// Scene description -> Three.js objects.
//
// Two things this file is careful about:
//
//   * **Sharing.** Geometries and materials are created once per shape and per
//     palette key and shared by every mesh that uses them. A scene of a few
//     hundred nodes would otherwise allocate a few hundred identical materials.
//   * **Incremental sync.** `syncObjects` diffs by id and only touches what
//     changed, so a selection change or one moved node does not rebuild the
//     scene graph. Rebuilding on every change is the difference between a
//     usable view and a stuttery one.
//
// Labels are sprites backed by a canvas texture rather than a font asset: no
// extra file to ship, no async font load to race, and they stay legible at any
// camera distance because the sprite scales with the world.

import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import type { SceneDescription, SceneObject, SceneShape } from '@logicpilot/scene3d';

/** Palette key -> base colour. Keys come from the projection's visual table, so
 *  an unmapped kind lands on `unknown` rather than on a colour that implies
 *  understanding. */
const PALETTE: Readonly<Record<string, number>> = {
  process: 0x4f7cac,
  state: 0x2f6d5a,
  decision: 0x6b7a1f,
  buffer: 0x7a5a1f,
  data: 0x5b3a7a,
  event: 0x8a5a2b,
  resource: 0x1f4d5c,
  behaviour: 0x35507a,
  control: 0x7a3a5a,
  terminal: 0x4a4a4a,
  chart: 0x2b4c6e,
  widget: 0x3f3f46,
  container: 0x33387a,
  agent: 0x2f6d5a,
  // Spatial markup. Distinct from `process` on purpose: on a spatial model the
  // floor is the point, and a marker sharing the block colour would read as one
  // more block dropped on the ground.
  spatialNode: 0xd9a441,
  spatialPath: 0x4a5568,
  unknown: 0x6b7280,
};

export const FALLBACK_COLOR = PALETTE.unknown ?? 0x6b7280;

/** Emissive tint applied to the selected object. */
export const SELECTION_COLOR = 0xfacc15;
/** Emissive tint applied to the hovered object. */
export const HOVER_COLOR = 0x93c5fd;

function geometryFor(shape: SceneShape, cache: Map<SceneShape, BufferGeometry>): BufferGeometry {
  const existing = cache.get(shape);
  if (existing !== undefined) return existing;
  // Every geometry is unit sized; meshes scale it to the object's size.
  let geometry: BufferGeometry;
  switch (shape) {
    case 'cylinder':
      geometry = new CylinderGeometry(0.5, 0.5, 1, 20);
      break;
    case 'cone':
      geometry = new ConeGeometry(0.5, 1, 20);
      break;
    case 'sphere':
      geometry = new SphereGeometry(0.5, 20, 14);
      break;
    case 'torus':
      geometry = new TorusGeometry(0.5, 0.18, 10, 24);
      break;
    case 'box':
    default:
      geometry = new BoxGeometry(1, 1, 1);
      break;
  }
  cache.set(shape, geometry);
  return geometry;
}

function materialFor(
  colorKey: string,
  emphasis: 'none' | 'selected' | 'hovered',
  cache: Map<string, MeshStandardMaterial>,
): MeshStandardMaterial {
  const key = `${colorKey}:${emphasis}`;
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const base = PALETTE[colorKey] ?? FALLBACK_COLOR;
  const material = new MeshStandardMaterial({
    color: base,
    roughness: 0.55,
    metalness: 0.1,
  });
  if (emphasis === 'selected') {
    material.emissive.setHex(SELECTION_COLOR);
    material.emissiveIntensity = 0.55;
  } else if (emphasis === 'hovered') {
    material.emissive.setHex(HOVER_COLOR);
    material.emissiveIntensity = 0.25;
  }
  cache.set(key, material);
  return material;
}

/** Resources shared by one mounted scene. Disposed when the host unmounts. */
export class SceneResources {
  readonly geometries = new Map<SceneShape, BufferGeometry>();
  readonly materials = new Map<string, MeshStandardMaterial>();
  /** Agent markers get their own geometry: they are sized in world units
   *  directly rather than scaled from a unit shape, so a queue of 30 must not
   *  allocate 30 geometries. */
  agentGeometry: SphereGeometry | null = null;
  readonly agentMaterials = new Map<boolean, MeshStandardMaterial>();
  readonly labelTextures = new Map<string, CanvasTexture>();
  readonly labelMaterials = new Map<string, SpriteMaterial>();

  /** Marker material: waiting agents are neutral, in-service ones are lit so
   *  "who is being served" is readable at a glance. */
  agentMaterial(serving: boolean, radius: number): MeshStandardMaterial {
    const existing = this.agentMaterials.get(serving);
    if (existing !== undefined) return existing;
    const material = new MeshStandardMaterial({
      color: serving ? 0x86efac : 0xfcd34d,
      emissive: serving ? 0x14532d : 0x000000,
      emissiveIntensity: serving ? 0.5 : 0,
      roughness: 0.4,
      metalness: 0.05,
    });
    void radius;
    this.agentMaterials.set(serving, material);
    return material;
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.agentGeometry?.dispose();
    this.agentGeometry = null;
    for (const material of this.agentMaterials.values()) material.dispose();
    this.agentMaterials.clear();
    for (const texture of this.labelTextures.values()) texture.dispose();
    for (const material of this.labelMaterials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.labelTextures.clear();
    this.labelMaterials.clear();
  }
}

function labelMaterial(text: string, resources: SceneResources): SpriteMaterial {
  const existing = resources.labelMaterials.get(text);
  if (existing !== undefined) return existing;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const fontSize = 28;
  // Measure first so the texture is exactly as wide as the text needs, keeping
  // the sprite's aspect ratio honest.
  if (context !== null) {
    context.font = `${fontSize}px sans-serif`;
    const width = Math.ceil(context.measureText(text).width) + 16;
    canvas.width = Math.max(width, 32);
    canvas.height = fontSize + 16;
    const draw = canvas.getContext('2d');
    if (draw !== null) {
      draw.font = `${fontSize}px sans-serif`;
      draw.fillStyle = 'rgba(15, 18, 24, 0.72)';
      draw.fillRect(0, 0, canvas.width, canvas.height);
      draw.fillStyle = '#e5e7eb';
      draw.textBaseline = 'middle';
      draw.fillText(text, 8, canvas.height / 2);
    }
  }
  const texture = new CanvasTexture(canvas);
  resources.labelTextures.set(text, texture);
  const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  resources.labelMaterials.set(text, material);
  return material;
}

interface MeshRecord {
  mesh: Mesh;
  label: Sprite | null;
  colorKey: string;
  shape: SceneShape;
  labelText: string;
}

/** Holds one scene's objects and keeps them in step with the description. */
export class SceneObjectTable {
  readonly group = new Group();
  private readonly records = new Map<string, MeshRecord>();

  constructor(private readonly resources: SceneResources) {}

  /** Adds, updates and removes meshes so the scene matches `description`.
   *  Returns the number of objects touched, which the host uses to decide
   *  whether a redraw is needed. */
  sync(
    description: SceneDescription,
    options: { selectedId: string | null; hoveredId: string | null; showLabels: boolean },
  ): number {
    let touched = 0;
    const seen = new Set<string>();

    for (const object of description.objects) {
      seen.add(object.id);
      touched += this.upsert(object, options);
    }

    for (const [id, record] of this.records) {
      if (seen.has(id)) continue;
      this.group.remove(record.mesh);
      if (record.label !== null) this.group.remove(record.label);
      this.records.delete(id);
      touched += 1;
    }

    return touched;
  }

  private upsert(
    object: SceneObject,
    options: { selectedId: string | null; hoveredId: string | null; showLabels: boolean },
  ): number {
    const emphasis: 'none' | 'selected' | 'hovered' =
      options.selectedId === object.id
        ? 'selected'
        : options.hoveredId === object.id
          ? 'hovered'
          : 'none';
    const material = materialFor(object.colorKey, emphasis, this.resources.materials);
    const labelText = object.label;

    let record = this.records.get(object.id);
    if (record === undefined) {
      const mesh = new Mesh(geometryFor(object.shape, this.resources.geometries), material);
      mesh.name = object.id;
      // The scene id is what picking reports; keeping it on the object avoids a
      // parallel lookup table that could drift.
      mesh.userData.sceneId = object.id;
      this.group.add(mesh);
      const label =
        labelText.length > 0 ? new Sprite(labelMaterial(labelText, this.resources)) : null;
      if (label !== null) {
        label.center.set(0.5, 0);
        label.scale.set(Math.max(labelText.length * 0.42, 2), 1.1, 1);
        this.group.add(label);
      }
      record = { mesh, label, colorKey: object.colorKey, shape: object.shape, labelText };
      this.records.set(object.id, record);
    } else {
      // Only rebuild the geometry when the shape actually changed: this map is
      // keyed by shape, so swapping a box for a cylinder must not silently keep
      // the old geometry.
      if (record.shape !== object.shape) {
        record.mesh.geometry = geometryFor(object.shape, this.resources.geometries);
        record.shape = object.shape;
      }
      record.mesh.material = material;
      record.colorKey = object.colorKey;
      if (record.labelText !== labelText && record.label !== null) {
        record.label.material = labelMaterial(labelText, this.resources);
        record.label.scale.set(Math.max(labelText.length * 0.42, 2), 1.1, 1);
        record.labelText = labelText;
      }
    }

    record.mesh.position.set(object.position.x, object.position.y, object.position.z);
    record.mesh.scale.set(object.size.x, object.size.y, object.size.z);
    // Set every time rather than only when present: a path ribbon that stopped
    // being rotated must return to axis-aligned, and a stale rotation is invisible
    // until it puts geometry somewhere the projection never asked for.
    const rotation = object.rotation;
    record.mesh.rotation.set(rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0);
    if (record.label !== null) {
      const label = record.label;
      // Sit the label on top of the box so it does not intersect the mesh.
      label.position.set(
        object.position.x,
        object.position.y + object.size.y / 2 + 0.1,
        object.position.z,
      );
      label.visible = options.showLabels;
    }
    record.mesh.visible = true;
    return 1;
  }

  /** Current meshes, for picking. */
  pickables(): Object3D[] {
    return [...this.records.values()].map((record) => record.mesh);
  }

  objectCount(): number {
    return this.records.size;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  dispose(): void {
    this.group.clear();
    this.records.clear();
  }
}

/** Marks where agents are during a run.
 *
 * One mesh per agent, created and removed as the population changes. A scene
 * holds tens of agents rather than thousands, so a pool of instanced meshes
 * would cost more in complexity than it saves; the geometry and both materials
 * are still shared across every marker. */
export class AgentLayer {
  readonly group = new Group();
  private readonly meshes = new Map<string, Mesh>();

  constructor(private readonly resources: SceneResources) {}

  /** Positions every agent for the current frame. `entries` is id -> position. */
  sync(
    entries: Array<[string, Vector3Like]>,
    servingIds: ReadonlySet<string>,
    radius: number,
  ): void {
    const seen = new Set<string>();
    for (const [id, position] of entries) {
      seen.add(id);
      const serving = servingIds.has(id);
      let mesh = this.meshes.get(id);
      if (mesh === undefined) {
        if (this.resources.agentGeometry === null) {
          this.resources.agentGeometry = new SphereGeometry(1, 12, 10);
        }
        mesh = new Mesh(
          this.resources.agentGeometry,
          this.resources.agentMaterial(serving, radius),
        );
        mesh.name = `agent:${id}`;
        mesh.scale.setScalar(radius);
        this.group.add(mesh);
        this.meshes.set(id, mesh);
      } else {
        const material = this.resources.agentMaterial(serving, radius);
        if (mesh.material !== material) mesh.material = material;
        mesh.scale.setScalar(radius);
      }
      mesh.position.set(position.x, position.y, position.z);
    }
    for (const [id, mesh] of [...this.meshes]) {
      if (seen.has(id)) continue;
      this.group.remove(mesh);
      this.meshes.delete(id);
    }
  }

  /** Removes every marker, for a new run. */
  clear(): void {
    for (const mesh of this.meshes.values()) this.group.remove(mesh);
    this.meshes.clear();
  }

  count(): number {
    return this.meshes.size;
  }

  /** Current marker positions, for callers that need to observe motion (the
   *  browser verification asserts that agents actually move). */
  sample(): Array<{ id: string; x: number; y: number; z: number }> {
    return [...this.meshes.entries()]
      .map(([id, mesh]) => ({ id, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  dispose(): void {
    this.group.clear();
    this.meshes.clear();
  }
}

/** Structural position type, so this module does not need the package's Vec3
 *  import just for a shape. */
interface Vector3Like {
  x: number;
  y: number;
  z: number;
}
