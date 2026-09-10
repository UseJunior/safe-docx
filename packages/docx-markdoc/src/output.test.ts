import { describe, expect } from 'vitest';
import { itAllure as it } from '../../docx-core/src/testing/allure-test.js';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeNewFiles } from './output.js';

describe('exclusive Markdoc output', () => {
  it('preserves existing files and rolls back all newly reserved siblings on a late collision', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'markdoc-output-'));
    try {
      const existing = path.join(dir, 'verification.json');
      await writeFile(existing, 'prior certificate');
      await expect(writeNewFiles([[path.join(dir, 'clean.docx'), 'clean'], [path.join(dir, 'redline.docx'), 'tracked'], [existing, 'new certificate']])).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readdir(dir)).toEqual(['verification.json']);
      expect(await readFile(existing, 'utf8')).toBe('prior certificate');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses symlink destinations and aliased output paths', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'markdoc-output-'));
    try {
      const source = path.join(dir, 'source.docx');
      const link = path.join(dir, 'link.docx');
      await writeFile(source, 'original');
      await symlink(source, link);
      await expect(writeNewFiles([[link, 'overwrite']])).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(source, 'utf8')).toBe('original');
      const same = path.join(dir, 'same.docx');
      await expect(writeNewFiles([[same, 'one'], [same, 'two']])).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readdir(dir)).toEqual(['link.docx', 'source.docx']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('writes a complete set to new paths', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'markdoc-output-'));
    try {
      await writeNewFiles([[path.join(dir, 'one'), 'clean'], [path.join(dir, 'two'), Buffer.from('tracked')]]);
      expect(await readFile(path.join(dir, 'one'), 'utf8')).toBe('clean');
      expect(await readFile(path.join(dir, 'two'), 'utf8')).toBe('tracked');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
