// S4 render-pipeline benchmark (canvas-platform plan §S4): the pure model
// pipeline at 500+ elements - parse/project, the synchronous tidy-tree
// layout and the ELK graph construction. DOM rendering is browser-only;
// these are the stages a Canvas2D backend decision would be based on.
// Budgets are generous gates, not aspirations: a regression that doubles
// any stage fails the suite.

import { describe, expect, it } from 'vitest';
import { projectSysML } from './sysmlProjection';
import { autoLayoutSysML } from './sysmlProjection';
import { buildElkGraph } from './sysmlAutoLayoutElk';

function syntheticSource(count: number): string {
  const lines: string[] = ["package Bench {"];
  for (let i = 0; i < count; i += 1) {
    lines.push(`  part def Part${i} {`);
    lines.push(`    attribute mass${i} = ${i};`);
    if (i > 0) lines.push(`    :> Part${i - 1};`);
    lines.push(`  }`);
  }
  lines.push("}");
  return lines.join('\n') + '\n';
}

describe('S4 render-pipeline benchmark (500 elements)', () => {
  const source = syntheticSource(500);

  it('projects 500 elements well under budget', () => {
    const started = performance.now();
    const projection = projectSysML(source);
    const elapsed = performance.now() - started;
    expect(projection.elements.length).toBeGreaterThan(1000); // parts + attributes
    expect(elapsed).toBeLessThan(400);
    // eslint-disable-next-line no-console -- benchmark output is the point
    console.log(`[s4] project 500 parts: ${elapsed.toFixed(1)} ms`);
  });

  it('sync layout of 1000+ elements well under budget', () => {
    const projection = projectSysML(source);
    const started = performance.now();
    const layout = autoLayoutSysML(projection);
    const elapsed = performance.now() - started;
    expect(Object.keys(layout.positions).length).toBe(projection.elements.length);
    expect(elapsed).toBeLessThan(400);
    // eslint-disable-next-line no-console -- benchmark output is the point
    console.log(`[s4] sync layout ${projection.elements.length} elements: ${elapsed.toFixed(1)} ms`);
  });

  it('ELK graph construction stays linear', () => {
    const projection = projectSysML(source);
    const started = performance.now();
    const graph = buildElkGraph(projection);
    const elapsed = performance.now() - started;
    expect(graph.children?.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
    // eslint-disable-next-line no-console -- benchmark output is the point
    console.log(`[s4] elk graph build: ${elapsed.toFixed(1)} ms`);
  });
});
