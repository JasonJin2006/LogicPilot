import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { PluginDraft } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export class PluginDraftStoreError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'io' | 'not-found',
  ) {
    super(message);
    this.name = 'PluginDraftStoreError';
  }
}

/** Atomic filesystem workspace for AI plugin drafts. Installed packages and
 * lockfiles are intentionally outside this store; publishing remains an
 * explicit, user-approved handoff to PackageManager. */
export class FileSystemPluginDraftStore {
  private readonly rootDir: string;

  constructor(options: { readonly rootDir: string }) {
    this.rootDir = resolve(options.rootDir);
  }

  write(value: unknown): PluginDraft {
    const checked = validateContract('PluginDraft', value);
    if (!checked.ok) {
      throw new PluginDraftStoreError(
        `invalid plugin draft: ${checked.errors.join('; ')}`,
        'invalid',
      );
    }
    mkdirSync(this.rootDir, { recursive: true });
    const path = this.pathFor(checked.value.id);
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(temporary, `${JSON.stringify(checked.value, null, 2)}\n`, 'utf8');
      try {
        renameSync(temporary, path);
      } catch {
        if (existsSync(path)) unlinkSync(path);
        renameSync(temporary, path);
      }
    } catch {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw new PluginDraftStoreError('cannot atomically write plugin draft', 'io');
    }
    return checked.value;
  }

  read(id: string): PluginDraft {
    const path = this.pathFor(id);
    if (!existsSync(path))
      throw new PluginDraftStoreError(`plugin draft '${id}' was not found`, 'not-found');
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new PluginDraftStoreError('plugin draft is not valid JSON', 'invalid');
    }
    const checked = validateContract('PluginDraft', parsed);
    if (!checked.ok) throw new PluginDraftStoreError('stored plugin draft is invalid', 'invalid');
    return checked.value;
  }

  list(): readonly PluginDraft[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort()
      .map((id) => this.read(decodeURIComponent(id)));
  }

  remove(id: string): void {
    const path = this.pathFor(id);
    if (!existsSync(path))
      throw new PluginDraftStoreError(`plugin draft '${id}' was not found`, 'not-found');
    unlinkSync(path);
  }

  private pathFor(id: string): string {
    if (id.trim() === '') throw new PluginDraftStoreError('plugin draft id is required', 'invalid');
    const encoded = encodeURIComponent(id);
    const path = join(this.rootDir, `${encoded}.json`);
    const relative = path.slice(this.rootDir.length);
    if (!relative.startsWith('\\') && !relative.startsWith('/')) {
      throw new PluginDraftStoreError('plugin draft path escapes workspace', 'invalid');
    }
    return path;
  }
}
