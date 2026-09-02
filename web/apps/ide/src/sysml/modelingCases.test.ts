import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDsl } from '@logicpilot/editor';
import { extractExecutionTargets } from './sysmlExecution';
import { lowerStateMachine } from './sysmlLowering';
import { projectSysML } from './sysmlProjection';

function fixture(relativePath: string): string {
  const path = fileURLToPath(new URL(`../../../../../examples/${relativePath}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

describe('three-level SysML engineering-modeling cases', () => {
  it('level 1 projects structure and requirement traceability without inventing execution', () => {
    const source = fixture('cases/sysml/requirements_trace.sysml');
    const projection = projectSysML(source);
    expect(projection.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
      [],
    );
    expect(projection.relations.filter((relation) => relation.kind === 'satisfies')).toHaveLength(
      2,
    );
    expect(projection.relations.filter((relation) => relation.kind === 'connects')).toHaveLength(1);
    expect(extractExecutionTargets(source, projection)).toEqual([]);
  });

  it('level 2 lowers a timed amphibious-system state definition to executable kernel DSL', () => {
    const source = fixture('sysml-demo/amphibious.sysml');
    const projection = projectSysML(source);
    expect(projection.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
      [],
    );
    const target = projection.elements.find(
      (element) => element.name === 'GroundPlatformWorkState' && element.kind === 'state',
    );
    expect(target).toBeDefined();
    const lowered = lowerStateMachine(source, projection, target!.id);
    expect(lowered.ok).toBe(true);
    expect(lowered.dsl).toContain('timeout = 60.0');
    expect(lowered.dsl).toContain('timeout = 30.0');
    expect(parseDsl(lowered.dsl).ok).toBe(true);
  });

  it('level 3 projects the comprehensive fixture with broad visual coverage', () => {
    const source = fixture('sysml-demo/comprehensive.sysml');
    const projection = projectSysML(source);
    expect(projection.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
      [],
    );
    expect(projection.elements.length).toBeGreaterThan(40);
    expect(new Set(projection.elements.map((element) => element.kind)).size).toBeGreaterThan(15);
    expect(new Set(projection.relations.map((relation) => relation.kind)).size).toBeGreaterThan(6);
  });
});
