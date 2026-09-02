import type { ViewDefinition } from '@logicpilot/contracts';
import { activeViews } from './viewRegistry';

export interface ViewIntent {
  readonly purpose: string;
  readonly artifactKinds?: readonly string[];
  readonly preferredCanvas?: ViewDefinition['canvas'];
  readonly selectedViewId?: string;
}

export interface ViewSuggestion {
  readonly viewId: string;
  readonly canvas: ViewDefinition['canvas'];
  readonly score: number;
  readonly reasons: readonly string[];
}

const PURPOSE_RULES: readonly {
  readonly words: readonly string[];
  readonly canvases: readonly ViewDefinition['canvas'][];
  readonly reason: string;
}[] = [
  {
    words: ['spatial', 'space', 'collision', 'trajectory', '空间', '轨迹'],
    canvases: ['scene2d', 'scene3d'],
    reason: 'spatial or trajectory intent',
  },
  {
    words: ['process', 'route', 'flow', '流程', '路由'],
    canvases: ['flow'],
    reason: 'process routing intent',
  },
  {
    words: ['lifecycle', 'state', '状态', '生命周期'],
    canvases: ['statechart'],
    reason: 'lifecycle/state intent',
  },
  {
    words: ['sequence', 'message', '消息', '顺序'],
    canvases: ['sequence'],
    reason: 'message ordering intent',
  },
  {
    words: ['architecture', 'boundary', '架构', '边界'],
    canvases: ['graph2d'],
    reason: 'architecture boundary intent',
  },
  {
    words: ['parameter', 'evidence', 'metric', '参数', '证据', '指标'],
    canvases: ['table', 'chart'],
    reason: 'parameter/evidence intent',
  },
  {
    words: ['causal', 'feedback', '因果', '反馈'],
    canvases: ['stock-flow', 'causal-loop'],
    reason: 'causal feedback intent',
  },
];

function score(view: ViewDefinition, intent: ViewIntent): ViewSuggestion {
  const text = intent.purpose.toLocaleLowerCase();
  const reasons: string[] = [];
  let value = 0;
  for (const rule of PURPOSE_RULES) {
    if (
      rule.words.some((word) => text.includes(word.toLocaleLowerCase())) &&
      rule.canvases.includes(view.canvas)
    ) {
      value += 10;
      reasons.push(rule.reason);
    }
  }
  if (intent.preferredCanvas === view.canvas) {
    value += 20;
    reasons.push('user preferred canvas');
  }
  if (intent.artifactKinds?.some((kind) => view.query.artifactKinds.includes(kind as never))) {
    value += 5;
    reasons.push('view queries requested artifact kind');
  }
  if (intent.selectedViewId === view.id) {
    value += 1_000;
    reasons.push('explicit user selection');
  }
  return { viewId: view.id, canvas: view.canvas, score: value, reasons };
}

/** Suggest only installed ViewDefinitions. Explicit user selection always
 * wins; otherwise ties are resolved by stable view id. */
export function planViews(
  intent: ViewIntent,
  views: readonly ViewDefinition[] = activeViews(),
): readonly ViewSuggestion[] {
  return [...views]
    .map((view) => score(view, intent))
    .filter((suggestion) => suggestion.score > 0 || intent.selectedViewId === suggestion.viewId)
    .sort((left, right) => right.score - left.score || left.viewId.localeCompare(right.viewId));
}
