import type { ViewDefinition } from '@logicpilot/contracts';
import type { AssistantTool } from '../../toolTypes';
import { planViews } from '../../../plugins/viewPlanner';

const CANVASES: readonly ViewDefinition['canvas'][] = [
  'graph2d',
  'scene2d',
  'scene3d',
  'timeline',
  'table',
  'chart',
  'text',
  'flow',
  'statechart',
  'sequence',
  'stock-flow',
  'causal-loop',
];

export const VIEW_PLANNING_TOOLS: readonly AssistantTool[] = [
  {
    name: 'plan_view',
    executionMode: 'parallel',
    description:
      'Suggest installed ViewDefinitions for a modeling question; explicit user view selection always wins.',
    parameters: {
      purpose: { type: 'string', required: true },
      artifactKinds: { type: 'array' },
      preferredCanvas: { type: 'string', enum: CANVASES },
      selectedViewId: { type: 'string' },
    },
    validate: (args) => {
      if (typeof args.purpose !== 'string' || args.purpose.trim() === '')
        return 'purpose must be a non-empty string';
      if (
        args.preferredCanvas !== undefined &&
        (typeof args.preferredCanvas !== 'string' ||
          !CANVASES.includes(args.preferredCanvas as never))
      )
        return 'preferredCanvas is not a supported canvas';
      if (args.artifactKinds !== undefined && !Array.isArray(args.artifactKinds))
        return 'artifactKinds must be an array';
      return null;
    },
    execute: (args) => ({
      ok: true,
      candidates: planViews({
        purpose: String(args.purpose),
        artifactKinds: Array.isArray(args.artifactKinds)
          ? args.artifactKinds.filter((kind): kind is string => typeof kind === 'string')
          : undefined,
        preferredCanvas:
          typeof args.preferredCanvas === 'string'
            ? (args.preferredCanvas as ViewDefinition['canvas'])
            : undefined,
        selectedViewId: typeof args.selectedViewId === 'string' ? args.selectedViewId : undefined,
      }),
    }),
  },
];
