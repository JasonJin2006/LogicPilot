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
    // A standalone bundle is not a folder project: drop any previous on-disk
    // path / Explorer tree so Save does not target the old folder.
    useProjectStore.getState().clearProject();
    useProjectStore.getState().openBundle(parsedBundle.bundle!);
    loadModelDocument(loaded.document!);
    useProjectStore.getState().markClean();
    addRecent({ name: loaded.document!.name, bundle: text, at: Date.now() });
    return;
  }

  if (lowerName.endsWith('.json')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const object = parsed as Record<string, unknown> | null;
      // A project manifest (logicpilot.json): guide to opening the directory.
      if (object !== null && object.schema === 'logicpilot.project') {
        openInfo(
          'Open a project',
          `${file.name} is the project manifest. Open the project directory with File > Open Project Folder (or a .lpproj bundle) - the manifest alone has no model files.`,
        );
        return;
      }
      // A v2 layout file (presentation/*.canvas.json): needs the structure.
      if (
        object !== null &&
        typeof object === 'object' &&
        'layout' in object &&
        'edges' in object
      ) {
        openInfo(
          'Open a project',
          `${file.name} is a layout file (.canvas.json). Layout only makes sense together with the model structure - open the project (File > Open Project Folder or a .lpproj bundle) instead.`,
        );
        return;
      }
      const documentLike =
        parsed !== null &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { nodes?: unknown }).nodes) &&
        Array.isArray((parsed as { edges?: unknown }).edges);
      if (!documentLike) {
        openInfo(
          'Open failed',
          'not a LogicPilot canvas document (.json). Open a .lpproj bundle or a project folder instead.',
        );
        return;
      }
      useProjectStore.getState().clearProject();
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
