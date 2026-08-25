// DES/DSL paradigm plugin: the LogicPilot DSL document type plus the model
// palette, graph validator and DSL outline. Self-contained - removing this
// file (with src/model and the DES halves of project/) removes DES support.

import { DOCUMENT_CONTRIBUTIONS } from '../workbench/documentTypes';

// The .lp document type was previously registered inline in the workbench
// core; it now lives with its paradigm like every other language.
DOCUMENT_CONTRIBUTIONS.register({
  id: 'dsl',
  label: 'LogicPilot DSL',
  extensions: ['.lp'],
  editorPanel: 'dsl',
  providesProjection: false,
  newFileTemplate: (fileName) => `model ${fileName.replace(/\.lp$/i, '')} {\n}\n`,
});

// Side-effect registrations owned by this plugin.
import '../model/paletteContributions';
import '../model/modelValidation';
import '../project/dslOutlineContribution';

export const desPlugin = {
  id: 'logicpilot.des',
  description: 'Discrete-event process modeling: DSL documents, palette, graph validation',
};
