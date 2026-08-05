// New Project dialog: creates an empty LogicPilot project (a *.lpproj
// bundle) with a name and default seed, then loads its blank canvas. The
// project becomes the current workspace unit: source DSL + canvas layout
// are saved together (docs/specs/project-format.md).

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createProject, projectToDocument } from '../project/project';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

export function NewProjectDialog() {
  const open = useUiStore((state) => state.newProjectOpen);
  const closeNewProject = useUiStore((state) => state.closeNewProject);
  const loadDocument = useModelStore((state) => state.loadDocument);
  const openBundle = useProjectStore((state) => state.openBundle);
  const markClean = useProjectStore((state) => state.markClean);
  const [name, setName] = useState('Untitled');
  const [seed, setSeed] = useState('42');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const onCreate = () => {
    const projectName = name.trim() || 'Untitled';
    const parsedSeed = Number(seed);
    const bundle = createProject(projectName, Number.isFinite(parsedSeed) ? parsedSeed : 42);
    const loaded = projectToDocument(bundle);
    if (loaded.ok) {
      loadDocument(loaded.document!);
    }
    openBundle(bundle);
    markClean();
    closeNewProject();
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
          </div>
          <p className="dialog-hint">
            Creates an empty project (IR schema v2). Model source and canvas
            layout are saved together as a .lpproj bundle.
          </p>
          <div className="dialog-actions">
            <button className="btn-primary" onClick={onCreate}>
              Create
            </button>
            <button onClick={closeNewProject}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
