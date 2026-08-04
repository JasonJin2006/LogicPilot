// Small inline SVG charts for the AI panel: continuous-model trajectory and
// the optimization curve over the search space.

import type { AiResult, OptimizeResult } from './api';

const TRAJECTORY_COLORS = ['#58a6ff', '#3fb950', '#ffb020', '#f85149'];

export function TrajectoryChart({
  trajectory,
}: {
  trajectory: NonNullable<AiResult['trajectory']>;
}) {
  const { variables, points } = trajectory;
  const width = 260;
  const height = 120;
  const pad = 6;
  let tMax = 0;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const point of points) {
    tMax = Math.max(tMax, point.t);
    for (const value of point.values) {
      vMin = Math.min(vMin, value);
      vMax = Math.max(vMax, value);
    }
  }
  if (vMin === vMax) {
    vMin -= 1;
    vMax += 1;
  }
  const x = (t: number) => pad + (t / (tMax || 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - vMin) / (vMax - vMin)) * (height - 2 * pad);
  return (
    <svg className="ai-trajectory" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {variables.map((name, index) => {
        const line = points
          .map((point) => `${x(point.t).toFixed(1)},${y(point.values[index] ?? 0).toFixed(1)}`)
          .join(' ');
        return (
          <polyline
            key={name}
            points={line}
            fill="none"
            stroke={TRAJECTORY_COLORS[index % TRAJECTORY_COLORS.length]}
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

// Optimization curve: variable value on the x axis, metric score on the y
// axis, with the best evaluated point highlighted (min or max per objective).
export function OptimizeChart({
  evaluations,
  objective,
}: {
  evaluations: OptimizeResult['evaluations'];
  objective: string;
}) {
  if (evaluations.length < 2) {
    return null;
  }
  const width = 260;
  const height = 120;
  const pad = 6;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let bestIndex = 0;
  let bestScore = evaluations[0]!.score;
  for (let i = 0; i < evaluations.length; ++i) {
    const { value, score } = evaluations[i]!;
    xMin = Math.min(xMin, value);
    xMax = Math.max(xMax, value);
    yMin = Math.min(yMin, score);
    yMax = Math.max(yMax, score);
    const better = objective === 'maximize' ? score > bestScore : score < bestScore;
    if (better) {
      bestIndex = i;
      bestScore = score;
    }
  }
  if (xMin === xMax) {
    xMax = xMin + 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const x = (v: number) => pad + ((v - xMin) / (xMax - xMin)) * (width - 2 * pad);
  const y = (s: number) => pad + (1 - (s - yMin) / (yMax - yMin)) * (height - 2 * pad);
  const points = evaluations
    .map((entry) => `${x(entry.value).toFixed(1)},${y(entry.score).toFixed(1)}`)
    .join(' ');
  const best = evaluations[bestIndex]!;
  return (
    <svg
      className="ai-trajectory ai-opt-chart"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline points={points} fill="none" stroke={TRAJECTORY_COLORS[0]} strokeWidth="1.5" />
      <circle
        cx={x(best.value).toFixed(1)}
        cy={y(best.score).toFixed(1)}
        r="3"
        fill={TRAJECTORY_COLORS[1]}
      />
    </svg>
  );
}
