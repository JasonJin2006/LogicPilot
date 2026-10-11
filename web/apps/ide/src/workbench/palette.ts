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
  /** Which workbench document types (e.g. 'dsl', 'sysml') this library
   *  applies to. Contributions without a declaration are legacy and appear
   *  for any known document type; plain files get no paradigm libraries. */
  context?: { readonly documentTypes?: readonly string[] };
  /** Catalog items under this library, in display order. Contributors own
   *  honesty filters (e.g. hiding catalog-only kinds their compiler would
   *  reject) - the host renders whatever is registered. */
  items: readonly PaletteItem[];
  /** Optional per-item glyph renderer so a language keeps its standard
   *  notation (SysML stick figures, lollipop interfaces, ...) instead of
   *  the generic block fallback. Return undefined for the default icon. */
  iconFor?: (item: PaletteItem) => ComponentType<{ size?: number }> | undefined;
  /** Creates the represented semantic item on the active canvas/document. */
  insert?: (item: PaletteItem, position?: { x: number; y: number }) => void;
  /** Optional notation-specific port anchor in the 40x40 glyph coordinate space. */
  portGlyphFor?: (
    item: PaletteItem,
    port: string,
    direction: 'in' | 'out',
  ) => readonly [number, number] | undefined;
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

  /** Contributions visible for a workbench document type. Plain files (no
   *  document type) never receive paradigm libraries; declared context is
   *  authoritative, undeclared (legacy) contributions appear for any known
   *  document type. */
  forDocumentType(documentTypeId: string | undefined): readonly PaletteContribution[] {
    return this.list().filter((entry) => {
      if (documentTypeId === undefined) return false;
      const declared = entry.context?.documentTypes;
      if (declared === undefined || declared.length === 0) return true;
      return declared.includes(documentTypeId);
    });
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
