// Workbench palette provider seam (workbench-architecture-plan.md §5/§9.3):
// element catalogs are contributed by language/library extensions, while the
// Palette panel stays a generic selector/search/drag host. Adding an element
// library means registering here - the panel never imports a specific
// catalog union.

export interface PaletteItem {
  kind: string;
  /** Owning library id (selector tab id); custom imported libraries reuse it. */
  library: string;
  name: string;
  hint?: string;
  in?: boolean;
  out?: boolean;
  /** Port names by direction, for the palette grid's connection dots. */
  inPorts?: string[];
  outPorts?: string[];
}

import type { ComponentType } from 'react';

export interface PaletteLibraryTab {
  id: string;
  name: string;
}

export interface PaletteContribution {
  id: string;
  /** Selector-bar tab this contribution adds. */
  library: PaletteLibraryTab;
  /** Catalog items under this library, in display order. Contributors own
   *  honesty filters (e.g. hiding catalog-only kinds their compiler would
   *  reject) - the host renders whatever is registered. */
  items: readonly PaletteItem[];
  /** Optional per-item glyph renderer so a language keeps its standard
   *  notation (SysML stick figures, lollipop interfaces, ...) instead of
   *  the generic block fallback. Return undefined for the default icon. */
  iconFor?: (item: PaletteItem) => ComponentType<{ size?: number }> | undefined;
}

class PaletteRegistry {
  private readonly entries = new Map<string, PaletteContribution>();

  register(contribution: PaletteContribution): () => void {
    if (this.entries.has(contribution.id)) {
      throw new Error(`palette contribution '${contribution.id}' is already registered`);
    }
    this.entries.set(contribution.id, contribution);
    return () => this.entries.delete(contribution.id);
  }

  list(): readonly PaletteContribution[] {
    return [...this.entries.values()];
  }

  libraries(): readonly PaletteLibraryTab[] {
    return this.list().map((entry) => entry.library);
  }

  itemsFor(libraryId: string): readonly PaletteItem[] {
    return this.list().find((entry) => entry.library.id === libraryId)?.items ?? [];
  }

  allItems(): readonly PaletteItem[] {
    return this.list().flatMap((entry) => entry.items);
  }
}

export const PALETTE_CONTRIBUTIONS = new PaletteRegistry();
