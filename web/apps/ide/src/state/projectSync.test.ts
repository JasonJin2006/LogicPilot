// The unified-session refresh: re-parsing the files swaps the canvas
// document while open file tabs and container views stay untouched, and a
// broken source keeps the last valid model (plan §6).

import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, DEFAULT_MODEL_PATH } from '../project/project';
import { refreshCanvasDocument } from './projectSync';
import { useCanvasView } from './canvasView';
import { useModelStore } from './modelStore';
import { useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';

const AGENT_MODEL = `model Swarm {
  agent Drone {
    count = 3
    on_tick { bounce }
  }
}
`;

function openDraftProject(mainSource: string): void {
  const bundle = createProject('Swarm');
  bundle.files[DEFAULT_MODEL_PATH] = mainSource;
  useProjectStore.getState().openBundle(bundle);
}

describe('refreshCanvasDocument (unified session projection)', () => {
  beforeEach(() => {
    const bundle = createProject('Swarm');
    useProjectStore.getState().openBundle(bundle);
    useUiStore.setState({ openFiles: [], activeFile: null, diskFiles: {} });
    useCanvasView.getState().resetCanvasViews();
    useModelStore.getState().reset();
  });

  it('swaps the document without closing file tabs or container views', () => {
    openDraftProject(AGENT_MODEL);
    // Session chrome the gentle path must preserve:
    useUiStore.getState().openFile('notes.txt');
    useCanvasView.getState().setView({ kind: 'agent', name: 'Drone' });

    refreshCanvasDocument();

    const nodes = useModelStore.getState().document.nodes;
    expect(nodes.some((node) => node.name === 'Drone')).toBe(true);
    expect(nodes.some((node) => node.kind === 'on_tick')).toBe(true);
    expect(useUiStore.getState().openFiles).toEqual(['notes.txt']);
    expect(useCanvasView.getState().views.map((view) => view.name)).toEqual(['Drone']);
  });

  it('keeps the last valid model when the edited source no longer parses', () => {
    openDraftProject(AGENT_MODEL);
    refreshCanvasDocument();
    const before = useModelStore.getState().document;
    expect(before.nodes.length).toBeGreaterThan(0);

    useProjectStore.getState().updateFiles((files) => ({
      ...files,
      [DEFAULT_MODEL_PATH]: 'model Swarm { agent Drone {',
    }));
    refreshCanvasDocument();

    expect(useModelStore.getState().document).toBe(before);
    expect(useUiStore.getState().openFiles).toEqual([]);
  });

  it('does nothing outside a project', () => {
    useProjectStore.getState().clearProject();
    useModelStore.getState().reset();
    refreshCanvasDocument();
    expect(useModelStore.getState().document.nodes).toHaveLength(0);
  });
});
