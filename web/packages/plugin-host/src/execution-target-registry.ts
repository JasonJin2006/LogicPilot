import type {
  ExecutionEvidence,
  ExecutionProviderCapabilities,
  ExecutionRequest,
  ExecutionRun,
  ExecutionSession,
  ExecutionTarget,
} from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface ExecutionProviderResult {
  readonly run: ExecutionRun;
  readonly evidence?: ExecutionEvidence;
  /** Optional provider payload for callers such as AI experiments. The
   * canonical run/evidence remain authoritative for lifecycle and archive
   * checks; this field carries method-specific result data without creating a
   * second execution channel. */
  readonly output?: unknown;
}

export interface ExecutionSessionHandle {
  readonly session: ExecutionSession;
  snapshot(): ExecutionSession;
  readonly result: Promise<ExecutionProviderResult>;
  control?(action: 'pause' | 'resume' | 'step'): Promise<void>;
  subscribe?(listener: (payload: unknown) => void): () => void;
  cancel(): Promise<void>;
}

export interface ExecutionTargetProvider {
  readonly target: ExecutionTarget;
  execute(request: ExecutionRequest): Promise<ExecutionProviderResult>;
  start?(request: ExecutionRequest): Promise<ExecutionSessionHandle>;
  cancel?(requestId: string): Promise<void> | void;
}

/** Host-owned execution boundary. Runtime plugins may provide targets, but
 * they cannot bypass contract validation or bind a result to another target. */
export class ExecutionTargetRegistry {
  private readonly providers = new Map<string, ExecutionTargetProvider>();
  private activeExecutions = 0;
  private accepting = true;
  private idleWaiters: Array<() => void> = [];

  /** Stop admitting new runs and resolve when all already-admitted runs settle. */
  async beginDrain(): Promise<void> {
    this.accepting = false;
    if (this.activeExecutions === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  /** Resume admissions after a successful or rolled-back host transition. */
  resume(): void {
    this.accepting = true;
  }

  register(provider: ExecutionTargetProvider): () => void {
    const checked = validateContract('ExecutionTarget', provider.target);
    if (!checked.ok) throw new Error(`invalid execution target: ${checked.errors.join('; ')}`);
    if (this.providers.has(checked.value.id))
      throw new Error(`execution target '${checked.value.id}' already registered`);
    // Do not spread the provider here. `execute` and `cancel` are commonly
    // prototype methods on a class instance and would disappear when the
    // instance is copied with object spread. Bind the methods explicitly so
    // both plain objects and class providers retain their receiver.
    const registered: ExecutionTargetProvider = {
      target: checked.value,
      execute: provider.execute.bind(provider),
      ...(provider.start === undefined ? {} : { start: provider.start.bind(provider) }),
      ...(provider.cancel === undefined ? {} : { cancel: provider.cancel.bind(provider) }),
    };
    this.providers.set(checked.value.id, registered);
    return () => {
      if (this.providers.get(checked.value.id)?.target === checked.value)
        this.providers.delete(checked.value.id);
    };
  }

  get(id: string): ExecutionTargetProvider | undefined {
    return this.providers.get(id);
  }

  list(): readonly ExecutionTarget[] {
    return [...this.providers.values()].map((provider) => provider.target);
  }

  async execute(targetId: string, request: unknown): Promise<ExecutionProviderResult> {
    const handle = await this.start(targetId, request);
    return handle.result;
  }

  async start(targetId: string, request: unknown): Promise<ExecutionSessionHandle> {
    if (!this.accepting) throw new Error('execution registry is draining');
    this.activeExecutions += 1;
    try {
      const provider = this.providers.get(targetId);
      if (!provider) throw new Error('execution target ' + targetId + ' is not registered');
      const checked = this.validateRequest(targetId, provider, request);
      const handle =
        provider.start === undefined
          ? this.createCompatibilitySession(provider, checked.value)
          : await provider.start(checked.value);
      const checkedSession = validateContract('ExecutionSession', handle.session);
      if (!checkedSession.ok)
        throw new Error('invalid execution session: ' + checkedSession.errors.join('; '));
      if (checkedSession.value.requestId !== checked.value.requestId)
        throw new Error('execution session request id mismatch');
      if (checkedSession.value.targetId !== targetId)
        throw new Error('execution session target id mismatch');
      if (checked.value.runId !== undefined && checkedSession.value.runId !== checked.value.runId)
        throw new Error('execution session run id mismatch');
      return {
        ...handle,
        result: handle.result
          .then((value) => this.validateResult(targetId, provider, checked.value, value))
          .finally(() => this.releaseExecution()),
      };
    } catch (error) {
      this.releaseExecution();
      throw error;
    }
  }

  private validateRequest(targetId: string, provider: ExecutionTargetProvider, request: unknown) {
    const checkedRequest = validateContract('ExecutionRequest', request);
    if (!checkedRequest.ok)
      throw new Error('invalid execution request: ' + checkedRequest.errors.join('; '));
    if (checkedRequest.value.targetId !== targetId)
      throw new Error('execution request target id mismatch');
    if (
      checkedRequest.value.artifactRef !== undefined &&
      (checkedRequest.value.artifactRef.artifactId !== provider.target.artifactRef.artifactId ||
        (provider.target.artifactRef.revisionId !== undefined &&
          checkedRequest.value.artifactRef.revisionId !== provider.target.artifactRef.revisionId))
    )
      throw new Error('execution request artifact reference mismatch');
    return checkedRequest;
  }

  private validateResult(
    targetId: string,
    provider: ExecutionTargetProvider,
    request: ExecutionRequest,
    result: ExecutionProviderResult,
  ): ExecutionProviderResult {
    const checkedRun = validateContract('ExecutionRun', result.run);
    if (!checkedRun.ok) throw new Error('invalid execution run: ' + checkedRun.errors.join('; '));
    if (checkedRun.value.targetId !== targetId) throw new Error('execution run target id mismatch');
    if (checkedRun.value.requestId !== request.requestId)
      throw new Error('execution run request id mismatch');
    if (request.runId !== undefined && checkedRun.value.runId !== request.runId)
      throw new Error('execution run id mismatch');
    const expectedArtifact = request.artifactRef ?? provider.target.artifactRef;
    if (!sameArtifactRef(checkedRun.value.artifactRef, expectedArtifact))
      throw new Error('execution run artifact reference mismatch');
    if (request.seed !== undefined && checkedRun.value.seed !== request.seed)
      throw new Error('execution run seed mismatch');
    if (result.evidence !== undefined) {
      const checkedEvidence = validateContract('ExecutionEvidence', result.evidence);
      if (!checkedEvidence.ok)
        throw new Error('invalid execution evidence: ' + checkedEvidence.errors.join('; '));
      if (checkedEvidence.value.runId !== checkedRun.value.runId)
        throw new Error('execution evidence run id mismatch');
      const evidence = checkedEvidence.value;
      if (evidence.details && evidence.details.kind !== evidence.runtimeKind)
        throw new Error('execution evidence runtime kind mismatch');
      if (evidence.conformance?.passed === false && checkedRun.value.status === 'completed')
        throw new Error('completed execution cannot contain failed conformance');
      return {
        run: checkedRun.value,
        evidence: checkedEvidence.value,
        ...(result.output === undefined ? {} : { output: result.output }),
      };
    }
    return {
      run: checkedRun.value,
      ...(result.output === undefined ? {} : { output: result.output }),
    };
  }

  private createCompatibilitySession(
    provider: ExecutionTargetProvider,
    request: ExecutionRequest,
  ): ExecutionSessionHandle {
    const runId =
      'execution-' + Date.now().toString(36) + '-' + (++compatibilityRunSequence).toString(36);
    const createdAt = new Date().toISOString();
    const capabilities: ExecutionProviderCapabilities = {
      ...(provider.target.capabilities ?? {}),
      cancel: provider.target.capabilities?.cancel ?? provider.cancel !== undefined,
      telemetry: provider.target.capabilities?.telemetry ?? false,
      snapshot: provider.target.capabilities?.snapshot ?? true,
    };
    let current: ExecutionSession = {
      schema: 'logicpilot.execution-session/v1',
      contractVersion: 1,
      runId: request.runId ?? runId,
      requestId: request.requestId,
      targetId: request.targetId,
      ...(request.artifactRef === undefined ? {} : { artifactRef: request.artifactRef }),
      status: 'preparing',
      stateVersion: 0,
      capabilities,
      createdAt,
    };
    const snapshot = () => current;
    const transition = (status: ExecutionSession['status'], error?: string) => {
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
    const result = Promise.resolve()
      .then(() => {
        transition('running');
        return provider.execute(request);
      })
      .then((value) => {
        transition('finalizing');
        transition(value.run.status === 'completed' ? 'completed' : 'failed', value.run.error);
        return value;
      })
      .catch((error: unknown) => {
        transition('failed', error instanceof Error ? error.message : String(error));
        throw error;
      });
    return {
      session: current,
      snapshot,
      result,
      cancel: async () => {
        if (provider.cancel === undefined)
          throw new Error('execution provider does not support cancel');
        await provider.cancel(request.requestId);
      },
    };
  }

  private releaseExecution(): void {
    this.activeExecutions -= 1;
    if (this.activeExecutions === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  cancel(targetId: string, requestId: string): void | Promise<void> {
    return this.providers.get(targetId)?.cancel?.(requestId);
  }
}

let compatibilityRunSequence = 0;

function sameArtifactRef(
  left: ExecutionRun['artifactRef'],
  right: ExecutionTarget['artifactRef'],
): boolean {
  return left.artifactId === right.artifactId && left.revisionId === right.revisionId;
}
