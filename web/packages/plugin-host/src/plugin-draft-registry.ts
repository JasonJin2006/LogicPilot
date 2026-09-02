import type {
  PermissionId,
  PluginDraft,
  PluginManifest,
  PluginContributionSet,
  TrustLevel,
} from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

const TRUST_RANK: Record<TrustLevel, number> = {
  t0: 0,
  t1: 1,
  t2: 2,
  t3: 3,
  t4: 4,
  t5: 5,
};

export interface PluginDraftCreateInput {
  readonly id: string;
  readonly baseManifest: PluginManifest;
  readonly manifest: PluginManifest;
  readonly contributions: PluginContributionSet;
  readonly createdBy: string;
  readonly now?: string;
}

export class PluginDraftRegistry {
  private readonly drafts = new Map<string, PluginDraft>();
  private readonly bases = new Map<string, PluginManifest>();

  create(input: PluginDraftCreateInput): PluginDraft {
    if (this.drafts.has(input.id)) throw new Error(`plugin draft '${input.id}' already exists`);
    const base = validateContract('PluginManifest', input.baseManifest);
    const manifest = validateContract('PluginManifest', input.manifest);
    const contributions = validateContract('PluginContributionSet', input.contributions);
    if (!base.ok || !manifest.ok || !contributions.ok) {
      throw new Error(
        `plugin draft input is invalid: ${[
          ...(base.ok ? [] : base.errors),
          ...(manifest.ok ? [] : manifest.errors),
          ...(contributions.ok ? [] : contributions.errors),
        ].join('; ')}`,
      );
    }
    const permissionDiff = permissionDiffOf(base.value, manifest.value);
    const draft: PluginDraft = {
      schema: 'logicpilot.plugin-draft/v1',
      contractVersion: 1,
      id: input.id,
      basePluginId: base.value.id,
      manifest: manifest.value,
      contributions: contributions.value,
      status: 'draft',
      createdBy: input.createdBy,
      createdAt: input.now ?? new Date().toISOString(),
      permissionDiff,
    };
    const checked = validateContract('PluginDraft', draft);
    if (!checked.ok) throw new Error(`plugin draft rejected: ${checked.errors.join('; ')}`);
    this.drafts.set(input.id, checked.value);
    this.bases.set(input.id, base.value);
    return checked.value;
  }

  get(id: string): PluginDraft | undefined {
    return this.drafts.get(id);
  }

  list(): readonly PluginDraft[] {
    return [...this.drafts.values()];
  }

  validate(id: string): PluginDraft {
    const draft = this.require(id);
    const base = this.bases.get(id)!;
    const diagnostics: string[] = [];
    if (draft.contributions.pluginId !== draft.manifest.id) {
      diagnostics.push('contribution pluginId must match draft manifest id');
    }
    if (draft.contributions.version !== draft.manifest.version) {
      diagnostics.push('contribution version must match draft manifest version');
    }
    if (draft.basePluginId !== base.id)
      diagnostics.push('base plugin id changed during validation');
    const next: PluginDraft = {
      ...draft,
      status: diagnostics.length === 0 ? 'validated' : 'rejected',
      validatedAt: new Date().toISOString(),
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
    };
    this.drafts.set(id, next);
    return next;
  }

  approve(
    id: string,
    approvedBy: string,
    acceptedPermissions: readonly PermissionId[] = [],
    allowTrustEscalation = false,
  ): PluginDraft {
    const draft = this.require(id);
    if (draft.status !== 'validated') throw new Error(`plugin draft '${id}' is not validated`);
    const added = new Set(draft.permissionDiff.added);
    const accepted = new Set(acceptedPermissions);
    if ([...added].some((permission) => !accepted.has(permission))) {
      throw new Error('plugin draft permission additions require explicit approval');
    }
    if ([...accepted].some((permission) => !added.has(permission))) {
      throw new Error('plugin draft approval contains an unrequested permission');
    }
    if (draft.permissionDiff.trustEscalation && !allowTrustEscalation) {
      throw new Error('plugin draft trust escalation requires explicit approval');
    }
    const next: PluginDraft = {
      ...draft,
      status: 'approved',
      approvedBy,
      approvedAt: new Date().toISOString(),
    };
    this.drafts.set(id, next);
    return next;
  }

  publish(id: string): PluginDraft {
    const draft = this.require(id);
    if (draft.status !== 'approved') throw new Error(`plugin draft '${id}' is not approved`);
    const next: PluginDraft = { ...draft, status: 'published' };
    this.drafts.set(id, next);
    return next;
  }

  reject(id: string, reason: string): PluginDraft {
    const draft = this.require(id);
    const next: PluginDraft = {
      ...draft,
      status: 'rejected',
      diagnostics: [...(draft.diagnostics ?? []), reason],
    };
    this.drafts.set(id, next);
    return next;
  }

  private require(id: string): PluginDraft {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error(`plugin draft '${id}' was not found`);
    return draft;
  }
}

function permissionDiffOf(base: PluginManifest, draft: PluginManifest) {
  const basePermissions = new Set(base.permissions);
  const draftPermissions = new Set(draft.permissions);
  const added = [...draftPermissions].filter((permission) => !basePermissions.has(permission));
  const removed = [...basePermissions].filter((permission) => !draftPermissions.has(permission));
  return {
    added: added.sort(),
    removed: removed.sort(),
    trustEscalation: TRUST_RANK[draft.trust.minLevel] > TRUST_RANK[base.trust.minLevel],
  };
}
