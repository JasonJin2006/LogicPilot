// Center tab (DSL): the project's code editor as a standalone panel at the
// same level as the modeling canvas. With a file open (clicked in the
// Explorer) it edits that bundle file and re-parses live into the Project
// tree; without one it shows the canvas-derived DSL (read-only). Compile
// builds the merged model source against the gateway.

import { generateDsl } from '@logicpilot/editor';
import { mergeModelSource } from '../project/project';
import { useConnectionStore } from '../state/connectionStore';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { writeProjectFile } from '../state/tauriFs';

export function DslEditor() {
  const document = useModelStore((state) => state.document);
  const compile = useConnectionStore((state) => state.compile);
  const activeFile = useUiStore((state) => state.activeFile);
  const closeFile = useUiStore((state) => state.closeFile);
  const updateDiskFile = useUiStore((state) => state.updateDiskFile);
  const openInfo = useUiStore((state) => state.openInfo);
  const diskContent = useUiStore((state) =>
    activeFile ? state.diskFiles[activeFile] : undefined,
  );
  const bundle = useProjectStore((state) => state.bundle);
  const projectPath = useProjectStore((state) => state.path);
  const updateFiles = useProjectStore((state) => state.updateFiles);

  const fileSource = activeFile !== null && bundle ? bundle.files[activeFile] : undefined;
  const isDiskFile = diskContent !== undefined;
  const isFileEditor = isDiskFile || fileSource !== undefined;
  const mergedSource = bundle
    ? mergeModelSource(
        bundle.files[bundle.manifest.model] ?? '',
        bundle.files,
        bundle.manifest.modelParts ?? [],
      )
    : undefined;
  const compileSource = isFileEditor ? mergedSource : undefined;
  const saveDiskFile = () => {
    if (!activeFile || !projectPath || diskContent === undefined) {
      return;
    }
    void writeProjectFile(projectPath, activeFile, diskContent).then((result) => {
      if (!result.ok) {
        openInfo('Save failed', result.error ?? 'cannot write the file');
        return;
      }
      void useProjectStore.getState().refreshDiskTree();
    });
  };

  return (
    <div className="dsl-editor">
      <div className="dsl-editor-header">
        <span className="dsl-title">
          {isDiskFile ? activeFile : isFileEditor ? activeFile : 'DSL (canvas)'}
        </span>
        {isFileEditor && (
          <button
            className="dsl-close-file"
            title="Close file"
            onClick={() => activeFile !== null && closeFile(activeFile)}
          >
            ×
          </button>
        )}
        {isDiskFile && projectPath && (
          <button className="dsl-compile" onClick={saveDiskFile}>
            Save
          </button>
        )}
        <button className="dsl-compile" onClick={() => compile(compileSource)}>
          Compile
        </button>
      </div>
      {isDiskFile ? (
        <textarea
          className="dsl-source dsl-textarea"
          value={diskContent}
          spellCheck={false}
          onChange={(event) =>
            activeFile !== null && updateDiskFile(activeFile, event.target.value)
          }
        />
      ) : isFileEditor && activeFile !== null ? (
        <textarea
          className="dsl-source dsl-textarea"
          value={fileSource}
          spellCheck={false}
          onChange={(event) =>
            updateFiles((files) => ({ ...files, [activeFile]: event.target.value }))
          }
        />
      ) : (
        <pre className="dsl-source">{generateDsl(document)}</pre>
      )}
    </div>
  );
}
