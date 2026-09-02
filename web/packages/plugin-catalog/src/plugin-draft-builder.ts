import { sign } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { PluginManifest } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
import { computePackageDigest } from './catalog.js';
import { isSafeDraftFilePath, PluginDraftValidationRunner } from '@logicpilot/plugin-host';

export interface DraftPackageSigner {
  readonly keyId: string;
  signDigest(digest: string): string;
}

export interface BuiltDraftPackage {
  readonly packagePath: string;
  readonly manifest: PluginManifest;
  readonly sha256: string;
  readonly signature: string;
  readonly signedBy: string;
}

/** Create a content-addressed .lppkg directory from an approved draft. Only
 * data contributions are materialized here; executable entrypoints remain
 * subject to the existing PackageManager trust gate. */
export class PluginDraftPackageBuilder {
  constructor(private readonly outputRoot: string) {}

  build(draftInput: unknown, signer: DraftPackageSigner): BuiltDraftPackage {
    const checked = validateContract('PluginDraft', draftInput);
    if (!checked.ok)
      throw new Error(`cannot build invalid plugin draft: ${checked.errors.join('; ')}`);
    const draft = checked.value;
    if (draft.status !== 'approved' && draft.status !== 'published') {
      throw new Error(`plugin draft '${draft.id}' must be approved before packaging`);
    }
    if (!signer.keyId.trim()) throw new Error('draft package signer keyId is required');
    const root = resolve(this.outputRoot);
    mkdirSync(root, { recursive: true });
    const temporary = join(root, `.draft-${process.pid}-${Date.now()}`);
    mkdirSync(temporary, { recursive: true });
    const unsignedManifest = { ...draft.manifest };
    delete unsignedManifest.integrity;
    writeFileSync(
      join(temporary, 'plugin.json'),
      `${JSON.stringify(unsignedManifest, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(temporary, 'contributions.json'),
      `${JSON.stringify(draft.contributions, null, 2)}\n`,
      'utf8',
    );
    const fileReport = new PluginDraftValidationRunner().run(draft);
    if (!fileReport.ok || fileReport.checks.files === 'failed') {
      throw new Error(
        `plugin draft data files failed validation: ${fileReport.diagnostics.join('; ')}`,
      );
    }
    for (const [filePath, content] of Object.entries(draft.files ?? {})) {
      const normalized = filePath.replaceAll('\\', '/');
      const target = resolve(temporary, normalized);
      const escaped = relative(temporary, target);
      if (!isSafeDraftFilePath(filePath) || escaped.startsWith('..') || isAbsolute(escaped)) {
        throw new Error(`plugin draft file path is unsafe: ${filePath}`);
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    try {
      const sha256 = computePackageDigest(temporary, unsignedManifest);
      const signature = signer.signDigest(sha256);
      if (!signature) throw new Error('draft package signer returned an empty signature');
      const manifest: PluginManifest = {
        ...unsignedManifest,
        integrity: { sha256, signature, signedBy: signer.keyId },
      };
      const validated = validateContract('PluginManifest', manifest);
      if (!validated.ok)
        throw new Error(`built manifest is invalid: ${validated.errors.join('; ')}`);
      writeFileSync(
        join(temporary, 'plugin.json'),
        `${JSON.stringify(validated.value, null, 2)}\n`,
        'utf8',
      );
      const packagePath = join(root, sha256);
      if (existsSync(packagePath)) {
        throw new Error(`content-addressed package '${sha256}' already exists`);
      }
      renameSync(temporary, packagePath);
      return {
        packagePath,
        manifest: validated.value,
        sha256,
        signature,
        signedBy: signer.keyId,
      };
    } catch (error) {
      if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }
}

/** Ed25519 signer helper. The private key is injected by the caller; no key
 * material is persisted in the package or lockfile. */
export function ed25519DraftSigner(keyId: string, privateKey: unknown): DraftPackageSigner {
  return {
    keyId,
    signDigest: (digest) => sign(null, Buffer.from(digest, 'utf8'), privateKey).toString('base64'),
  };
}
