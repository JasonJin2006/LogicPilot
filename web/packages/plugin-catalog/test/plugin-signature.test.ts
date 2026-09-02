import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { PluginSignatureKeyring } from '../src/index.js';

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
});
