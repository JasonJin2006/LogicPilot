// Live chart widgets for the analysis-library chart blocks (AnyLogic-style
// data binding). The shared vizState is updated at 10 Hz by the wire-frame
// handler, so a chart block bound to a metric (queue length, throughput,
// mean wait, ...) scrolls live during a run without a dedicated socket.
import { useEffect, useState } from 'react';
import { vizState } from '../state/vizState';

const WINDOW = 60; // samples kept (10 Hz -> ~6 s of history)

type MetricReader = () => number;

const METRIC_READERS: Record<string, MetricReader> = {
  queueLength: () => vizState.queueLength,
  throughput: () => vizState.throughput,
  meanWait: () => vizState.meanWait,
  busy: () => (vizState.busy ? 1 : 0),
  servers: () => vizState.servers,
  downServers: () => vizState.downServers,
};

function resolveMetric(valueParam: unknown): MetricReader {
  const key = String(valueParam ?? 'queueLength');
  return METRIC_READERS[key] ?? METRIC_READERS['queueLength']!;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Scrollable line chart (Time Plot / Plot). */
function LineChart({
  samples,
  title,
  color,
}: {
  samples: number[];
  title: string;
  color: string;
}) {
  const width = 200;
  const height = 110;
  const pad = { left: 34, right: 8, top: 8, bottom: 18 };
  const max = niceMax(Math.max(1, ...samples));
  const points = samples
    .map((value, index) => {
      const x =
        pad.left +
        (samples.length === 1 ? 0 : (index / (samples.length - 1)) * (width - pad.left - pad.right));
      const y = height - pad.bottom - (Math.min(value, max) / max) * (height - pad.top - pad.bottom);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = samples[samples.length - 1] ?? 0;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" aria-label={title}>
      <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} stroke="currentColor" strokeWidth={1} opacity={0.4} />
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="currentColor" strokeWidth={1} opacity={0.4} />
      <line x1={pad.left} y1={pad.top} x2={width - pad.right} y2={pad.top} stroke="currentColor" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.25} />
      <text x={pad.left} y={pad.top - 3} fontSize={8} fill="currentColor" opacity={0.6}>
        {max.toFixed(0)}
      </text>
      {samples.length > 1 && (
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <text x={width / 2} y={height - 4} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.6}>
        {last.toFixed(1)}
      </text>
    </svg>
  );
}

/** Bar chart of the sample window (Bar Chart / Stack Chart). */
function BarChart({ samples, title, color }: { samples: number[]; title: string; color: string }) {
  const width = 200;
  const height = 110;
  const max = niceMax(Math.max(1, ...samples));
  const bars = samples.map((value, index) => {
    const barWidth = Math.max(2, (width - 12) / WINDOW - 1);
    const x = 8 + index * ((width - 12) / WINDOW);
    const barHeight = (Math.min(value, max) / max) * (height - 22);
    return <rect key={index} x={x} y={height - 18 - barHeight} width={barWidth} height={barHeight} fill={color} opacity={0.85} />;
  });
  const last = samples[samples.length - 1] ?? 0;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" aria-label={title}>
      <line x1={4} y1={height - 18} x2={width - 4} y2={height - 18} stroke="currentColor" strokeWidth={1} opacity={0.4} />
      {bars}
      <text x={width / 2} y={height - 4} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.6}>
        {last.toFixed(1)}
      </text>
    </svg>
  );
}

/** Donut showing the latest sample as a fraction of the window max. */
function PieChart({ samples, title, color }: { samples: number[]; title: string; color: string }) {
  const last = samples[samples.length - 1] ?? 0;
  const max = niceMax(Math.max(1, ...samples));
  const fraction = Math.min(last / max, 1);
  const circumference = 2 * Math.PI * 26;
  const dash = fraction * circumference;
  return (
    <div className="chart-donut">
      <svg viewBox="0 0 64 64" className="chart-svg" aria-label={title}>
        <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="8" opacity={0.15} />
        <circle
          cx="32"
          cy="32"
          r="26"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="36" fontSize="12" textAnchor="middle" fill="currentColor">
          {last.toFixed(1)}
        </text>
      </svg>
    </div>
  );
}

const KIND_COLORS: Record<string, string> = {
  timePlot: '#4cc2ff',
  plot: '#4cc2ff',
  barChart: '#3fb950',
  stackChart: '#3fb950',
  timeStackChart: '#3fb950',
  timeColorChart: '#d29922',
  pieChart: '#e3b341',
  histogram: '#4cc2ff',
  histogram2D: '#4cc2ff',
};

/** Renders an analysis-library chart block live on the canvas. */
export function ChartWidget({
  kind,
  params,
  name,
}: {
  kind: string;
  params: Record<string, string | number | boolean>;
  name: string;
}) {
  const [samples, setSamples] = useState<number[]>([]);
  const metric = resolveMetric(params['value']);
  const title = String(params['title'] ?? name);
  const color = KIND_COLORS[kind] ?? '#4cc2ff';

  useEffect(() => {
    const id = window.setInterval(() => {
      setSamples((previous) => {
        const next = [...previous, metric()];
        return next.length > WINDOW ? next.slice(next.length - WINDOW) : next;
      });
    }, 100);
    return () => window.clearInterval(id);
    // The metric binding is part of the block's params; a change restarts
    // the sampling loop.
  }, [metric, params['value']]);

  const body =
    kind === 'barChart' || kind === 'stackChart' || kind === 'timeStackChart' ? (
      <BarChart samples={samples} title={title} color={color} />
    ) : kind === 'pieChart' ? (
      <PieChart samples={samples} title={title} color={color} />
    ) : (
      <LineChart samples={samples} title={title} color={color} />
    );

  return (
    <div className="chart-widget" role="img" aria-label={`${title} live chart`}>
      <span className="chart-widget-title">{title}</span>
      {body}
      <span className="chart-widget-kind">{kind}</span>
    </div>
  );
}
