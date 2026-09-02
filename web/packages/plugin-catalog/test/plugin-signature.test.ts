import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  PluginSignatureKeyring,
  computePluginRegistryDigest,
  signPluginRegistry,
} from '../src/index.js';

describe('PluginSignatureKeyring', () => {
  it('verifies signatures and supports explicit key rotation', () => {
    const first = generateKeyPairSync('ed25519');
    const second = generateKeyPairSync('ed25519');
    const ring = new PluginSignatureKeyring();
    ring.add('key-1', first.publicKey);
    const manifest = {
      integrity: {
        sha256: 'a'.repeat(64),
        signedBy: 'key-1',
        signature: sign(null, Buffer.from('a'.repeat(64), 'utf8'), first.privateKey).toString(
          'base64',
        ),
      },
    } as never;
    expect(ring.verify(manifest, 'a'.repeat(64))).toBe(true);
    expect(ring.verify(manifest, 'b'.repeat(64))).toBe(false);
    expect(ring.remove('key-1')).toBe(true);
    expect(ring.verify(manifest, 'a'.repeat(64))).toBe(false);
    ring.add('key-2', second.publicKey);
    expect(ring.has('key-2')).toBe(true);
  });

  it('signs the canonical registry payload and detects content or key changes', () => {
    const first = generateKeyPairSync('ed25519');
    const second = generateKeyPairSync('ed25519');
    const registry = {
      schema: 'logicpilot.plugin-registry/v1',
      contractVersion: 1,
      generation: 7,
      plugins: ['logicpilot.example'],
      contributions: [],
    } as const;
    const signed = signPluginRegistry(registry, 'registry-key-1', first.privateKey);
    const ring = new PluginSignatureKeyring();
    ring.add('registry-key-1', first.publicKey);
    const digest = computePluginRegistryDigest(signed);
    expect(signed.integrity?.sha256).toBe(digest);
    expect(ring.verifyDigest(signed.integrity, digest)).toBe(true);
    expect(ring.verifyDigest(signed.integrity, 'a'.repeat(64))).toBe(false);
    expect(
      ring.verifyDigest(
        signPluginRegistry({ ...registry, generation: 8 }, 'registry-key-1', first.privateKey)
          .integrity,
        digest,
      ),
    ).toBe(false);
    ring.remove('registry-key-1');
    ring.add('registry-key-1', second.publicKey);
    expect(ring.verifyDigest(signed.integrity, digest)).toBe(false);
  });
});
