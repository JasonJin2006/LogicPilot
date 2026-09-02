import { createHash, sign, verify } from 'node:crypto';
import type {
  PluginManifest,
  PluginRegistry,
  PluginRegistryIntegrity,
} from '@logicpilot/contracts';

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
    return this.verifyDigest(integrity, digest);
  }

  verifyDigest(
    integrity: PluginRegistryIntegrity | PluginManifest['integrity'] | undefined,
    digest: string,
  ): boolean {
    if (!integrity?.signature || !integrity.signedBy || integrity.sha256 !== digest) return false;
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

/** Canonical bytes deliberately omit integrity to prevent self-referential
 * signatures. Key ordering is stable across Node versions and runtimes. */
export function canonicalPluginRegistry(registry: PluginRegistry): string {
  const { integrity: _integrity, ...unsigned } = registry;
  return stableJson(unsigned);
}

export function computePluginRegistryDigest(registry: PluginRegistry): string {
  return createHash('sha256').update(canonicalPluginRegistry(registry)).digest('hex');
}

export function signPluginRegistry(
  registry: PluginRegistry,
  signedBy: string,
  privateKey: unknown,
): PluginRegistry {
  if (signedBy.trim() === '') throw new Error('registry signing key id is required');
  const sha256 = computePluginRegistryDigest(registry);
  const signature = sign(null, Buffer.from(sha256, 'utf8'), privateKey).toString('base64');
  return { ...registry, integrity: { sha256, signature, signedBy } };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
