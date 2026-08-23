import { beforeEach, describe, expect, it } from 'vitest';
import { SYSML_TOOLS } from './sysmlTools';
import { useSysMLStore } from '../../../state/sysmlStore';

const tool = (name: string) => SYSML_TOOLS.find((entry) => entry.name === name)!;

describe('SysML projection AI tools', () => {
  beforeEach(() => {
    useSysMLStore.getState().clear();
    useSysMLStore.getState().load('vehicle.sysml', 'part def Vehicle {}\nrequirement def Safe {}\n');
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
});
