import { afterEach, describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { testAllure } from '../testing/allure-test.js';
import { createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { publishSaveOutputs, SavePublicationError } from './save_publication.js';

const TEST_FEATURE = 'stage-save-publication';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

async function fixture(existing: readonly boolean[] = [true, true]) {
  const root = await fs.realpath(await createTrackedTempDir('save-publication-'));
  const outputs = [0, 1].map(i => ({ destination: path.join(root, `dir-${i}`, 'output.docx'), buffer: Buffer.from(`new-${i}`) }));
  for (const [i, output] of outputs.entries()) {
    await fs.mkdir(path.dirname(output.destination));
    if (existing[i]) await fs.writeFile(output.destination, `old-${i}`);
  }
  const originals = await Promise.all(outputs.map(output => fs.stat(output.destination).catch(() => null)));
  return { root, outputs, originals };
}

async function assertRestored(outputs: Awaited<ReturnType<typeof fixture>>['outputs'], existing: readonly boolean[], originals?: (Stats | null)[]) {
  for (const [i, output] of outputs.entries()) {
    if (existing[i]) expect(await fs.readFile(output.destination, 'utf8')).toBe(`old-${i}`);
    else await expect(fs.stat(output.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(path.dirname(output.destination))).toEqual(existing[i] ? ['output.docx'] : []);
    if (originals?.[i]) expect(await fs.stat(output.destination)).toMatchObject({ ino: originals[i]!.ino, dev: originals[i]!.dev, uid: originals[i]!.uid, gid: originals[i]!.gid, mode: originals[i]!.mode });
  }
}

function interceptWrites(
  destinations: string[],
  fault: (index: number, attempt: number, perform: (length?: number) => Promise<unknown>) => Promise<unknown>,
) {
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    const index = destinations.indexOf(String(args[0]));
    if (index >= 0) {
      const write = handle.write.bind(handle);
      let attempt = 0;
      vi.spyOn(handle, 'write').mockImplementation((async (buffer: Buffer, offset: number, length: number, position: number) =>
        fault(index, attempt++, limit => write(buffer, offset, limit ?? length, position))) as never);
    }
    return handle;
  });
}

describe('bounded filesystem save publication', () => {
  registerCleanup();
  afterEach(() => vi.restoreAllMocks());

  for (const existing of [[true, true], [false, false], [true, false], [false, true]]) {
    test.openspec('Successful paired publication')(`publishes exact bytes in separate directories; originals ${existing}`, async () => {
      const { outputs, originals } = await fixture(existing);
      expect(await publishSaveOutputs(outputs)).toEqual([]);
      for (const [i, output] of outputs.entries()) {
        expect(await fs.readFile(output.destination)).toEqual(output.buffer);
        expect(await fs.readdir(path.dirname(output.destination))).toEqual(['output.docx']);
        if (originals[i]) expect(await fs.stat(output.destination)).toMatchObject({ ino: originals[i]!.ino, dev: originals[i]!.dev, uid: originals[i]!.uid, gid: originals[i]!.gid, mode: originals[i]!.mode });
      }
    });
  }

  for (const phase of ['mkdir', 'mkdtemp', 'stage', 'backup-verify', 'backup', 'publish'] as const) {
    for (const failedIndex of [0, 1]) {
      const variants = phase === 'backup-verify' || phase === 'backup' ? [[true, true]] : [[true, true], [false, false], [true, false], [false, true]];
      for (const existing of variants) {
        test.openspec('Staging and publication recovery')(`${phase} ${failedIndex + 1} failure restores exact originals ${existing}`, async () => {
          const { outputs, originals } = await fixture(existing);
          if (phase === 'publish') {
            interceptWrites(outputs.map(output => output.destination), async (index, attempt, perform) => {
              if (index === failedIndex && attempt === 0) { await perform(1); throw new Error('partial publication rejected'); }
              return perform();
            });
          } else {
            const method = phase === 'stage' || phase === 'backup' ? 'writeFile' : phase === 'backup-verify' ? 'readFile' : phase;
            const real = fs[method].bind(fs) as (...args: unknown[]) => Promise<unknown>;
            let calls = 0;
            vi.spyOn(fs, method).mockImplementation((async (...args: unknown[]) => {
              const selected = method === 'mkdir' || method === 'mkdtemp' || String(args[0]).endsWith(phase === 'stage' ? '/staged' : '/original');
              if (selected && calls++ === failedIndex) {
                if (method === 'writeFile') await real(args[0], Buffer.from('partial'));
                if (phase === 'backup-verify') return Buffer.from('incomplete backup');
                throw new Error(`injected ${phase} ${failedIndex}`);
              }
              return real(...args);
            }) as never);
          }
          await expect(publishSaveOutputs(outputs)).rejects.toMatchObject({ rollbackFailures: [] });
          await assertRestored(outputs, existing, originals);
        });
      }
    }
  }

  test.openspec('Destination preflight')('rejects lexical aliases and inode aliases before staging', async () => {
    for (const kind of ['same', 'hardlink']) {
      const { outputs } = await fixture();
      if (kind === 'same') outputs[1]!.destination = path.join(path.dirname(outputs[0]!.destination), '.', 'output.docx');
      else {
        await fs.unlink(outputs[1]!.destination);
        await fs.link(outputs[0]!.destination, outputs[1]!.destination);
      }
      const spy = vi.spyOn(fs, 'mkdtemp');
      await expect(publishSaveOutputs(outputs)).rejects.toMatchObject({ code: 'ALIASED_OUTPUT_PATHS' });
      expect(spy).not.toHaveBeenCalled();
      expect(await fs.readFile(outputs[0]!.destination, 'utf8')).toBe('old-0');
      spy.mockRestore();
    }
  });

  test.openspec('Destination preflight')('rejects an unrelated hardlink, directory, or unwritable second target before staging', async () => {
    for (const kind of ['hardlink', 'directory', 'permission']) {
      const { outputs, root } = await fixture();
      if (kind === 'hardlink') await fs.link(outputs[1]!.destination, path.join(root, 'third-link'));
      if (kind === 'directory') { await fs.unlink(outputs[1]!.destination); await fs.mkdir(outputs[1]!.destination); }
      if (kind === 'permission') {
        const access = fs.access.bind(fs);
        vi.spyOn(fs, 'access').mockImplementation(async (name, mode) => {
          if (String(name) === outputs[1]!.destination) throw Object.assign(new Error('injected denied'), { code: 'EACCES' });
          return access(name, mode);
        });
      }
      const stage = vi.spyOn(fs, 'mkdtemp');
      await expect(publishSaveOutputs(outputs)).rejects.toThrow();
      expect(stage).not.toHaveBeenCalled();
      expect(await fs.readFile(outputs[0]!.destination, 'utf8')).toBe('old-0');
      vi.restoreAllMocks();
    }
  });

  for (const parentKind of ['none', 'missing', 'existing']) {
    test.openspec('Destination preflight')(`uses actual filesystem name rules for absent case-alias outputs with ${parentKind} parents`, async () => {
      const { root } = await fixture([false, false]);
      // Independently observe this volume. On case-sensitive CI both outputs must
      // succeed; on this case-insensitive Mac they must be rejected, not merged.
      const marker = path.join(root, 'CaseSensitivity');
      await fs.writeFile(marker, 'probe', { flag: 'wx' });
      const caseSensitive = !(await fs.stat(path.join(root, 'casesensitivity')).then(() => true, () => false));
      await fs.unlink(marker);
      if (parentKind === 'existing') await fs.mkdir(path.join(root, 'NewParent'));
      const destinations = parentKind !== 'none'
        ? [path.join(root, 'NewParent', 'output.docx'), path.join(root, 'newparent', 'output.docx')]
        : [path.join(root, 'Clean.docx'), path.join(root, 'clean.docx')];
      const outputs = destinations.map((destination, i) => ({ destination, buffer: Buffer.from(`case-${i}`) }));
      const before = await fs.readdir(root);
      const rename = vi.spyOn(fs, 'rename');
      if (caseSensitive) {
        expect(await publishSaveOutputs(outputs)).toEqual([]);
        for (const [i, destination] of destinations.entries()) expect(await fs.readFile(destination, 'utf8')).toBe(`case-${i}`);
      } else {
        await expect(publishSaveOutputs(outputs)).rejects.toMatchObject({ code: 'ALIASED_OUTPUT_PATHS' });
        expect(rename).not.toHaveBeenCalled();
        expect(await fs.readdir(root)).toEqual(before);
        for (const destination of destinations) await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
      }
    });
  }

  test.openspec('Destination preflight')('allows distinct names in a shared missing parent and removes all private probes', async () => {
    const { root } = await fixture([false, false]);
    const outputs = ['clean.docx', 'tracked.docx'].map(name => ({ destination: path.join(root, 'new', name), buffer: Buffer.from(name) }));
    expect(await publishSaveOutputs(outputs)).toEqual([]);
    for (const output of outputs) expect(await fs.readFile(output.destination)).toEqual(output.buffer);
    expect(await fs.readdir(path.join(root, 'new'))).toEqual(['clean.docx', 'tracked.docx']);
    expect((await fs.readdir(root)).some(name => name.startsWith('.safe-docx-'))).toBe(false);
  });

  for (const operation of ['open', 'unlink', 'rmdir'] as const) {
    test.openspec('Recovery needs attention')(`alias probe ${operation} failure preserves destinations and reports surviving probe paths`, async () => {
      const { root } = await fixture([false, false]);
      const outputs = ['clean.docx', 'tracked.docx'].map(name => ({ destination: path.join(root, name), buffer: Buffer.from(name) }));
      const rename = vi.spyOn(fs, 'rename');
      if (operation === 'open') {
        const open = fs.open.bind(fs);
        let count = 0;
        vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
          if (count++ === 1) throw new Error('injected probe open failure');
          return open(...args);
        });
        await expect(publishSaveOutputs(outputs)).rejects.toThrow('injected probe open failure');
        expect((await fs.readdir(root)).some(name => name.startsWith('.safe-docx-'))).toBe(false);
      } else {
        const real = fs[operation].bind(fs);
        vi.spyOn(fs, operation).mockImplementation(async (target: Parameters<typeof fs.unlink>[0]) => {
          if (String(target).includes('.safe-docx-probe-')) throw new Error('injected probe cleanup failure');
          return real(target);
        });
        const error = await publishSaveOutputs(outputs).catch(e => e) as SavePublicationError;
        expect(error).toBeInstanceOf(SavePublicationError);
        expect(error.rollbackFailures.length).toBeGreaterThan(0);
        for (const failure of error.rollbackFailures) {
          expect(failure.path).toContain('.safe-docx-probe-');
          expect(error.message).toContain(failure.path);
          expect(await fs.stat(failure.path)).toBeTruthy();
        }
      }
      expect(rename).not.toHaveBeenCalled();
      for (const output of outputs) await expect(fs.stat(output.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }

  test.openspec('Destination preflight')('refuses special-file stat shapes before backup and leaves original bytes untouched', async () => {
    const { outputs } = await fixture();
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation((async (target: Parameters<typeof fs.lstat>[0]) => {
      const info = await lstat(target);
      return String(target) === outputs[1]!.destination ? Object.assign(Object.create(info), { isFile: () => false }) : info;
    }) as typeof fs.lstat);
    const rename = vi.spyOn(fs, 'rename');
    await expect(publishSaveOutputs(outputs)).rejects.toThrow('not a regular file');
    expect(rename).not.toHaveBeenCalled();
    await assertRestored(outputs, [true, true]);
  });

  test.openspec('Destination preflight')('preserves modes and does not overwrite a read-only file through writable parent permissions', async () => {
    const { outputs } = await fixture();
    await fs.chmod(outputs[0]!.destination, 0o640);
    await fs.chmod(outputs[1]!.destination, 0o600);
    await publishSaveOutputs(outputs);
    expect((await fs.stat(outputs[0]!.destination)).mode & 0o777).toBe(0o640);
    expect((await fs.stat(outputs[1]!.destination)).mode & 0o777).toBe(0o600);
    if (process.getuid?.() !== 0 && process.platform !== 'win32') {
      await fs.chmod(outputs[1]!.destination, 0o400);
      await expect(publishSaveOutputs(outputs)).rejects.toMatchObject({ code: 'EACCES' });
      expect(await fs.readFile(outputs[0]!.destination)).toEqual(outputs[0]!.buffer);
    }
  });

  test.openspec('Successful paired publication')('keeps existing inode, ownership, modes and native Mac ACL/xattrs while replacing shorter and longer bytes', async () => {
    const { outputs } = await fixture();
    outputs[0]!.buffer = Buffer.from('x');
    outputs[1]!.buffer = Buffer.alloc(100, 'y');
    await fs.chmod(outputs[0]!.destination, 0o640);
    const before = await Promise.all(outputs.map(output => fs.stat(output.destination)));
    const native = process.platform === 'darwin';
    const attribute = 'com.usejunior.save-publication-test';
    const acl = (destination: string) => execFileSync('/bin/ls', ['-le', destination], { encoding: 'utf8' }).split('\n').filter(line => /^\s*\d+:/.test(line)).join('\n');
    let originalAcl = '';
    try {
      if (native) {
        execFileSync('/usr/bin/xattr', ['-w', attribute, 'security-metadata-sentinel', outputs[0]!.destination]);
        execFileSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;00000000;SafeDocxSynthetic;', outputs[0]!.destination]);
        execFileSync('/bin/chmod', ['+a', 'everyone deny execute', outputs[0]!.destination]);
        originalAcl = acl(outputs[0]!.destination);
        expect(originalAcl).toContain('deny execute');
      }
      expect(await publishSaveOutputs(outputs)).toEqual([]);
      for (const [i, output] of outputs.entries()) {
        expect(await fs.readFile(output.destination)).toEqual(output.buffer);
        expect(await fs.stat(output.destination)).toMatchObject({ ino: before[i]!.ino, dev: before[i]!.dev, uid: before[i]!.uid, gid: before[i]!.gid, mode: before[i]!.mode });
      }
      interceptWrites(outputs.map(output => output.destination), async (index, attempt, perform) => {
        if (index === 1 && attempt === 0) { await perform(1); throw new Error('metadata rollback probe'); }
        return perform();
      });
      await expect(publishSaveOutputs(outputs.map(output => ({ ...output, buffer: Buffer.from('replacement-not-to-keep') })))).rejects.toMatchObject({ rollbackFailures: [] });
      for (const [i, output] of outputs.entries()) {
        expect(await fs.readFile(output.destination)).toEqual(output.buffer);
        expect(await fs.stat(output.destination)).toMatchObject({ ino: before[i]!.ino, dev: before[i]!.dev, uid: before[i]!.uid, gid: before[i]!.gid, mode: before[i]!.mode });
      }
      if (native) {
        expect(execFileSync('/usr/bin/xattr', ['-p', attribute, outputs[0]!.destination], { encoding: 'utf8' }).trim()).toBe('security-metadata-sentinel');
        expect(execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', outputs[0]!.destination], { encoding: 'utf8' }).trim()).toBe('0081;00000000;SafeDocxSynthetic;');
        expect(acl(outputs[0]!.destination)).toBe(originalAcl);
      }
    } finally {
      if (native) execFileSync('/bin/chmod', ['-N', outputs[0]!.destination]);
    }
  });

  test.openspec('Staging and publication recovery')('exclusive new-output creation never overwrites or removes a file created after preflight', async () => {
    const { outputs, originals } = await fixture([true, false]);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === outputs[1]!.destination && args[1] === 'wx') await fs.writeFile(outputs[1]!.destination, 'unexpected-owner-bytes', { flag: 'wx' });
      return open(...args);
    });
    await expect(publishSaveOutputs(outputs)).rejects.toMatchObject({ rollbackFailures: [] });
    expect(await fs.readFile(outputs[0]!.destination, 'utf8')).toBe('old-0');
    expect((await fs.stat(outputs[0]!.destination)).ino).toBe(originals[0]!.ino);
    expect(await fs.readFile(outputs[1]!.destination, 'utf8')).toBe('unexpected-owner-bytes');
    for (const output of outputs) expect(await fs.readdir(path.dirname(output.destination))).toEqual(['output.docx']);
  });

  for (const failedIndex of [0, 1]) {
    test.openspec('Staging and publication recovery')(`truncate ${failedIndex + 1} failure after bytes changed restores both existing inodes and contents`, async () => {
      const { outputs, originals } = await fixture();
      const open = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await open(...args);
        if (String(args[0]) === outputs[failedIndex]!.destination) {
          const truncate = handle.truncate.bind(handle);
          vi.spyOn(handle, 'truncate').mockRejectedValueOnce(new Error('injected truncate failure')).mockImplementation(truncate);
        }
        return handle;
      });
      await expect(publishSaveOutputs(outputs)).rejects.toMatchObject({ rollbackFailures: [] });
      await assertRestored(outputs, [true, true], originals);
    });
  }

  for (const failedIndex of [0, 1]) {
    test.openspec('Recovery needs attention')(`partial existing publication ${failedIndex + 1} followed by failed restore retains verified original bytes`, async () => {
      const { outputs, originals } = await fixture();
      interceptWrites(outputs.map(output => output.destination), async (index, attempt, perform) => {
        if (index === failedIndex) {
          if (attempt === 0) { await perform(1); throw new Error('partial write rejected'); }
          throw new Error('restore rejected');
        }
        return perform();
      });
      const error = await publishSaveOutputs(outputs).catch(e => e) as SavePublicationError;
      expect(error.rollbackFailures).toHaveLength(1);
      const failure = error.rollbackFailures[0]!;
      expect(failure).toMatchObject({ path: outputs[failedIndex]!.destination, operation: 'restore-original' });
      expect(error.message).toContain(failure.backup_path);
      expect(await fs.readFile(failure.backup_path!, 'utf8')).toBe(`old-${failedIndex}`);
      for (const [i, output] of outputs.entries()) {
        expect(await fs.readFile(output.destination, 'utf8')).toBe(i === failedIndex ? `nld-${i}` : `old-${i}`);
        expect((await fs.stat(output.destination)).ino).toBe(originals[i]!.ino);
      }
    });
  }

  for (const noProgress of [false, true]) {
    test.openspec('Staging and publication recovery')(`${noProgress ? 'zero' : 'short'} writes ${noProgress ? 'restore' : 'publish'} exact bytes without replacing inodes`, async () => {
      const { outputs, originals } = await fixture();
      interceptWrites(outputs.map(output => output.destination), async (_index, attempt, perform) => {
        if (noProgress && attempt === 0) return { bytesWritten: 0 };
        return perform(1);
      });
      if (noProgress) {
        await expect(publishSaveOutputs(outputs)).rejects.toMatchObject({ rollbackFailures: [] });
        await assertRestored(outputs, [true, true], originals);
      } else {
        expect(await publishSaveOutputs(outputs)).toEqual([]);
        for (const [i, output] of outputs.entries()) {
          expect(await fs.readFile(output.destination)).toEqual(output.buffer);
          expect((await fs.stat(output.destination)).ino).toBe(originals[i]!.ino);
        }
      }
    });
  }

  for (const existing of [[true, true], [false, false]]) {
    test.openspec('Recovery needs attention')(`retains exact recovery paths when restoration/removal fails; originals ${existing}`, async () => {
      const { outputs } = await fixture(existing);
      const unlink = fs.unlink.bind(fs);
      const writeFile = fs.writeFile.bind(fs);
      let backupPath: string | undefined;
      vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
        if (String(args[0]).includes('/dir-0/') && String(args[0]).endsWith('/original')) backupPath = String(args[0]);
        return writeFile(...args);
      });
      interceptWrites(outputs.map(output => output.destination), async (index, attempt, perform) => {
        if (index === 1 && attempt === 0) { await perform(1); throw new Error('second publish failed after partial write'); }
        if (existing[0] && index === 0 && attempt > 0) throw new Error('restore failed');
        return perform();
      });
      vi.spyOn(fs, 'unlink').mockImplementation(async target => {
        if (!existing[0] && String(target) === outputs[0]!.destination) throw new Error('remove new failed');
        return unlink(target);
      });
      const error = await publishSaveOutputs(outputs).catch(e => e) as SavePublicationError;
      expect(error).toBeInstanceOf(SavePublicationError);
      expect(error.rollbackFailures).toHaveLength(1);
      expect(error.rollbackFailures[0]).toMatchObject({ path: outputs[0]!.destination,
        operation: existing[0] ? 'restore-original' : 'remove-new-output',
        ...(existing[0] ? { backup_path: backupPath } : {}) });
      expect(error.message).toContain(outputs[0]!.destination);
      expect(await fs.readFile(outputs[0]!.destination)).toEqual(outputs[0]!.buffer);
      if (existing[0]) {
        expect(error.message).toContain(backupPath);
        expect(await fs.readFile(backupPath!, 'utf8')).toBe('old-0');
        expect(await fs.readFile(outputs[1]!.destination, 'utf8')).toBe('old-1');
      } else await expect(fs.stat(outputs[1]!.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }

  for (const operation of ['unlink', 'rmdir'] as const) {
    test.openspec('Recovery needs attention')(`reports exact surviving staging path when ${operation} cleanup fails`, async () => {
      const { outputs } = await fixture();
      interceptWrites(outputs.map(output => output.destination), async (index, attempt, perform) => {
        if (index === 0 && attempt === 0) throw new Error('publish failed');
        return perform();
      });
      const real = fs[operation].bind(fs);
      vi.spyOn(fs, operation).mockImplementation(async (target: Parameters<typeof fs.unlink>[0]) => {
        if (String(target).includes('/dir-0/.safe-docx-save-') && (operation === 'rmdir' || String(target).endsWith('/staged'))) throw new Error('cleanup failed');
        return real(target);
      });
      const error = await publishSaveOutputs(outputs).catch(e => e) as SavePublicationError;
      expect(error.rollbackFailures).toHaveLength(1);
      const failure = error.rollbackFailures[0]!;
      expect(failure.operation).toBe(operation === 'unlink' ? 'remove-stage' : 'remove-staging-directory');
      expect(failure.path).toContain('/dir-0/.safe-docx-save-');
      expect(error.message).toContain(failure.path);
      expect(await fs.stat(failure.path)).toBeTruthy();
      for (const [i, output] of outputs.entries()) expect(await fs.readFile(output.destination, 'utf8')).toBe(`old-${i}`);
    });
  }

  test.openspec('Successful paired publication')('reports retained backup after committed cleanup failure without rolling back either output', async () => {
    const { outputs } = await fixture();
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (String(target).endsWith('/original')) throw new Error('backup cleanup failed');
      return unlink(target);
    });
    const failures = await publishSaveOutputs(outputs);
    expect(failures).toHaveLength(2);
    for (const [i, failure] of failures.entries()) {
      expect(failure.operation).toBe('remove-backup');
      expect(await fs.readFile(failure.path, 'utf8')).toBe(`old-${i}`);
      expect(await fs.readFile(outputs[i]!.destination)).toEqual(outputs[i]!.buffer);
    }
  });
});
