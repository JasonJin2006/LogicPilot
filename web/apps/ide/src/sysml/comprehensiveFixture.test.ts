// The committed comprehensive example must stay inside the visual subset:
// projecting it may produce ZERO diagnostics. Any new construct needs a
// parser rule (or an explicit matrix row) before it lands in this file.

import { describe, expect, it } from 'vitest';
// @ts-expect-error - node builtins are available in the vitest runtime; the
// app tsconfig intentionally stays DOM-only.
import { readFileSync } from 'node:fs';
// @ts-expect-error - see above.
import { fileURLToPath } from 'node:url';
import { projectSysML } from './sysmlProjection';

describe('comprehensive example fixture', () => {
  const path = fileURLToPath(new URL('../../../../../examples/sysml-demo/comprehensive.sysml', import.meta.url));

  it('projects with zero SY0001/SY0002 diagnostics', () => {
    const source = readFileSync(path, 'utf8');
    const projection = projectSysML(source);
    const codes = projection.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).not.toContain('SY0001');
    expect(codes).not.toContain('SY0002');
    // Sanity: the file really exercises the breadth it claims.
    expect(projection.elements.length).toBeGreaterThan(40);
    for (const kind of [
      'package',
      'enum',
      'attribute',
      'part',
      'item',
      'port',
      'interface',
      'requirement',
      'action',
      'calculation',
      'state',
      'constraint',
      'usecase',
      'view',
      'viewpoint',
      'stakeholder',
      'occurrence',
      'interaction',
      'analysis',
      'verification',
    ]) {
      expect(projection.elements.some((element) => element.kind === kind)).toBe(true);
    }
    for (const relation of ['typed_by', 'connects', 'transitions', 'allocates', 'messages', 'replies']) {
      expect(projection.relations.some((r) => r.kind === relation)).toBe(true);
    }
  });
});
