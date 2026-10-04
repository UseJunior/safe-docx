/**
 * Cross-process LibreOffice launch lock.
 *
 * Every helper in this package that launches `soffice` (the accept/reject oracle, its
 * launchability probe, and the generation probes) memoizes or batches within ONE process, but
 * nothing coordinated ACROSS processes: parallel Vitest workers, sibling sessions, and a human
 * running the oracle at the same time each spawned their own headless LibreOffice. On macOS
 * concurrent headless launches are the amplification vector behind issue #627 (one environment
 * incompatibility became several simultaneous SIGABRT crash reports), so LibreOffice launches
 * serialize on a lockfile in the OS temp dir (issue #1037).
 *
 * Protocol:
 * - Acquire = exclusive-create (`wx`) a JSON lockfile recording PID, host, and a random token.
 *   Creation can only succeed while no lockfile exists, so it never displaces a holder.
 * - Every REMOVAL of the lockfile — a holder's release or a waiter's stale steal — happens under
 *   a short-lived guard file (also `wx`), and only after re-reading the lockfile under that guard
 *   and confirming it is still the exact record (by token) the remover is entitled to delete.
 *   Because removers are serialized and a present lockfile cannot be replaced by a create, the
 *   record cannot change between that re-read and the `rm`. So a release never deletes a
 *   successor's lock, and two waiters racing to steal the same stale lock cannot delete a fresh
 *   lock a third process created.
 * - A waiter steals only when the recorded holder is provably gone (same host and
 *   `process.kill(pid, 0)` reports ESRCH), or the file is older than `staleMs` (a SIGKILLed holder
 *   cannot clean up; a recycled PID cannot pin the lock forever). A lockfile that cannot be parsed
 *   (a creator between `open` and `write`) is stolen only after a grace period.
 * - The guard is held for a few synchronous filesystem calls and records its holder like the
 *   lock does. A guard is cleared only when its holder is provably dead (a process killed inside
 *   that window), or when it is still unparseable after `GUARD_STALE_MS` (its creator died between
 *   `open` and `write`). A guard whose holder is alive is never cleared, however old: a holder
 *   stopped mid-section (SIGSTOP, a debugger) keeps it, and waiters time out with a diagnostic
 *   naming the guard file rather than overlap. Clearing renames the guard aside and puts it back
 *   if it turns out not to be the one judged stale.
 *   Residual risk: two waiters clearing the SAME dead guard while a third creates a new one can
 *   still overlap. That needs a process to die inside a microsecond critical section and three
 *   more to race within microseconds of it; the worst outcome is two concurrent soffice launches,
 *   the behaviour before this lock existed.
 * - If the guard cannot be taken, a release leaves its lockfile in place rather than removing it
 *   unguarded; waiters reclaim it once the holder exits (ESRCH) or after `staleMs`.
 *
 * Re-entrancy: a call nested inside a holder's async context (for the same lockfile) runs under
 * the holder's lease instead of waiting on itself. The lease is invalidated before release, so
 * work that outlives the holder (a detached promise) must acquire the lock again. Nested calls
 * share the holder's lease and are not serialized among themselves; the package's launchers
 * never nest.
 *
 * Scope: every real LibreOffice binary (anything whose path or resolved real path contains
 * "libreoffice", e.g. the Homebrew wrapper and the app-bundle binary it execs) shares ONE
 * machine-wide lock. Any other executable — the stub converters used by unit tests — is locked by
 * its own real path, so stubs never queue behind a real oracle run in another worker.
 *
 * If the temp dir cannot be written (a restricted sandbox), launches proceed unlocked with a
 * one-time warning rather than turning a skip-on-unusable-soffice into a hard failure.
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
import { closeSync, linkSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A holder older than this is presumed dead even if its PID looks alive (PID reuse). Oracle
 *  launches are bounded far below this: the probe times out at 30s, an oracle batch at
 *  20s + 2 × 45s, a generation probe at 45s. */
export const DEFAULT_STALE_LOCK_MS = 10 * 60_000;
/** Default wait for a contended lock before giving up with a diagnostic. */
export const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60_000;
/** A lockfile that exists but cannot be parsed is only stolen after this grace period. */
const UNREADABLE_LOCK_GRACE_MS = 10_000;
/** A guard still unparseable after this long was abandoned between `open` and `write`. */
const GUARD_STALE_MS = 60_000;
/** Give up on the removal guard after this long (only reachable if the guard dir misbehaves). */
const GUARD_TIMEOUT_MS = 30_000;

type LockRecord = { pid: number; host: string; token: string; at: string };

export type SofficeLockOptions = {
  /** Lockfile path; defaults to {@link sofficeLockPath}. */
  lockPath?: string;
  timeoutMs?: number;
  pollMs?: number;
  staleMs?: number;
};

/** An idempotent release; resolves once the lockfile is removed (or confirmed not ours). */
export type SofficeLockRelease = () => Promise<void>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const errCode = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | undefined)?.code;

function canonicalBinary(soffice: string): string {
  try {
    return realpathSync(soffice);
  } catch {
    return path.resolve(soffice);
  }
}

/** Lockfile path for a binary: one machine-wide (per OS user temp dir) lock for every real
 *  LibreOffice entry point, a per-path lock for anything else. */
export function sofficeLockPath(soffice: string): string {
  const real = canonicalBinary(soffice);
  const key = /libreoffice/i.test(real) || /libreoffice/i.test(soffice)
    ? 'libreoffice'
    : createHash('sha256').update(real).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `safe-docx-soffice-${key}.lock`);
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
    return errCode(err) !== 'ESRCH';
  }
}

/** Age of the lockfile in ms; null if it no longer exists. Any other stat failure is reported as
 *  age 0 (fresh), so an unreadable file is waited on, never stolen or spun on. */
function lockAgeMs(lockPath: string): number | null {
  try {
    return Date.now() - statSync(lockPath).mtimeMs;
  } catch (err) {
    return errCode(err) === 'ENOENT' ? null : 0;
  }
}

/** Exclusive-create `file` holding `record`; false if it already exists. A failed write removes
 *  the half-created file (no one else removes a fresh unparseable file) and rethrows. */
function tryCreate(file: string, record: LockRecord): boolean {
  let fd: number;
  try {
    fd = openSync(file, 'wx');
  } catch (err) {
    if (errCode(err) === 'EEXIST') return false;
    throw err;
  }
  try {
    writeSync(fd, JSON.stringify(record));
    closeSync(fd);
  } catch (err) {
    try { closeSync(fd); } catch { /* already closed */ }
    try { rmSync(file, { force: true }); } catch { /* best effort */ }
    throw err;
  }
  return true;
}

const newRecord = (): LockRecord => ({ pid: process.pid, host: os.hostname(), token: randomUUID(), at: new Date().toISOString() });

/** Clear an abandoned guard: rename it aside, keep it removed only if it is the record judged
 *  stale, otherwise put it back (`link` refuses to overwrite a newer guard). */
function clearStaleGuard(guard: string, judged: LockRecord | null): void {
  const aside = `${guard}.stale-${randomUUID()}`;
  try {
    renameSync(guard, aside);
  } catch {
    return; // vanished, or cannot be moved — the caller waits and re-evaluates
  }
  const moved = readRecord(aside);
  const same = judged ? moved?.token === judged.token : moved === null;
  if (!same) {
    try { linkSync(aside, guard); } catch { /* a newer guard exists */ }
  }
  try { rmSync(aside, { force: true }); } catch { /* best effort */ }
}

/** Run `fn` (synchronous filesystem work only) while holding the removal guard. */
async function underRemovalGuard(
  lockPath: string,
  fn: () => void,
  deadline = Date.now() + GUARD_TIMEOUT_MS,
): Promise<void> {
  const guard = `${lockPath}.guard`;
  for (;;) {
    const mine = newRecord();
    if (tryCreate(guard, mine)) {
      try {
        fn();
        return;
      } finally {
        if (readRecord(guard)?.token === mine.token) rmSync(guard, { force: true });
      }
    }
    const holder = readRecord(guard);
    const age = lockAgeMs(guard);
    if (age === null) continue; // freed between our create and our read — retry at once
    const stale = holder ? !holderAlive(holder) : age > GUARD_STALE_MS;
    if (stale) clearStaleGuard(guard, holder);
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for the LibreOffice lock guard at ${guard}` +
          (holder ? ` (recorded holder pid ${holder.pid} since ${holder.at})` : '') +
          '. Delete it only if that process is not a safe-docx LibreOffice launcher.',
      );
    }
    await sleep(5 + Math.floor(Math.random() * 10));
  }
}

/**
 * Acquire the lockfile, returning an idempotent async release. Exported for unit tests and the
 * multi-process contention test; production code uses {@link withSofficeLock}.
 */
export async function acquireSofficeLock(
  lockPath: string,
  {
    timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    pollMs = 200,
    staleMs = DEFAULT_STALE_LOCK_MS,
  }: Omit<SofficeLockOptions, 'lockPath'> = {},
): Promise<SofficeLockRelease> {
  const deadline = Date.now() + timeoutMs;
  const record = newRecord();
  for (;;) {
    if (tryCreate(lockPath, record)) {
      let released: Promise<void> | undefined;
      return () => {
        released ??= underRemovalGuard(lockPath, () => {
          if (readRecord(lockPath)?.token === record.token) rmSync(lockPath, { force: true });
        }).catch((err: unknown) => {
          // Never remove unguarded (a successor could be deleted). The lockfile stays until this
          // process exits (ESRCH) or it ages past staleMs, when waiters reclaim it.
          // eslint-disable-next-line no-console
          console.warn(`[soffice-lock] could not release ${lockPath} (${(err as Error).message}); it will be reclaimed as stale.`);
        });
        return released;
      };
    }

    const holder = readRecord(lockPath);
    const age = lockAgeMs(lockPath);
    if (age === null) continue; // released between our create and our read — retry the create
    const stale = holder ? !holderAlive(holder) || age > staleMs : age > UNREADABLE_LOCK_GRACE_MS;
    if (stale) {
      // Re-check under the guard: remove only the exact record judged stale. If it changed
      // (released, or replaced by a fresh holder), the next iteration re-evaluates.
      // The guard wait is bounded by the caller's deadline, and a removal that finishes past it
      // does not turn into a late acquisition.
      let removed = false;
      await underRemovalGuard(lockPath, () => {
        const current = readRecord(lockPath);
        const currentAge = lockAgeMs(lockPath);
        const same = holder
          ? current?.token === holder.token
          : current === null && currentAge !== null && currentAge > UNREADABLE_LOCK_GRACE_MS;
        if (same) {
          rmSync(lockPath, { force: true });
          removed = true;
        }
      }, deadline);
      if (removed && Date.now() <= deadline) continue;
    }
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

type Lease = { lockPath: string; active: boolean };
const leases = new AsyncLocalStorage<ReadonlyMap<string, Lease>>();
let warnedUnlocked = false;

/** Filesystem errors meaning "the lock cannot be created here", not "the lock is contended". */
const UNWRITABLE = new Set(['EACCES', 'EPERM', 'EROFS']);

/**
 * Run `fn` while holding the cross-process lock for `soffice`. The lock is released on every
 * exit path, including a throw or timeout inside `fn`. See the module comment for re-entrancy
 * and the unwritable-temp-dir fallback.
 */
export async function withSofficeLock<T>(
  soffice: string,
  fn: () => Promise<T>,
  options: SofficeLockOptions = {},
): Promise<T> {
  const lockPath = options.lockPath ?? sofficeLockPath(soffice);
  const current = leases.getStore();
  if (current?.get(lockPath)?.active) return fn();

  let release: SofficeLockRelease;
  try {
    release = await acquireSofficeLock(lockPath, options);
  } catch (err) {
    if (!UNWRITABLE.has(errCode(err) ?? '')) throw err;
    if (!warnedUnlocked) {
      warnedUnlocked = true;
      // eslint-disable-next-line no-console
      console.warn(`[soffice-lock] cannot create ${lockPath} (${errCode(err)}); launching LibreOffice without the cross-process lock.`);
    }
    return fn();
  }
  const lease: Lease = { lockPath, active: true };
  try {
    return await leases.run(new Map([...(current ?? []), [lockPath, lease]]), fn);
  } finally {
    lease.active = false;
    await release();
  }
}
