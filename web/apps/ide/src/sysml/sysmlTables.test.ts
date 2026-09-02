// Row builders for the SysML v2 table views (official Part / Requirement /
// Allocation tables): pure projections over the model, pinned here.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectSysML } from './sysmlProjection';
import { allocationRows, partRows, requirementRows } from './sysmlTables';

const SOURCE = `package Plant {
  part def Pump {
    attribute ratedFlow;
  }
  part pump1 : Pump;
  item Water;
  requirement '流量要求';
  requirement '系统要求';
  satisfy requirement '流量要求' by pump1;
  allocate Pump to pump1;
}
`;

describe('sysmlTables row builders', () => {
  const projection = projectSysML(SOURCE);

  it('lists parts and items with their types and owners', () => {
    const rows = partRows(projection);
    const pump1 = rows.find((row) => row.name === 'pump1');
    expect(pump1?.declaration).toBe('usage');
    expect(pump1?.type).toBe('Plant::Pump');
    expect(pump1?.owner).toBe('Plant');
    // Keyword-less `item Water;` IS a usage per SysML semantics.
    expect(rows.some((row) => row.name === 'Water' && row.declaration === 'usage')).toBe(true);
  });

  it('counts traceability relations per requirement', () => {
    const rows = requirementRows(projection);
    const touched = rows.find((row) => row.name === '流量要求');
    expect(touched?.relations).toBe(1);
    expect(rows.find((row) => row.name === '系统要求')?.relations).toBe(0);
    // Doc blocks attach to their owner as stated requirement text.
    const fixture = projectSysML(
      readFileSync(
        fileURLToPath(
          new URL('../../../../../examples/sysml-demo/comprehensive.sysml', import.meta.url),
        ),
        'utf8',
      ),
    );
    const stated = requirementRows(fixture).find((row) => row.name === '数据要求');
    expect(stated?.text).toContain('采样数据必须实时上传');
  });

  it('flattens allocation statements to endpoint rows', () => {
    const rows = allocationRows(projection);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.from).toBe('Plant::Pump');
    expect(rows[0]!.to).toBe('Plant::pump1');
  });
});
