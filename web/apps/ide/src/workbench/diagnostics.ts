// Workbench diagnostic provider seam (workbench-architecture-plan.md §5/§9.1).
// Language extensions register validators here; shell surfaces (canvas
// badges, properties panels, run gates, AI preflights) aggregate through
// this seam instead of importing a specific validator. Each provider owns
// its document payload contract - the registry never inspects it, so no
// unified representation is imposed on languages.

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface WorkbenchDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** Owning semantic element (provider-defined id space). */
  nodeId?: string;
  edgeId?: string;
  /** 1-based source line for text-backed documents. */
  line?: number;
}

export interface DiagnosticContribution {
  id: string;
  /** Document contribution ids whose documents this provider diagnoses. */
  documentTypes: readonly string[];
  /** Validate one document payload. Providers own the payload type; a
   *  provider that receives a foreign payload must not guess semantics. */
  diagnose(document: unknown): readonly WorkbenchDiagnostic[];
}

class DiagnosticRegistry {
  private readonly entries = new Map<string, DiagnosticContribution>();

  register(contribution: DiagnosticContribution): () => void {
    if (this.entries.has(contribution.id)) {
      throw new Error(`diagnostic contribution '${contribution.id}' is already registered`);
    }
    this.entries.set(contribution.id, contribution);
    return () => this.entries.delete(contribution.id);
  }

  unregisterAll(): void {
    this.entries.clear();
  }

  forDocumentTypes(...documentTypes: readonly (string | null | undefined)[]): DiagnosticContribution[] {
    const wanted = new Set(
      documentTypes.filter((type): type is string => typeof type === 'string'),
    );
    return [...this.entries.values()].filter((entry) =>
      entry.documentTypes.some((type) => wanted.has(type)),
    );
  }
}

export const DIAGNOSTIC_PROVIDERS = new DiagnosticRegistry();

/** Aggregate every registered provider applying to the document type.
 *  Unknown document types diagnose to an empty list - they are never routed
 *  to another language's validator. */
export function diagnoseDocument(
  documentType: string | null | undefined,
  document: unknown,
): WorkbenchDiagnostic[] {
  return DIAGNOSTIC_PROVIDERS.forDocumentTypes(documentType).flatMap((provider) =>
    provider.diagnose(document),
  );
}
