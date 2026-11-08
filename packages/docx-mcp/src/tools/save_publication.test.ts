import { afterEach, describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure } from '../testing/allure-test.js';
import { createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { publishSaveOutputs, SavePublicationError } from './save_publication.js';

const TEST_FEATURE = 'stage-save-publication';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

async function fixture(existing: readonly boolean[] = [true, true]) {
  const root = await createTrackedTempDir('save-publication-');
  const outputs = [0, 1].map(i => ({ destination: path.join(root, `dir-${i}`, 'output.docx'), buffer: Buffer.from(`new-${i}`) }));
  for (const [i, output] of outputs.entries()) {
    await fs.mkdir(path.dirname(output.destination));
    if (existing[i]) await fs.writeFile(output.destination, `old-${i}`);
  }
  return { root, outputs };
}

async function assertRestored(outputs: Awaited<ReturnType<typeof fixture>>['outputs'], existing: readonly boolean[]) {
  for (const [i, output] of outputs.entries()) {
    if (existing[i]) expect(await fs.readFile(output.destination, 'utf8')).toBe(`old-${i}`);
    else await expect(fs.stat(output.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(path.dirname(output.destination))).toEqual(existing[i] ? ['output.docx'] : []);
  }
}

describe('bounded filesystem save publication', () => {
  registerCleanup();
  afterEach(() => vi.restoreAllMocks());

  for (const existing of [[true, true], [false, false], [true, false], [false, true]]) {
    test.openspec('Successful paired publication')(`publishes exact bytes in separate directories; originals ${existing}`, async () => {
      const { outputs } = await fixture(existing);
      expect(await publishSaveOutputs(outputs)).toEqual([]);
      for (const output of outputs) {
        expect(await fs.readFile(output.destination)).toEqual(output.buffer);
        expect(await fs.readdir(path.dirname(output.destination))).toEqual(['output.docx']);
      }
    });
  }

  for (const phase of ['mkdir', 'mkdtemp', 'writeFile', 'chmod', 'backup', 'publish'] as const) {
    for (const failedIndex of [0, 1]) {
      const variants = phase === 'chmod' || phase === 'backup' ? [[true, true]] : [[true, true], [false, false], [true, false], [false, true]];
      for (const existing of variants) {
        test.openspec('Staging and publication recovery')(`${phase} ${failedIndex + 1} failure restores exact originals ${existing}`, async () => {
          const { outputs } = await fixture(existing);
          const method = phase === 'backup' || phase === 'publish' ? 'rename' : phase;
          const real = fs[method].bind(fs) as (...args: unknown[]) => Promise<unknown>;
          let calls = 0;
          // Only the requested phase fails once; recovery uses real filesystem IO.
          vi.spyOn(fs, method).mockImplementation((async (...args: unknown[]) => {
            const selected = method !== 'rename' || (phase === 'backup'
              ? String(args[1]).endsWith('/original') : String(args[0]).endsWith('/staged'));
            if (selected && calls++ === failedIndex) {
              // Exercise cleanup of bytes left by an interrupted stage write.
              if (phase === 'writeFile') await real(args[0], Buffer.from('partial'));
              throw new Error(`injected ${phase} ${failedIndex}`);
            }
            return real(...args);
          }) as never);
          await expect(publishSaveOutputs(outputs)).rejects.toMatchObject({ rollbackFailures: [] });
          await assertRestored(outputs, existing);
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

  for (const existing of [[true, true], [false, false]]) {
    test.openspec('Recovery needs attention')(`retains exact recovery paths when restoration/removal fails; originals ${existing}`, async () => {
      const { outputs } = await fixture(existing);
      const rename = fs.rename.bind(fs);
      const unlink = fs.unlink.bind(fs);
      let backupPath: string | undefined;
      vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (String(to).endsWith('/original') && String(from) === outputs[0]!.destination) backupPath = String(to);
        if (String(from).endsWith('/staged') && String(to) === outputs[1]!.destination) throw new Error('second publish failed');
        if (String(from) === backupPath) throw new Error('restore failed');
        return rename(from, to);
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
      const rename = fs.rename.bind(fs);
      vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (String(from).endsWith('/staged')) throw new Error('publish failed');
        return rename(from, to);
      });
      const real = fs[operation].bind(fs);
      vi.spyOn(fs, operation).mockImplementation(async target => {
        if (String(target).includes('/dir-0/.safe-docx-save-')) throw new Error('cleanup failed');
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
