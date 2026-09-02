import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PluginDraftPackageBuilder,
  computePackageDigest,
  ed25519DraftSigner,
} from '../src/index.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function approvedDraft() {
  const pluginId = 'logicpilot.derived';
  const manifest = {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id: pluginId,
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: {},
    permissions: [],
    trust: { minLevel: 't0' },
  } as const;
  return {
    schema: 'logicpilot.plugin-draft/v1',
    contractVersion: 1,
    id: 'draft-builder',
    basePluginId: 'logicpilot.base',
    manifest,
    contributions: {
      schema: 'logicpilot.plugin-contributions/v1',
      contractVersion: 1,
      pluginId,
      version: '1.0.0',
      knowledge: [],
      skills: [],
      instructions: [],
      diagnostics: [],
      views: [],
      notations: [],
      createActions: [],
      palettes: [],
      tools: [],
    },
    status: 'approved',
    createdBy: 'agent',
    createdAt: '2026-09-03T00:00:00Z',
    approvedBy: 'user',
    approvedAt: '2026-09-03T00:01:00Z',
    permissionDiff: { added: [], removed: [] },
  } as const;
}

describe('PluginDraftPackageBuilder', () => {
  it('builds a content-addressed, manifest-bound and Ed25519-signed package', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-draft-package-'));
    roots.push(root);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const built = new PluginDraftPackageBuilder(root).build(
      approvedDraft(),
      ed25519DraftSigner('test-key', privateKey),
    );
    expect(built.packagePath).toBe(join(root, built.sha256));
    expect(existsSync(join(built.packagePath, 'contributions.json'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(built.packagePath, 'plugin.json'), 'utf8')) as {
      integrity: { sha256: string; signature: string; signedBy: string };
    };
    expect(manifest.integrity.sha256).toBe(built.sha256);
    expect(manifest.integrity.signedBy).toBe('test-key');
    expect(
      verify(
        null,
        Buffer.from(built.sha256, 'utf8'),
        publicKey,
        Buffer.from(manifest.integrity.signature, 'base64'),
      ),
    ).toBe(true);
    const unsigned = { ...manifest, integrity: undefined };
    delete (unsigned as { integrity?: unknown }).integrity;
    expect(computePackageDigest(built.packagePath, unsigned as never)).toBe(built.sha256);
  });

  it('refuses drafts that have not reached approval', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-draft-package-reject-'));
    roots.push(root);
    expect(() =>
      new PluginDraftPackageBuilder(root).build(
        { ...approvedDraft(), status: 'validated' },
        { keyId: 'test', signDigest: () => 'signature' },
      ),
    ).toThrow(/approved/);
  });

  it('never replaces an existing content-addressed package', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-draft-package-immutable-'));
    roots.push(root);
    const signer = { keyId: 'test', signDigest: () => 'signature' };
    const builder = new PluginDraftPackageBuilder(root);
    const first = builder.build(approvedDraft(), signer);
    expect(() => builder.build(approvedDraft(), signer)).toThrow(/already exists/);
    expect(existsSync(first.packagePath)).toBe(true);
  });
});
