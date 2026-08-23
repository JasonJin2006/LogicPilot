// SysML document contribution (workbench-architecture-plan.md §5/§13): the
// .sysml document type is registered by the language extension itself, so
// the workbench registry carries no per-language entries. The icon follows
// the standard SysML diagram-frame glyph.

import { DOCUMENT_CONTRIBUTIONS } from '../workbench/documentTypes';
import { SysMLFileIcon } from './sysmlIcons';

DOCUMENT_CONTRIBUTIONS.register({
  id: 'sysml',
  label: 'SysML v2',
  extensions: ['.sysml'],
  editorPanel: 'sysml',
  providesProjection: true,
  icon: SysMLFileIcon,
});
