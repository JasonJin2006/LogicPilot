// Center-workspace visualization placeholder.
//
// The previous hardcoded MM1 queue animation was removed: the workspace is
// the model's presentation view (AnyLogic-style), which will be rebuilt on
// a per-element presentation registry (blocks/agents each provide their own
// rendering) instead of a fixed 'queue' scene.

export function VisualizationPlaceholder() {
  return <div className="viz-empty" />;
}
