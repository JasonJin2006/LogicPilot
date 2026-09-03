import type {
  ExecutionEvidence,
  ExecutionRequest,
  ExecutionRun,
  ExecutionTarget,
} from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface ExecutionProviderResult {
  readonly run: ExecutionRun;
  readonly evidence?: ExecutionEvidence;
}

export interface ExecutionTargetProvider {
  readonly target: ExecutionTarget;
  execute(request: ExecutionRequest): Promise<ExecutionProviderResult>;
  cancel?(requestId: string): Promise<void> | void;
}

/** Host-owned execution boundary. Runtime plugins may provide targets, but
 * they cannot bypass contract validation or bind a result to another target. */
export class ExecutionTargetRegistry {
  private readonly providers = new Map<string, ExecutionTargetProvider>();

  register(provider: ExecutionTargetProvider): () => void {
    const checked = validateContract('ExecutionTarget', provider.target);
    if (!checked.ok) throw new Error(`invalid execution target: ${checked.errors.join('; ')}`);
    if (this.providers.has(checked.value.id))
      throw new Error(`execution target '${checked.value.id}' already registered`);
    this.providers.set(checked.value.id, { ...provider, target: checked.value });
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
    const provider = this.providers.get(targetId);
    if (!provider) throw new Error(`execution target '${targetId}' is not registered`);
    const checkedRequest = validateContract('ExecutionRequest', request);
    if (!checkedRequest.ok)
      throw new Error(`invalid execution request: ${checkedRequest.errors.join('; ')}`);
    if (checkedRequest.value.targetId !== targetId)
      throw new Error('execution request target id mismatch');
    const result = await provider.execute(checkedRequest.value);
    const checkedRun = validateContract('ExecutionRun', result.run);
    if (!checkedRun.ok) throw new Error(`invalid execution run: ${checkedRun.errors.join('; ')}`);
    if (checkedRun.value.targetId !== targetId) throw new Error('execution run target id mismatch');
    if (result.evidence !== undefined) {
      const checkedEvidence = validateContract('ExecutionEvidence', result.evidence);
      if (!checkedEvidence.ok)
        throw new Error(`invalid execution evidence: ${checkedEvidence.errors.join('; ')}`);
      if (checkedEvidence.value.runId !== checkedRun.value.runId)
        throw new Error('execution evidence run id mismatch');
      return { run: checkedRun.value, evidence: checkedEvidence.value };
    }
    return { run: checkedRun.value };
  }

  cancel(targetId: string, requestId: string): void | Promise<void> {
    return this.providers.get(targetId)?.cancel?.(requestId);
  }
}
