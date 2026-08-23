// Workbench outline provider seam (workbench-architecture-plan.md §5/§9.2):
// semantic element trees are contributed by language extensions, while the
// Project panel is a generic host that mounts the first applicable
// contribution. The host never parses a language or branches on its kinds -
// adding an outline means registering here.

import type { ComponentType } from 'react';

export interface OutlineContext {
  /** Path of the active editor file; null when no file is open. */
  activePath: string | null;
  /** Document contribution id of the active file; null when none/unknown. */
  activeDocumentType: string | null;
  /** Whether a LogicPilot project bundle is open. */
  hasProject: boolean;
}

export interface OutlineContribution {
  id: string;
  /** Higher priority wins when several contributions apply (default 0). */
  priority?: number;
  /** Whether this contribution's outline applies to the context. */
  applies(context: OutlineContext): boolean;
  /** The outline body; mounted only while applicable and owns all store
   *  subscriptions it needs (the host does not proxy provider state). */
  component: ComponentType;
}

class OutlineRegistry {
  private readonly entries = new Map<string, OutlineContribution>();

  register(contribution: OutlineContribution): () => void {
    if (this.entries.has(contribution.id)) {
      throw new Error(`outline contribution '${contribution.id}' is already registered`);
    }
    this.entries.set(contribution.id, contribution);
    return () => this.entries.delete(contribution.id);
  }

  unregisterAll(): void {
    this.entries.clear();
  }

  list(): readonly OutlineContribution[] {
    return [...this.entries.values()].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
  }

  /** First applicable contribution for the context, if any. */
  resolve(context: OutlineContext): OutlineContribution | null {
    return this.list().find((entry) => entry.applies(context)) ?? null;
  }
}

export const OUTLINE_CONTRIBUTIONS = new OutlineRegistry();
