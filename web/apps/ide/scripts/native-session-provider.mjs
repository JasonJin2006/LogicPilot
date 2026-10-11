import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const TARGET_ID = 'logicpilot.native.session';
const MAX_STDERR_BYTES = 1 * 1024 * 1024;

/** Provider for the private native session-host protocol. The provider owns
 * one supervised host process per run; the kernel remains the only simulation
 * implementation. */
export function createNativeSessionProvider(options = {}) {
  const host = options.host ?? process.env.LOGICPILOT_SESSION_HOST;
  if (!host) throw new Error('native session host path is not configured');
  const target = {
    schema: 'logicpilot.execution-target/v1',
    contractVersion: 1,
    id: options.targetId ?? TARGET_ID,
    artifactRef: { artifactId: 'workspace.model' },
    runtime: { kind: 'native', pluginId: 'logicpilot.native.session' },
    capabilities: {
      cancel: true,
      telemetry: true,
      snapshot: true,
      eventStep: true,
      pause: true,
      resume: true,
      maxConcurrentRuns: 1,
    },
  };

  const start = async (request) => {
    const input = request.inputs;
    if (!input || typeof input !== 'object' || typeof input.dsl !== 'string')
      throw new Error('native session request requires inputs.dsl');
    const child = spawn(host, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const reader = createInterface({ input: child.stdout });
    let nextId = 1;
    let closed = false;
    const pending = new Map();
    let current = {
      schema: 'logicpilot.execution-session/v1',
      contractVersion: 1,
      runId: request.runId,
      requestId: request.requestId,
      targetId: request.targetId,
      artifactRef: request.artifactRef ?? target.artifactRef,
      status: 'preparing',
      stateVersion: 0,
      capabilities: target.capabilities,
      createdAt: new Date().toISOString(),
    };
    let resultResolve;
    let resultReject;
    let resultSettled = false;
    let wallTimer;
    let stderrBytes = 0;
    let paused = false;
    const listeners = new Set();
    const emit = (payload) => {
      for (const listener of listeners) listener(payload);
    };
    const result = new Promise((resolve, reject) => {
      resultResolve = resolve;
      resultReject = reject;
    });

    const cleanup = () => {
      if (closed) return;
      closed = true;
      reader.close();
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (wallTimer !== undefined) clearTimeout(wallTimer);
      for (const reject of pending.values()) reject(new Error('native session host closed'));
      pending.clear();
    };
    const settle = (value, error) => {
      if (resultSettled) return;
      resultSettled = true;
      if (error) resultReject(error);
      else resultResolve(value);
    };
    const transition = (status, error) => {
      current = {
        ...current,
        status,
        stateVersion: current.stateVersion + 1,
        ...(status === 'running' ? { startedAt: new Date().toISOString() } : {}),
        ...(status === 'completed' || status === 'failed' || status === 'cancelled'
          ? { finishedAt: new Date().toISOString() }
          : {}),
        ...(error === undefined ? {} : { error }),
      };
    };
    const send = (kind, fields = {}) => {
      if (closed) return Promise.reject(new Error('native session host is closed'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, kind, ...fields }) + '\n');
      });
    };
    reader.on('line', (line) => {
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        return;
      }
      const waiter = pending.get(value.id);
      if (!waiter) return;
      pending.delete(value.id);
      if (value.ok === false) waiter.reject(new Error(value.error ?? 'native session failed'));
      else waiter.resolve(value);
    });
    child.once('error', (error) => {
      cleanup();
      settle(undefined, error);
    });
    child.stderr?.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES && !resultSettled) {
        transition('failed', 'native session stderr quota exceeded');
        settle(undefined, new Error('native session stderr quota exceeded'));
        cleanup();
        child.kill();
      }
    });
    child.once('close', (code) => {
      cleanup();
      if (!resultSettled && code !== 0)
        settle(undefined, new Error('native session host exited with code ' + code));
    });

    const hello = await send('hello');
    if (hello.protocol !== 'logicpilot.native-session/v1' || hello.version !== 1)
      throw new Error('native session protocol handshake failed');
    const params = input.runParams ?? {};
    const start = await send('start', {
      dsl: input.dsl,
      seed: request.seed ?? params.seed ?? 42,
      arrivals: params.arrivals ?? 4000,
      warmup: params.warmup ?? 0,
      maxEvents: request.budget?.maxSteps ?? 50_000_000,
    });
    if (start.ok !== true) throw new Error(start.error ?? 'native session start failed');
    transition('running');
    emit({ type: 'session-started', simTimeNs: start.simTimeNs ?? 0, pending: start.pending });
    const autoFinish = input.executionMode !== 'animated' && input.autoFinish !== false;
    const finishAutomatically = async () => {
      try {
        await send('finish');
        if (current.status === 'cancelled') return;
        transition('finalizing');
        transition('completed');
        settle({
          run: {
            schema: 'logicpilot.execution-run/v1',
            contractVersion: 1,
            runId: request.runId,
            requestId: request.requestId,
            targetId: request.targetId,
            artifactRef: request.artifactRef ?? target.artifactRef,
            seed: request.seed ?? params.seed ?? 42,
            status: 'completed',
          },
        });
        await send('shutdown').catch(() => undefined);
        cleanup();
      } catch (error) {
        transition('failed', error.message);
        settle(undefined, error);
        cleanup();
      }
    };
    if (autoFinish) void finishAutomatically();

    const handle = {
      session: current,
      snapshot: () => current,
      result,
      control: async (action) => {
        if (action === 'pause') {
          paused = true;
          transition('paused');
          emit({ type: 'paused' });
          return;
        }
        if (action === 'resume') {
          paused = false;
          transition('running');
          emit({ type: 'resumed' });
          return;
        }
        const stepped = await send('step', { events: 1 });
        current = { ...current, stateVersion: current.stateVersion + 1 };
        emit({
          type: 'step',
          dispatched: stepped.dispatched ?? 0,
          simTimeNs: stepped.simTimeNs ?? 0,
          pending: stepped.pending,
          telemetry: stepped.telemetry ?? {},
        });
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      cancel: async () => {
        if (current.status === 'completed' || current.status === 'cancelled') return;
        transition('cancelling');
        await send('abort').catch(() => undefined);
        transition('cancelled');
        settle({
          run: {
            schema: 'logicpilot.execution-run/v1',
            contractVersion: 1,
            runId: request.runId,
            requestId: request.requestId,
            targetId: request.targetId,
            artifactRef: request.artifactRef ?? target.artifactRef,
            seed: request.seed ?? params.seed ?? 42,
            status: 'cancelled',
          },
        });
        cleanup();
        child.kill();
      },
    };
    if (!autoFinish && input.executionMode === 'animated') {
      void (async () => {
        let simTimeNs = start.simTimeNs ?? 0;
        try {
          while (!resultSettled && !closed) {
            if (paused) {
              await new Promise((resolve) => setTimeout(resolve, 20));
              continue;
            }
            const advanced = await send('advance', { untilNs: simTimeNs + 100_000_000 });
            simTimeNs = advanced.simTimeNs ?? simTimeNs;
            emit({
              type: 'advance',
              dispatched: advanced.dispatched ?? 0,
              simTimeNs,
              pending: advanced.pending,
              telemetry: advanced.telemetry ?? {},
            });
            if (!advanced.pending) {
              await finishAutomatically();
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } catch (error) {
          transition('failed', error.message);
          settle(undefined, error);
          cleanup();
        }
      })();
    }
    if (Number.isSafeInteger(request.budget?.maxWallMs)) {
      wallTimer = setTimeout(() => void handle.cancel(), request.budget.maxWallMs);
    }
    return handle;
  };
  return {
    target,
    start,
    execute: async (request) => (await start(request)).result,
  };
}

export { TARGET_ID as NATIVE_SESSION_TARGET_ID };
