// Owner-token filesystem mutex shared by the graph store and the outbox. A
// lock is only released by the process that holds its token, and a stale lock
// is only reclaimed when its recorded owner pid is no longer alive - so a
// slow live owner can never be "stolen" mid-write. Short critical sections
// (one read-modify-write) are serialized with a bounded spin so transient
// contention does not surface as a hard failure; a lock held past the spin
// budget fails closed to the caller instead of corrupting state.

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export interface SharedLockOptions {
  readonly staleMs?: number;
  /** Max wall-clock (ms) to spin for a lock held by a live owner. */
  readonly retryBudgetMs?: number;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function attempt(mutexPath: string, now: () => number): string | null {
  const token = randomBytes(8).toString('hex');
  try {
    writeFileSync(mutexPath, JSON.stringify({ pid: process.pid, createdAt: now(), token }), {
      encoding: 'utf8',
      flag: 'wx',
    });
    return token;
  } catch {
    return null;
  }
}

function readMarker(mutexPath: string): {
  pid?: unknown;
  createdAt?: unknown;
  token?: unknown;
} {
  try {
    return JSON.parse(readFileSync(mutexPath, 'utf8')) as {
      pid?: unknown;
      createdAt?: unknown;
      token?: unknown;
    };
  } catch {
    return {};
  }
}

function isReclaimable(mutexPath: string, staleMs: number, now: number): boolean {
  const marker = readMarker(mutexPath);
  const createdAt = Number(marker.createdAt);
  if (!Number.isFinite(createdAt) || now - createdAt < staleMs) return false;
  const pid = Number(marker.pid);
  // Only reclaim when the owner is provably dead; a live-but-slow owner is
  // never stolen, failing closed to the caller.
  return !Number.isFinite(pid) || !isProcessAlive(pid);
}

function reclaim(
  mutexPath: string,
  staleMs: number,
  expectedToken: string | undefined,
): string | null {
  const now = () => Date.now();
  const quarantine = `${mutexPath}.reclaim-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    // Rename is the ownership claim. Two reclaimers cannot both move the same
    // marker, and no reclaimer unlinks a newly-created live lock.
    renameSync(mutexPath, quarantine);
  } catch {
    return null;
  }
  const marker = readMarker(quarantine);
  const validClaim = expectedToken === undefined || marker.token === expectedToken;
  if (!validClaim || !isReclaimable(quarantine, staleMs, now())) {
    if (!existsSync(mutexPath)) renameSync(quarantine, mutexPath);
    else unlinkSync(quarantine);
    return null;
  }
  const token = attempt(mutexPath, now);
  unlinkSync(quarantine);
  return token;
}

/** Try to acquire the lock, returning its owner token or null. */
export function acquireSharedLock(
  mutexPath: string,
  options: SharedLockOptions = {},
): string | null {
  const staleMs = options.staleMs ?? 30 * 60 * 1000;
  const retryBudgetMs = options.retryBudgetMs ?? 45;
  const deadline = Date.now() + retryBudgetMs;
  for (;;) {
    const token = attempt(mutexPath, () => Date.now());
    if (token !== null) return token;
    if (!existsSync(mutexPath)) return null;
    if (isReclaimable(mutexPath, staleMs, Date.now())) {
      const reclaimed = reclaim(
        mutexPath,
        staleMs,
        readMarker(mutexPath).token as string | undefined,
      );
      if (reclaimed !== null) return reclaimed;
    }
    if (Date.now() >= deadline) return null;
    sleepSync(3);
  }
}

/** Release the lock only if we still own it; a stolen/replaced lock is left
 * untouched. Returns true when this caller actually released it. */
export function releaseSharedLock(mutexPath: string, token: string): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  const marker = readMarker(mutexPath);
  if (marker.token !== token) return false;
  try {
    unlinkSync(mutexPath);
    return true;
  } catch {
    return false;
  }
}

const sleepBuf = new SharedArrayBuffer(4);
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(sleepBuf), 0, 0, ms);
}
