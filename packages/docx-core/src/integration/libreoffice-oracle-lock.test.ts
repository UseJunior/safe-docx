/**
 * Cross-process LibreOffice lock — pure unit coverage.
 *
 * The lock (`acquireGlobalSofficeLock`) serializes every soffice launch in the repo on a
 * single machine-wide lockfile so parallel vitest workers, sibling agent sessions, and a
 * human never spawn concurrent headless LibreOffice instances (the amplification vector
 * behind issue #627). These cases exercise the lock's branches WITHOUT launching soffice,
 * using a temp lockfile: exclusive acquisition, contention against a held lock, and stealing
 * a stale lock whose recorded holder PID is dead.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/627
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { acquireGlobalSofficeLock } from './libreoffice-oracle.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const TEST_FEATURE = 'LibreOffice Oracle Cross-Process Lock';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

describe('acquireGlobalSofficeLock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'lo-lock-test-'));
    lockPath = path.join(dir, 'soffice.lock');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('acquires exclusively and releases idempotently', async ({ given, when, then, and }: AllureBddContext) => {
    let release: () => void;
    await given('a free lock path', () => {
      expect(existsSync(lockPath)).toBe(false);
    });
    await when('the lock is acquired', async () => {
      release = await acquireGlobalSofficeLock(5_000, { lockPath, pollMs: 20 });
    });
    await then('the lockfile exists and records this process PID', () => {
      expect(existsSync(lockPath)).toBe(true);
      const holder = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number };
      expect(holder.pid).toBe(process.pid);
    });
    await and('releasing removes it and a second release is a no-op', () => {
      release();
      expect(existsSync(lockPath)).toBe(false);
      expect(() => release()).not.toThrow();
    });
  });

  test('a second waiter blocks until the holder releases', async ({ given, when, then }: AllureBddContext) => {
    let firstRelease: () => void;
    let acquiredSecond = false;
    await given('the lock is already held', async () => {
      firstRelease = await acquireGlobalSofficeLock(5_000, { lockPath, pollMs: 20 });
    });
    await when('a second acquisition is attempted while held, then the holder releases', async () => {
      const pending = acquireGlobalSofficeLock(5_000, { lockPath, pollMs: 20 }).then((r) => {
        acquiredSecond = true;
        return r;
      });
      // Give the waiter time to spin at least once without the lock.
      await new Promise((r) => setTimeout(r, 120));
      expect(acquiredSecond).toBe(false);
      firstRelease();
      const secondRelease = await pending;
      secondRelease();
    });
    await then('the second acquisition succeeded only after release', () => {
      expect(acquiredSecond).toBe(true);
    });
  });

  test('steals a stale lock whose recorded holder PID is dead', async ({ given, when, then }: AllureBddContext) => {
    await given('a lockfile owned by a non-existent PID', () => {
      // PID 0x7fffffff is not a live process; process.kill(pid, 0) throws ESRCH.
      writeFileSync(lockPath, JSON.stringify({ pid: 0x7fffffff, at: new Date().toISOString() }));
      expect(existsSync(lockPath)).toBe(true);
    });
    let release: () => void;
    await when('a new acquisition runs', async () => {
      release = await acquireGlobalSofficeLock(5_000, { lockPath, pollMs: 20 });
    });
    await then('it steals the stale lock and takes ownership', () => {
      const holder = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number };
      expect(holder.pid).toBe(process.pid);
      release();
    });
  });
});
