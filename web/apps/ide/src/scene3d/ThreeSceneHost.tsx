// The imperative Three.js host.
//
// React renders this component once; everything per-frame happens outside
// React's render path. That mirrors the existing pattern for high-frequency
// data in this codebase (`state/vizState.ts` is deliberately a mutable
// non-React singleton read by a rAF loop), and it is what keeps a spinning
// camera from re-rendering the IDE's whole component tree.
//
// It also means the drawing surface never depends on React state: the host is
// told "here is the description, here is the selection" and it diffs.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  GridHelper,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PressGesture } from '@logicpilot/canvas';
import {
  AGENT_RADIUS,
  AgentMotion,
  type AgentPlacement,
  type Bounds3,
  type SceneDescription,
} from '@logicpilot/scene3d';
import { AgentLayer, SceneObjectTable, SceneResources } from './objects';
import { pickSceneId } from './picking';

const BACKGROUND = 0x12151b;
const WHEEL_DOLLY_STEP = 1.12;

export interface PixelStats {
  /** Mean absolute deviation of luminance from mid-grey, 0..255. A frame drawn
   *  onto the solid background sits near 0; anything drawn pushes it up. */
  variance: number;
  /** Distinct RGB triples sampled. A flat frame has 1. */
  distinctColors: number;
  sampled: number;
}

export interface Scene3DSpatialStats {
  /** `node` markers standing on the floor. */
  markerCount: number;
  /** Declared `path` segments drawn to scale. */
  segmentCount: number;
  /** Step-to-place lines (`moveTo { node = ... }`). */
  bridgeCount: number;
  /** Grid cell size in world units - the floor's stated scale. */
  gridCell: number;
}

export interface Scene3DStats {
  objectCount: number;
  linkCount: number;
  frames: number;
  cameraDistance: number;
  selectedId: string | null;
  /** False when WebGL could not be created; the panel then shows a notice
   *  instead of an unexplained empty box. */
  contextAvailable: boolean;
  /** Current drawing surface size in CSS pixels, so callers can fit the camera
   *  without measuring the DOM themselves. */
  viewport: { width: number; height: number };
  /** Agent markers currently drawn. */
  agentCount: number;
  /** Non-null when the model declares a spatial graph, so the panel and the
   *  tests can tell "the floor is drawn" from "this is the structural view". */
  spatial: Scene3DSpatialStats | null;
}

export interface Scene3DHandle {
  frame: () => void;
  reset: () => void;
  stats: () => Scene3DStats;
  samplePixels: () => PixelStats | null;
  /** Marker positions at this instant, so a test can watch them move. */
  sampleAgents: () => Array<{ id: string; x: number; y: number; z: number }>;
  bounds: () => Bounds3;
}

/** One wire frame's worth of agent targets, read inside the render loop.
 *
 * A getter rather than a prop value on purpose: the wire frames arrive at 10 Hz
 * and routing them through React state would re-render the IDE's component tree
 * ten times a second, which is exactly what `state/vizState` exists to avoid. */
export interface LiveFrame {
  placements: AgentPlacement[];
  /** Bumped when a run or connection resets. A change makes agents snap to their
   *  new positions instead of gliding across the scene from the last run's. */
  resetKey: number;
}

export interface ThreeSceneHostProps {
  description: SceneDescription;
  selectedId: string | null;
  hoveredId: string | null;
  showLabels: boolean;
  showLinks: boolean;
  /** Camera revision from the store; a change marks the frame dirty. */
  cameraRevision: number;
  camera: {
    target: { x: number; y: number; z: number };
    distance: number;
    azimuth: number;
    elevation: number;
    fov: number;
  };
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onOrbit: (deltaX: number, deltaY: number) => void;
  onPan: (deltaX: number, deltaY: number, viewport: { width: number; height: number }) => void;
  onDolly: (factor: number) => void;
  onFrame: (bounds: Bounds3, viewport: { width: number; height: number }) => void;
  /** Agent targets for the current moment, or null when there is nothing live
   *  (no run, or a model with no queue/service pair to anchor to). Called once
   *  per rendered frame; must be cheap and side-effect free. */
  getLiveFrame?: () => LiveFrame | null;
  /** Receives the live host so the workspace toolbar and the test hook can call
   *  it without prop plumbing for every action. */
  onReady?: (handle: Scene3DHandle | null) => void;
}

interface SceneRuntime {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  resources: SceneResources;
  table: SceneObjectTable;
  agents: AgentLayer;
  links: LineSegments;
  /** The floor ruler. Created on demand: a structural model must not pay for a
   *  grid it has no coordinates to measure. */
  grid: GridHelper | null;
  bridges: LineSegments;
  raycaster: Raycaster;
  dispose: () => void;
}

export const ThreeSceneHost = forwardRef<Scene3DHandle, ThreeSceneHostProps>(
  function ThreeSceneHost(props, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const runtimeRef = useRef<SceneRuntime | null>(null);
    const dirtyRef = useRef(true);
    const framesRef = useRef(0);
    const gestureRef = useRef(new PressGesture());
    const dragModeRef = useRef<'none' | 'orbit' | 'pan'>('none');
    const lastPointerRef = useRef({ x: 0, y: 0 });
    const propsRef = useRef(props);
    const motionRef = useRef(new AgentMotion());
    const lastResetKeyRef = useRef(-1);
    const [contextFailed, setContextFailed] = useState(false);

    // The rAF loop reads the latest props without being re-created for them.
    propsRef.current = props;

    // One handle object, created once: `useImperativeHandle` and `onReady` must
    // publish the same functions, or the toolbar and the test hook would drive
    // two different views of the host.
    const handleRef = useRef<Scene3DHandle | null>(null);
    if (handleRef.current === null) {
      handleRef.current = {
        frame: () => {
          propsRef.current.onFrame(
            propsRef.current.description.bounds,
            sizeOf(containerRef.current),
          );
          dirtyRef.current = true;
        },
        reset: () => {
          dirtyRef.current = true;
        },
        stats: () => {
          const runtime = runtimeRef.current;
          const current = propsRef.current;
          return {
            objectCount: runtime?.table.objectCount() ?? 0,
            linkCount: current.description.links.length,
            frames: framesRef.current,
            cameraDistance: current.camera.distance,
            selectedId: current.selectedId,
            contextAvailable: runtime !== null,
            viewport: sizeOf(containerRef.current),
            agentCount: runtime?.agents.count() ?? 0,
            spatial:
              current.description.spatial === undefined
                ? null
                : {
                    markerCount: current.description.spatial.markerCount,
                    segmentCount: current.description.spatial.segments.length,
                    bridgeCount: current.description.spatial.bridges.length,
                    gridCell: current.description.spatial.floor.cell,
                  },
          };
        },
        samplePixels: () => {
          const runtime = runtimeRef.current;
          if (runtime === null) return null;
          // Render and read in the same synchronous task. Reading after the
          // browser has composited would see an empty buffer unless the context
          // were created with `preserveDrawingBuffer`, which costs performance
          // in the normal case purely to make a test simpler.
          runtime.renderer.render(runtime.scene, runtime.camera);
          const gl = runtime.renderer.getContext();
          const width = gl.drawingBufferWidth;
          const height = gl.drawingBufferHeight;
          if (width <= 0 || height <= 0) return null;
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return pixelStats(pixels, width, height);
        },
        sampleAgents: () => runtimeRef.current?.agents.sample() ?? [],
        bounds: () => propsRef.current.description.bounds,
      };
    }
    const handle = handleRef.current;
    useImperativeHandle(ref, () => handle, [handle]);

    // Build the runtime once. Every prop is read through the ref, so this
    // effect must not depend on any of them.
    useEffect(() => {
      const container = containerRef.current;
      if (container === null) return;
      let runtime: SceneRuntime | null = null;
      try {
        runtime = createRuntime(container);
      } catch {
        // A machine without WebGL must get an explanation, not an empty box.
        setContextFailed(true);
        return;
      }
      runtimeRef.current = runtime;
      setContextFailed(false);
      propsRef.current.onReady?.(handle);

      const resizeObserver = new ResizeObserver(() => {
        const size = sizeOf(container);
        if (size.width <= 0 || size.height <= 0) return;
        runtime?.renderer.setSize(size.width, size.height, false);
        if (runtime !== null) {
          runtime.camera.aspect = size.width / size.height;
          runtime.camera.updateProjectionMatrix();
        }
        dirtyRef.current = true;
      });
      resizeObserver.observe(container);

      let raf = 0;
      let lastFrameMs = performance.now();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const active = runtimeRef.current;
        if (active === null) return;

        const nowMs = performance.now();
        const deltaSeconds = Math.min((nowMs - lastFrameMs) / 1000, 0.1);
        lastFrameMs = nowMs;

        // Live agents are advanced here rather than from React, so a run moving
        // at 10 Hz does not re-render the workbench.
        const live = propsRef.current.getLiveFrame?.() ?? null;
        if (live === null) {
          if (active.agents.count() > 0) {
            active.agents.clear();
            motionRef.current.reset();
            dirtyRef.current = true;
          }
        } else {
          if (live.resetKey !== lastResetKeyRef.current) {
            lastResetKeyRef.current = live.resetKey;
            motionRef.current.reset(live.placements);
          }
          const moved = motionRef.current.advance(live.placements, deltaSeconds);
          const serving = new Set(
            live.placements
              .filter((placement) => placement.serving)
              .map((placement) => placement.id),
          );
          active.agents.sync(motionRef.current.entries(), serving, AGENT_RADIUS);
          if (moved) dirtyRef.current = true;
        }

        if (dragModeRef.current !== 'none') dirtyRef.current = true;
        if (!dirtyRef.current) return;
        dirtyRef.current = false;
        active.renderer.render(active.scene, active.camera);
        framesRef.current += 1;
      };
      raf = requestAnimationFrame(tick);

      return () => {
        cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        propsRef.current.onReady?.(null);
        runtime?.dispose();
        runtimeRef.current = null;
      };
    }, []);

    // Camera: push the store's value into the engine whenever it changes.
    useEffect(() => {
      const runtime = runtimeRef.current;
      if (runtime === null) return;
      applyCamera(runtime.camera, props.camera);
      dirtyRef.current = true;
    }, [props.camera, props.cameraRevision]);

    // Scene content: diff rather than rebuild.
    useEffect(() => {
      const runtime = runtimeRef.current;
      if (runtime === null) return;
      runtime.table.sync(props.description, {
        selectedId: props.selectedId,
        hoveredId: props.hoveredId,
        showLabels: props.showLabels,
      });
      syncLinks(runtime, props.description, props.showLinks);
      syncSpatial(runtime, props.description);
      dirtyRef.current = true;
    }, [props.description, props.selectedId, props.hoveredId, props.showLabels, props.showLinks]);

    // Pointer handling. Attached as DOM listeners rather than React handlers so
    // a fast drag does not depend on React's synthetic event batching.
    useEffect(() => {
      const container = containerRef.current;
      if (container === null) return;
      // Typed as HTMLElement rather than a union: a union makes addEventListener
      // resolve to the generic EventListener overload and lose the event map.
      const canvas: HTMLElement = runtimeRef.current?.renderer.domElement ?? container;

      const onPointerDown = (event: PointerEvent) => {
        container.setPointerCapture?.(event.pointerId);
        const rect = container.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        lastPointerRef.current = point;
        gestureRef.current.begin(point);
        // Middle button or shift pans; plain left orbits until it becomes a drag.
        dragModeRef.current =
          event.button === 1 || event.shiftKey ? 'pan' : event.button === 0 ? 'orbit' : 'none';
        if (dragModeRef.current === 'pan') event.preventDefault();
      };

      const onPointerMove = (event: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const previous = lastPointerRef.current;
        const deltaX = point.x - previous.x;
        const deltaY = point.y - previous.y;
        lastPointerRef.current = point;

        if (gestureRef.current.active) {
          gestureRef.current.update(point);
          const size = { width: rect.width, height: rect.height };
          if (dragModeRef.current === 'pan') {
            propsRef.current.onPan(deltaX, deltaY, size);
          } else if (dragModeRef.current === 'orbit') {
            propsRef.current.onOrbit(deltaX, deltaY);
          }
          return;
        }

        // Hover: only when not dragging, and only meaningful for picking.
        const runtime = runtimeRef.current;
        if (runtime === null) return;
        const id = pickSceneId(runtime.raycaster, runtime.camera, runtime.table.pickables(), {
          x: point.x,
          y: point.y,
          width: rect.width,
          height: rect.height,
        });
        if (propsRef.current.hoveredId !== id) {
          propsRef.current.onHover(id);
          dirtyRef.current = true;
        }
      };

      const onPointerUp = (event: PointerEvent) => {
        container.releasePointerCapture?.(event.pointerId);
        const rect = container.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        // A press that never grew into a drag is a click, and only a click
        // selects. This is the shared kernel's classification, so a click means
        // the same thing here as on the 2D canvases.
        const wasClick = gestureRef.current.active && !gestureRef.current.moved;
        gestureRef.current.end();
        dragModeRef.current = 'none';
        if (!wasClick) return;
        const runtime = runtimeRef.current;
        if (runtime === null) return;
        const id = pickSceneId(runtime.raycaster, runtime.camera, runtime.table.pickables(), {
          x: point.x,
          y: point.y,
          width: rect.width,
          height: rect.height,
        });
        if (id !== null) propsRef.current.onSelect(id);
      };

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const factor = event.deltaY > 0 ? WHEEL_DOLLY_STEP : 1 / WHEEL_DOLLY_STEP;
        propsRef.current.onDolly(factor);
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('contextmenu', preventDefault);
      return () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', preventDefault);
      };
    }, []);

    return (
      <div className="scene3d-surface" ref={containerRef} data-testid="scene3d-surface">
        {contextFailed ? (
          <div className="scene3d-notice" data-testid="scene3d-webgl-unavailable">
            This machine has no usable WebGL context, so the 3D scene cannot be drawn. The 2D Model
            canvas is unaffected.
          </div>
        ) : null}
      </div>
    );
  },
);

function preventDefault(event: Event): void {
  event.preventDefault();
}

function sizeOf(element: HTMLElement | null): { width: number; height: number } {
  if (element === null) return { width: 0, height: 0 };
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function applyCamera(camera: PerspectiveCamera, state: ThreeSceneHostProps['camera']): void {
  const cosElevation = Math.cos(state.elevation);
  const offset = {
    x: cosElevation * Math.sin(state.azimuth),
    y: Math.sin(state.elevation),
    z: cosElevation * Math.cos(state.azimuth),
  };
  camera.position.set(
    state.target.x + offset.x * state.distance,
    state.target.y + offset.y * state.distance,
    state.target.z + offset.z * state.distance,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(new Vector3(state.target.x, state.target.y, state.target.z));
  camera.fov = state.fov;
  camera.updateProjectionMatrix();
}

function createRuntime(container: HTMLElement): SceneRuntime {
  const size = sizeOf(container);
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
  renderer.setSize(size.width, size.height, false);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(BACKGROUND);

  const camera = new PerspectiveCamera(50, size.width / size.height, 0.1, 5000);
  camera.position.set(10, 10, 10);

  scene.add(new AmbientLight(0xffffff, 0.55));
  scene.add(new HemisphereLight(0x9ecbff, 0x1b1f27, 0.45));
  const key = new DirectionalLight(0xffffff, 1.1);
  key.position.set(8, 14, 10);
  scene.add(key);
  const fill = new DirectionalLight(0x88aaff, 0.4);
  fill.position.set(-10, 6, -8);
  scene.add(fill);

  const resources = new SceneResources();
  const table = new SceneObjectTable(resources);
  scene.add(table.group);
  const agents = new AgentLayer(resources);
  scene.add(agents.group);

  const linkGeometry = new BufferGeometry();
  const linkMaterial = new LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.9 });
  const links = new LineSegments(linkGeometry, linkMaterial);
  links.frustumCulled = false;
  scene.add(links);

  // Destination lines carry their own colour and their own toggle-free life: a
  // `moveTo`'s target is a fact about the model, not a flow connection, so hiding
  // "Links" must not hide where a step goes.
  const bridgeGeometry = new BufferGeometry();
  const bridgeMaterial = new LineBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.85,
  });
  const bridges = new LineSegments(bridgeGeometry, bridgeMaterial);
  bridges.frustumCulled = false;
  bridges.visible = false;
  scene.add(bridges);

  const runtime: SceneRuntime = {
    renderer,
    scene,
    camera,
    resources,
    table,
    agents,
    links,
    grid: null,
    bridges,
    raycaster: new Raycaster(),
    dispose: () => {
      table.dispose();
      agents.dispose();
      resources.dispose();
      linkGeometry.dispose();
      linkMaterial.dispose();
      bridgeGeometry.dispose();
      bridgeMaterial.dispose();
      // Through the binding, not a snapshot: `syncSpatial` replaces this field as
      // the model changes, and a snapshot would leak whichever grid was current.
      disposeGrid(runtime);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return runtime;
}

/** Removes and releases the floor ruler, if one was built. */
function disposeGrid(runtime: Pick<SceneRuntime, 'grid'>): void {
  if (runtime.grid === null) return;
  runtime.grid.removeFromParent();
  runtime.grid.dispose();
  runtime.grid = null;
}

/** Builds, resizes or drops the floor ruler so its squares stay a round number of
 *  world units, then rebuilds the destination lines.
 *
 * The grid is the only thing in the scene that makes the floor's scale readable
 * without trusting the numbers in the status line, so it is regenerated whenever
 * the declared extent changes rather than being scaled: scaling a grid would
 * stretch its squares into rectangles. */
function syncSpatial(runtime: SceneRuntime, description: SceneDescription): void {
  const spatial = description.spatial;
  if (spatial === undefined) {
    disposeGrid(runtime);
  } else {
    const floor = spatial.floor;
    const existing = runtime.grid;
    // Keyed on the size, not the division count: 12 divisions is a 12-unit grid
    // with 1-unit cells or a 24-unit grid with 2-unit ones, and reusing the wrong
    // one would silently relabel the ruler.
    if (existing === null || existing.userData.size !== floor.width) {
      disposeGrid(runtime);
      const grid = new GridHelper(floor.width, floor.divisions, 0x3d4757, 0x232a35);
      grid.userData.size = floor.width;
      grid.position.set(floor.center.x, 0, floor.center.z);
      runtime.scene.add(grid);
      runtime.grid = grid;
    } else {
      existing.position.set(floor.center.x, 0, floor.center.z);
    }
  }

  const positions: number[] = [];
  for (const bridge of spatial?.bridges ?? []) {
    positions.push(bridge.from3.x, bridge.from3.y, bridge.from3.z);
    positions.push(bridge.to3.x, bridge.to3.y, bridge.to3.z);
  }
  runtime.bridges.geometry.dispose();
  const geometry = new BufferGeometry();
  if (positions.length > 0) {
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  }
  runtime.bridges.geometry = geometry;
  runtime.bridges.visible = positions.length > 0;
}

/** Rebuilds the link geometry from the current mesh positions.
 *
 * Straight centre-to-centre segments for now: routing links around obstacles is
 * a separate problem and doing it badly would be worse than a clear straight
 * line. */
function syncLinks(runtime: SceneRuntime, description: SceneDescription, visible: boolean): void {
  const positions: number[] = [];
  for (const link of description.links) {
    const from = runtime.table.group.getObjectByName(link.from);
    const to = runtime.table.group.getObjectByName(link.to);
    if (from === undefined || to === undefined) continue;
    positions.push(from.position.x, from.position.y, from.position.z);
    positions.push(to.position.x, to.position.y, to.position.z);
  }
  runtime.links.geometry.dispose();
  const geometry = new BufferGeometry();
  if (positions.length > 0) {
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  }
  runtime.links.geometry = geometry;
  runtime.links.visible = visible && positions.length > 0;
}

/** Pixel statistics used by the browser test to prove a frame is not blank.
 *
 * Sampling every Nth pixel keeps this cheap on a large surface while still
 * catching a uniform (i.e. nothing drawn) frame. */
function pixelStats(pixels: Uint8Array, width: number, height: number): PixelStats {
  const step = 4;
  let sum = 0;
  let count = 0;
  const seen = new Set<number>();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      const r = pixels[index] ?? 0;
      const g = pixels[index + 1] ?? 0;
      const b = pixels[index + 2] ?? 0;
      const luminance = (r + g + b) / 3;
      sum += Math.abs(luminance - 128);
      seen.add((r << 16) | (g << 8) | b);
      count += 1;
    }
  }
  const mean = count > 0 ? sum / count : 0;
  return { variance: mean, distinctColors: seen.size, sampled: count };
}
