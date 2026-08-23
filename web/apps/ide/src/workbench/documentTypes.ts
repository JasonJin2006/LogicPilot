// Minimal Workbench document contribution registry. It intentionally owns
// only routing/capability metadata; language semantics stay in the extension.

export type DocumentEditorPanel = 'dsl' | 'sysml';

export interface DocumentContribution {
  id: string;
  label: string;
  extensions: readonly string[];
  editorPanel: DocumentEditorPanel;
  providesProjection: boolean;
}

class DocumentContributionRegistry {
  private readonly entries = new Map<string, DocumentContribution>();

  register(contribution: DocumentContribution): () => void {
    if (this.entries.has(contribution.id)) {
      throw new Error(`document contribution '${contribution.id}' is already registered`);
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
DOCUMENT_CONTRIBUTIONS.register({
  id: 'sysml',
  label: 'SysML v2',
  extensions: ['.sysml'],
  editorPanel: 'sysml',
  providesProjection: true,
});

export function documentContributionFor(path: string | null | undefined): DocumentContribution | undefined {
  return DOCUMENT_CONTRIBUTIONS.resolve(path);
}

export function editorPanelFor(path: string | null | undefined): DocumentEditorPanel {
  return documentContributionFor(path)?.editorPanel ?? 'dsl';
}

