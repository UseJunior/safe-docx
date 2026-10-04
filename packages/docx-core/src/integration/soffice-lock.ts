/**
 * Cross-process LibreOffice launch lock.
 *
 * Every helper in this package that launches `soffice` (the accept/reject oracle, its
 * launchability probe, and the generation probes) memoizes or batches within ONE process, but
 * nothing coordinated ACROSS processes: parallel Vitest workers, sibling sessions, and a human
 * running the oracle at the same time each spawned their own headless LibreOffice. On macOS
 * concurrent headless launches are the amplification vector behind issue #627 (one environment
 * incompatibility became several simultaneous SIGABRT crash reports), so launches of the same
 * LibreOffice binary serialize on a lockfile in the OS temp dir (issue #1037).
 *
 * Protocol: exclusive-create (`wx`) a JSON lockfile. The holder records its PID, host, and a
 * random token. Waiters poll with jitter and steal the lock only when the recorded holder is
 * provably gone (same host, `process.kill(pid, 0)` reports ESRCH) or the file is older than
 * `staleMs` (a SIGKILLed holder cannot clean up; a recycled PID cannot pin the lock forever).
 * A steal renames the file aside first and checks that the renamed file is the one judged stale,
 * so two waiters racing a steal cannot delete a lock a third process just created. Release
 * removes the file only while it still carries the holder's token.
 *
 * Re-entrancy: the lock is held per async context. A launch nested inside a launch that already
 * holds the lock for the same binary (for example, a probe started from an oracle's
 * `captureOutput` callback) runs inside the held lock instead of waiting on itself.
 *
 * The lock is keyed by the binary's resolved real path, so every caller of the same LibreOffice
 * installation shares one lock, while a stub converter used by unit tests gets its own and never
 * queues behind a real oracle run in another worker.
 *
 * Deliberately NOT part of the package's public API: it is internal coordination for this
 * package's soffice launchers, which callers reach through `runLibreOfficeOracle` /
 * `probeSofficeUsable` and get the lock for free.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1037
 * @see https://github.com/UseJunior/safe-docx/issues/627
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A holder older than this is presumed dead even if its PID looks alive (PID reuse). Oracle
 *  launches are bounded far below this: the probe times out at 30s, an oracle batch at
 *  20s + 2 × 45s, a generation probe at 45s. */
export const DEFAULT_STALE_LOCK_MS = 10 * 60_000;
/** Default wait for a contended lock before giving up with a diagnostic. */
export const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60_000;
/** A lockfile that exists but cannot be parsed (a holder between create and write, or a torn
 *  write) is only stolen after this grace period. */
const UNREADABLE_LOCK_GRACE_MS = 10_000;

type LockRecord = { pid: number; host: string; token: string; at: string };

export type SofficeLockOptions = {
  /** Lockfile path; defaults to the per-binary path in the OS temp dir. */
  lockPath?: string;
  timeoutMs?: number;
  pollMs?: number;
  staleMs?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve symlinks so `/opt/homebrew/bin/soffice` and the app-bundle binary share a lock. */
function canonicalBinary(soffice: string): string {
  try {
    return realpathSync(soffice);
  } catch {
    return path.resolve(soffice);
  }
}

/** Machine-wide (per OS user temp dir) lockfile path for one LibreOffice binary. */
export function sofficeLockPath(soffice: string): string {
  const digest = createHash('sha256').update(canonicalBinary(soffice)).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `safe-docx-soffice-${digest}.lock`);
}

function readRecord(file: string): LockRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockRecord>;
    if (typeof parsed.pid !== 'number' || typeof parsed.token !== 'string') return null;
    return { pid: parsed.pid, host: String(parsed.host ?? ''), token: parsed.token, at: String(parsed.at ?? '') };
  } catch {
    return null;
  }
}

/** True unless the holder is provably gone. EPERM means the PID exists but belongs to another
 *  user (shared /tmp on Linux), so it counts as alive. A holder on another host cannot be
 *  checked and is left to the age-based stale rule. */
function holderAlive(record: LockRecord): boolean {
  if (record.host && record.host !== os.hostname()) return true;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Age of the lockfile in ms, or null if it vanished. */
function lockAgeMs(lockPath: string): number | null {
  try {
    return Date.now() - statSync(lockPath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Remove a stale lock without clobbering a fresh one: rename it aside (atomic), then confirm the
 * renamed file is the one judged stale. If a racer already replaced it, put the fresh lock back
 * (`link` fails rather than overwrite if yet another lock appeared meanwhile).
 */
function stealStaleLock(lockPath: string, judged: LockRecord | null): boolean {
  const aside = `${lockPath}.stale-${randomUUID()}`;
  try {
    renameSync(lockPath, aside);
  } catch (err) {
    // ENOENT: it vanished or another waiter moved it first — retry the create at once. Anything
    // else (e.g. EPERM on another user's file in a sticky /tmp) means we cannot steal it: wait.
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
  const moved = readRecord(aside);
  const sameLock = judged ? moved?.token === judged.token : moved === null;
  if (!sameLock) {
    try { linkSync(aside, lockPath); } catch { /* a newer lock exists; ours was already superseded */ }
  }
  try { rmSync(aside, { force: true }); } catch { /* best effort */ }
  return true;
}

/**
 * Acquire the lockfile, returning an idempotent release function. Exported for unit tests and
 * for the two-process contention test; production code uses {@link withSofficeLock}.
 */
export async function acquireSofficeLock(
  lockPath: string,
  {
    timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    pollMs = 200,
    staleMs = DEFAULT_STALE_LOCK_MS,
  }: Omit<SofficeLockOptions, 'lockPath'> = {},
): Promise<() => void> {
  const deadline = Date.now() + timeoutMs;
  const record: LockRecord = { pid: process.pid, host: os.hostname(), token: randomUUID(), at: new Date().toISOString() };
  for (;;) {
    let fd: number | undefined;
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    if (fd !== undefined) {
      try {
        writeSync(fd, JSON.stringify(record));
      } finally {
        closeSync(fd);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        // Only remove the file if it is still ours — after a stale steal it belongs to someone else.
        if (readRecord(lockPath)?.token === record.token) {
          try { rmSync(lockPath, { force: true }); } catch { /* best effort */ }
        }
      };
    }

    const holder = readRecord(lockPath);
    const age = lockAgeMs(lockPath);
    if (age === null) continue; // released between our create and our read — retry at once
    const stale = holder
      ? !holderAlive(holder) || age > staleMs
      : age > UNREADABLE_LOCK_GRACE_MS;
    if (stale && stealStaleLock(lockPath, holder)) continue;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the cross-process LibreOffice lock at ${lockPath}` +
          (holder ? ` (held by pid ${holder.pid} on ${holder.host || 'unknown host'} since ${holder.at})` : '') +
          '. Another LibreOffice-driving process appears to be live; delete the lockfile only if none is.',
      );
    }
    await sleep(pollMs + Math.floor(Math.random() * pollMs));
  }
}

const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * Run `fn` while holding the cross-process lock for `soffice`. Re-entrant within one async
 * context: a nested call for the same lock runs immediately. The lock is released on every exit
 * path, including a throw or timeout inside `fn`.
 */
export async function withSofficeLock<T>(
  soffice: string,
  fn: () => Promise<T>,
  options: SofficeLockOptions = {},
): Promise<T> {
  const lockPath = options.lockPath ?? sofficeLockPath(soffice);
  const held = heldLocks.getStore();
  if (held?.has(lockPath)) return fn();
  const release = await acquireSofficeLock(lockPath, options);
  try {
    return await heldLocks.run(new Set([...(held ?? []), lockPath]), fn);
  } finally {
    release();
  }
}
