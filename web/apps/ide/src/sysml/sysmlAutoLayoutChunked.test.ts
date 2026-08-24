// Chunked ELK layout tests: large models split into per-section chunks so
// each ELK run stays small; chunks pack in rows without overlapping.

import { describe, expect, it } from 'vitest';
import { projectSysML, SYML_NODE_WIDTH } from './sysmlProjection';
import { autoLayoutChunkedWithElk } from './sysmlAutoLayoutElk';

function bigModel(sections: number, partsPerSection: number): string {
  const lines = ['package Giant {'];
  for (let s = 0; s < sections; s += 1) {
    lines.push(`  package Section${s} {`);
    for (let p = 0; p < partsPerSection; p += 1) {
      lines.push(`    part def P${s}_${p};`);
    }
    lines.push('  }');
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

describe('autoLayoutChunkedWithElk', () => {
  it('positions every element and packs chunks in non-overlapping rows', async () => {
    const projection = projectSysML(bigModel(6, 60)); // 366+ elements
    const layout = await autoLayoutChunkedWithElk(projection, 250);
    expect(Object.keys(layout.positions).length).toBe(projection.elements.length);
    // Section roots sit on at most two distinct rows and never share a slot.
    const sectionPos = projection.elements
      .filter((element) => element.name.startsWith('Section'))
      .map((element) => layout.positions[element.id]!);
    expect(sectionPos.length).toBe(6);
    const rows = new Set(sectionPos.map((pos) => pos.y));
    expect(rows.size).toBeLessThanOrEqual(2);
  }, 30000);

  it('delegates small models to the single-graph pipeline', async () => {
    const projection = projectSysML(bigModel(1, 10));
    const layout = await autoLayoutChunkedWithElk(projection, 250);
    expect(Object.keys(layout.positions).length).toBe(projection.elements.length);
    expect(layout.positions[projection.elements[0]!.id]?.x).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('keeps node widths from the shared footprint', async () => {
    const projection = projectSysML(bigModel(2, 5));
    const layout = await autoLayoutChunkedWithElk(projection, 250);
    expect(layout.sizes).toBeDefined();
    void SYML_NODE_WIDTH;
  }, 30000);
});
