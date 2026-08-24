import { useEffect, useMemo } from 'react';
import { Code2, RefreshCw } from 'lucide-react';
import { SysMLCanvas } from './SysMLCanvas';
import {
  sysmlEvidencePath,
  legacySysmlEvidencePath,
  parseEvidence,
  serializeEvidence,
} from './sysmlEvidence';
import { sysmlLayoutPath } from './sysmlProjection';
import { useSysMLStore } from '../state/sysmlStore';
import { SysMLFileIcon } from './sysmlIcons';
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
    () => (activeFile ? (bundle?.files[activeFile] ?? diskFiles[activeFile] ?? '') : ''),
    [activeFile, bundle, diskFiles],
  );
  // Every sibling .sysml source the workspace can see - the linked-model
  // layer derives the import closure from this set and only pulls in the
  // files the open document actually references.
  const workspaceSources = useMemo(() => {
    const sources: Record<string, string> = {};
    for (const [path, content] of Object.entries(bundle?.files ?? {})) {
      if (/\.sysml$/i.test(path)) sources[path] = content;
    }
    if (Object.keys(sources).length === 0) {
      for (const [path, content] of Object.entries(diskFiles)) {
        if (/\.sysml$/i.test(path)) sources[path] = content;
      }
    }
    return sources;
  }, [bundle, diskFiles]);
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
      // openDocument is idempotent for an unchanged document + sibling set;
      // it upgrades the store to the linked multi-file model when the
      // closure spans several files.
      useSysMLStore.getState().openDocument(
        path,
        source,
        workspaceSources,
        bundle?.files[sysmlLayoutPath(path)],
        // New journals live under presentation/history/; projects saved
        // before the relocation keep theirs at the legacy path.
        parseEvidence(
          bundle?.files[sysmlEvidencePath(path)] ?? bundle?.files[legacySysmlEvidencePath(path)],
        ),
      );
      return;
    }
    useSysMLStore.getState().clear();
  }, [activeFile, source, workspaceSources, bundle, refresh]);

  // A project bundle carries the visual projection as a sidecar. External
  // .sysml files without a LogicPilot project continue to use localStorage.
  useEffect(() => {
    if (
      !activeFile ||
      documentContributionFor(activeFile)?.id !== 'sysml' ||
      !bundle ||
      !layout ||
      !layoutDirty
    )
      return;
    const path = sysmlLayoutPath(activeFile);
    const serialized = JSON.stringify(layout, null, 2);
    if (bundle.files[path] === serialized) return;
    updateFiles((files) => (files[path] === serialized ? files : { ...files, [path]: serialized }));
    markLayoutPersisted();
  }, [activeFile, bundle, layout, layoutDirty, updateFiles, markLayoutPersisted]);

  // Execution evidence travels with the project the same way: one immutable
  // journal file bound to the revisions that produced it (plan §8 S2).
  const evidence = useSysMLStore((state) => state.evidence);
  useEffect(() => {
    if (
      !activeFile ||
      documentContributionFor(activeFile)?.id !== 'sysml' ||
      !bundle ||
      evidence.length === 0
    )
      return;
    const path = sysmlEvidencePath(activeFile);
    const serialized = serializeEvidence(evidence);
    if (bundle.files[path] === serialized) return;
    updateFiles((files) => (files[path] === serialized ? files : { ...files, [path]: serialized }));
  }, [activeFile, bundle, evidence, updateFiles]);

  if (!activeFile || documentContributionFor(activeFile)?.id !== 'sysml') {
    return <div className="sysml-empty">Open a .sysml file from Explorer to visualize it.</div>;
  }
  return (
    <div className="sysml-workspace">
      <div className="sysml-workspace-header">
        <div>
          <span className="sysml-workspace-title">
            <SysMLFileIcon size={13} /> SysML v2 projection
          </span>
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
