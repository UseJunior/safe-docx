import { afterEach, describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure } from '../testing/allure-test.js';
import { assertFailure, assertSuccess, createTestSessionManager, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { save } from './save.js';

const TEST_FEATURE = 'stage-save-publication';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

describe('save destination coordination', () => {
  registerCleanup();
  afterEach(() => vi.restoreAllMocks());

  test.openspec('Destination preflight')('rejects disallowed second output without creating clean parent directory', async () => {
    const { mgr, inputPath, tmpDir } = await openSession(['Synthetic'], { mgr: createTestSessionManager() });
    const output = path.join(tmpDir, 'new-parent', 'clean.docx');
    const result = await save(mgr, { file_path: inputPath, save_to_local_path: output, tracked_save_to_local_path: '/outside-allowed-roots/redline.docx' });
    assertFailure(result, 'PATH_NOT_ALLOWED');
    await expect(fs.stat(path.dirname(output))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  for (const kind of ['identical', 'symlink', 'missing-parent-symlink', 'dangling-symlink', 'hardlink']) {
    test.openspec('Destination preflight')(`rejects ${kind} aliases without changing existing bytes`, async () => {
      const { mgr, inputPath, tmpDir } = await openSession(['Synthetic'], { mgr: createTestSessionManager() });
      const target = path.join(tmpDir, 'target.docx');
      let alias = path.join(tmpDir, 'alias.docx');
      if (kind === 'missing-parent-symlink') {
        const parent = path.join(tmpDir, 'linked-parent');
        await fs.symlink(tmpDir, parent, 'dir');
        alias = path.join(parent, 'target.docx');
      } else if (kind !== 'dangling-symlink') await fs.writeFile(target, 'original');
      if (kind === 'identical') alias = target;
      if (kind === 'symlink' || kind === 'dangling-symlink') await fs.symlink(target, alias);
      if (kind === 'hardlink') await fs.link(target, alias);
      const result = await save(mgr, { file_path: inputPath, save_to_local_path: target, tracked_save_to_local_path: alias });
      assertFailure(result, 'ALIASED_OUTPUT_PATHS');
      if (kind === 'missing-parent-symlink' || kind === 'dangling-symlink') await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
      else expect(await fs.readFile(target, 'utf8')).toBe('original');
    });
  }

  for (const dangling of [false, true]) {
    test.openspec('Destination preflight')(`writes through ${dangling ? 'dangling' : 'existing'} symlinks and retains link`, async () => {
      const { mgr, inputPath, tmpDir } = await openSession(['Synthetic'], { mgr: createTestSessionManager() });
      const target = path.join(tmpDir, 'actual.docx');
      const alias = path.join(tmpDir, 'alias.docx');
      if (!dangling) { await fs.writeFile(target, 'original'); await fs.chmod(target, 0o640); }
      await fs.symlink(target, alias);
      assertSuccess(await save(mgr, { file_path: inputPath, save_to_local_path: alias, save_format: 'clean' }), 'symlink save');
      expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(target)).toEqual(await fs.readFile(alias));
      if (!dangling) expect((await fs.stat(target)).mode & 0o777).toBe(0o640);
    });
  }

  test.openspec('Destination preflight')('refuses a symlink to a directory before any publication', async () => {
    const { mgr, inputPath, tmpDir } = await openSession(['Synthetic'], { mgr: createTestSessionManager() });
    const alias = path.join(tmpDir, 'directory-link.docx');
    const output = path.join(tmpDir, 'clean.docx');
    await fs.symlink(tmpDir, alias, 'dir');
    const rename = vi.spyOn(fs, 'rename');
    assertFailure(await save(mgr, { file_path: inputPath, save_to_local_path: output, tracked_save_to_local_path: alias }), 'SAVE_ERROR');
    expect(rename).not.toHaveBeenCalled();
    expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true);
    expect((await fs.stat(tmpDir)).isDirectory()).toBe(true);
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.openspec('Recovery needs attention')('surfaces exact rollback paths in the public error', async () => {
    const { mgr, inputPath, tmpDir } = await openSession(['Synthetic'], { mgr: createTestSessionManager() });
    const canonicalDir = await fs.realpath(tmpDir);
    const clean = path.join(canonicalDir, 'clean.docx');
    const tracked = path.join(canonicalDir, 'tracked.docx');
    await fs.writeFile(clean, 'original');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      const destination = String(args[0]);
      if (destination === clean || destination === tracked) {
        let attempt = 0;
        const write = handle.write.bind(handle);
        vi.spyOn(handle, 'write').mockImplementation((async (...writeArgs: unknown[]) => {
          if (destination === tracked || attempt++ > 0) throw new Error('injected recovery failure');
          return (write as (...args: unknown[]) => Promise<unknown>)(...writeArgs);
        }) as never);
      }
      return handle;
    });
    const result = await save(mgr, { file_path: inputPath, save_to_local_path: clean, tracked_save_to_local_path: tracked });
    assertFailure(result, 'SAVE_ERROR');
    const failures = result.rollback_failures as { path: string; backup_path: string }[];
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe(await fs.realpath(clean));
    expect(await fs.readFile(failures[0]!.backup_path, 'utf8')).toBe('original');
    expect(result.error.message).toContain(failures[0]!.backup_path);
  });
});
