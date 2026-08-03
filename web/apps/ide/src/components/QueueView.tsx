// PixiJS 8 view of the M/M/1 queue: server station at the origin, waiting
// customers laid out by Tick.deltas pos_x. Targets arrive at 10 Hz; display
// positions lerp toward them inside the rAF-driven ticker, so motion stays
// smooth at display refresh rate.

import { Application, Graphics } from 'pixi.js';
import { useEffect, useRef } from 'react';
import type { VizState } from '../state/vizState';

interface QueueViewProps {
  viz: VizState;
  onFps: (fps: number) => void;
}

interface DisplayAgent {
  x: number;
  y: number;
  serving: boolean;
}

const COLORS = {
  background: 0x0d1117,
  serverIdle: 0x30363d,
  serverBusy: 0xffb020,
  serving: 0x3fb950,
  waiting: 0x58a6ff,
  label: 0x8b949e,
};

export function QueueView({ viz, onFps }: QueueViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vizRef = useRef(viz);
  vizRef.current = viz;
  const onFpsRef = useRef(onFps);
  onFpsRef.current = onFps;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const app = new Application();
    const layer = new Graphics();
    // Displayed (interpolated) positions keyed by stable agent id.
    const display = new Map<string, DisplayAgent>();
    let disposed = false;
    let initialized = false;
    let lastFpsPush = 0;

    const draw = (dtSeconds: number) => {
      const state = vizRef.current;
      const { width, height } = app.screen;
      const originX = 110;
      const originY = height * 0.55;

      // Drop agents that left the system (not present in the latest Tick).
      for (const id of [...display.keys()]) {
        if (!state.agents.has(id)) display.delete(id);
      }

      // World -> screen scale: compress spacing for long queues.
      let maxSlot = 8;
      for (const agent of state.agents.values()) {
        maxSlot = Math.max(maxSlot, Math.ceil(agent.x));
      }
      const spacing = Math.min(34, Math.max(12, (width - originX - 60) / maxSlot));

      // Interpolate toward the latest Tick targets (exponential smoothing,
      // ~100 ms convergence to match the 10 Hz telemetry cadence).
      const alpha = 1 - Math.exp(-Math.min(dtSeconds, 0.1) * 12);
      for (const [id, target] of state.agents) {
        const tx = originX + target.x * spacing;
        const ty = originY + target.y * spacing;
        const current = display.get(id);
        if (!current) {
          display.set(id, { x: tx, y: ty, serving: target.serving });
        } else {
          current.x += (tx - current.x) * alpha;
          current.y += (ty - current.y) * alpha;
          current.serving = target.serving;
        }
      }

      layer.clear();

      // Ground line through the queue.
      layer
        .moveTo(originX - 60, originY)
        .lineTo(width - 20, originY)
        .stroke({ width: 1, color: COLORS.label, alpha: 0.25 });

      // Server station at the origin; highlighted while busy.
      const serverColor = state.busy ? COLORS.serverBusy : COLORS.serverIdle;
      layer
        .roundRect(originX - 44, originY - 42, 52, 84, 8)
        .fill({ color: serverColor, alpha: state.busy ? 0.9 : 0.5 })
        .stroke({ width: 2, color: state.busy ? COLORS.serverBusy : COLORS.label });

      // Customers.
      for (const agent of display.values()) {
        layer
          .circle(agent.x, agent.y, 9)
          .fill(agent.serving ? COLORS.serving : COLORS.waiting)
          .stroke({ width: 1.5, color: 0x0d1117 });
      }
    };

    void app.init({ resizeTo: el, background: COLORS.background, antialias: true }).then(() => {
      if (disposed) {
        // React StrictMode may unmount before init resolves; destroy now
        // that the app is fully constructed.
        app.destroy(true);
        return;
      }
      initialized = true;
      app.stage.addChild(layer);
      app.ticker.add((ticker) => {
        draw(ticker.deltaMS / 1000);
        const now = performance.now();
        if (now - lastFpsPush > 500) {
          lastFpsPush = now;
          onFpsRef.current(Math.round(ticker.FPS));
        }
      });
      el.appendChild(app.canvas);
    });

    return () => {
      disposed = true;
      // Destroying before init finishes breaks Pixi internals; the init
      // callback above handles that case.
      if (initialized) {
        app.destroy(true, { children: true });
      }
    };
  }, []);

  return (
    <div className="queue-view">
      <div ref={containerRef} className="queue-canvas" />
      <div className="queue-legend">
        <span className="dot dot-serving" /> in service
        <span className="dot dot-waiting" /> waiting
        <span className="dot dot-server" /> server (busy)
      </div>
    </div>
  );
}
