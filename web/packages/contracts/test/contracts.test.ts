// Phase 1 contract gates (docs/architecture/next-generation-plugin-platform.md §16):
// round-trip, unknown field rejection, version checks, dependency cycles.
// Schema compatibility against the frozen baseline runs via
// scripts/check-contract-conform.mjs.
import { describe, expect, it } from 'vitest';
import { validateContract, parseContract, isSupportedPluginApiVersion } from '../src';
import { resolveActivationOrder, satisfiesRange, toResolutionInput } from '../src/deps';
import type { PluginManifest } from '../src/generated/contracts';

const validManifest = {
  schema: 'logicpilot.plugin-manifest/v2',
  contractVersion: 1,
  id: 'logicpilot.process',
  version: '1.0.0',
  apiVersion: 1,
  provides: ['paradigm.process'],
  requires: [{ id: 'logicpilot.graph2d' }],
  entrypoints: { data: 'plugins/process/' },
  permissions: ['knowledge.draft.write'],
  trust: { minLevel: 't0' },
};

const validLockfile = {
  schema: 'logicpilot.plugin-lock/v1',
  contractVersion: 1,
  plugins: [
    {
      id: 'logicpilot.process',
      version: '1.0.0',
      apiVersion: 1,
      sha256: 'a'.repeat(64),
      source: 'builtin',
      trust: 't0',
      permissions: [{ permissionId: 'knowledge.draft.write', granted: true }],
      dependencies: [],
    },
  ],
};

describe('round-trip gate', () => {
  it('validates a well-formed plugin manifest', () => {
    const result = validateContract('PluginManifest', validManifest);
    expect(result.ok).toBe(true);
  });

  it('JSON text round-trips through parse without loss', () => {
    const text = JSON.stringify(validManifest);
    const parsed = parseContract('PluginManifest', text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(JSON.parse(JSON.stringify(parsed.value))).toEqual(validManifest);
    }
  });

  it('validates a plugin lockfile with nested entries', () => {
    const result = validateContract('PluginLockfile', validLockfile);
    expect(result.ok).toBe(true);
  });

  it('validates diagnostic definitions and instances against artifact refs', () => {
    const definition = {
      schema: 'logicpilot.diagnostic-definition/v1',
      contractVersion: 1,
      id: 'SY0001',
      pluginId: 'logicpilot.sysml',
      titleKey: 'diagnostics.sy0001.title',
      defaultSeverity: 'error',
      fixIds: ['SY0001.reparse'],
      conformanceCases: ['sysml/diagnostics/sy0001'],
    };
    const instance = {
      schema: 'logicpilot.diagnostic-instance/v1',
      contractVersion: 1,
      definitionId: 'SY0001',
      artifactRef: { artifactId: 'doc-1', revisionId: 'rev-7' },
      sourceSpan: { startLine: 3, endLine: 3 },
      availableFixIds: ['SY0001.reparse'],
    };
    expect(validateContract('DiagnosticDefinition', definition).ok).toBe(true);
    expect(validateContract('DiagnosticInstance', instance).ok).toBe(true);
  });

  it('validates agent step envelopes with tool descriptors', () => {
    const request = {
      schema: 'logicpilot.agent-step-request/v1',
      contractVersion: 1,
      turnId: 'turn-1',
      engineId: 'builtin',
      stepIndex: 0,
      input: { role: 'user', text: 'add a source block' },
      tools: [
        {
          name: 'add_block',
          parameters: { type: 'object', properties: { kind: { type: 'string' } } },
        },
      ],
    };
    expect(validateContract('AgentStepRequest', request).ok).toBe(true);
  });
});

describe('unknown field rejection gate', () => {
  it('rejects manifests with unknown top-level fields', () => {
    const bad = { ...validManifest, unknownFutureField: true };
    const result = validateContract('PluginManifest', bad);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.join('\n')).toMatch(
        /unknownFutureField|must NOT have additional properties/i,
      );
  });

  it('rejects nested objects with unknown fields', () => {
    const bad = {
      ...validManifest,
      trust: { minLevel: 't0', customTier: 'gold' },
    };
    expect(validateContract('PluginManifest', bad).ok).toBe(false);
  });

  it('rejects unknown enum values', () => {
    const bad = { ...validManifest, permissions: ['knowledge.absolute.write'] };
    expect(validateContract('PluginManifest', bad).ok).toBe(false);
  });

  it('rejects malformed ids', () => {
    const bad = { ...validManifest, id: 'LogicPilot Process' };
    expect(validateContract('PluginManifest', bad).ok).toBe(false);
  });
});

describe('version check gate', () => {
  it('rejects future contractVersion values', () => {
    const bad = { ...validManifest, contractVersion: 2 };
    expect(validateContract('PluginManifest', bad).ok).toBe(false);
  });

  it('rejects mismatched schema identifiers', () => {
    const bad = { ...validManifest, schema: 'logicpilot.plugin-manifest/v3' };
    expect(validateContract('PluginManifest', bad).ok).toBe(false);
  });

  it('rejects unsupported plugin apiVersion values', () => {
    expect(isSupportedPluginApiVersion(1)).toBe(true);
    expect(isSupportedPluginApiVersion(99)).toBe(false);
  });
});

describe('dependency cycle gate', () => {
  const manifest = (overrides: Partial<PluginManifest>): PluginManifest =>
    ({
      ...validManifest,
      id: 'logicpilot.tmp',
      requires: [],
      ...overrides,
    }) as PluginManifest;

  it('orders dependencies before dependents deterministically', () => {
    const result = resolveActivationOrder([
      toResolutionInput(
        manifest({ id: 'logicpilot.sysml', requires: [{ id: 'logicpilot.graph2d' }] }),
      ),
      toResolutionInput(manifest({ id: 'logicpilot.graph2d' })),
      toResolutionInput(
        manifest({ id: 'logicpilot.process', requires: [{ id: 'logicpilot.graph2d' }] }),
      ),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order).toEqual([
        'logicpilot.graph2d',
        'logicpilot.process',
        'logicpilot.sysml',
      ]);
    }
  });

  it('detects dependency cycles', () => {
    const result = resolveActivationOrder([
      toResolutionInput(manifest({ id: 'logicpilot.a', requires: [{ id: 'logicpilot.b' }] })),
      toResolutionInput(manifest({ id: 'logicpilot.b', requires: [{ id: 'logicpilot.a' }] })),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cycles.length).toBeGreaterThan(0);
  });

  it('reports missing required dependencies but skips optional ones', () => {
    const result = resolveActivationOrder([
      toResolutionInput(
        manifest({
          id: 'logicpilot.c',
          requires: [{ id: 'logicpilot.ghost' }, { id: 'logicpilot.also-ghost', optional: true }],
        }),
      ),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(['logicpilot.c -> logicpilot.ghost']);
  });
});

describe('version ranges', () => {
  it('supports caret, tilde, gte and exact ranges', () => {
    expect(satisfiesRange('1.2.3', '^1.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfiesRange('1.3.9', '~1.3.0')).toBe(true);
    expect(satisfiesRange('1.4.0', '~1.3.0')).toBe(false);
    expect(satisfiesRange('1.5.0', '>=1.2.0')).toBe(true);
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '*')).toBe(true);
  });
});
