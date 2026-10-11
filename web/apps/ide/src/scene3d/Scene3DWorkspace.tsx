// The Scene panel: a read-only 3D view of the current model document.
//
// Read-only on purpose. The only thing this panel writes anywhere is the
// selection (`useModelStore.select`), which is the same action the 2D canvas
// and the navigator use — so a click in 3D means the same thing as a click in
// 2D, and there is no second selection model to keep in step.
//
// Everything else it renders comes from the pure projection in
// `@logicpilot/scene3d`: this file decides layout and wiring, never geometry.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildScene,
  flowAnchorsFromScene,
  placeAgents,
  projectToScreen,
  type AgentView,
} from '@logicpilot/scene3d';
import { useModelStore } from '../state/modelStore';
import { useSceneStore } from '../state/sceneStore';
import { vizState } from '../state/vizState';
import {
  ThreeSceneHost,
  type LiveFrame,
  type Scene3DHandle,
  type Scene3DStats,
} from './ThreeSceneHost';

const EMPTY_STATS: Scene3DStats = {
  objectCount: 0,
  linkCount: 0,
  frames: 0,
  cameraDistance: 0,
  selectedId: null,
  contextAvailable: false,
  viewport: { width: 0, height: 0 },
  agentCount: 0,
  spatial: null,
};

export function Scene3DWorkspace() {
  const document = useModelStore((state) => state.document);
  const selectedId = useModelStore((state) => state.selectedId);
  const select = useModelStore((state) => state.select);

  const camera = useSceneStore((state) => state.camera);
  const cameraRevision = useSceneStore((state) => state.cameraRevision);
  const showLabels = useSceneStore((state) => state.showLabels);
  const showLinks = useSceneStore((state) => state.showLinks);
  const hoveredId = useSceneStore((state) => state.hoveredId);
  const orbitByPixels = useSceneStore((state) => state.orbitByPixels);
  const dollyBy = useSceneStore((state) => state.dollyBy);
  const panByPixels = useSceneStore((state) => state.panByPixels);
  const frameBounds = useSceneStore((state) => state.frameBounds);
  const resetCamera = useSceneStore((state) => state.resetCamera);
  const toggleLabels = useSceneStore((state) => state.toggleLabels);
  const toggleLinks = useSceneStore((state) => state.toggleLinks);
  const setHovered = useSceneStore((state) => state.setHovered);

  // One entry point decides which reading of the document the scene shows: a model
  // that declares `node`/`path` markup gets the floor built from those
  // coordinates, anything else gets the structural lift of the canvas layout.
  // Asking the projection rather than branching here keeps this file from having a
  // second opinion about what "spatial" means.
  const description = useMemo(() => buildScene(document), [document]);
  const handleRef = useRef<Scene3DHandle | null>(null);
  const [stats, setStats] = useState<Scene3DStats>(EMPTY_STATS);
  const [live, setLive] = useState({
    queueLength: 0,
    throughput: 0,
    meanWait: 0,
    simTime: 0,
    busy: false,
    servers: 1,
    agents: 0,
    anchored: false,
  });
  // Framing runs once per document identity. Re-framing on every change would
  // yank the camera away while the user is looking at something.
  const framedDocumentRef = useRef<unknown>(null);

  const frame = useCallback(() => {
    const handle = handleRef.current;
    if (handle === null) return;
    const viewport = handle.stats().viewport;
    if (viewport.width <= 0 || viewport.height <= 0) return;
    frameBounds(description.bounds, viewport);
  }, [description.bounds, frameBounds]);

  // Read by the render loop, not by React: wire frames arrive at 10 Hz and
  // routing them through state would re-render the workbench on every frame.
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  const liveCacheRef = useRef({ key: '', placements: [] as LiveFrame['placements'] });
  const getLiveFrame = useCallback((): LiveFrame | null => {
    const anchors = flowAnchorsFromScene(descriptionRef.current.objects, vizState.servers);
    // No queue/service pair means no flow axis: drawing agents anyway would put
    // them somewhere meaningless, so the layer stays off.
    if (anchors === null) return null;
    const cache = liveCacheRef.current;
    // Counters and ticks arrive as separate frames, so the anchors can move
    // without the tick changing.
    const key = `${vizState.tickVersion}:${vizState.servers}`;
    if (cache.key !== key) {
      const agents: AgentView[] = [];
      for (const [id, agent] of vizState.agents) {
        agents.push({ id, slot: agent.x, serving: agent.serving });
      }
      cache.placements = placeAgents(agents, anchors);
      cache.key = key;
    }
    return { placements: cache.placements, resetKey: vizState.tokenGeneration };
  }, []);

  const onReady = useCallback((handle: Scene3DHandle | null) => {
    handleRef.current = handle;
    if (handle !== null) setStats(handle.stats());
  }, []);

  // Frame the scene the first time there is something to frame. A model that
  // starts empty and is then loaded must still get an initial fit, hence keying
  // on the document identity rather than on mount.
  useEffect(() => {
    if (description.objects.length === 0) return;
    if (framedDocumentRef.current === document) return;
    framedDocumentRef.current = document;
    frame();
  }, [document, description.objects.length, frame]);

  // Refresh the readout as soon as the scene content changes. Without this the
  // status line shows the previous counts (initially "0 nodes") for up to one
  // poll interval while the canvas is already drawn, which reads as "nothing
  // loaded" - the exact confusion a blank-looking panel causes.
  useEffect(() => {
    const handle = handleRef.current;
    if (handle !== null) setStats(handle.stats());
  }, [description, selectedId, hoveredId]);

  // The status line is otherwise a slow, human-paced readout; sampling it on a
  // timer keeps the three.js frame counter from pushing React state every frame.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const handle = handleRef.current;
      if (handle !== null) setStats(handle.stats());
      setLive({
        queueLength: vizState.queueLength,
        throughput: vizState.throughput,
        meanWait: vizState.meanWait,
        simTime: vizState.simTime,
        busy: vizState.busy,
        servers: vizState.servers,
        agents: vizState.agents.size,
        anchored: flowAnchorsFromScene(descriptionRef.current.objects, vizState.servers) !== null,
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  // Test hook. The browser verification drives the panel through this rather
  // than through fragile DOM geometry, and it is the only supported way to read
  // the rendered pixels.
  useEffect(() => {
    const api = {
      stats: () => handleRef.current?.stats() ?? null,
      samplePixels: () => handleRef.current?.samplePixels() ?? null,
      sampleAgents: () => handleRef.current?.sampleAgents() ?? [],
      objectIds: () => description.objects.map((object) => object.id),
      unknownKindCount: () => description.objects.filter((object) => !object.knownKind).length,
      /** The spatial reading of the document, or null when the model declares no
       *  `node`/`path` markup. Positions come from the drawn objects rather than
       *  from the extracted graph, so an assertion here covers the whole
       *  projection from coordinates to scene geometry. */
      spatial: () => {
        const layer = description.spatial;
        if (layer === undefined) return null;
        return {
          markerCount: layer.markerCount,
          markerDiameter: layer.markerDiameter,
          pathWidth: layer.pathWidth,
          modelUnitsPerWorldUnit: layer.modelUnitsPerWorldUnit,
          extent: layer.extent,
          gridCell: layer.floor.cell,
          gridSize: layer.floor.width,
          usesZ: layer.usesZ,
          issueCount: layer.issueCount,
          segments: layer.segments.map((segment) => ({
            name: segment.name,
            from: segment.fromName,
            to: segment.toName,
            length: segment.length,
          })),
          bridges: layer.bridges.map((bridge) => ({ from: bridge.from, to: bridge.to })),
          positions: description.objects
            .filter((object) => object.kind === 'node')
            .map((object) => ({
              name: object.label,
              x: object.position.x,
              y: object.position.y,
              z: object.position.z,
            })),
        };
      },
      frame: () => frame(),
      /** The framed extent, so a test can check that the floor is inside the view
       *  rather than clipped by the fit. */
      bounds: () => handleRef.current?.bounds() ?? null,
      select: (id: string | null) => select(id),
      /** Screen position of a node, so a test can synthesise a real click at
       *  the right pixel and exercise the ray-casting pick path rather than
       *  calling select() directly. Uses the same projection the camera uses. */
      projectNode: (id: string) => {
        const handle = handleRef.current;
        if (handle === null) return null;
        const object = description.objects.find((entry) => entry.id === id);
        if (object === undefined) return null;
        const { viewport } = handle.stats();
        if (viewport.width <= 0 || viewport.height <= 0) return null;
        // Read the live camera: capturing it in this effect would go stale as
        // soon as the user orbits.
        const projected = projectToScreen(
          useSceneStore.getState().camera,
          object.position,
          viewport,
        );
        return projected === null ? null : { x: projected.x, y: projected.y };
      },
    };
    (window as unknown as { __logicpilotScene3d?: unknown }).__logicpilotScene3d = api;
    return () => {
      delete (window as unknown as { __logicpilotScene3d?: unknown }).__logicpilotScene3d;
    };
  }, [description, frame, select]);

  const spatialLayer = description.spatial ?? null;

  const selectedLabel = useMemo(() => {
    if (selectedId === null) return 'nothing selected';
    const object = description.objects.find((entry) => entry.id === selectedId);
    if (object === undefined) return 'nothing selected';
    return object.knownKind
      ? `${object.label} (${object.kind})`
      : `${object.label} (${object.kind}, unmapped kind)`;
  }, [description.objects, selectedId]);

  return (
    <div className="scene3d-workspace" data-testid="scene3d-workspace">
      <div className="scene3d-toolbar">
        <button type="button" onClick={frame} title="Frame everything in view">
          Fit
        </button>
        <button type="button" onClick={resetCamera} title="Return to the default viewpoint">
          Reset view
        </button>
        <label className="scene3d-toggle">
          <input type="checkbox" checked={showLinks} onChange={toggleLinks} />
          Links
        </label>
        <label className="scene3d-toggle">
          <input type="checkbox" checked={showLabels} onChange={toggleLabels} />
          Labels
        </label>
        <span className="scene3d-hint">
          drag to orbit &middot; middle-drag or shift-drag to pan &middot; wheel to zoom
        </span>
      </div>
      <ThreeSceneHost
        ref={handleRef}
        description={description}
        selectedId={selectedId}
        hoveredId={hoveredId}
        showLabels={showLabels}
        showLinks={showLinks}
        camera={camera}
        cameraRevision={cameraRevision}
        onSelect={select}
        onHover={setHovered}
        onOrbit={orbitByPixels}
        onPan={panByPixels}
        onDolly={dollyBy}
        onFrame={frameBounds}
        onReady={onReady}
        getLiveFrame={getLiveFrame}
      />
      <div className="scene3d-status" data-testid="scene3d-status">
        <span data-testid="scene3d-object-count">{stats.objectCount}</span> nodes
        {' · '}
        <span data-testid="scene3d-link-count">{stats.linkCount}</span> links
        {' · '}
        <span data-testid="scene3d-selected">{selectedLabel}</span>
        {spatialLayer !== null ? (
          <span
            className="scene3d-spatial"
            data-testid="scene3d-spatial"
            title={
              "Positions and path lengths are the model's own coordinates, drawn to scale. " +
              'Marker diameter and path width are conventional: the DSL declares where a node is, ' +
              'never how big it is.'
            }
          >
            {' · '}space{' '}
            <span data-testid="scene3d-spatial-markers">{spatialLayer.markerCount}</span>
            {' nodes / '}
            <span data-testid="scene3d-spatial-segments">{spatialLayer.segments.length}</span>
            {' paths · board '}
            <span data-testid="scene3d-spatial-extent">
              {spatialLayer.extent.width.toFixed(1)} × {spatialLayer.extent.depth.toFixed(1)}
            </span>
            {' units · grid '}
            <span data-testid="scene3d-spatial-grid">{spatialLayer.floor.cell}</span>
            {spatialLayer.usesZ ? (
              <span className="scene3d-status-note">
                {' '}
                — the model declares z, but the path solver is two-dimensional, so the floor is
                drawn flat
              </span>
            ) : null}
            {spatialLayer.issueCount > 0 ? (
              <span className="scene3d-status-note">
                {' '}
                — {spatialLayer.issueCount} spatial declaration
                {spatialLayer.issueCount === 1 ? '' : 's'} could not be used
              </span>
            ) : null}
          </span>
        ) : null}
        {live.agents > 0 ? (
          <span className="scene3d-live" data-testid="scene3d-live">
            {' · '}agents <span data-testid="scene3d-agent-count">{stats.agentCount}</span>
            {' · '}queue <span data-testid="scene3d-queue">{live.queueLength}</span>
            {' · '}throughput <span data-testid="scene3d-throughput">{live.throughput}</span>
            {' · '}mean wait {live.meanWait.toFixed(2)}
            {' · '}t {live.simTime.toFixed(1)}s
            {!live.anchored ? (
              <span className="scene3d-status-note">
                {' '}
                — this model has no queue/service pair, so the agents in the run have nowhere
                meaningful to stand
              </span>
            ) : null}
          </span>
        ) : null}
        {description.objects.length === 0 ? (
          <span className="scene3d-status-note">
            {' · '}the model is empty, so there is nothing to draw yet
          </span>
        ) : null}
        {!stats.contextAvailable ? (
          <span className="scene3d-status-note"> · no WebGL context</span>
        ) : null}
      </div>
    </div>
  );
}
