// SysML plugin web entrypoint (Phase 2 plugin platform): registers the
// .sysml document type, projection panels, palette catalog, outline
// contribution, properties editor, selection-focus probe and problem
// source. Self-contained - removing this plugin (and the src/sysml
// directory) removes SysML support entirely.

import type { PluginModule } from '@logicpilot/plugin-host';

import { lazy } from 'react';
import { registerPropertiesEditor } from '../../../layout/PropertiesHost';
import { registerFocusProbe } from '../../../layout/panels';
import { registerProblemSource } from '../../../workbench/problems';
import { notifySelectionChanged } from '../../../workbench/selectionFocus';
import { useSysMLStore } from '../../../state/sysmlStore';
import type { ProblemEntry } from '../../../workbench/problems';
import { registerSysmlDocumentContribution } from '../../../sysml/sysmlDocumentContribution';
import { registerSysmlPanelContribution } from '../../../sysml/sysmlPanelsContribution';
import { registerSysmlPaletteContribution } from '../../../sysml/sysmlPaletteContribution';
import { registerSysmlOutlineContribution } from '../../../sysml/sysmlOutlineContribution';
import {
  BUILTIN_SYSML_SEMANTIC_PROVIDER,
  registerSysMLSemanticProvider,
} from '../../registries/sysmlSemantics';
import sysmlContributionsJson from './contributions.json';
import { registerLocalPluginContribution } from '../../registry';

const LazySysmlProperties = lazy(() =>
  import('../../../sysml/SysMLPropertiesPanel').then((module) => ({
    default: module.SysMLPropertiesPanel,
  })),
);

export function activateSysmlPlugin(): PluginModule {
  return {
    activate: (ctx) => {
      ctx.effect(registerSysmlDocumentContribution());
      ctx.effect(registerSysmlPanelContribution());
      ctx.effect(registerSysmlPaletteContribution());
      ctx.effect(registerSysmlOutlineContribution());
      ctx.effect(registerSysMLSemanticProvider(BUILTIN_SYSML_SEMANTIC_PROVIDER));
      ctx.effect(registerLocalPluginContribution(sysmlContributionsJson));
      // Properties host: the SysML element inspector swaps in while a
      // .sysml document is active (previously a hardcoded core branch).
      const disposeProperties = registerPropertiesEditor('sysml', () => LazySysmlProperties);
      ctx.effect(disposeProperties);

      // Selection focus probe: a projection selection brings Properties
      // forward; the workspace hears about it through the neutral seam.
      const disposeProbe = registerFocusProbe(() => useSysMLStore.getState().selectedId !== null);
      ctx.effect(disposeProbe);
      const offSelection = useSysMLStore.subscribe(() => notifySelectionChanged());
      ctx.effect(offSelection);

      // Problems aggregation: projection diagnostics + parse-dirty marker
      // surface in the unified list (previously a hardcoded core input).
      const disposeProblems = registerProblemSource({
        id: 'sysml',
        subscribe: (listener) => useSysMLStore.subscribe(listener),
        read: () => {
          const state = useSysMLStore.getState();
          const entries: ProblemEntry[] = [];
          if (state.parseDirty) {
            entries.push({
              id: 'sysml:parse-dirty',
              origin: 'sysml',
              code: 'SY0001',
              severity: 'error',
              message:
                'the SysML source has parse errors - the canvas shows the last valid projection',
            });
          }
          for (const [index, diagnostic] of (state.projection?.diagnostics ?? []).entries()) {
            entries.push({
              id: `sysml:${index}:${diagnostic.code}`,
              origin: 'sysml',
              code: diagnostic.code,
              severity: diagnostic.severity,
              message: diagnostic.message,
              line: diagnostic.line,
              ...(diagnostic.path !== undefined ? { path: diagnostic.path } : {}),
            });
          }
          return entries;
        },
      });
      ctx.effect(disposeProblems);

      // onSelectionChanged removed: the store subscription above pushes
      // directly into the neutral seam.
    },
  };
}
