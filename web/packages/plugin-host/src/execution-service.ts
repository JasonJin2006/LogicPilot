import type {
  ExecutionCommandAck,
  ExecutionEvent,
  ExecutionRequest,
  ExecutionSession,
} from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
import {
  ExecutionTargetRegistry,
  type ExecutionProviderResult,
  type ExecutionSessionHandle,
} from './execution-target-registry.js';

export interface ExecutionServiceOptions {
  readonly registry: ExecutionTargetRegistry;
  readonly maxActiveRuns?: number;
  readonly store?: ExecutionRunStore;
}

export interface ExecutionRunStore {
  list(): readonly ExecutionSession[];
  upsert(session: ExecutionSession): void;
}

interface RunRecord {
  readonly request: ExecutionRequest;
  readonly fingerprint: string;
  readonly handle: ExecutionSessionHandle;
  readonly commands: Map<string, ExecutionCommandAck>;
  readonly events: ExecutionEvent[];
  readonly listeners: Set<(event: ExecutionEvent) => void>;
  providerUnsubscribe?: () => void;
}

export interface ExecutionEventQuery {
  readonly session: ExecutionSession;
  readonly events: readonly ExecutionEvent[];
  readonly nextSeq: number;
  readonly gap: boolean;
}

/** One orchestration boundary for canvas, AI and background execution.
 * Providers remain in ExecutionTargetRegistry; this service owns run identity,
 * request idempotency and command state. */
export class ExecutionService {
  private readonly registry: ExecutionTargetRegistry;
  private readonly maxActiveRuns: number;
  private readonly store?: ExecutionRunStore;
  private readonly byRunId = new Map<string, RunRecord>();
  private readonly byRequestId = new Map<string, RunRecord>();
  private activeRuns = 0;
  private sequence = 0;

  constructor(options: ExecutionServiceOptions) {
    this.registry = options.registry;
    this.maxActiveRuns = options.maxActiveRuns ?? 4;
    this.store = options.store;
    for (const persisted of options.store?.list() ?? []) {
      const recovered = isTerminal(persisted)
        ? persisted
        : {
            ...persisted,
            status: 'failed' as const,
            stateVersion: persisted.stateVersion + 1,
            finishedAt: new Date().toISOString(),
            error: 'execution was interrupted before the service restarted',
          };
      this.persist(recovered);
    }
  }

  async start(request: unknown): Promise<ExecutionSession> {
    const checked = validateContract('ExecutionRequest', request);
    if (!checked.ok) throw new Error('invalid execution request: ' + checked.errors.join('; '));
    const normalized = checked.value;
    const fingerprint = canonical(normalized);
    const existing = this.byRequestId.get(normalized.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error('execution request id was reused with a different payload');
      return existing.handle.snapshot();
    }
    if (this.activeRuns >= this.maxActiveRuns) throw new Error('execution run quota exceeded');
    const requestWithRunId: ExecutionRequest = {
      ...normalized,
      runId: normalized.runId ?? this.nextRunId(),
    };
    const target = this.registry.get(requestWithRunId.targetId);
    if (!target)
      throw new Error('execution target ' + requestWithRunId.targetId + ' is not registered');
    const initial: ExecutionSession = {
      schema: 'logicpilot.execution-session/v1',
      contractVersion: 1,
      runId: requestWithRunId.runId!,
      requestId: requestWithRunId.requestId,
      targetId: requestWithRunId.targetId,
      ...(requestWithRunId.artifactRef === undefined
        ? {}
        : { artifactRef: requestWithRunId.artifactRef }),
      status: 'queued',
      stateVersion: 0,
      capabilities: target.target.capabilities ?? {
        cancel: target.cancel !== undefined,
        telemetry: false,
        snapshot: true,
      },
      createdAt: new Date().toISOString(),
    };
    this.persist(initial);
    this.activeRuns += 1;
    let handle: ExecutionSessionHandle;
    try {
      handle = await this.registry.start(requestWithRunId.targetId, requestWithRunId);
    } catch (error) {
      this.activeRuns -= 1;
      throw error;
    }
    const record: RunRecord = {
      request: requestWithRunId,
      fingerprint,
      handle,
      commands: new Map(),
      events: [],
      listeners: new Set(),
    };
    this.byRunId.set(handle.session.runId, record);
    this.byRequestId.set(requestWithRunId.requestId, record);
    record.providerUnsubscribe = handle.subscribe?.((payload) =>
      this.emit(record, 'telemetry', payload),
    );
    this.persist(handle.snapshot());
    this.emit(record, 'state', handle.snapshot());
    void handle.result
      .then(
        () => {
          record.providerUnsubscribe?.();
          this.persist(handle.snapshot());
          this.emit(record, 'terminal', handle.snapshot());
        },
        () => {
          record.providerUnsubscribe?.();
          this.persist(handle.snapshot());
          this.emit(record, 'terminal', handle.snapshot());
        },
      )
      .finally(() => {
        this.activeRuns = Math.max(0, this.activeRuns - 1);
      })
      .catch(() => undefined);
    return handle.snapshot();
  }

  get(runId: string): ExecutionSession | undefined {
    return (
      this.byRunId.get(runId)?.handle.snapshot() ??
      this.store?.list().find((item) => item.runId === runId)
    );
  }

  list(): readonly ExecutionSession[] {
    const sessions = new Map<string, ExecutionSession>();
    for (const session of this.store?.list() ?? []) sessions.set(session.runId, session);
    for (const record of this.byRunId.values())
      sessions.set(record.handle.session.runId, record.handle.snapshot());
    return [...sessions.values()];
  }

  events(runId: string, afterSeq = -1, limit = 100): ExecutionEventQuery | undefined {
    const record = this.byRunId.get(runId);
    const session =
      record?.handle.snapshot() ?? this.store?.list().find((item) => item.runId === runId);
    if (!session) return undefined;
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const events = record?.events ?? [];
    const earliest = events[0]?.seq ?? 0;
    const gap = events.length > 0 && afterSeq < earliest - 1;
    return {
      session,
      events: events.filter((event) => event.seq > afterSeq).slice(0, boundedLimit),
      nextSeq: events.at(-1)?.seq ?? afterSeq,
      gap,
    };
  }

  subscribe(
    runId: string,
    afterSeq: number,
    listener: (event: ExecutionEvent) => void,
  ): { readonly initial: ExecutionEventQuery | undefined; readonly unsubscribe: () => void } {
    const record = this.byRunId.get(runId);
    const initial = this.events(runId, afterSeq);
    if (!record) return { initial, unsubscribe: () => undefined };
    record.listeners.add(listener);
    return {
      initial,
      unsubscribe: () => record.listeners.delete(listener),
    };
  }

  async wait(runId: string): Promise<ExecutionProviderResult> {
    const record = this.byRunId.get(runId);
    if (!record) throw new Error('execution run was not found');
    return record.handle.result;
  }

  async command(input: unknown): Promise<ExecutionCommandAck> {
    const checked = validateContract('ExecutionCommand', input);
    if (!checked.ok) throw new Error('invalid execution command: ' + checked.errors.join('; '));
    const command = checked.value;
    const record = this.byRunId.get(command.runId);
    if (!record) throw new Error('execution run was not found');
    const previous = record.commands.get(command.commandId);
    if (previous) return previous;
    const current = record.handle.snapshot();
    if (current.stateVersion !== command.expectedStateVersion) {
      return this.rememberCommand(record, {
        schema: 'logicpilot.execution-command-ack/v1',
        contractVersion: 1,
        commandId: command.commandId,
        runId: command.runId,
        accepted: false,
        stateVersion: current.stateVersion,
        status: current.status,
        errorCode: 'state-version-mismatch',
        error: 'execution state changed; refresh the session snapshot',
      });
    }
    const capability =
      command.action === 'pause'
        ? current.capabilities.pause
        : command.action === 'resume'
          ? current.capabilities.resume
          : command.action === 'step'
            ? current.capabilities.eventStep
            : current.capabilities.cancel;
    if (!capability) {
      return this.rememberCommand(record, {
        schema: 'logicpilot.execution-command-ack/v1',
        contractVersion: 1,
        commandId: command.commandId,
        runId: command.runId,
        accepted: false,
        stateVersion: current.stateVersion,
        status: current.status,
        errorCode: 'capability-unsupported',
        error: 'execution provider does not support this command',
      });
    }
    if (command.action === 'pause' || command.action === 'resume' || command.action === 'step') {
      if (record.handle.control === undefined)
        throw new Error('execution provider declared control capability without a control handle');
      await record.handle.control(command.action);
    } else {
      await record.handle.cancel();
    }
    const next = record.handle.snapshot();
    this.persist(next);
    return this.rememberCommand(record, {
      schema: 'logicpilot.execution-command-ack/v1',
      contractVersion: 1,
      commandId: command.commandId,
      runId: command.runId,
      accepted: true,
      stateVersion: next.stateVersion,
      status: next.status,
    });
  }

  private rememberCommand(record: RunRecord, ack: ExecutionCommandAck): ExecutionCommandAck {
    record.commands.set(ack.commandId, ack);
    this.emit(record, ack.accepted ? 'state' : 'diagnostic', ack);
    return ack;
  }

  private nextRunId(): string {
    return 'run-' + Date.now().toString(36) + '-' + (++this.sequence).toString(36);
  }

  private persist(session: ExecutionSession): void {
    this.store?.upsert(session);
  }

  private emit(record: RunRecord, kind: ExecutionEvent['kind'], payload: unknown): void {
    const previous = record.events.at(-1);
    const event: ExecutionEvent = {
      schema: 'logicpilot.execution-event/v1',
      contractVersion: 1,
      runId: record.handle.session.runId,
      seq: previous === undefined ? 0 : previous.seq + 1,
      kind,
      payload: payload as ExecutionEvent['payload'],
    };
    record.events.push(event);
    if (record.events.length > 256) record.events.splice(0, record.events.length - 256);
    for (const listener of record.listeners) {
      try {
        listener(event);
      } catch {
        // A slow/broken subscriber cannot break execution state progression.
      }
    }
  }
}

function isTerminal(session: ExecutionSession): boolean {
  return (
    session.status === 'completed' || session.status === 'cancelled' || session.status === 'failed'
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(object)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(object[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}
