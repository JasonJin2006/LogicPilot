// Rolling-window counter charts (uPlot): queue_length / throughput /
// mean_wait versus simulated time, fed by 10 Hz Counters frames.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartsHandle {
  /** Append one Counters sample at simulated time t (seconds). */
  push: (t: number, counters: Record<string, number>) => void;
  /** Clear all history (new run / new replication). */
  reset: () => void;
}

interface Metric {
  key: string;
  color: string;
}

const METRICS: Metric[] = [
  { key: 'queue_length', color: '#58a6ff' },
  { key: 'throughput', color: '#3fb950' },
  { key: 'mean_wait', color: '#ffb020' },
];

const MAX_POINTS = 1200; // ~2 minutes at 10 Hz
const CHART_HEIGHT = 128;

interface SeriesBuffer {
  t: number[];
  v: Array<number | null>;
}

function makeOptions(width: number, metric: Metric): uPlot.Options {
  return {
    width,
    height: CHART_HEIGHT,
    pxAlign: false,
    legend: { show: false },
    padding: [8, 8, 0, 0],
    series: [{}, { label: metric.key, stroke: metric.color, width: 2 }],
    axes: [
      { stroke: '#8b949e', grid: { stroke: '#21262d' }, font: '10px monospace' },
      { stroke: '#8b949e', grid: { stroke: '#21262d' }, font: '10px monospace' },
    ],
    scales: {
      // x is simulated seconds, not epoch time.
      x: { time: false },
    },
  };
}

export const ChartPanel = forwardRef<ChartsHandle, object>(function ChartPanel(_props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotEls = useRef<Array<HTMLDivElement | null>>([]);
  const plots = useRef<Array<uPlot | null>>([]);
  const buffers = useRef<SeriesBuffer[]>(METRICS.map(() => ({ t: [], v: [] })));
  const lastT = useRef<number>(Number.NEGATIVE_INFINITY);

  const redraw = () => {
    plots.current.forEach((plot, i) => {
      const buf = buffers.current[i];
      if (plot && buf) {
        plot.setData([buf.t, buf.v]);
      }
    });
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const width = Math.max(220, wrap.clientWidth - 4);
    plots.current = METRICS.map((metric, i) => {
      const el = plotEls.current[i];
      if (!el) return null;
      const buf = buffers.current[i];
      return new uPlot(makeOptions(width, metric), [buf?.t ?? [], buf?.v ?? []], el);
    });

    const observer = new ResizeObserver(() => {
      const w = Math.max(220, wrap.clientWidth - 4);
      plots.current.forEach((plot) => {
        plot?.setSize({ width: w, height: CHART_HEIGHT });
      });
    });
    observer.observe(wrap);

    return () => {
      observer.disconnect();
      plots.current.forEach((plot) => plot?.destroy());
      plots.current = [];
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      push: (t: number, counters: Record<string, number>) => {
        // sim_time goes backwards when the gateway restarts a replication
        // (or a new run begins without RunStarted): start a fresh window.
        if (t < lastT.current) {
          buffers.current.forEach((buf) => {
            buf.t = [];
            buf.v = [];
          });
        }
        lastT.current = t;
        METRICS.forEach((metric, i) => {
          const buf = buffers.current[i];
          if (!buf) return;
          buf.t.push(t);
          buf.v.push(counters[metric.key] ?? null);
          if (buf.t.length > MAX_POINTS) {
            buf.t.shift();
            buf.v.shift();
          }
        });
        redraw();
      },
      reset: () => {
        lastT.current = Number.NEGATIVE_INFINITY;
        buffers.current.forEach((buf) => {
          buf.t = [];
          buf.v = [];
        });
        redraw();
      },
    }),
    [],
  );

  return (
    <div ref={wrapRef} className="charts">
      {METRICS.map((metric, i) => (
        <div key={metric.key} className="chart-block">
          <div className="chart-title" style={{ color: metric.color }}>
            {metric.key}
          </div>
          <div
            ref={(el) => {
              plotEls.current[i] = el;
            }}
          />
        </div>
      ))}
    </div>
  );
});
