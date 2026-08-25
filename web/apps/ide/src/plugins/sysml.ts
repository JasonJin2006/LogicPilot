// SysML v2 paradigm plugin: registers the .sysml document type, panels,
// palette catalog and outline contribution. Self-contained - removing this
// file (and the src/sysml directory) removes SysML support entirely.

// Side-effect registrations owned by this plugin.
import '../sysml/sysmlDocumentContribution';
import '../sysml/sysmlPanelsContribution';
import '../sysml/sysmlPaletteContribution';
import '../sysml/sysmlOutlineContribution';

export const sysmlPlugin = {
  id: 'logicpilot.sysml',
  description: 'SysML v2 projection: views, language service, AI tools, lowering',
};
