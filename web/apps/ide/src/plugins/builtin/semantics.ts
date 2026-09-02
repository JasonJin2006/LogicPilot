// Neutral built-in composition entrypoint. It intentionally has no paradigm
// name in its import path so workbench/AI/state layers depend on a host seam;
// the concrete SysML wiring remains inside the builtin plugin directory.
export * from './sysml/semantics';
