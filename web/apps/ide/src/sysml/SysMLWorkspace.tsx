import { useEffect, useMemo } from 'react';
import { Code2, RefreshCw } from 'lucide-react';
import { SysMLCanvas } from './SysMLCanvas';
import { sysmlLayoutPath } from './sysmlProjection';
import { useSysMLStore } from '../state/sysmlStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { readProjectFile } from '../state/tauriFs';
import { useLayoutStore } from '../state/layoutStore';
import { documentContributionFor } from '../workbench/documentTypes';

export function SysMLWorkspace() {
  const activeFile = useUiStore((state) => state.activeFile);
  const diskFiles = useUiStore((state) => state.diskFiles);
  const bundle = useProjectStore((state) => state.bundle);
  const projectPath = useProjectStore((state) => state.path);
  const updateFiles = useProjectStore((state) => state.updateFiles);
  const updateDiskFile = useUiStore((state) => state.updateDiskFile);
  const source = useMemo(
    () => (activeFile ? bundle?.files[activeFile] ?? diskFiles[activeFile] ?? '' : ''),
    [activeFile, bundle, diskFiles],
  );
  const currentPath = useSysMLStore((state) => state.path);
  const layout = useSysMLStore((state) => state.layout);
  const layoutDirty = useSysMLStore((state) => state.layoutDirty);
  const markLayoutPersisted = useSysMLStore((state) => state.markLayoutPersisted);
  const refresh = useSysMLStore((state) => state.refresh);
  const openSource = () => {
    if (activeFile) useLayoutStore.getState().openPanel('center', 'dsl');
  };
  const reloadSource = () => {
    if (!activeFile) return;
    if (bundle?.files[activeFile] !== undefined) {
      refresh(bundle.files[activeFile]);
      return;
    }
    if (projectPath) {
      void readProjectFile(projectPath, activeFile).then((result) => {
        if (result.ok && result.content !== undefined) {
          updateDiskFile(activeFile, result.content);
          refresh(result.content);
        }
      });
    } else {
      refresh(source);
    }
  };

  useEffect(() => {
    const path = activeFile;
    if (!path) {
      useSysMLStore.getState().clear();
      return;
    }
    if (documentContributionFor(path)?.id === 'sysml') {
      if (useSysMLStore.getState().path !== path) {
        useSysMLStore
          .getState()
          .load(path, source, bundle?.files[sysmlLayoutPath(path)]);
      } else if (useSysMLStore.getState().source !== source) {
        refresh(source);
      }
      return;
    }
    useSysMLStore.getState().clear();
  }, [activeFile, source, refresh]);

  // A project bundle carries the visual projection as a sidecar. External
  // .sysml files without a LogicPilot project continue to use localStorage.
  useEffect(() => {
    if (!activeFile || documentContributionFor(activeFile)?.id !== 'sysml' || !bundle || !layout || !layoutDirty) return;
    const path = sysmlLayoutPath(activeFile);
    const serialized = JSON.stringify(layout, null, 2);
    if (bundle.files[path] === serialized) return;
    updateFiles((files) => (files[path] === serialized ? files : { ...files, [path]: serialized }));
    markLayoutPersisted();
  }, [activeFile, bundle, layout, layoutDirty, updateFiles, markLayoutPersisted]);

  if (!activeFile || documentContributionFor(activeFile)?.id !== 'sysml') {
    return <div className="sysml-empty">Open a .sysml file from Explorer to visualize it.</div>;
  }
  return (
    <div className="sysml-workspace">
      <div className="sysml-workspace-header">
        <div>
          <span className="sysml-workspace-title">SysML v2 projection</span>
          <span className="sysml-workspace-path">{currentPath ?? activeFile}</span>
        </div>
        <div className="sysml-workspace-actions">
          <button type="button" title="Open SysML source" onClick={openSource}>
            <Code2 size={13} /> Source
          </button>
          <button type="button" title="Refresh from source" onClick={reloadSource}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>
      <SysMLCanvas />
    </div>
  );
}
