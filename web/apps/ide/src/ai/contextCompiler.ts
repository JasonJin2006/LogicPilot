import type { PluginRegistrySnapshot } from '../plugins/registry';

export interface ContextCompilerScope {
  readonly documentType?: string | null;
  readonly paradigm?: string | null;
  readonly domain?: string | null;
}

export interface CompiledAgentContext {
  readonly generation: number;
  readonly knowledge?: string;
  readonly skills?: string;
  readonly instructions?: string;
  readonly diagnosticDefinitions?: string;
}

const DEFAULT_MAX_CHARS = 12_000;

function boundedJson(values: readonly unknown[], maxChars: number): string | undefined {
  const selected: unknown[] = [];
  let size = 2;
  for (const value of values) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) continue;
    const nextSize = size + (selected.length === 0 ? 0 : 1) + encoded.length;
    if (nextSize > maxChars) break;
    selected.push(value);
    size = nextSize;
  }
  return selected.length === 0 ? undefined : JSON.stringify(selected);
}

function appliesToScope(
  scope:
    { readonly paradigms?: readonly string[]; readonly domains?: readonly string[] } | undefined,
  query: ContextCompilerScope,
): boolean {
  if (query.paradigm && scope?.paradigms && !scope.paradigms.includes(query.paradigm)) return false;
  if (query.domain && scope?.domains && !scope.domains.includes(query.domain)) return false;
  return true;
}

/** Compile one generation of plugin contributions into deterministic,
 * structured model context. Display/localization text is not expanded here;
 * the model receives IDs, references, formulas and bounded JSON blocks. */
export function compilePluginContext(
  snapshot: PluginRegistrySnapshot,
  scope: ContextCompilerScope = {},
  maxChars = DEFAULT_MAX_CHARS,
): CompiledAgentContext {
  if (!Number.isSafeInteger(maxChars) || maxChars < 256)
    throw new Error('context compiler maxChars must be at least 256');
  const contributions = [...snapshot.contributions].sort((left, right) =>
    left.pluginId.localeCompare(right.pluginId),
  );
  const knowledge = contributions
    .flatMap((set) => set.knowledge)
    .filter((block) => block.status === 'trusted' && appliesToScope(block.scope, scope))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((block) => ({
      id: block.id,
      version: block.version,
      owner: block.owner,
      type: block.type,
      scope: block.scope,
      dependencies: block.dependencies,
      conflicts: block.conflicts,
      supersedes: block.supersedes,
      applicability: block.applicability,
      content: block.content,
      formula: block.formula,
      provenance: block.provenance,
      verification: block.verification,
    }));
  const skills = contributions
    .flatMap((set) => set.skills)
    .sort((left, right) => left.id.localeCompare(right.id));
  const instructions = contributions
    .flatMap((set) => set.instructions)
    .filter(
      (instruction) =>
        instruction.scope === '*' ||
        scope.documentType === undefined ||
        scope.documentType === null ||
        instruction.scope === scope.documentType ||
        instruction.scope === scope.paradigm,
    )
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const diagnosticDefinitions = contributions
    .flatMap((set) => set.diagnostics)
    .filter(
      (definition) =>
        !scope.paradigm ||
        definition.appliesToParadigms === undefined ||
        definition.appliesToParadigms.includes(scope.paradigm),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const knowledgeJson = boundedJson(knowledge, maxChars);
  const skillsJson = boundedJson(skills, maxChars);
  const instructionsJson = boundedJson(instructions, maxChars);
  const diagnosticsJson = boundedJson(diagnosticDefinitions, maxChars);
  return {
    generation: snapshot.generation,
    ...(knowledgeJson === undefined ? {} : { knowledge: knowledgeJson }),
    ...(skillsJson === undefined ? {} : { skills: skillsJson }),
    ...(instructionsJson === undefined ? {} : { instructions: instructionsJson }),
    ...(diagnosticsJson === undefined ? {} : { diagnosticDefinitions: diagnosticsJson }),
  };
}
