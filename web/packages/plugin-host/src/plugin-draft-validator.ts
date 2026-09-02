import type { PluginDraft, TrustLevel } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
import { ContributionRegistry } from './contribution-registry.js';

const TRUST_RANK: Record<TrustLevel, number> = {
  t0: 0,
  t1: 1,
  t2: 2,
  t3: 3,
  t4: 4,
  t5: 5,
};

export interface PluginDraftValidationReport {
  readonly draftId: string;
  readonly ok: boolean;
  readonly diagnostics: readonly string[];
  readonly checks: Readonly<Record<string, 'passed' | 'failed'>>;
}

export function isSafeDraftFilePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return (
    normalized !== '' &&
    !normalized.startsWith('/') &&
    !/^[A-Za-z]:/.test(normalized) &&
    !normalized.split('/').includes('..') &&
    !normalized.includes('\0') &&
    normalized !== 'plugin.json' &&
    normalized !== 'contributions.json'
  );
}

/** Side-effect-free static gate for a plugin draft. It validates the complete
 * envelope and cross-entity invariants, but never imports or executes an
 * entrypoint. */
export class PluginDraftValidationRunner {
  run(input: unknown): PluginDraftValidationReport {
    const draftId =
      typeof input === 'object' &&
      input !== null &&
      typeof (input as { id?: unknown }).id === 'string'
        ? String((input as { id: string }).id)
        : 'unknown';
    const diagnostics: string[] = [];
    const checks: Record<string, 'passed' | 'failed'> = {};
    const checked = validateContract('PluginDraft', input);
    if (!checked.ok) {
      return {
        draftId,
        ok: false,
        diagnostics: checked.errors,
        checks: { schema: 'failed' },
      };
    }
    checks.schema = 'passed';
    const draft: PluginDraft = checked.value;
    if (draft.contributions.pluginId !== draft.manifest.id) {
      diagnostics.push('contribution pluginId must match manifest id');
    }
    if (draft.contributions.version !== draft.manifest.version) {
      diagnostics.push('contribution version must match manifest version');
    }
    checks.ownership = diagnostics.length === 0 ? 'passed' : 'failed';

    try {
      new ContributionRegistry().prepare([draft.contributions]);
      checks.ids = 'passed';
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error));
      checks.ids = 'failed';
    }

    const declaredPermissions = new Set(draft.manifest.permissions);
    const contributionPermissions = [
      ...draft.contributions.skills.flatMap((skill) => skill.permissions),
      ...draft.contributions.tools.flatMap((tool) => tool.permissions),
    ];
    const undeclared = contributionPermissions.filter(
      (permission, index) =>
        !declaredPermissions.has(permission) &&
        contributionPermissions.indexOf(permission) === index,
    );
    if (undeclared.length > 0) {
      diagnostics.push(`contributions require undeclared permissions: ${undeclared.join(', ')}`);
    }
    checks.permissions = undeclared.length === 0 ? 'passed' : 'failed';

    const entrypointTrust =
      draft.manifest.entrypoints.wasm !== undefined
        ? 2
        : draft.manifest.entrypoints.node !== undefined ||
            draft.manifest.entrypoints.native !== undefined
          ? 4
          : draft.manifest.entrypoints.web !== undefined
            ? 3
            : 0;
    if (TRUST_RANK[draft.manifest.trust.minLevel] < entrypointTrust) {
      diagnostics.push(
        `manifest trust ${draft.manifest.trust.minLevel} is below entrypoint requirement t${entrypointTrust}`,
      );
    }
    checks.trust =
      TRUST_RANK[draft.manifest.trust.minLevel] >= entrypointTrust ? 'passed' : 'failed';

    const draftFiles = Object.keys(draft.files ?? {});
    const unsafeFiles = draftFiles.filter((path) => !isSafeDraftFilePath(path));
    const totalFileBytes = draftFiles.reduce(
      // Count UTF-16 code units conservatively; this may reject a few valid
      // multi-byte edge cases but cannot allow an oversized payload through.
      (total, path) => total + draft.files![path]!.length,
      0,
    );
    if (unsafeFiles.length > 0) {
      diagnostics.push(`draft contains unsafe file paths: ${unsafeFiles.join(', ')}`);
    }
    if (totalFileBytes > 4 * 1024 * 1024) {
      diagnostics.push('draft data files exceed the 4 MiB total limit');
    }
    checks.files =
      unsafeFiles.length === 0 && totalFileBytes <= 4 * 1024 * 1024 ? 'passed' : 'failed';

    const knowledgeIds = new Set(draft.contributions.knowledge.map((block) => block.id));
    const missingExplanations = draft.contributions.diagnostics
      .map((definition) => definition.explanationBlockId)
      .filter((id): id is string => id !== undefined && !knowledgeIds.has(id));
    const missingFixes = draft.contributions.diagnostics.flatMap((definition) =>
      definition.fixIds.filter((id) => !knowledgeIds.has(id)),
    );
    if (missingExplanations.length > 0) {
      diagnostics.push(
        `diagnostic explanation blocks are missing: ${[...new Set(missingExplanations)].join(', ')}`,
      );
    }
    if (missingFixes.length > 0) {
      diagnostics.push(
        `diagnostic fix blocks are missing: ${[...new Set(missingFixes)].join(', ')}`,
      );
    }
    checks.references =
      missingExplanations.length === 0 && missingFixes.length === 0 ? 'passed' : 'failed';

    return { draftId, ok: diagnostics.length === 0, diagnostics, checks };
  }
}
