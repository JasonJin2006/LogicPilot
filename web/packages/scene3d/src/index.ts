// @logicpilot/scene3d — public entry point.
//
// The renderer-free half of the IDE's 3D scene view. Everything here is pure
// and engine-agnostic: it runs in Node, so the camera math, the document
// projection and the 3D layout are covered by unit tests without a WebGL
// context. The Three.js layer lives in the IDE app and is a thin translation of
// these values.

export * from './math3d.js';
export * from './camera3d.js';
export * from './layout3d.js';
export * from './sceneModel.js';
export * from './spatialGraph.js';
export * from './spatialScene.js';
export * from './motion.js';
