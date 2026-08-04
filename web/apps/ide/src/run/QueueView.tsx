// PixiJS 8 view of the queueing scene: one service cell per server (from the
// `servers` counter; the last `down_servers` cells are tinted red), in-service
// customers on their cell, waiting customers laid out by Tick.deltas pos_x.
// Targets arrive at 10 Hz; display positions lerp toward them inside the
// rAF-driven ticker, so motion stays smooth at display refresh rate.

import { Application, Graphics } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { useConnectionStore } from '../state/connectionStore';
import { resolveTheme, useThemeStore } from '../state/themeStore';
import { vizState } from '../state/vizState';

interface DisplayAgent {
  x: number;
  y: number;
  serving: boolean;
}

// Pixi paints its own canvas, so colors cannot use CSS variables directly;
// pick the palette by the resolved theme (mirrors the --canvas-bg token).
const PALETTES = {
  light: {
    canvas: 0xffffff,
    serverIdle: 0xe6e8eb,
    serverBusy: 0xd29922,
    serverDown: 0xcf222e,
    serving: 0x1a7f37,
    waiting: 0x0969da,
    label: 0x8b949e,
    stroke: 0xffffff,
  },
  dark: {
    canvas: 0x0b1018,
    serverIdle: 0x30363d,
    serverBusy: 0xffb020,
    serverDown: 0xf85149,
    serving: 0x3fb950,
    waiting: 0x58a6ff,
    label: 0x8b949e,
    stroke: 0x0d1117,
  },
} as const;

export function QueueView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const setFps = useConnectionStore((state) => state.setFps);
  const setFpsRef = useRef(setFps);
  setFpsRef.current = setFps;

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
      const colors = PALETTES[resolveTheme(useThemeStore.getState().mode)];
      const state = vizState;
      const { width, height } = app.screen;
      const originX = 110;
      const originY = height * 0.55;
      const servers = Math.max(1, Math.round(state.servers));
      const cellW = 56;

      // Drop agents that left the system (not present in the latest Tick).
      for (const id of [...display.keys()]) {
        if (!state.agents.has(id)) display.delete(id);
      }

      // Queue spacing: compress for long queues. Queue world slots start at
      // `servers` (SimRunner positions them after the service cells).
      let maxQueue = 8;
      for (const agent of state.agents.values()) {
        if (agent.x >= servers) {
          maxQueue = Math.max(maxQueue, Math.ceil(agent.x) - servers + 1);
        }
      }
      const queueStartX = originX + servers * cellW;
      const spacing = Math.min(34, Math.max(12, (width - queueStartX - 60) / maxQueue));

      // Interpolate toward the latest Tick targets (exponential smoothing,
      // ~100 ms convergence to match the 10 Hz telemetry cadence).
      const alpha = 1 - Math.exp(-Math.min(dtSeconds, 0.1) * 12);
      for (const [id, target] of state.agents) {
        const inService = target.x < servers;
        const tx = inService
          ? originX + target.x * cellW + cellW / 2
          : queueStartX + (target.x - servers) * spacing;
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
      // Theme-following canvas background (Pixi paints its own canvas).
      layer.rect(0, 0, width, height).fill(colors.canvas);

      // Ground line through the queue.
      layer
        .moveTo(originX - 60, originY)
        .lineTo(width - 20, originY)
        .stroke({ width: 1, color: colors.label, alpha: 0.25 });

      // Service cells: one per server; the last `downServers` cells are down.
      const downServers = Math.max(0, Math.min(state.downServers, servers));
      for (let i = 0; i < servers; ++i) {
        const down = i >= servers - downServers;
        const color = down ? colors.serverDown : state.busy ? colors.serverBusy : colors.serverIdle;
        const cx = originX + i * cellW;
        layer
          .roundRect(cx + 2, originY - 42, cellW - 14, 84, 8)
          .fill({ color, alpha: down || state.busy ? 0.9 : 0.5 })
          .stroke({
            width: 2,
            color: down ? colors.serverDown : state.busy ? colors.serverBusy : colors.label,
          });
      }

      // Customers.
      for (const agent of display.values()) {
        layer
          .circle(agent.x, agent.y, 9)
          .fill(agent.serving ? colors.serving : colors.waiting)
          .stroke({ width: 1.5, color: colors.stroke });
      }
    };

    void app
      .init({
        resizeTo: el,
        background: PALETTES[resolveTheme(useThemeStore.getState().mode)].canvas,
        antialias: true,
      })
      .then(() => {
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
            setFpsRef.current(Math.round(ticker.FPS));
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
        <span className="dot dot-down" /> server down
      </div>
    </div>
  );
}
