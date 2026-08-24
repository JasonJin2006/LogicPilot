// Wire gesture layer for the model canvas (canvas-platform S3.2): drag from
// an out port, or click-then-click (two-stage connect armed by PressGesture),
// to couple blocks - state-to-state gestures create transitions instead.
// All state and lifecycle live here; the host supplies target lookup and the
// write-back commands.

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ModelNode } from '@logicpilot/editor';
import { PressGesture } from '@logicpilot/canvas';

export interface WireTarget {
  id: string;
  port: string;
}

interface DraftWire {
  fromId: string;
  fromPort: string;
  x: number;
  y: number;
}

export interface UseWireGestureOptions {
  visibleNodes: ModelNode[];
  /** Screen → world transform of the hosting canvas. */
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** Nearest valid in-port within tolerance, excluding the source block. */
  findTarget: (world: { x: number; y: number }, fromId: string) => WireTarget | null;
  /** Screen anchor of one port (for the draft wire's origin). */
  getAnchor: (node: ModelNode, port: string) => { x: number; y: number };
  connect: (fromId: string, toId: string, fromPort: string, toPort: string) => void;
  createTransition: (from: ModelNode, to: ModelNode) => void;
  /** Whether completing this pair should create a transition block instead
   *  of a flow coupling (host owns the paradigm rule). */
  isTransitionPair?: (from: ModelNode, to: ModelNode) => boolean;
}

/** Slop radius distinguishing a wire drag from an arming click. */
const WIRE_SLOP_PX = 4;

export function useWireGesture({
  visibleNodes,
  clientToWorld,
  findTarget,
  getAnchor,
  connect,
  createTransition,
  isTransitionPair,
}: UseWireGestureOptions) {
  const [draftWire, setDraftWire] = useState<DraftWire | null>(null);
  const [wireTarget, setWireTarget] = useState<WireTarget | null>(null);
  // Two-stage connect: a plain click (no drag) on an out port arms the
  // connection; the next click on an in port completes it. Esc, another
  // canvas click or re-clicking the armed port cancels.
  const [pendingConnect, setPendingConnect] = useState<{
    fromId: string;
    fromPort: string;
  } | null>(null);
  const wirePress = useRef<PressGesture | null>(null);

  const completeWire = (
    fromId: string,
    fromPort: string,
    world: { x: number; y: number },
  ): void => {
    const target = findTarget(world, fromId);
    if (target === null) return;
    const from = visibleNodes.find((node) => node.id === fromId);
    const to = visibleNodes.find((node) => node.id === target.id);
    if (from !== undefined && to !== undefined && isTransitionPair?.(from, to)) {
      // Statechart-family pair: the gesture creates a transition (AnyLogic
      // style) instead of a process-flow coupling.
      createTransition(from, to);
    } else if (to !== undefined) {
      connect(fromId, target.id, fromPort, target.port);
    }
  };

  const beginWire = (
    event: ReactPointerEvent<HTMLSpanElement>,
    node: ModelNode,
    port: string,
  ): void => {
    event.stopPropagation();
    const anchor = getAnchor(node, port);
    wirePress.current = new PressGesture();
    wirePress.current.begin({ x: event.clientX, y: event.clientY }, WIRE_SLOP_PX);
    setDraftWire({ fromId: node.id, fromPort: port, x: anchor.x, y: anchor.y });
    setWireTarget(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWire = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (!draftWire) return;
    wirePress.current?.update({ x: event.clientX, y: event.clientY });
    const world = clientToWorld(event.clientX, event.clientY);
    setDraftWire((wire) => (wire ? { ...wire, x: world.x, y: world.y } : wire));
    setWireTarget(findTarget(world, draftWire.fromId));
  };

  const endWire = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (!draftWire) return;
    if (wirePress.current?.moved ?? false) {
      completeWire(
        draftWire.fromId,
        draftWire.fromPort,
        clientToWorld(event.clientX, event.clientY),
      );
    } else {
      // A click without a drag arms the two-stage connect: the next click on
      // an in port completes it.
      setPendingConnect({ fromId: draftWire.fromId, fromPort: draftWire.fromPort });
    }
    wirePress.current = null;
    setDraftWire(null);
    setWireTarget(null);
  };

  const cancelWire = (): void => {
    wirePress.current = null;
    setDraftWire(null);
    setWireTarget(null);
  };

  /** Second stage of the click-click connect. */
  const onPortClick = (event: ReactMouseEvent<HTMLSpanElement>): void => {
    if (pendingConnect === null) return;
    event.stopPropagation();
    const world = clientToWorld(event.clientX, event.clientY);
    completeWire(pendingConnect.fromId, pendingConnect.fromPort, world);
    setPendingConnect(null);
  };

  // Escape cancels an in-flight wire or the armed two-stage connect.
  useEffect(() => {
    if (!draftWire && !pendingConnect) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelWire();
        setPendingConnect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draftWire, pendingConnect]);

  return {
    draftWire,
    wireTarget,
    pendingConnect,
    beginWire,
    moveWire,
    endWire,
    cancelWire,
    onPortClick,
    disarmPendingConnect: () => setPendingConnect(null),
  };
}
