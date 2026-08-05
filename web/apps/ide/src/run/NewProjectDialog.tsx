// New Project dialog: creates an empty LogicPilot project with a name and
// default seed. In the desktop client the project is materialized on disk
// under the chosen folder (<folder>/<name>/ with logicpilot.json, model/,
// presentation/, build/, results/); in the browser it stays in-memory and
// is exported on Save (docs/specs/project-format.md).

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createProject, projectToDocument, projectToDiskFiles } from '../project/project';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { createProjectDir, isTauri, pickProjectFolder } from '../state/tauriFs';
import { useUiStore } from '../state/uiStore';

export function NewProjectDialog() {
  const open = useUiStore((state) => state.newProjectOpen);
  const closeNewProject = useUiStore((state) => state.closeNewProject);
  const loadDocument = useModelStore((state) => state.loadDocument);
  const openBundle = useProjectStore((state) => state.openBundle);
  const setPath = useProjectStore((state) => state.setPath);
  const markClean = useProjectStore((state) => state.markClean);
  const openInfo = useUiStore((state) => state.openInfo);
  const [name, setName] = useState('Untitled');
  const [seed, setSeed] = useState('42');
  const [folder, setFolder] = useState('');
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const desktop = isTauri();

  useEffect(() => {
    if (open) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const onCreate = async () => {
    if (creating) {
      return;
    }
    setCreating(true);
    const projectName = name.trim() || 'Untitled';
    const parsedSeed = Number(seed);
    const bundle = createProject(projectName, Number.isFinite(parsedSeed) ? parsedSeed : 42);
    const loaded = projectToDocument(bundle);
    let projectPath: string | null = null;
    if (desktop && folder.trim() !== '') {
      const result = await createProjectDir(folder.trim(), projectName, projectToDiskFiles(bundle));
      if (!result.ok) {
        setCreating(false);
        openInfo('Create failed', result.error ?? 'cannot create the project folder');
        return;
      }
      projectPath = result.path ?? null;
    }
    if (loaded.ok) {
      loadDocument(loaded.document!);
    }
    openBundle(bundle);
    setPath(projectPath);
    markClean();
    closeNewProject();
  };

  const browse = async () => {
    const picked = await pickProjectFolder();
    if (picked !== null) {
      setFolder(picked);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={closeNewProject}>
      <div
        className="dialog-card"
        role="dialog"
        aria-label="New Project"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>New Project</h2>
          <button className="btn-ghost" aria-label="Close" onClick={closeNewProject}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-section">
          <span className="dialog-label">Project</span>
          <div className="run-fields">
            <label className="field">
              <span>name</span>
              <input
                ref={nameRef}
                type="text"
                value={name}
                spellCheck={false}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onCreate();
                  }
                }}
              />
            </label>
            <label className="field">
              <span>seed</span>
              <input
                type="number"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
              />
            </label>
            {desktop ? (
              <label className="field field-wide">
                <span>folder</span>
                <div className="folder-picker">
                  <input
                    type="text"
                    value={folder}
                    placeholder="Choose where the project folder is created"
                    spellCheck={false}
                    onChange={(event) => setFolder(event.target.value)}
                  />
                  <button type="button" onClick={() => void browse()}>
                    Browse...
                  </button>
                </div>
              </label>
            ) : (
              <p className="dialog-hint">
                Browser mode keeps the project in memory; use the desktop
                client to create it as a real folder on disk.
              </p>
            )}
          </div>
          <p className="dialog-hint">
            {desktop
              ? 'Creates <folder>/<name>/ with logicpilot.json, model/main.lp, presentation/main.canvas.json, build/ and results/ (IR schema v2).'
              : 'Creates an empty project (IR schema v2). Model source and canvas layout are saved together as a .lpproj bundle.'}
          </p>
          <div className="dialog-actions">
            <button className="btn-primary" disabled={creating} onClick={() => void onCreate()}>
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button onClick={closeNewProject}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
