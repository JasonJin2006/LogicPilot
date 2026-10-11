import { spawn } from 'node:child_process';

const MAX_FRAME_BYTES = 256 * 1024;

function forceKill(pid: number | undefined): void {
  if (pid === undefined) return;
  // SIGKILL already went out; escalate to a hard tree kill so a stuck runner
  // can never outlive the timeout that was supposed to reclaim it.
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => undefined);
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/** One component instance per process. Lifecycle and capability IDs are separate
 * namespaces. Any transport failure is terminal and reclaims the instance. */
export function createComponentRunnerController(
  runner: string,
  component: string,
  pluginId: string,
  timeoutMs = 10_000,
  invoke?: (capability: string, payload: unknown) => unknown | Promise<unknown>,
  capabilities: ReadonlySet<string> = new Set(),
  maxMemoryBytes = 64 * 1024 * 1024,
) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maxMemoryBytes) ||
    maxMemoryBytes < 65536
  )
    throw new Error('invalid component runtime limits');
  let child: ReturnType<typeof spawn> | undefined;
  let closePromise: Promise<void> | undefined;
  let stopped = false;
  let closed = false;
  let sequence = 0;
  let buffer = '';
  let bytes = 0;
  let pending: { id: number; resolve(): void; reject(error: Error): void } | undefined;
  const rpcIds = new Set<number>();
  let stopping: Promise<void> | undefined;
  const error = (message: string) => new Error(`component '${pluginId}': ${message}`);
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopped = true;
    stopping = (async () => {
      if (!child || closed) return;
      const pid = child.pid;
      child.kill('SIGKILL');
      let timer: unknown;
      try {
        await Promise.race([
          closePromise,
          new Promise<void>((_, reject) => {
            timer = setTimeout(() => reject(error('runner did not terminate')), 3000);
          }),
        ]);
      } catch {
        // The graceful kill did not land within the window; escalate to a
        // forced tree kill so the child cannot outlive this call.
        forceKill(pid);
      } finally {
        clearTimeout(timer);
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    })();
    return stopping;
  };
  const fail = (reason: Error) => {
    pending?.reject(reason);
    pending = undefined;
    void stop().catch(() => undefined);
  };
  const write = (value: unknown) => {
    if (!child || closed || stopped) return;
    const line = JSON.stringify(value);
    if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) throw error('RPC frame too large');
    child.stdin!.write(`${line}\n`);
  };
  const receive = (line: string) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    if (!message || !Number.isSafeInteger(message.id) || (message.id as number) < 1)
      throw error('invalid response id');
    const id = message.id as number;
    if (message.kind === 'capability-request') {
      if (rpcIds.has(id) || rpcIds.size >= 32) throw error('capability RPC limit');
      if (typeof message.capability !== 'string' || typeof message.payloadJson !== 'string')
        throw error('invalid capability request');
      const capability = message.capability;
      const payload: unknown = JSON.parse(message.payloadJson);
      rpcIds.add(id);
      void Promise.resolve()
        .then(() => {
          if (!capabilities.has(capability)) throw error('permission-denied');
          if (!invoke) throw error('capability broker unavailable');
          return invoke(capability, payload);
        })
        .then(
          (value) =>
            write({
              kind: 'capability-response',
              id,
              ok: true,
              payloadJson: JSON.stringify(value ?? null),
            }),
          () =>
            write({
              kind: 'capability-response',
              id,
              ok: false,
              payloadJson: 'null',
              errorCode: 'capability-denied',
            }),
        )
        .catch((reason) => fail(reason instanceof Error ? reason : error('RPC failed')))
        .finally(() => rpcIds.delete(id));
      return;
    }
    if (
      message.kind !== undefined ||
      !pending ||
      pending.id !== id ||
      typeof message.ok !== 'boolean'
    )
      throw error('unexpected lifecycle response');
    const current = pending;
    pending = undefined;
    if (message.ok) current.resolve();
    else
      current.reject(error(typeof message.error === 'string' ? message.error : 'lifecycle failed'));
  };
  const start = () => {
    if (child) return;
    child = spawn(
      runner,
      [
        component,
        '--max-memory-bytes',
        String(maxMemoryBytes),
        '--capability-timeout-ms',
        String(timeoutMs),
        ...[...capabilities].flatMap((capability) => ['--capability', capability]),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    closePromise = new Promise<void>((resolve) =>
      child!.once('close', () => {
        closed = true;
        resolve();
        if (pending) fail(error('runner closed before responding'));
      }),
    );
    child.once('error', () => fail(error('runner could not start')));
    child.once('exit', () => {
      if (pending) fail(error('runner exited before responding'));
    });
    child.stdin!.once('error', () => fail(error('runner input closed')));
    child.stderr!.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) fail(error('runner output limit'));
    });
    child.stdout!.on('data', (chunk: Buffer) => {
      if (stopped) return;
      bytes += chunk.length;
      buffer += chunk.toString('utf8');
      try {
        if (bytes > 4 * 1024 * 1024 || Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES)
          throw error('runner output limit');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) receive(line);
        }
      } catch (reason) {
        fail(reason instanceof Error ? reason : error('invalid RPC'));
      }
    });
  };
  const call = async (kind: 'activate' | 'deactivate') => {
    if (stopped || closed) throw error('runner stopped');
    if (pending) throw error('concurrent lifecycle request');
    let timer: unknown;
    try {
      await new Promise<void>((resolve, reject) => {
        pending = { id: ++sequence, resolve, reject };
        timer = setTimeout(() => fail(error(`${kind} timed out`)), timeoutMs);
        start();
        write({ id: sequence, kind });
      });
    } catch (reason) {
      await stop();
      throw reason;
    } finally {
      clearTimeout(timer);
      pending = undefined;
    }
  };
  return {
    activate: () => call('activate'),
    deactivate: async () => {
      try {
        if (child && !stopped && !closed) await call('deactivate');
      } finally {
        await stop();
      }
    },
  };
}
