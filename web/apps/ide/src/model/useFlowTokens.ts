// Flow-token animation for the model canvas (canvas-platform S3.3):
// telemetry-driven circles travel along couplings when a block's departed
// counter advances. Reads the latest node/edge layout through refs so the
// rAF loop runs at display rate without restarting; a vizState
// tokenGeneration bump (new run / model switch / reconnect) drops in-flight
// tokens so leftovers never animate across a new run.

import { useEffect, useRef, useState } from 'react';
import type { ModelEdge, ModelNode } from '@logicpilot/editor';
import { departedDelta, vizState } from '../state/vizState';

export interface FlowToken {
  id: number;
  a: { x: number; y: number };
  b: { x: number; y: number };
  born: number;
}

export interface UseFlowTokensOptions {
  visibleNodes: ModelNode[];
  visibleEdges: ModelEdge[];
  getAnchor: (node: ModelNode, port: string) => { x: number; y: number };
  firstOutPort: (node: ModelNode) => string;
  firstInPort: (node: ModelNode) => string;
  lifetimeMs?: number;
}

/** Spawn rate guard: at most one delta scan per 80ms around the display
 *  frame. */
const SPAWN_INTERVAL_MS = 80;
/** Active token cap: latest window retained (spawns slice at -47 + 1). */
const MAX_ACTIVE = 48;

export function useFlowTokens({
  visibleNodes,
  visibleEdges,
  getAnchor,
  firstOutPort,
  firstInPort,
  lifetimeMs = 700,
}: UseFlowTokensOptions): { tokens: FlowToken[]; lifetimeMs: number } {
  const nodesRef = useRef(visibleNodes);
  const edgesRef = useRef(visibleEdges);
  nodesRef.current = visibleNodes;
  edgesRef.current = visibleEdges;
  const [tokens, setTokens] = useState<FlowToken[]>([]);
  const tokenSeq = useRef(0);
  // Keep the geometry/strategy callbacks in a ref so the loop effect stays
  // mounted once while still seeing fresh nodes/edges/props.
  const strategy = useRef({ getAnchor, firstOutPort, firstInPort, lifetimeMs });
  strategy.current = { getAnchor, firstOutPort, firstInPort, lifetimeMs };

  useEffect(() => {
    let raf = 0;
    let lastSpawn = 0;
    let seenGeneration = vizState.tokenGeneration;
    const tick = (now: number) => {
      if (vizState.tokenGeneration !== seenGeneration) {
        // New run / model switch / reconnect: the baseline was reset, so
        // drop leftover tokens and let the fresh counters spawn from 0.
        seenGeneration = vizState.tokenGeneration;
        setTokens([]);
        lastSpawn = now;
      }
      if (now - lastSpawn > SPAWN_INTERVAL_MS) {
        lastSpawn = now;
        const {
          getAnchor: anchor,
          firstOutPort: firstOut,
          firstInPort: firstIn,
        } = strategy.current;
        for (const [name, state] of vizState.blocks) {
          const previous = vizState.lastDeparted.get(name) ?? 0;
          const delta = departedDelta(previous, state.departed);
          if (delta === 0) continue;
          vizState.lastDeparted.set(name, state.departed);
          const fromNode = nodesRef.current.find((node) => node.name === name);
          if (!fromNode) continue;
          const outs = edgesRef.current.filter((edge) => edge.from === fromNode.id);
          if (outs.length === 0) continue;
          for (let i = 0; i < delta; ++i) {
            const edge = outs[i % outs.length]!;
            const toNode = nodesRef.current.find((node) => node.id === edge.to);
            if (!toNode) continue;
            const a = anchor(fromNode, edge.fromPort ?? firstOut(fromNode));
            const b = anchor(toNode, edge.toPort ?? firstIn(toNode));
            const id = tokenSeq.current++;
            setTokens((prev) => [...prev.slice(-(MAX_ACTIVE - 1)), { id, a, b, born: now }]);
          }
        }
      }
      setTokens((prev) => {
        const alive = prev.filter((token) => now - token.born < strategy.current.lifetimeMs);
        return alive.length === prev.length ? prev : alive;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // lifetimeMs mirrors the requested duration so renderers can keep the
  // CSS animation in sync with the prune policy.
  return { tokens, lifetimeMs };
}
