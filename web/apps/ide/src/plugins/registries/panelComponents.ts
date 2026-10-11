// Composition-root imports for built-in panel implementations. The workbench
// panel table consumes these opaque components and does not know their model
// module paths; external plugins may replace/register panels independently.
export { DslEditor } from '../../model/DslEditor';
export { ModelWorkspace } from '../../model/ModelWorkspace';
export { PropertiesPanel } from '../../model/PropertiesPanel';
export { Scene3DPanel } from '../../scene3d/Scene3DPanel';
