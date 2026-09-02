import { verify } from 'node:crypto';
import type { PluginManifest } from '@logicpilot/contracts';

/** Public-key keyring for manifest signatures. Private keys never enter this
 * class; replacing a key requires an explicit keyring update and old keys can
 * be retired without changing package digests. */
export class PluginSignatureKeyring {
  private readonly keys = new Map<string, unknown>();

  add(keyId: string, publicKey: unknown): void {
    if (keyId.trim() === '') throw new Error('signature key id is required');
    this.keys.set(keyId, publicKey);
  }

  remove(keyId: string): boolean {
    return this.keys.delete(keyId);
  }

  has(keyId: string): boolean {
    return this.keys.has(keyId);
  }

  verify(manifest: PluginManifest, digest: string): boolean {
    const integrity = manifest.integrity;
    if (!integrity?.signature || !integrity.signedBy) return false;
    const key = this.keys.get(integrity.signedBy);
    if (!key) return false;
    try {
      return verify(
        null,
        Buffer.from(digest, 'utf8'),
        key,
        Buffer.from(integrity.signature, 'base64'),
      );
    } catch {
      return false;
    }
  }
}
