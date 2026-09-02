// DES plugin web entrypoint (Phase 2 plugin platform): registers the .lp
// document type plus the model palette, DES graph validator and DSL project
// outline through the workbench contribution registries. Self-contained -
// removing this plugin (with src/model and the DES halves of project/)
// removes DES support.
//
// The legacy side-effect file (src/plugins/des.ts) was the same set of
// imports without lifecycle; the PluginHost now drives it through
// activate()/deactivate() with effect-scoped cleanup.

import type { PluginModule } from '@logicpilot/plugin-host';
import { DOCUMENT_CONTRIBUTIONS } from '../../../workbench/documentTypes';
import { registerModelPaletteContributions } from '../../../model/paletteContributions';
import { registerDesModelValidation } from '../../../model/modelValidation';
import { registerDslOutlineContribution } from '../../../project/dslOutlineContribution';
import { replacePanel } from '../../../layout/panels';
import { DslEditor, ModelWorkspace } from '../../registries/panelComponents';
import {
  PROCESS_MODEL_SEMANTIC_PROVIDER,
  registerModelSemanticProvider,
} from '../../registries/modelSemantics';
import desContributionsJson from './contributions.json';
import { registerLocalPluginContribution } from '../../registry';

export function activateDesPlugin(): PluginModule {
  return {
    activate: (ctx) => {
      ctx.effect(
        DOCUMENT_CONTRIBUTIONS.register({
          id: 'dsl',
          label: 'LogicPilot DSL',
          extensions: ['.lp'],
          editorPanel: 'dsl',
          providesProjection: false,
          newFileTemplate: (fileName) => `model ${fileName.replace(/\.lp$/i, '')} {\n}\n`,
        }),
      );
      ctx.effect(registerModelPaletteContributions());
      ctx.effect(registerDesModelValidation());
      ctx.effect(registerDslOutlineContribution());
      ctx.effect(registerModelSemanticProvider(PROCESS_MODEL_SEMANTIC_PROVIDER));
      ctx.effect(registerLocalPluginContribution(desContributionsJson));
      ctx.effect(
        replacePanel('model', { title: 'Model', area: 'center', component: ModelWorkspace }),
      );
      ctx.effect(replacePanel('dsl', { title: 'DSL', area: 'center', component: DslEditor }));
    },
  };
}
