import { generateDsl } from '@logicpilot/editor';
import type { AssistantSessionState } from '../../assistantTypes';
import { useModelStore } from '../../../state/modelStore';

export function undoAssistantChange(
  session: AssistantSessionState,
  tokenId: string,
): { ok: boolean; undone?: boolean; error?: string } {
  const token = session.activeUndo;
  const store = useModelStore.getState();
  if (
    token === null ||
    token.id !== tokenId ||
    store.document !== token.after ||
    token.undoSteps <= 0 ||
    store.past.length < token.undoSteps ||
    store.past[store.past.length - token.undoSteps] !== token.before
  ) {
    return { ok: false, error: 'the AI change is no longer the latest model transaction' };
  }
  for (let index = 0; index < token.undoSteps; ++index) useModelStore.getState().undo();
  if (useModelStore.getState().document !== token.before) {
    return { ok: false, error: 'the model history changed; AI undo was stopped' };
  }
  session.activeUndo = null;
  session.documentSnapshot = useModelStore.getState().document;
  session.dsl = generateDsl(useModelStore.getState().document);
  session.diagnostics = [];
  session.compiled = false;
  session.runStatus = 'none';
  session.runMetrics = null;
  session.previousRunMetrics = null;
  session.runSummary = '';
  return { ok: true, undone: true };
}
