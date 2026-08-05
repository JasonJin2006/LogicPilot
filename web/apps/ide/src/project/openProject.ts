// Open a project/model file picked by the user. Shared by File > Open... and
// the Explorer empty-state button so both paths behave identically.

import { generateDsl, parseDsl } from '@logicpilot/editor';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { addRecent } from '../state/recentStore';
import { loadModelDocument } from '../state/projectSync';
import { parseProjectBundle, projectToDocument } from './project';

export async function openProjectFromFile(file: File): Promise<void> {
  const text = await file.text();
  const lowerName = file.name.toLowerCase();
  const openInfo = useUiStore.getState().openInfo;

  if (lowerName.endsWith('.lpproj')) {
    const parsedBundle = parseProjectBundle(text);
    if (!parsedBundle.ok) {
      openInfo('Open failed', parsedBundle.error ?? 'invalid project');
      return;
    }
    const loaded = projectToDocument(parsedBundle.bundle!);
    if (!loaded.ok) {
      openInfo('Open failed', loaded.error ?? 'invalid project');
      return;
    }
    useProjectStore.getState().openBundle(parsedBundle.bundle!);
    loadModelDocument(loaded.document!);
    useProjectStore.getState().markClean();
    addRecent({ name: loaded.document!.name, bundle: text, at: Date.now() });
    return;
  }

  if (lowerName.endsWith('.json')) {
    useProjectStore.getState().clearProject();
    try {
      const parsed = JSON.parse(text) as unknown;
      const documentLike =
        parsed !== null &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { nodes?: unknown }).nodes) &&
        Array.isArray((parsed as { edges?: unknown }).edges);
      if (!documentLike) {
        openInfo('Open failed', 'not a LogicPilot canvas document (.json)');
        return;
      }
      loadModelDocument(parsed as never);
      useProjectStore.getState().markClean();
      const parsedName =
        typeof (parsed as { name?: unknown }).name === 'string'
          ? (parsed as { name: string }).name
          : useModelStore.getState().document.name || 'Model';
      addRecent({ name: parsedName, dsl: generateDsl(parsed as never), at: Date.now() });
    } catch (error) {
      openInfo('Open failed', String(error));
    }
    return;
  }

  useProjectStore.getState().clearProject();
  const parsed = parseDsl(text);
  if (parsed.ok) {
    loadModelDocument(parsed.document);
    useProjectStore.getState().markClean();
    addRecent({ name: parsed.document.name, dsl: text, at: Date.now() });
  } else {
    openInfo('Open failed', parsed.error ?? 'invalid DSL');
  }
}
