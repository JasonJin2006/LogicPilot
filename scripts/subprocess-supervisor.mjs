// Async child-process supervisor for the kernel service path. Replaces
// execFileSync when the caller must keep serving the event loop: the child
// runs detached from the request thread, a deadline/abort reclaims the whole
// process tree, and every listener is removed once the call settles so no
// handle keeps the server process alive.

import { spawn } from 'node:child_process';

export const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const TREE_KILL_WAIT_MS = 5_000;
const CLOSE_AFTER_KILL_MS = 3_000;

export class ProcessTimeoutError extends Error {
  constructor(details = {}) {
    super('process exceeded its deadline and was terminated');
    this.name = 'ProcessTimeoutError';
    this.code = 'ETIMEDOUT';
    this.timedOut = true;
    this.stdout = details.stdout ?? '';
    this.stderr = details.stderr ?? '';
    this.exitCode = null;
    this.signalCode = details.signalCode ?? null;
    Error.captureStackTrace(this, ProcessTimeoutError);
  }
}

/**
 * Run `args` under `command` asynchronously. Resolves with
 * `{ stdout, stderr, exitCode, signalCode }` on exit 0; rejects with an error
 * carrying `stdout`/`stderr`/`exitCode`/`signalCode` on any other exit, with
 * ProcessTimeoutError when `timeoutMs` expires or `signal` aborts, and with
 * code `EOUTPUT` when combined output exceeds `maxOutputBytes`.
 *
 * On timeout/abort/overflow the whole process tree is reclaimed (taskkill
 * /T /F on Windows, SIGKILL to the process group on POSIX) and stdio pipes
 * are destroyed so no read stream stays open.
 */
export function execFileAsync({
  command,
  args = [],
  cwd,
  env,
  timeoutMs,
  signal,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
}) {
  return new Promise((resolveOuter, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // On POSIX the child leads its own group so the whole tree can be
        // killed with one signal; on Windows taskkill /T navigates the tree.
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      reject(wrapSpawnError(error));
      return;
    }
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let terminated = false;
    let closed = false;
    let timer = null;

    const stdout = () => Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = () => Buffer.concat(stderrChunks).toString('utf8');

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
      child.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
    };

    const release = () => {
      // Only the termination paths need to force-close pipes; a normal exit
      // already closed them. unref() is a no-op for a reaped child.
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref?.();
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveOuter(value);
    };

    const terminate = async (reason) => {
      if (settled || terminated) return;
      terminated = true;
      await killTree(child);
      await waitForClose(child, CLOSE_AFTER_KILL_MS, closed);
      if (reason === 'timeout') {
        fail(new ProcessTimeoutError({ stdout: stdout(), stderr: stderr() }));
        release();
        return;
      }
      if (reason === 'abort') {
        const error = new Error('process was aborted');
        error.code = 'EABORTED';
        error.aborted = true;
        error.stdout = stdout();
        error.stderr = stderr();
        fail(error);
        release();
        return;
      }
      const error = new Error('process output exceeded the supervisor limit');
      error.code = 'EOUTPUT';
      error.stdout = stdout();
      error.stderr = stderr();
      fail(error);
      release();
    };

    const onAbort = () => void terminate('abort');

    child.stdout.on('data', (chunk) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes + stderrBytes > maxOutputBytes) {
        void terminate('output');
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (settled) return;
      stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes > maxOutputBytes) {
        void terminate('output');
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on('error', (error) => {
      fail(error);
      release();
    });

    child.on('close', (code, signalCode) => {
      closed = true;
      if (settled) return;
      if (terminated) {
        // A timeout/abort/overflow is already owning the settle; the kill
        // sequence may have raced this close. Let terminate() decide.
        return;
      }
      settled = true;
      cleanup();
      if (code === 0) {
        resolveOuter({
          stdout: stdout(),
          stderr: stderr(),
          exitCode: 0,
          signalCode: null,
        });
        return;
      }
      const error = new Error(
        signalCode ? `process exited from signal ${signalCode}` : `process exited with code ${code}`,
      );
      error.stdout = stdout();
      error.stderr = stderr();
      error.exitCode = code;
      error.signalCode = signalCode;
      error.code = code ?? signalCode ?? 'EPROCESS';
      reject(error);
    });

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => void terminate('timeout'), timeoutMs);
    }
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Reclaim the process tree of `child`; best effort but waits for taskkill. */
function killTree(child) {
  return new Promise((resolve) => {
    const pid = child.pid;
    if (pid === undefined) {
      resolve();
      return;
    }
    if (process.platform !== 'win32') {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process may already be gone.
        }
      }
      resolve();
      return;
    }
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const guard = setTimeout(() => {
      try {
        killer.kill('SIGKILL');
      } catch {
        // Ignore; taskkill is already gone.
      }
      resolve();
    }, TREE_KILL_WAIT_MS);
    killer.on('error', () => {
      clearTimeout(guard);
      // taskkill can fail on the event loop level (missing binary); fall back
      // to a direct kill of the supervisor child.
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore.
      }
      resolve();
    });
    killer.on('close', (code) => {
      clearTimeout(guard);
      if (code !== 0) {
        // A taskkill exit code is meaningful: access denied, an already
        // reparented process, or a missing target can leave descendants. The
        // direct kill is only a fallback for the root, but is safer than
        // claiming the tree was reclaimed when the helper reported failure.
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore; the root may already have exited.
        }
      }
      resolve();
    });
    killer.once('close', () => {
      // The supervisor child's own close listener handles the rest; make sure
      // the helper leaves no listener behind.
      killer.removeAllListeners();
    });
  });
}

function waitForClose(child, timeoutMs, alreadyClosed = false) {
  return new Promise((resolve) => {
    if (alreadyClosed) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function wrapSpawnError(error) {
  const wrapped = new Error(
    error?.code === 'ENOENT'
      ? `cannot spawn ${error.path ?? 'process'}: not found`
      : `cannot spawn process: ${error?.message ?? String(error)}`,
  );
  wrapped.cause = error;
  wrapped.code = error?.code ?? 'ESPAWN';
  wrapped.stdout = '';
  wrapped.stderr = '';
  wrapped.exitCode = null;
  return wrapped;
}
