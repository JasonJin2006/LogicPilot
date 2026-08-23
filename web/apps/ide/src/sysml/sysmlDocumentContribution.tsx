// SysML document contribution (workbench-architecture-plan.md §5/§13): the
// .sysml document type is registered by the language extension itself, so
// the workbench registry carries no per-language entries. The icon follows
// the standard SysML diagram-frame glyph; completions come from the
// language-service module.

import { DOCUMENT_CONTRIBUTIONS } from '../workbench/documentTypes';
import { completionsAt } from './sysmlLanguage';
import { projectSysML } from './sysmlProjection';
import { SysMLFileIcon } from './sysmlIcons';

DOCUMENT_CONTRIBUTIONS.register({
  id: 'sysml',
  label: 'SysML v2',
  extensions: ['.sysml'],
  editorPanel: 'sysml',
  providesProjection: true,
  icon: SysMLFileIcon,
  completions: (source, offset) =>
    completionsAt(source, offset, projectSysML(source)).map((item) => ({
      label: item.label,
      insertText: item.insertText,
      detail: item.kind === 'element' ? 'element' : undefined,
    })),
});
