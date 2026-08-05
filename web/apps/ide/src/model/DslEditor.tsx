// Center tab (DSL): the project's code editor. The file name and close
// button live on the tab bar; Compile / Save live in the tab bar's
// contextual action area.

import { generateDsl } from '@logicpilot/editor';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

export function DslEditor() {
  const document = useModelStore((state) => state.document);
  const activeFile = useUiStore((state) => state.activeFile);
  const updateDiskFile = useUiStore((state) => state.updateDiskFile);
  const diskContent = useUiStore((state) =>
    activeFile ? state.diskFiles[activeFile] : undefined,
  );
  const bundle = useProjectStore((state) => state.bundle);
  const updateFiles = useProjectStore((state) => state.updateFiles);

  const fileSource = activeFile !== null && bundle ? bundle.files[activeFile] : undefined;
  const isDiskFile = diskContent !== undefined;
  const isFileEditor = isDiskFile || fileSource !== undefined;

  return (
    <div className="dsl-editor">
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
