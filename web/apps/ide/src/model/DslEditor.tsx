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

export function DslEditor() {
  const document = useModelStore((state) => state.document);
  const compile = useConnectionStore((state) => state.compile);
  const activeFile = useUiStore((state) => state.activeFile);
  const closeFile = useUiStore((state) => state.closeFile);
  const diskContent = useUiStore((state) =>
    activeFile ? state.diskFiles[activeFile] : undefined,
  );
  const bundle = useProjectStore((state) => state.bundle);
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

  return (
    <div className="dsl-editor">
      <div className="dsl-editor-header">
        <span className="dsl-title">
          {isDiskFile ? `${activeFile} (read-only)` : isFileEditor ? activeFile : 'DSL (canvas)'}
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
        <button className="dsl-compile" onClick={() => compile(compileSource)}>
          Compile
        </button>
      </div>
      {isDiskFile ? (
        <pre className="dsl-source">{diskContent}</pre>
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
