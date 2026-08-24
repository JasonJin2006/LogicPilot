// Minimal Workbench document contribution registry. It intentionally owns
// only routing/capability metadata; language semantics stay in the extension.
// Shell panels (Explorer file kinds/icons, center tab bar, editors, new-file
// templates) resolve through this registry instead of hardcoded extension
// switches (workbench-architecture-plan.md §5/§13).

import type { ComponentType } from 'react';

/** The center panel a document type opens in. A plain string: the panel
 *  itself is registered by the language's panel contribution, not by the
 *  workbench (plan §13 - no core table of language panels). */
export type DocumentEditorPanel = string;

/** One completion row rendered by the shared editor overlay. */
export interface DocumentCompletionItem {
  label: string;
  insertText: string;
  detail?: string;
}

export interface DocumentContribution {
  id: string;
  label: string;
  extensions: readonly string[];
  editorPanel: DocumentEditorPanel;
  providesProjection: boolean;
  /** Content template used when the Explorer creates a new file of this
   *  type; omit to create empty files. */
  newFileTemplate?: (fileName: string) => string;
  /** The language's standard file icon; the Explorer falls back to its
   *  generic source/data glyphs when omitted. Contributed by the language -
   *  the workbench never maps kinds to icons itself. */
  icon?: ComponentType<{ size?: number }>;
  /** Cursor-aware completions for this document type, served to the shared
   *  text-editor overlay (Ctrl+Space). Contributed by the language - the
   *  editor stays keyword-agnostic. */
  completions?: (source: string, offset: number) => readonly DocumentCompletionItem[];
}

class DocumentContributionRegistry {
  private readonly entries = new Map<string, DocumentContribution>();

  register(contribution: DocumentContribution): () => void {
    if (this.entries.has(contribution.id)) {
      throw new Error(`document contribution '${contribution.id}' is already registered`);
    }
    for (const extension of contribution.extensions) {
      const lower = extension.toLowerCase();
      for (const existing of this.entries.values()) {
        if (existing.extensions.some((candidate) => candidate.toLowerCase() === lower)) {
          throw new Error(
            `document extension '${extension}' is already registered by '${existing.id}'`,
          );
        }
      }
    }
    this.entries.set(contribution.id, contribution);
    return () => this.entries.delete(contribution.id);
  }

  resolve(path: string | null | undefined): DocumentContribution | undefined {
    if (!path) return undefined;
    const lower = path.toLowerCase();
    return [...this.entries.values()].find((entry) =>
      entry.extensions.some((extension) => lower.endsWith(extension.toLowerCase())),
    );
  }

  list(): readonly DocumentContribution[] {
    return [...this.entries.values()];
  }
}

export const DOCUMENT_CONTRIBUTIONS = new DocumentContributionRegistry();

// The LogicPilot DSL is the platform-native language and registers here;
// external languages (SysML, ...) register from their own contribution
// modules so this core file stays free of per-language entries.

DOCUMENT_CONTRIBUTIONS.register({
  id: 'dsl',
  label: 'LogicPilot DSL',
  extensions: ['.lp'],
  editorPanel: 'dsl',
  providesProjection: false,
  newFileTemplate: (fileName) => `model ${fileName.replace(/\.lp$/i, '')} {\n}\n`,
});

export function documentContributionFor(
  path: string | null | undefined,
): DocumentContribution | undefined {
  return DOCUMENT_CONTRIBUTIONS.resolve(path);
}

export function editorPanelFor(path: string | null | undefined): DocumentEditorPanel {
  return documentContributionFor(path)?.editorPanel ?? 'dsl';
}

/** Initial content for an Explorer-created file path ('' when the resolved
 *  contribution declares no template or no contribution matches). */
export function newFileContentFor(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const fileName = path.slice(separator + 1);
  return documentContributionFor(path)?.newFileTemplate?.(fileName) ?? '';
}
