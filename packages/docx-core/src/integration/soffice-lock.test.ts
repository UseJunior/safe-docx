/**
 * Cross-process LibreOffice launch lock (issue #1037).
 *
 * In-process cases exercise the lock's branches against a temp lockfile without launching
 * soffice: exclusive acquisition, contention, stale-lock stealing (dead holder and aged holder),
 * a live holder owned by another user, ownership-checked release, release on throw, and
 * re-entrancy. The multi-process cases spawn real Node processes: one set contends for the raw
 * lock, the other drives `probeSofficeUsable` against a stub `soffice` that logs every launch,
 * proving that separate processes never overlap launches and that one tagged test run probes
 * once.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1037
 * @see https://github.com/UseJunior/safe-docx/issues/627
 */
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { acquireSofficeLock, sofficeLockPath, withSofficeLock } from './soffice-lock.js';
import { sofficeProbeRecordDir } from './libreoffice-oracle.js';

// Fault injection for the lock module's filesystem calls (passthrough unless a flag is set).
const faults = vi.hoisted(() => ({ failWrite: false, failStatPath: '' }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const fail = (code: string): never => {
    throw Object.assign(new Error(`${code}: injected`), { code });
  };
  return {
    ...actual,
    writeSync: ((...args: Parameters<typeof actual.writeSync>) =>
      faults.failWrite ? fail('ENOSPC') : actual.writeSync(...args)) as typeof actual.writeSync,
    statSync: ((...args: Parameters<typeof actual.statSync>) =>
      faults.failStatPath && String(args[0]) === faults.failStatPath ? fail('EIO') : actual.statSync(...args)) as typeof actual.statSync,
  };
});

const execFileAsync = promisify(execFile);
const TEST_FEATURE = 'LibreOffice Oracle Cross-Process Lock';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '../..');
const LOCK_MODULE = pathToFileURL(path.join(HERE, 'soffice-lock.ts')).href;
const ORACLE_MODULE = pathToFileURL(path.join(HERE, 'libreoffice-oracle.ts')).href;

type Holder = { pid: number; host: string; token: string; at: string };
const readHolder = (file: string): Holder => JSON.parse(readFileSync(file, 'utf8')) as Holder;
const DEAD_PID = 0x7fffffff; // above every platform's pid_max: process.kill(pid, 0) throws ESRCH

/** Parse `enter <id> <ms>` / `exit <id> <ms>` lines into per-id intervals. */
function intervals(log: string): Array<{ id: string; start: number; end: number }> {
  const byId = new Map<string, { id: string; start: number; end: number }>();
  for (const line of log.trim().split('\n').filter(Boolean)) {
    const [kind, id, ms] = line.split(' ');
    const entry = byId.get(id!) ?? { id: id!, start: NaN, end: NaN };
    if (kind === 'enter') entry.start = Number(ms);
    else entry.end = Number(ms);
    byId.set(id!, entry);
  }
  return [...byId.values()].sort((a, b) => a.start - b.start);
}

function expectNoOverlap(spans: Array<{ start: number; end: number }>): void {
  for (let i = 1; i < spans.length; i++) {
    expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
  }
}

/** Run a child Node process that can import this package's TypeScript sources directly. */
function runChild(script: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ stdout: string }> {
  return execFileAsync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: PACKAGE_DIR,
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
}

describe('soffice cross-process lock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sdx-soffice-lock-test-'));
    lockPath = path.join(dir, 'soffice.lock');
  });
  afterEach(() => {
    faults.failWrite = false;
    faults.failStatPath = '';
    rmSync(dir, { recursive: true, force: true });
  });

  const liveRecord = (token: string): string =>
    JSON.stringify({ pid: process.ppid, host: os.hostname(), token, at: new Date().toISOString() });

  test('a steal re-checks under the guard and never deletes a lock that replaced the stale one', async ({ given, when, then }: AllureBddContext) => {
    const guard = `${lockPath}.guard`;
    let waiter!: Promise<unknown>;
    await given('a stale lock (dead holder) and the removal guard held by someone else', () => {
      writeFileSync(lockPath, JSON.stringify({ pid: DEAD_PID, host: os.hostname(), token: 'stale', at: new Date().toISOString() }));
      writeFileSync(guard, '');
    });
    await when('a waiter judges it stale, and a fresh live holder replaces it before the guard frees', async () => {
      waiter = acquireSofficeLock(lockPath, { timeoutMs: 400, pollMs: 20 }).then(
        async (release) => { await release(); return 'acquired'; },
        (err: Error) => err.message,
      );
      await new Promise((r) => setTimeout(r, 60)); // waiter is now blocked on the guard
      rmSync(lockPath);
      writeFileSync(lockPath, liveRecord('fresh'));
      rmSync(guard);
    });
    await then('the fresh lock survives and the waiter times out instead of entering', async () => {
      expect(await waiter).toMatch(/Timed out/);
      expect(readHolder(lockPath).token).toBe('fresh');
    });
  });

  test('a release waits for the guard and then spares a successor', async ({ given, when, then }: AllureBddContext) => {
    const guard = `${lockPath}.guard`;
    let release!: () => Promise<void>;
    await given('a holder whose release must wait on a held guard', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 });
      writeFileSync(guard, '');
    });
    await when('the lock passes to a successor while the release is waiting', async () => {
      const pending = release();
      await new Promise((r) => setTimeout(r, 40));
      writeFileSync(lockPath, liveRecord('successor'));
      rmSync(guard);
      await pending;
    });
    await then("the successor's lock is untouched", () => {
      expect(readHolder(lockPath).token).toBe('successor');
    });
  });

  test('a failed lockfile write removes the half-created lock', async ({ when, then }: AllureBddContext) => {
    let error = '';
    await when('writing the holder record fails', async () => {
      faults.failWrite = true;
      error = await acquireSofficeLock(lockPath, { timeoutMs: 1_000, pollMs: 20 }).then(() => 'acquired', (e: Error) => e.message);
      faults.failWrite = false;
    });
    await then('the acquisition fails and leaves no lockfile behind', () => {
      expect(error).toMatch(/ENOSPC/);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  test('a lockfile that cannot be stat-ed is waited on until the deadline, not spun on', async ({ given, then }: AllureBddContext) => {
    await given('a live lock whose stat fails with EIO', () => {
      writeFileSync(lockPath, liveRecord('live'));
      faults.failStatPath = lockPath;
    });
    await then('the waiter honours its timeout', async () => {
      const started = Date.now();
      await expect(acquireSofficeLock(lockPath, { timeoutMs: 100, pollMs: 20 })).rejects.toThrow(/Timed out/);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(readHolder(lockPath).token).toBe('live');
    });
  });

  test('work that outlives the holder must re-acquire the lock', async ({ when, then }: AllureBddContext) => {
    const opts = { lockPath, timeoutMs: 150, pollMs: 20 };
    let detached!: Promise<string>;
    let otherRelease!: () => Promise<void>;
    await when('a holder starts detached work, releases, and another holder takes the lock', async () => {
      await withSofficeLock('unused', async () => {
        detached = new Promise((r) => setTimeout(r, 50)).then(() =>
          withSofficeLock('unused', async () => 'entered', opts).catch((e: Error) => e.message),
        );
      }, opts);
      otherRelease = await acquireSofficeLock(lockPath, { timeoutMs: 1_000, pollMs: 20 });
    });
    await then('the detached work waits on the new holder instead of entering under a dead lease', async () => {
      expect(await detached).toMatch(/Timed out/);
      await otherRelease();
    });
  });

  test('acquires exclusively and releases idempotently', async ({ given, when, then, and }: AllureBddContext) => {
    let release!: () => Promise<void>;
    await given('a free lock path', () => {
      expect(existsSync(lockPath)).toBe(false);
    });
    await when('the lock is acquired', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 });
    });
    await then('the lockfile records this process as the holder', () => {
      const holder = readHolder(lockPath);
      expect(holder.pid).toBe(process.pid);
      expect(holder.host).toBe(os.hostname());
    });
    await and('releasing removes it and a second release is a no-op', async () => {
      await release();
      expect(existsSync(lockPath)).toBe(false);
      await expect(release()).resolves.toBeUndefined();
    });
  });

  test('a second waiter blocks until the holder releases', async ({ given, when, then }: AllureBddContext) => {
    let firstRelease!: () => Promise<void>;
    let acquiredSecond = false;
    await given('the lock is already held', async () => {
      firstRelease = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 });
    });
    await when('a second acquisition waits, then the holder releases', async () => {
      const pending = acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 }).then((r) => {
        acquiredSecond = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 150));
      expect(acquiredSecond).toBe(false);
      await firstRelease();
      await (await pending)();
    });
    await then('the second acquisition succeeded only after release', () => {
      expect(acquiredSecond).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  test('times out with a diagnostic naming the live holder', async ({ given, then }: AllureBddContext) => {
    let release!: () => Promise<void>;
    await given('the lock is held by this live process', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 });
    });
    await then('a waiter with a short timeout rejects and names the holder pid', async () => {
      await expect(acquireSofficeLock(lockPath, { timeoutMs: 100, pollMs: 20 })).rejects.toThrow(
        new RegExp(`held by pid ${process.pid}`),
      );
      await release();
    });
  });

  test('steals a stale lock whose recorded holder is dead', async ({ given, when, then }: AllureBddContext) => {
    await given('a lockfile owned by a non-existent PID on this host', () => {
      writeFileSync(lockPath, JSON.stringify({ pid: DEAD_PID, host: os.hostname(), token: 'dead', at: new Date().toISOString() }));
    });
    let release!: () => Promise<void>;
    await when('a new acquisition runs', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 });
    });
    await then('it steals the stale lock and takes ownership', async () => {
      expect(readHolder(lockPath).pid).toBe(process.pid);
      await release();
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  test('treats an aged lock as stale even when its PID looks alive (PID reuse)', async ({ given, when, then }: AllureBddContext) => {
    await given('a lockfile naming a live PID but last written long ago', () => {
      // process.ppid is alive, standing in for a recycled PID that now belongs to something else.
      writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, host: os.hostname(), token: 'old', at: '2020-01-01T00:00:00Z' }));
      const old = new Date(Date.now() - 60_000);
      utimesSync(lockPath, old, old);
    });
    let release!: () => Promise<void>;
    await when('an acquisition runs with a 30s stale window', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20, staleMs: 30_000 });
    });
    await then('the aged lock was stolen', async () => {
      expect(readHolder(lockPath).token).not.toBe('old');
      await release();
    });
  });

  test('does not steal a fresh lock held by a live process', async ({ given, then }: AllureBddContext) => {
    await given('a fresh lockfile naming a live PID (the parent process)', () => {
      writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, host: os.hostname(), token: 'live', at: new Date().toISOString() }));
    });
    await then('a waiter times out and leaves the holder in place', async () => {
      await expect(acquireSofficeLock(lockPath, { timeoutMs: 150, pollMs: 20 })).rejects.toThrow(/Timed out/);
      expect(readHolder(lockPath).token).toBe('live');
    });
  });

  test('release never removes a lock that has since passed to another holder', async ({ given, when, then }: AllureBddContext) => {
    let release!: () => Promise<void>;
    await given('a holder whose lock was replaced by another process', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 });
      writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, host: os.hostname(), token: 'successor', at: new Date().toISOString() }));
    });
    await when('the original holder releases', async () => {
      await release();
    });
    await then("the successor's lockfile is untouched", () => {
      expect(readHolder(lockPath).token).toBe('successor');
    });
  });

  test('withSofficeLock releases on throw and is re-entrant', async ({ when, then, and }: AllureBddContext) => {
    await when('the locked work throws', async () => {
      await expect(
        withSofficeLock('unused', async () => {
          expect(existsSync(lockPath)).toBe(true);
          throw new Error('boom');
        }, { lockPath, timeoutMs: 5_000, pollMs: 20 }),
      ).rejects.toThrow('boom');
    });
    await then('the lock was released', () => {
      expect(existsSync(lockPath)).toBe(false);
    });
    await and('a nested acquisition of the same lock runs without waiting on itself', async () => {
      const opts = { lockPath, timeoutMs: 300, pollMs: 20 };
      const result = await withSofficeLock('unused', () => withSofficeLock('unused', async () => 'nested', opts), opts);
      expect(result).toBe('nested');
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  test('every LibreOffice entry point shares one machine-wide lock', async ({ then }: AllureBddContext) => {
    await then('the Homebrew wrapper, the app bundle binary and a Linux install map to the same lockfile', () => {
      const shared = sofficeLockPath('/Applications/LibreOffice.app/Contents/MacOS/soffice');
      expect(sofficeLockPath('/opt/homebrew/Caskroom/libreoffice-still/26.2.5/.homebrew-command-wrappers/soffice')).toBe(shared);
      expect(sofficeLockPath('/usr/lib/libreoffice/program/soffice')).toBe(shared);
      expect(shared).toBe(path.join(os.tmpdir(), 'safe-docx-soffice-libreoffice.lock'));
    });
  });

  test('keys any other binary by its resolved path so symlinks share one lock', async ({ given, then }: AllureBddContext) => {
    const target = path.join(dir, 'soffice-real');
    const link = path.join(dir, 'soffice-link');
    await given('a binary and a symlink to it', () => {
      writeFileSync(target, '');
      symlinkSync(target, link);
    });
    await then('both resolve to the same lockfile in the OS temp dir, distinct from another binary', () => {
      expect(sofficeLockPath(link)).toBe(sofficeLockPath(target));
      expect(path.dirname(sofficeLockPath(target))).toBe(os.tmpdir());
      expect(sofficeLockPath(path.join(dir, 'other'))).not.toBe(sofficeLockPath(target));
    });
  });

  test('separate processes contending for the lock never overlap', async ({ given, when, then }: AllureBddContext) => {
    const logPath = path.join(dir, 'events.log');
    const child = path.join(dir, 'contender.mjs');
    await given('a child script that holds the lock for 250ms and logs entry and exit', () => {
      writeFileSync(
        child,
        `import { appendFileSync } from 'node:fs';\n` +
          `const { acquireSofficeLock } = await import(${JSON.stringify(LOCK_MODULE)});\n` +
          `const [lockPath, logPath, id] = process.argv.slice(2);\n` +
          `const release = await acquireSofficeLock(lockPath, { timeoutMs: 30000, pollMs: 20 });\n` +
          `appendFileSync(logPath, 'enter ' + id + ' ' + Date.now() + '\\n');\n` +
          `await new Promise((r) => setTimeout(r, 250));\n` +
          `appendFileSync(logPath, 'exit ' + id + ' ' + Date.now() + '\\n');\n` +
          `await release();\n`,
      );
    });
    await when('three processes start at once', async () => {
      await Promise.all(['a', 'b', 'c'].map((id) => runChild(child, [lockPath, logPath, id])));
    });
    await then('each held the lock alone, and the lockfile is gone afterwards', () => {
      const spans = intervals(readFileSync(logPath, 'utf8'));
      expect(spans).toHaveLength(3);
      expectNoOverlap(spans);
      expect(existsSync(lockPath)).toBe(false);
    });
  }, 90_000);

  test('probeSofficeUsable serializes launches across processes and shares one verdict per run', async ({ given, when, then, and }: AllureBddContext) => {
    const launchLog = path.join(dir, 'launches.log');
    const stub = path.join(dir, 'soffice');
    const child = path.join(dir, 'prober.mjs');
    await given('a stub soffice that logs each launch, takes 250ms, and converts successfully', () => {
      const script = path.join(dir, 'stub-soffice.mjs');
      writeFileSync(
        script,
        `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';\n` +
          `import path from 'node:path';\n` +
          `const argv = process.argv.slice(2);\n` +
          `const outDir = argv[argv.indexOf('--outdir') + 1];\n` +
          `const id = process.pid;\n` +
          `appendFileSync(${JSON.stringify(launchLog)}, 'enter ' + id + ' ' + Date.now() + '\\n');\n` +
          `await new Promise((r) => setTimeout(r, 250));\n` +
          `mkdirSync(outDir, { recursive: true });\n` +
          `writeFileSync(path.join(outDir, 'probe-input.txt'), 'probe');\n` +
          `appendFileSync(${JSON.stringify(launchLog)}, 'exit ' + id + ' ' + Date.now() + '\\n');\n`,
      );
      writeFileSync(stub, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`);
      chmodSync(stub, 0o755);
      writeFileSync(
        child,
        `const { probeSofficeUsable } = await import(${JSON.stringify(ORACLE_MODULE)});\n` +
          `process.stdout.write(String(await probeSofficeUsable(process.argv[2])));\n`,
      );
    });
    const runTag = `${process.pid}-${Date.now()}`;
    const shared = `shared-${runTag}`;
    try {
      await when('three processes of one tagged run probe at once', async () => {
        const outs = await Promise.all([1, 2, 3].map(() => runChild(child, [stub], { SAFE_DOCX_SOFFICE_RUN_ID: shared })));
        expect(outs.map((o) => o.stdout)).toEqual(['true', 'true', 'true']);
      });
      await then('soffice launched exactly once for the whole run', () => {
        expect(intervals(readFileSync(launchLog, 'utf8'))).toHaveLength(1);
      });
      await and('processes of different runs each probe, one launch at a time, and leave no lock behind', async () => {
        rmSync(launchLog, { force: true });
        await Promise.all(['a', 'b', 'c'].map((r) => runChild(child, [stub], { SAFE_DOCX_SOFFICE_RUN_ID: `${r}-${runTag}` })));
        const spans = intervals(readFileSync(launchLog, 'utf8'));
        expect(spans).toHaveLength(3);
        expectNoOverlap(spans);
        expect(existsSync(sofficeLockPath(stub))).toBe(false);
      });
      await and('a later worker of the first run still reuses its verdict after the other runs', async () => {
        rmSync(launchLog, { force: true });
        expect((await runChild(child, [stub], { SAFE_DOCX_SOFFICE_RUN_ID: shared })).stdout).toBe('true');
        expect(existsSync(launchLog)).toBe(false);
      });
    } finally {
      // Verdict files of this test's runs (the stub path is unique to this test).
      const records = sofficeProbeRecordDir();
      for (const name of existsSync(records) ? readdirSync(records) : []) {
        const file = path.join(records, name);
        try {
          if ((JSON.parse(readFileSync(file, 'utf8')) as { soffice?: string }).soffice === stub) rmSync(file, { force: true });
        } catch { /* another run's file mid-write */ }
      }
      rmSync(sofficeLockPath(stub), { force: true });
    }
  }, 90_000);
});
