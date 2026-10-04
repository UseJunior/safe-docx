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
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { acquireSofficeLock, sofficeLockPath, withSofficeLock } from './soffice-lock.js';

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
    rmSync(dir, { recursive: true, force: true });
  });

  test('acquires exclusively and releases idempotently', async ({ given, when, then, and }: AllureBddContext) => {
    let release!: () => void;
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
    await and('releasing removes it and a second release is a no-op', () => {
      release();
      expect(existsSync(lockPath)).toBe(false);
      expect(() => release()).not.toThrow();
    });
  });

  test('a second waiter blocks until the holder releases', async ({ given, when, then }: AllureBddContext) => {
    let firstRelease!: () => void;
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
      firstRelease();
      (await pending)();
    });
    await then('the second acquisition succeeded only after release', () => {
      expect(acquiredSecond).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  test('times out with a diagnostic naming the live holder', async ({ given, then }: AllureBddContext) => {
    let release!: () => void;
    await given('the lock is held by this live process', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 });
    });
    await then('a waiter with a short timeout rejects and names the holder pid', async () => {
      await expect(acquireSofficeLock(lockPath, { timeoutMs: 100, pollMs: 20 })).rejects.toThrow(
        new RegExp(`held by pid ${process.pid}`),
      );
      release();
    });
  });

  test('steals a stale lock whose recorded holder is dead', async ({ given, when, then }: AllureBddContext) => {
    await given('a lockfile owned by a non-existent PID on this host', () => {
      writeFileSync(lockPath, JSON.stringify({ pid: DEAD_PID, host: os.hostname(), token: 'dead', at: new Date().toISOString() }));
    });
    let release!: () => void;
    await when('a new acquisition runs', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 });
    });
    await then('it steals the stale lock and takes ownership', () => {
      expect(readHolder(lockPath).pid).toBe(process.pid);
      release();
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
    let release!: () => void;
    await when('an acquisition runs with a 30s stale window', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20, staleMs: 30_000 });
    });
    await then('the aged lock was stolen', () => {
      expect(readHolder(lockPath).token).not.toBe('old');
      release();
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
    let release!: () => void;
    await given('a holder whose lock was replaced by another process', async () => {
      release = await acquireSofficeLock(lockPath, { timeoutMs: 5_000, pollMs: 20 });
      writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, host: os.hostname(), token: 'successor', at: new Date().toISOString() }));
    });
    await when('the original holder releases', () => {
      release();
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

  test('keys the lock by the resolved binary so symlinks share one lock', async ({ given, then }: AllureBddContext) => {
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
          `release();\n`,
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
    const probeRecord = sofficeLockPath(stub).replace(/\.lock$/, '.probe.json');
    try {
      await when('three processes of one tagged run probe at once', async () => {
        const outs = await Promise.all([1, 2, 3].map(() => runChild(child, [stub], { SAFE_DOCX_SOFFICE_RUN_ID: 'run-shared' })));
        expect(outs.map((o) => o.stdout)).toEqual(['true', 'true', 'true']);
      });
      await then('soffice launched exactly once for the whole run', () => {
        expect(intervals(readFileSync(launchLog, 'utf8'))).toHaveLength(1);
      });
      await and('processes of different runs each probe, one launch at a time, and leave no lock behind', async () => {
        rmSync(launchLog, { force: true });
        await Promise.all(['run-a', 'run-b', 'run-c'].map((runId) => runChild(child, [stub], { SAFE_DOCX_SOFFICE_RUN_ID: runId })));
        const spans = intervals(readFileSync(launchLog, 'utf8'));
        expect(spans).toHaveLength(3);
        expectNoOverlap(spans);
        expect(existsSync(sofficeLockPath(stub))).toBe(false);
      });
    } finally {
      rmSync(probeRecord, { force: true });
      rmSync(sofficeLockPath(stub), { force: true });
    }
  }, 90_000);
});
