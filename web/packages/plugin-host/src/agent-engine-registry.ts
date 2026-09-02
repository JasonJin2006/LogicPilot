import type {
  AgentEngineDescriptor,
  AgentStepRequest,
  AgentStepResult,
} from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface AgentEngine {
  readonly descriptor: AgentEngineDescriptor;
  runStep(request: AgentStepRequest): Promise<AgentStepResult>;
  cancel?(turnId: string): Promise<void> | void;
}

/** Registry for builtin and SDK-backed agent loops. Engines only reason over
 * the compiled request; tool execution, grants, transactions and evidence
 * remain owned by LogicPilot. */
export class AgentEngineRegistry {
  private readonly engines = new Map<string, AgentEngine>();

  register(engine: AgentEngine): () => void {
    const descriptor = validateContract('AgentEngineDescriptor', engine.descriptor);
    if (!descriptor.ok) throw new Error(`invalid agent engine: ${descriptor.errors.join('; ')}`);
    if (this.engines.has(descriptor.value.id))
      throw new Error(`agent engine '${descriptor.value.id}' already registered`);
    const stored = { ...engine, descriptor: descriptor.value };
    this.engines.set(descriptor.value.id, stored);
    return () => {
      if (this.engines.get(descriptor.value.id) === stored)
        this.engines.delete(descriptor.value.id);
    };
  }

  get(id: string): AgentEngine | undefined {
    return this.engines.get(id);
  }

  list(): readonly AgentEngineDescriptor[] {
    return [...this.engines.values()].map((engine) => engine.descriptor);
  }

  async runStep(engineId: string, request: unknown): Promise<AgentStepResult> {
    const engine = this.engines.get(engineId);
    if (!engine) throw new Error(`agent engine '${engineId}' is not registered`);
    const validated = validateContract('AgentStepRequest', request);
    if (!validated.ok)
      throw new Error(`invalid agent step request: ${validated.errors.join('; ')}`);
    if (validated.value.engineId !== engineId) throw new Error('agent request engine id mismatch');
    const result = await engine.runStep(validated.value);
    const checked = validateContract('AgentStepResult', result);
    if (!checked.ok) throw new Error(`invalid agent step result: ${checked.errors.join('; ')}`);
    return checked.value;
  }
}
