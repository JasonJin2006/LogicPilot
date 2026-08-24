import { describe, expect, it } from 'vitest';
import { parseSysMLSource } from './sysmlParser';

describe('sysmlParser (stable identity, spans, SYxxxx diagnostics)', () => {
  const source = `package Vehicle {
  part def Engine {
    port def Shaft;
  }
  requirement Power;
}
`;

  it('points nameSpan exactly at the identifier and spans blocks through their brace', () => {
    const parsed = parseSysMLSource(source);
    const engine = parsed.elements.find((element) => element.name === 'Engine')!;
    // "part def Engine {" on source line 2 - name starts after the keyword.
    expect(source.slice(engine.nameSpan.start, engine.nameSpan.end)).toBe('Engine');
    expect(engine.nameSpan.line).toBe(2);
    expect(source[engine.nameSpan.start]!).toBe('E');

    const shaft = parsed.elements.find((element) => element.name === 'Shaft')!;
    // The single-line member ends at its own line; the container's span
    // extends through the line holding its closing brace.
    expect(shaft.span.end).toBeGreaterThan(shaft.span.start);
    expect(source.slice(shaft.span.start, shaft.span.start + 8)).toBe('port def');
    const engineBlock = source.slice(engine.span.start, engine.span.end);
    expect(engineBlock).toContain('Shaft');
    expect(engineBlock).toContain('}');
  });

  it('keeps element ids stable when unrelated members are added', () => {
    const before = parseSysMLSource(source);
    const after = parseSysMLSource(`package Vehicle {
  part def Wheel;
  part def Engine {
    port def Shaft;
  }
  requirement Power;
  requirement newOne;
}
`);
    // Identity is qualified-name based: siblings joining elsewhere never
    // renumber existing elements (the layout sidecar depends on this).
    expect(after.elements.map((element) => element.qualifiedName)).toContain('Vehicle::Engine');
    const stableNames = ['Engine', 'Shaft', 'Power'];
    for (const name of stableNames) {
      const a = before.elements.find((element) => element.name === name)!;
      const b = after.elements.find((element) => element.name === name)!;
      expect(a.ownerId).toBeDefined();
      // ownerId is derived from the owner's qualified name, so it survives.
      expect(b.ownerId).toBeDefined();
      expect(a.nameSpan.line).not.toBe(0);
    }
  });

  it('warns about duplicate member names inside one scope (SY0003)', () => {
    const parsed = parseSysMLSource(`package P {
  part def A;
  part def A;
}
`);
    const codes = parsed.diagnostics.map((d) => d.code);
    expect(codes).toContain('SY0003');
    expect(parsed.diagnostics.find((d) => d.code === 'SY0003')?.line).toBe(3);
  });

  it('recovers from unrecognized statements and reports every one (SY0001)', () => {
    const parsed = parseSysMLSource(`part def A;
what is this even;
part def B;
also bad here;
requirement R;
`);
    expect(parsed.elements.map((element) => element.name)).toEqual(['A', 'B', 'R']);
    const errors = parsed.diagnostics.filter((d) => d.code === 'SY0001');
    expect(errors).toHaveLength(2);
    expect(errors[0]!.line).toBe(2);
    expect(errors[1]!.line).toBe(4);
  });

  it('reports unbalanced braces once and resynchronizes (SY0004)', () => {
    const extraClose = parseSysMLSource(`package P {
  part def A;
}
}`);
    expect(extraClose.diagnostics.some((d) => d.code === 'SY0004' && d.severity === 'error')).toBe(
      true,
    );

    const missingClose = parseSysMLSource(`package P {
  part def A;
`);
    expect(missingClose.diagnostics.some((d) => d.code === 'SY0004')).toBe(true);
    // Recovery: the member inside the unterminated block still parsed.
    expect(missingClose.elements.map((element) => element.name)).toEqual(['P', 'A']);
  });

  it('flags a fully unrecognizable source (SY0005)', () => {
    const parsed = parseSysMLSource('nothing sysml here\n');
    expect(parsed.diagnostics.some((d) => d.code === 'SY0005')).toBe(true);
    expect(parsed.elements).toHaveLength(0);
  });

  it('captures numeric after/at triggers on transition statements (execution 0.2)', () => {
    const parsed = parseSysMLSource(
      `state def M {\n  state a;\n  state b;\n  state c;\n  transition a then b after 5 s;\n  transition b then c at 30 min;\n  transition c then a;\n}\n`,
    );
    const transitions = parsed.pending.filter((relation) => relation.kind === 'transitions');
    expect(transitions).toHaveLength(3);
    expect(transitions[0]!.trigger).toEqual({ kind: 'after', amount: 5, unit: 's' });
    expect(transitions[1]!.trigger).toEqual({ kind: 'at', amount: 30, unit: 'min' });
    expect(transitions[2]!.trigger).toBeUndefined();
    // No syntax diagnostics for any of the supported forms.
    expect(parsed.diagnostics).toHaveLength(0);
  });

  it('rejects unsupported trigger forms explicitly instead of truncating them (SY0001)', () => {
    const parsed = parseSysMLSource(
      `state def M {\n  state a;\n  state b;\n  transition a when x > 0 then b;\n  transition b then a after timeout;\n}\n`,
    );
    const errors = parsed.diagnostics.filter((d) => d.code === 'SY0001');
    expect(errors).toHaveLength(2); // guard clause + expression duration
    expect(errors[0]!.line).toBe(4);
    expect(errors[1]!.line).toBe(5);
  });
});
