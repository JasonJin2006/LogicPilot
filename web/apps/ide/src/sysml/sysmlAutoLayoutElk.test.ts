import { describe, expect, it } from 'vitest';
import { buildElkGraph } from './sysmlAutoLayoutElk';
import { projectSysML } from './sysmlProjection';

describe('buildElkGraph', () => {
  it('nests containment as ELK children and drops contains edges', () => {
    const projection = projectSysML(
      'package Vehicle {\n  part def Engine;\n}\n\nrequirement Power;\nsatisfy requirement Power by Vehicle::Engine;\n',
    );
    const graph = buildElkGraph(projection);
    // Root holds the package and the top-level requirement.
    expect(graph.children!.map((node) => node.id)).toEqual([
      ...projection.elements.filter((e) => e.ownerId === undefined).map((e) => e.id),
    ]);
    const vehicle = graph.children![0]!;
    expect(vehicle.children!.map((node) => node.id).length).toBe(1);
    // `contains` became hierarchy; only satisfies remains an edge.
    const edges = graph.edges as Array<{ sources: string[]; targets: string[] }>;
    expect(edges).toHaveLength(1);
    const satisfies = projection.relations.find((relation) => relation.kind === 'satisfies')!;
    expect(edges[0]!.sources).toEqual([satisfies.from]);
  });

  it('is deterministic: same input builds byte-identical graphs', () => {
    const source = 'package P {\n  part def A;\n  part def B;\n}\nrequirement R;\n';
    expect(JSON.stringify(buildElkGraph(projectSysML(source)))).toBe(
      JSON.stringify(buildElkGraph(projectSysML(source))),
    );
  });
});
