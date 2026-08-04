// Presentation scene: the model's visualization is a set of elements
// (source/queue/service/...) at canvas coordinates, each rendered by its
// registered presentation component. The scene is normally derived from the
// model IR / editor document; `mm1Scene` is the temporary built-in demo
// until that pipeline lands.

import type { SceneElement } from './registry';

export interface Scene {
  width: number;
  height: number;
  elements: SceneElement[];
}

// Demo scene for the built-in M/M/1 gateway model (service cell + queue +
// arrivals), laid out left to right like a process flow.
export function mm1Scene(): Scene {
  const y = 120;
  return {
    width: 900,
    height: 300,
    elements: [
      { id: 'arrivals', kind: 'source', name: 'Arrivals', x: 60, y },
      { id: 'waitline', kind: 'queue', name: 'WaitLine', x: 320, y },
      { id: 'handle', kind: 'service', name: 'Handle', x: 580, y },
      { id: 'done', kind: 'sink', name: 'Done', x: 800, y },
    ],
  };
}
