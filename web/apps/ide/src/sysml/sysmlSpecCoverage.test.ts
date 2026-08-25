// Spec-alignment slice 0.3: pins the widened textual-notation coverage on
// top of the legacy visual subset - full def/usage matrix, declaration
// modifiers, multiplicities, value defaults, specialization/redefinition
// clauses (previously silently dropped), dotted connector endpoints,
// directed features with types, and guarded transitions.

import { describe, expect, it } from 'vitest';

import { projectSysML } from './sysmlProjection';
import { parseSysMLSource } from './sysmlParser';

describe('sysml textual notation 0.3 coverage', () => {
  it('defaults bare declarations of every def/usage family to usage', () => {
    const parsed = parseSysMLSource(`
      package P {
        connection c1;
        allocation a1;
        requirement r1;
        view v1;
        analysis an1;
      }
    `);
    const byName = new Map(parsed.elements.map((e) => [e.name, e]));
    expect(byName.get('c1')?.declaration).toBe('usage');
    expect(byName.get('c1')?.kind).toBe('connection');
    expect(byName.get('a1')?.declaration).toBe('usage');
    expect(byName.get('a1')?.kind).toBe('allocation');
    expect(byName.get('r1')?.declaration).toBe('usage');
    expect(byName.get('v1')?.declaration).toBe('usage');
    expect(byName.get('an1')?.declaration).toBe('usage');
    expect(parsed.diagnostics.filter((d) => d.code === 'SY0001')).toHaveLength(0);
  });

  it('projects requirements-family spellings onto stable visual kinds', () => {
    const parsed = parseSysMLSource(`
      package P {
        concern '热管理';
        rendering '布局图';
        meeting '评审会';
        objective '温度达标';
      }
    `);
    const byName = new Map(parsed.elements.map((e) => [e.name, e]));
    expect(byName.get('热管理')?.kind).toBe('requirement');
    expect(byName.get('布局图')?.kind).toBe('view');
    expect(byName.get('评审会')?.kind).toBe('view');
    expect(byName.get('温度达标')?.kind).toBe('constraint');
    expect(parsed.diagnostics.filter((d) => d.code === 'SY0001')).toHaveLength(0);
  });

  it('records declaration modifiers verbatim', () => {
    const parsed = parseSysMLSource(`
      package P {
        abstract part def '基类';
        variation part '变体组';
        individual snapshot '交付快照';
        ref item '外部引用项';
        readonly attribute mass;
      }
    `);
    const byName = new Map(parsed.elements.map((e) => [e.name, e]));
    expect(byName.get('基类')?.modifiers).toEqual(['abstract']);
    expect(byName.get('变体组')?.modifiers).toEqual(['variation']);
    expect(byName.get('交付快照')?.modifiers).toEqual(['individual']);
    expect(byName.get('外部引用项')?.modifiers).toEqual(['ref']);
    expect(byName.get('mass')?.modifiers).toEqual(['readonly']);
  });

  it('records multiplicity brackets and value-default tails verbatim', () => {
    const parsed = parseSysMLSource(`
      part def Vehicle {
        attribute wheels : Integer[4];
        attribute passengers : Integer[1..*] = 2;
        attribute name : String = "原型机";
      }
    `);
    const byName = new Map(parsed.elements.map((e) => [e.name, e]));
    expect(byName.get('wheels')?.multiplicity).toBe('[4]');
    expect(byName.get('wheels')?.typeRef).toBe('Integer');
    expect(byName.get('passengers')?.multiplicity).toBe('[1..*]');
    expect(byName.get('passengers')?.valueText).toBe('2');
    expect(byName.get('name')?.valueText).toBe('"原型机"');
  });

  it('emits specializes relations for :> clauses (previously dropped silently)', () => {
    const source = `
      part def Base;
      part def Derived :> Base;
      part def Multi :> Base, Derived;
    `;
    const projection = projectSysML(source);
    const idByName = new Map(projection.elements.map((element) => [element.name, element.id]));
    const specializes = projection.relations.filter((r) => r.kind === 'specializes');
    // Derived:>Base plus Multi:>Base and Multi:>Derived.
    expect(specializes.length).toBe(3);
    const multiId = idByName.get('Multi')!;
    const baseId = idByName.get('Base')!;
    const derivedId = idByName.get('Derived')!;
    expect(specializes.some((r) => r.from === multiId && r.to === baseId)).toBe(true);
    expect(specializes.some((r) => r.from === multiId && r.to === derivedId)).toBe(true);
    expect(specializes.some((r) => r.from === derivedId && r.to === baseId)).toBe(true);
    // No SY0002 noise: every reference resolves.
    expect(projection.diagnostics.filter((d) => d.code === 'SY0002')).toHaveLength(0);
  });

  it('emits redefinition clause relations from declaration headers (:>>)', () => {
    const source = `
      part def P {
        attribute mass : Real;
        attribute weight : Real :>> mass;
      }
    `;
    const projection = projectSysML(source);
    const redefinitions = projection.relations.filter((r) => r.kind === 'redefines');
    expect(redefinitions.length).toBe(1);
    const idByName = new Map(projection.elements.map((e) => [e.name, e.id]));
    expect(redefinitions[0]?.to).toBe(idByName.get('mass'));
  });

  it('resolves dotted connector endpoints to their owning elements without SY0002', () => {
    const source = `
      port def Torque;
      part def Machine {
        port shaft : Torque;
        port hub : Torque;
      }
      part engine : Machine;
      part wheel : Machine;
      connection c1 connect engine.shaft to wheel.hub;
    `;
    const projection = projectSysML(source);
    const connects = projection.relations.filter((r) => r.kind === 'connects');
    expect(connects.length).toBe(1);
    const idByName = new Map(projection.elements.map((e) => [e.name, e.id]));
    expect(connects[0]?.from).toBe(idByName.get('engine'));
    expect(connects[0]?.to).toBe(idByName.get('wheel'));
    expect(projection.diagnostics.filter((d) => d.code === 'SY0002')).toHaveLength(0);
  });

  it('records direction and type on directed feature usages inside bodies', () => {
    const parsed = parseSysMLSource(`
      port def Gauge {
        out torque : Real;
        in speed : Real;
      }
    `);
    const ports = parsed.elements.filter((e) => e.kind === 'port');
    const torque = ports.find((p) => p.name === 'torque');
    const speed = ports.find((p) => p.name === 'speed');
    expect(torque?.direction).toBe('out');
    expect(torque?.typeRef).toBe('Real');
    expect(speed?.direction).toBe('in');
  });

  it('captures guarded transitions on a single line (guard recorded, not evaluated)', () => {
    const source = `
      state def M {
        state s1;
        state s2;
        transition s1 then s2 when temp > 100 after 5 s;
      }
    `;
    const projection = projectSysML(source);
    const guarded = projection.relations.find((r) => r.kind === 'transitions' && r.guard);
    expect(guarded?.guard).toBe('temp > 100');
    expect(guarded?.trigger?.amount).toBe(5);
    expect(projection.diagnostics.filter((d) => d.code === 'SY0001')).toHaveLength(0);
  });

  it('captures guards on multi-line transition statements', () => {
    const source = `
      state def M {
        state s1;
        state s2;
        transition s1
          first
          then s2 when pressure >= 10.5;
      }
    `;
    const projection = projectSysML(source);
    const guarded = projection.relations.filter((r) => r.kind === 'transitions' && r.guard);
    expect(guarded.length).toBe(1);
    expect(guarded[0]?.guard).toContain('pressure');
    expect(guarded[0]?.guard).toContain('10.5');
    expect(projection.diagnostics.filter((d) => d.code === 'SY0001')).toHaveLength(0);
  });
});
