import { beforeEach, describe, expect, it } from 'vitest';
import { SYSML_TOOLS } from './sysmlTools';
import { useSysMLStore } from '../../../state/sysmlStore';
import { useProjectStore } from '../../../state/projectStore';
import { useUiStore } from '../../../state/uiStore';
import { projectSysML } from '../../../plugins/builtin/sysml/semantics';
import { createProject } from '../../../project/project';

const tool = (name: string) => SYSML_TOOLS.find((entry) => entry.name === name)!;

describe('SysML projection AI tools', () => {
  beforeEach(() => {
    useSysMLStore.getState().clear();
    useSysMLStore
      .getState()
      .load('vehicle.sysml', 'part def Vehicle {}\nrequirement def Safe {}\n');
  });

  it('switches projection views through a typed command', () => {
    const command = tool('set_sysml_projection_view');
    expect(command.validate({ mode: 'requirements' })).toBeNull();
    expect(command.validate({ mode: 'bogus' })).toContain('mode');
    command.execute({ mode: 'requirements' }, {} as never);
    expect(useSysMLStore.getState().viewMode).toBe('requirements');
  });

  it('moves an element without mutating external source text', () => {
    const state = useSysMLStore.getState();
    const element = state.projection!.elements[0]!;
    const command = tool('move_sysml_element');
    expect(command.validate({ elementId: element.id, x: 300, y: 200 })).toBeNull();
    command.execute({ elementId: element.id, x: 300, y: 200 }, {} as never);
    expect(useSysMLStore.getState().source).toContain('Vehicle');
    expect(useSysMLStore.getState().layout!.positions[element.id]).toEqual({ x: 300, y: 200 });
  });

  it('focuses an element by qualified name', () => {
    const command = tool('focus_sysml_element');
    expect(command.validate({ query: 'Vehicle' })).toBeNull();
    command.execute({ query: 'Vehicle' }, {} as never);
    expect(useSysMLStore.getState().selectedId).toBe(
      useSysMLStore.getState().projection!.elements[0]!.id,
    );
  });

  // Typed edits write the authoritative source in the owning store; the
  // workspace effect re-projects automatically, so assertions run on the
  // persisted text plus a fresh parse of it.
  describe('typed source edits (project bundle)', () => {
    const PATH = 'model/vehicle.sysml';
    const BASE = 'package Vehicle {\n  part def Engine;\n}\n\nrequirement Power;\n';

    beforeEach(() => {
      const bundle = createProject('Vehicle');
      bundle.files[PATH] = BASE;
      useProjectStore.getState().openBundle(bundle);
      useUiStore.setState({ openFiles: [], activeFile: null, diskFiles: {} });
      useUiStore.getState().openFile(PATH);
      useSysMLStore.getState().clear();
      useSysMLStore.getState().load(PATH, BASE);
    });

    it('add_sysml_element nests into a parent and persists verified source', () => {
      const result = tool('add_sysml_element').execute(
        { kind: 'requirement', name: 'Safety', declaration: 'def', parent: 'Vehicle' },
        {} as never,
      ) as Record<string, unknown>;
      expect(result.ok).toBe(true);
      const written = useProjectStore.getState().bundle!.files[PATH]!;
      expect(written).toContain('requirement def Safety;');
      expect(projectSysML(written).elements.map((element) => element.qualifiedName)).toContain(
        'Vehicle::Safety',
      );
    });

    it('rename_sysml_element edits only the identifier token', () => {
      const result = tool('rename_sysml_element').execute(
        { query: 'Engine', newName: 'Motor' },
        {} as never,
      ) as Record<string, unknown>;
      expect(result.ok).toBe(true);
      const written = useProjectStore.getState().bundle!.files[PATH]!;
      expect(written).toContain('part def Motor');
      expect(written).not.toContain('Engine');
    });

    it('connect_sysml_elements appends traceability that survives reparse', () => {
      expect(
        (
          tool('add_sysml_element').execute(
            { kind: 'part', name: 'car', parent: 'Vehicle' },
            {} as never,
          ) as Record<string, unknown>
        ).ok,
      ).toBe(true);
      const result = tool('connect_sysml_elements').execute(
        { verb: 'satisfy', from: 'car', to: 'Power' },
        {} as never,
      ) as Record<string, unknown>;
      expect(result.ok).toBe(true);
      const next = projectSysML(useProjectStore.getState().bundle!.files[PATH]!);
      expect(next.relations.some((relation) => relation.kind === 'satisfies')).toBe(true);
    });

    it('rejects invalid edits without touching the file', () => {
      const result = tool('add_sysml_element').execute(
        { kind: 'part', name: 'X', parent: 'Missing' },
        {} as never,
      ) as Record<string, unknown>;
      expect(result.ok).toBe(false);
      expect(useProjectStore.getState().bundle!.files[PATH]).toBe(BASE);
    });
  });
});

describe('evidence query tools', () => {
  const MACHINE =
    'state def Light {\n  state red;\n  state green;\n  transition red then green after 30 s;\n}\n';

  beforeEach(() => {
    // Fresh virtual document with a clean evidence journal.
    useUiStore.setState({ openFiles: [], activeFile: null, diskFiles: {} });
    useSysMLStore.getState().clear();
    useSysMLStore.getState().load('light.sysml', MACHINE);
  });

  it('every run lands in the journal and query filters by outcome', () => {
    const run = tool('query_sysml_evidence');
    // Two runs: the machine cycles deterministically, both succeed.
    useSysMLStore
      .getState()
      .runTarget(useSysMLStore.getState().projection!.elements.find((e) => e.kind === 'state')!.id);
    useSysMLStore
      .getState()
      .runTarget(useSysMLStore.getState().projection!.elements.find((e) => e.kind === 'state')!.id);
    const all = run.execute({}, {} as never) as Record<string, unknown>;
    expect(all.total).toBe(2);
    expect(all.matched).toBe(2);

    const okOnly = run.execute({ outcome: 'ok', limit: 1 }, {} as never) as Record<string, unknown>;
    expect(okOnly.matched).toBe(2);
    expect((okOnly.runs as unknown[]).length).toBe(1);

    expect(run.validate({ outcome: 'bogus' })).toContain('outcome');
    expect(run.validate({ limit: 99 })).toContain('limit');
  });

  it('explain_sysml_run returns the full trace of one record', () => {
    const state = useSysMLStore.getState();
    state.runTarget(state.projection!.elements.find((e) => e.kind === 'state')!.id);
    const record = useSysMLStore.getState().evidence[0]!;
    const explain = tool('explain_sysml_run');
    expect(explain.validate({ evidenceId: 'nope' })).toContain('no evidence record');
    const detail = explain.execute({ evidenceId: record.id }, {} as never) as Record<
      string,
      unknown
    >;
    expect(detail.ok).toBe(true);
    expect(detail.runOk).toBe(true);
    expect(detail.target).toBe('Light');
    expect(Array.isArray(detail.steps)).toBe(true);
    expect((detail.steps as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('lower_sysml_state_machine tool', () => {
  beforeEach(() => {
    useUiStore.setState({ openFiles: [], activeFile: null, diskFiles: {} });
    useSysMLStore.getState().clear();
    useSysMLStore
      .getState()
      .load(
        'light.sysml',
        'state def Light {\n  state red;\n  state green;\n  transition red then green after 30 s;\n}\n',
      );
  });

  it('validates the target kind and returns kernel DSL', () => {
    const lower = tool('lower_sysml_state_machine');
    expect(lower.validate({ query: 'missing' })).toContain('no SysML element');
    expect(lower.validate({ query: 'Light' })).toBeNull();
    const result = lower.execute({ query: 'Light' }, {} as never) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.entryState).toBe('red');
    expect(String(result.dsl)).toContain('statechart Light {');
    expect(String(result.dsl)).toContain('triggeredBy = timeout; timeout = 30.0');
  });

  it('surfaces SLxxxx diagnostics for unsupported machines', () => {
    useSysMLStore
      .getState()
      .load(
        'abs.sysml',
        'state def M {\n  state a;\n  transition a then b at 10;\n  state b;\n}\n',
      );
    const result = tool('lower_sysml_state_machine').execute({ query: 'M' }, {} as never) as Record<
      string,
      unknown
    >;
    expect(result.ok).toBe(false);
    const diagnostics = result.diagnostics as Array<{ code: string }>;
    expect(diagnostics[0]!.code).toBe('SL0003');
  });
});
