// AI tools for the external SysML projection. These tools edit only the
// visualization sidecar; the professional SysML source remains authoritative.

import type { AssistantTool } from '../../toolTypes';
import { useSysMLStore, type SysMLViewMode } from '../../../state/sysmlStore';

function numberArg(args: Record<string, unknown>, key: string): number | null {
  return typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : null;
}

export const SYSML_TOOLS: readonly AssistantTool[] = [
  {
    name: 'inspect_sysml_projection',
    executionMode: 'parallel',
    description: 'Inspect the currently open external SysML visual projection and its warnings.',
    parameters: {},
    validate: () => null,
    execute: () => {
      const state = useSysMLStore.getState();
      if (!state.projection || !state.layout) return { ok: false, error: 'no SysML projection is open' };
      const layout = state.layout;
      return {
        ok: true,
        path: state.path,
        sourceHash: state.projection.sourceHash,
        viewMode: state.viewMode,
        elements: state.projection.elements.map((element) => ({
          id: element.id,
          kind: element.kind,
          name: element.name,
          qualifiedName: element.qualifiedName,
          ownerId: element.ownerId ?? null,
          line: element.span.line,
          position: layout.positions[element.id] ?? null,
        })),
        relations: state.projection.relations,
        diagnostics: state.projection.diagnostics,
      };
    },
  },
  {
    name: 'auto_layout_sysml_projection',
    description: 'Automatically arrange the currently open SysML structure/relationship diagram.',
    parameters: {},
    validate: () => null,
    execute: () => {
      const state = useSysMLStore.getState();
      if (!state.projection) return { ok: false, error: 'no SysML projection is open' };
      state.autoLayout();
      return { ok: true, message: 'SysML projection layout updated', elementCount: state.projection.elements.length };
    },
  },
  {
    name: 'set_sysml_projection_view',
    description: 'Focus the SysML projection on all, structure, requirements, behavior, or traceability elements.',
    parameters: { mode: { type: 'string', required: true, enum: ['all', 'structure', 'requirements', 'behavior', 'traceability'] } },
    validate: (args) => {
      const mode = args.mode;
      return mode === 'all' || mode === 'structure' || mode === 'requirements' || mode === 'behavior' || mode === 'traceability'
        ? null
        : "mode must be one of 'all', 'structure', 'requirements', 'behavior', 'traceability'";
    },
    execute: (args) => {
      const mode = args.mode as SysMLViewMode;
      const state = useSysMLStore.getState();
      if (!state.projection) return { ok: false, error: 'no SysML projection is open' };
      state.setViewMode(mode);
      return { ok: true, viewMode: mode };
    },
  },
  {
    name: 'focus_sysml_element',
    description: 'Select a SysML element by stable ID, name, or qualified name and reveal it in the projection.',
    parameters: { query: { type: 'string', required: true } },
    validate: (args) => {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      const projection = useSysMLStore.getState().projection;
      if (!projection) return 'no SysML projection is open';
      if (!query) return 'query must be a non-empty string';
      const normalized = query.toLowerCase();
      const found = projection.elements.find(
        (element) =>
          element.id.toLowerCase() === normalized ||
          element.name.toLowerCase() === normalized ||
          element.qualifiedName.toLowerCase() === normalized,
      );
      return found ? null : `no SysML element matches '${query}'`;
    },
    execute: (args) => {
      const query = (args.query as string).trim().toLowerCase();
      const projection = useSysMLStore.getState().projection;
      if (!projection) return { ok: false, error: 'no SysML projection is open' };
      const found = projection.elements.find(
        (element) =>
          element.id.toLowerCase() === query ||
          element.name.toLowerCase() === query ||
          element.qualifiedName.toLowerCase() === query,
      );
      if (!found) return { ok: false, error: `no SysML element matches '${args.query as string}'` };
      useSysMLStore.getState().select(found.id);
      return { ok: true, element: found };
    },
  },
  {
    name: 'move_sysml_element',
    description: 'Move one SysML visual element in the current projection without changing source.',
    parameters: {
      elementId: { type: 'string', required: true },
      x: { type: 'number', required: true },
      y: { type: 'number', required: true },
    },
    validate: (args) => {
      const id = typeof args.elementId === 'string' ? args.elementId : null;
      const x = numberArg(args, 'x');
      const y = numberArg(args, 'y');
      const state = useSysMLStore.getState();
      if (!state.projection) return 'no SysML projection is open';
      if (!id || !state.projection.elements.some((element) => element.id === id)) return 'elementId is not a visible SysML element';
      if (x === null || y === null || x < 0 || y < 0) return 'x and y must be non-negative finite numbers';
      return null;
    },
    execute: (args) => {
      const id = args.elementId as string;
      const x = numberArg(args, 'x')!;
      const y = numberArg(args, 'y')!;
      useSysMLStore.getState().checkpoint();
      useSysMLStore.getState().move(id, { x, y });
      return { ok: true, elementId: id, position: { x, y } };
    },
  },
];
