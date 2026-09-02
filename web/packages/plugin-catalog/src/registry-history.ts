import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { PluginRegistry } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface RegistryHistoryEntry {
  readonly generation: number;
  readonly payload: PluginRegistry;
}

/** Crash-safe, bounded registry snapshot history used by SSE replay. */
export class FileSystemRegistryHistory {
  private readonly rootDir: string;
  private readonly path: string;
  private readonly maxEntries: number;

  constructor(options: {
    readonly rootDir: string;
    readonly fileName?: string;
    readonly maxEntries?: number;
  }) {
    this.rootDir = resolve(options.rootDir);
    this.path = join(this.rootDir, options.fileName ?? 'registry-history.json');
    this.maxEntries = options.maxEntries ?? 32;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1)
      throw new Error('registry history maxEntries must be a positive integer');
  }

  read(): readonly RegistryHistoryEntry[] {
    if (!existsSync(this.path)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      throw new Error('registry history is not valid JSON');
    }
    if (!Array.isArray(parsed)) throw new Error('registry history must be an array');
    const entries: RegistryHistoryEntry[] = [];
    for (const raw of parsed) {
      if (typeof raw !== 'object' || raw === null)
        throw new Error('registry history entry is invalid');
      const record = raw as { generation?: unknown; payload?: unknown };
      if (!Number.isSafeInteger(record.generation))
        throw new Error('registry history generation is invalid');
      const checked = validateContract('PluginRegistry', record.payload);
      if (!checked.ok)
        throw new Error(`registry history payload is invalid: ${checked.errors.join('; ')}`);
      entries.push({ generation: record.generation as number, payload: checked.value });
    }
    return entries.slice(-this.maxEntries);
  }

  append(payload: PluginRegistry): void {
    const checked = validateContract('PluginRegistry', payload);
    if (!checked.ok) throw new Error(`registry payload is invalid: ${checked.errors.join('; ')}`);
    const current = [...this.read()];
    if (current.some((entry) => entry.generation === checked.value.generation)) return;
    current.push({ generation: checked.value.generation, payload: checked.value });
    this.write(current.slice(-this.maxEntries));
  }

  readSince(generation: number): readonly RegistryHistoryEntry[] {
    return this.read().filter((entry) => entry.generation > generation);
  }

  private write(entries: readonly RegistryHistoryEntry[]): void {
    mkdirSync(this.rootDir, { recursive: true });
    const temporary = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
      try {
        renameSync(temporary, this.path);
      } catch {
        if (existsSync(this.path)) unlinkSync(this.path);
        renameSync(temporary, this.path);
      }
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
  }
}
