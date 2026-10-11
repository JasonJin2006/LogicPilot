// Cross-process atomic file replace. The store and outbox both serialize one
// complete JSON state file; a naive "unlink target then rename" leaves a crash
// window where the file simply does not exist and the caller reads an empty
// state. This module guarantees that at any instant on disk there is either
// the old complete file or the new complete file.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

let sequence = 0;

/** Replace `targetPath` with `data`, atomically where the platform allows.
 * On a failed direct rename (Windows sharing violations, antivirus locks) the
 * target is first moved to a `.bak` sibling, the temp file is then promoted
 * and, if that second step fails, the backup is restored. The target file is
 * never deleted before a complete replacement exists. */
export function atomicWriteFileSync(targetPath: string, data: string): void {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const temporary = `${targetPath}.tmp-${process.pid}-${++sequence}-${randomBytes(6).toString('hex')}`;
  try {
    const fd = openSync(temporary, 'wx');
    try {
      writeFileSync(fd, data, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    let moved = false;
    try {
      renameSync(temporary, targetPath);
      moved = true;
    } catch {
      // Fallback: keep a recoverable backup of the live target instead of
      // deleting it, so a crash between the two renames can be restored.
      const backup = `${targetPath}.bak`;
      if (existsSync(backup)) unlinkSync(backup);
      if (existsSync(targetPath)) renameSync(targetPath, backup);
      try {
        renameSync(temporary, targetPath);
      } catch (error) {
        if (existsSync(backup)) renameSync(backup, targetPath);
        throw error;
      }
      if (existsSync(backup)) unlinkSync(backup);
      moved = true;
    }
    if (!moved) throw new Error('atomic replace did not complete');
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    syncDirectory(dir);
  }
}

/** Restore a `.bak` sibling if the target is missing (a crash landed between
 * the two renames of the fallback path), and prune leftover temp files that
 * are old enough that no live writer can still need them. */
export function recoverAtomicFile(targetPath: string, staleMs = 60 * 60 * 1000): void {
  // A live store/outbox writer owns the sibling mutex. Never inspect or move
  // its backup/temp files from a concurrent read.
  if (activeMutex(`${targetPath}.mutex`)) return;
  const backup = `${targetPath}.bak`;
  if (!existsSync(targetPath) && existsSync(backup)) {
    renameSync(backup, targetPath);
  }
  const dir = dirname(targetPath);
  const prefix = `${basename(targetPath)}.tmp-`;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      const candidate = join(dir, name);
      try {
        if (Date.now() - statSync(candidate).mtimeMs >= staleMs) unlinkSync(candidate);
      } catch {
        // A concurrent writer may have removed it; ignore.
      }
    }
  } catch {
    // Directory listing is best-effort.
  }
}

function activeMutex(mutexPath: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(mutexPath, 'utf8')) as { pid?: unknown };
    const pid = Number(marker.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function syncDirectory(dir: string): void {
  if (process.platform === 'win32') return; // Cannot open a directory on Windows.
  let fd: number | undefined;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // Directory fsync is best-effort and unsupported on some platforms.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
