import { afterEach, describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DocxZip } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { assertFailure, assertSuccess, createTestSessionManager, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { isDocxSession, type SaveCacheEntry } from '../session/manager.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';

const TEST_FEATURE = 'discriminate-save-artifacts';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

async function fixture() {
  const opened = await openSession(['Hello World'], { mgr: createTestSessionManager({ defaultAiAuthor: 'SafeDocX' }) });
  const session = opened.mgr.getSessionByPath(await fs.realpath(opened.inputPath));
  if (!session || !isDocxSession(session)) throw new Error('Missing DOCX session');
  assertSuccess(await replaceText(opened.mgr, {
    file_path: opened.inputPath, target_paragraph_id: opened.firstParaId,
    old_string: 'Hello', new_string: 'First', instruction: 'initial tracked edit',
  }), 'initial tracked edit');
  return { ...opened, session };
}

async function xmlAt(filePath: string) {
  return (await DocxZip.load(await fs.readFile(filePath))).readText('word/document.xml');
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('save artifact contracts', () => {
  registerCleanup();
  afterEach(() => vi.restoreAllMocks());

  for (const format of ['clean', 'tracked', 'both'] as const) {
    test.openspec('Format compatibility and cache reuse')(`${format} writes every requested artifact and reuses identical cached bytes`, async () => {
      const { mgr, inputPath, tmpDir } = await fixture();
      const params = { file_path: inputPath, save_format: format };
      const first = await save(mgr, { ...params, save_to_local_path: path.join(tmpDir, 'first.docx') });
      assertSuccess(first, 'first save');
      expect(first.cache_hit).toBe(false);
      const second = await save(mgr, { ...params, save_to_local_path: path.join(tmpDir, 'second.docx') });
      assertSuccess(second, 'cached save');
      expect(second.cache_hit).toBe(true);
      expect(second.exported_at_utc).toBe(first.exported_at_utc);
      expect(second.revisions).toEqual(first.revisions);
      expect(second.tracked_changes_stats).toEqual(first.tracked_changes_stats);
      expect(await fs.readFile(String(second.saved_to))).toEqual(await fs.readFile(String(first.saved_to)));
      expect(first.size_bytes).toBe((await fs.stat(String(first.saved_to))).size);
      expect(first.returned_variants).toEqual(format === 'both' ? ['clean', 'redline'] : [format === 'clean' ? 'clean' : 'redline']);
      if (format === 'clean') {
        expect(first.tracked_saved_to).toBeNull();
        expect(first.tracked_size_bytes).toBeUndefined();
        expect(first.tracked_changes_stats).toBeUndefined();
        expect(await xmlAt(String(first.saved_to))).not.toContain('<w:ins');
      } else {
        expect(first.tracked_changes_stats).toEqual({ insertions: 1, deletions: 1, modifications: 0 });
        expect(first.tracked_size_bytes).toBe((await fs.stat(String(first.tracked_saved_to))).size);
        expect(await xmlAt(String(first.tracked_saved_to))).toContain('<w:ins');
        expect(await fs.readFile(String(second.tracked_saved_to))).toEqual(await fs.readFile(String(first.tracked_saved_to)));
      }
    });
  }

  const selections = [
    { params: {}, format: 'both', source: 'default_both' },
    { params: { track_changes: false }, format: 'clean', source: 'track_changes_alias' },
    { params: { track_changes: true }, format: 'tracked', source: 'track_changes_alias' },
    { params: { tracked_save_to_local_path: 'redline.docx', track_changes: false }, format: 'both', source: 'tracked_save_to_local_path', warning: true },
    { params: { save_format: 'clean' as const, tracked_save_to_local_path: 'redline.docx', track_changes: true }, format: 'clean', source: 'save_format' },
    { params: { save_format: 'tracked' as const, track_changes: false }, format: 'tracked', source: 'save_format' },
  ];
  for (const [index, selection] of selections.entries()) {
    test(`format precedence and aliases case ${index}`, async () => {
      const { mgr, inputPath, tmpDir } = await fixture();
      const result = await save(mgr, {
        file_path: inputPath, save_to_local_path: path.join(tmpDir, 'output.docx'),
        ...selection.params,
        ...(selection.params.tracked_save_to_local_path ? { tracked_save_to_local_path: path.join(tmpDir, 'redline.docx') } : {}),
      });
      assertSuccess(result, 'save');
      expect(result.save_format).toBe(selection.format);
      expect(result.format_source).toBe(selection.source);
      expect(Boolean(result.parameter_warning)).toBe(Boolean(selection.warning));
    });
  }

  for (const format of ['tracked', 'both'] as const) {
    for (const missing of ['revisedBuffer', 'trackedBuffer', 'trackedStats', 'format'] as const) {
      test.openspec('Requested cached artifact is missing')(`${format} rejects corrupted cache ${missing} before writing any file`, async () => {
        const { mgr, session, inputPath, tmpDir } = await fixture();
        assertSuccess(await save(mgr, {
          file_path: inputPath, save_to_local_path: path.join(tmpDir, 'first.docx'), save_format: format,
        }), 'warm cache');
        const entry = [...session.saveCache.values()][0]!;
        session.saveCache.set(entry.cacheKey, { ...entry, [missing]: null } as unknown as SaveCacheEntry);
        const output = path.join(tmpDir, 'must-not-exist.docx');
        const trackedOutput = path.join(tmpDir, 'redline-must-not-exist.docx');
        const result = await save(mgr, {
          file_path: inputPath, save_to_local_path: output, tracked_save_to_local_path: trackedOutput, save_format: format,
        });
        assertFailure(result, 'SAVE_ERROR');
        await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.stat(trackedOutput)).rejects.toMatchObject({ code: 'ENOENT' });
      });
    }
  }

  test('serialization failure writes no artifact and publishes no cache entry', async () => {
    const { mgr, session, inputPath, tmpDir } = await fixture();
    vi.spyOn(session.doc, 'toAcceptedBuffer').mockRejectedValueOnce(new Error('injected export failure'));
    const output = path.join(tmpDir, 'failed.docx');
    assertFailure(await save(mgr, { file_path: inputPath, save_to_local_path: output }), 'SAVE_ERROR');
    expect(session.saveCache.size).toBe(0);
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('missing freshly generated clean buffer fails before writing either variant', async () => {
    const { mgr, session, inputPath, tmpDir } = await fixture();
    vi.spyOn(session.doc, 'toAcceptedBuffer').mockResolvedValueOnce({
      buffer: undefined as unknown as Buffer, bookmarksRemoved: 0, blocksRestored: 0,
    });
    const output = path.join(tmpDir, 'failed.docx');
    const redline = path.join(tmpDir, 'failed-redline.docx');
    assertFailure(await save(mgr, {
      file_path: inputPath, save_to_local_path: output, tracked_save_to_local_path: redline,
    }), 'SAVE_ERROR');
    expect(session.saveCache.size).toBe(0);
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(redline)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  for (const format of ['clean', 'tracked', 'both'] as const) {
    for (const cacheHit of [false, true]) {
      test.openspec('Mutation overlaps artifact generation')(`${format} ${cacheHit ? 'cached' : 'fresh'} save retains one generation during a concurrent edit`, async () => {
        const { mgr, session, inputPath, tmpDir, firstParaId } = await fixture();
        const revision = session.editRevision;
        const editCount = session.editCount;
        mgr.recordNonRevisionChange(session, { tool: 'add_comment', parts: ['word/comments.xml'], description: 'before capture' });
        if (cacheHit) assertSuccess(await save(mgr, {
          file_path: inputPath, save_to_local_path: path.join(tmpDir, 'warm.docx'), save_format: format,
        }), 'warm cache');
        const entered = deferred();
        const release = deferred();
        const serialize = session.doc.toBuffer.bind(session.doc);
        let paused = false;
        vi.spyOn(session.doc, 'toBuffer').mockImplementation(options => {
          const captured = serialize(options);
          if (paused) return captured;
          paused = true;
          return captured.then(async result => {
            entered.resolve();
            await release.promise;
            return result;
          });
        });
        const saving = save(mgr, {
          file_path: inputPath, save_to_local_path: path.join(tmpDir, 'captured.docx'), save_format: format,
        });
        await entered.promise;
        try {
          assertSuccess(await replaceText(mgr, {
            file_path: inputPath, target_paragraph_id: firstParaId, old_string: 'First', new_string: 'Second', instruction: 'concurrent tracked edit',
          }), 'concurrent edit');
          // Also exercise in-place manifest updates: a shallow array snapshot is insufficient.
          session.nonRevisionManifest[0]!.parts.push('word/late.xml');
          mgr.recordNonRevisionChange(session, { tool: 'add_comment', parts: ['word/comments.xml'], description: 'after capture' });
        } finally { release.resolve(); }
        const result = await saving;
        assertSuccess(result, 'captured save');
        expect(result.cache_hit).toBe(cacheHit);
        expect(result.edit_revision).toBe(revision);
        expect(result.edit_count).toBe(editCount);
        expect(result.non_revision_changes).toEqual([
          { tool: 'add_comment', parts: ['word/comments.xml'], description: 'before capture', editRevision: revision },
        ]);
        expect(session.saveCache.size).toBe(0);
        const xml = await xmlAt(String(result.saved_to));
        expect(xml).toContain('First');
        expect(xml).not.toContain('Second');
        if (format !== 'clean') {
          expect(result.tracked_changes_stats).toEqual({ insertions: 1, deletions: 1, modifications: 0 });
          expect(await xmlAt(String(result.tracked_saved_to))).not.toContain('Second');
        }
        const next = await save(mgr, {
          file_path: inputPath, save_to_local_path: path.join(tmpDir, 'current.docx'), save_format: format,
        });
        assertSuccess(next, 'current save');
        expect(next.cache_hit).toBe(false);
        expect(next.edit_revision).toBe(session.editRevision);
        expect(await xmlAt(String(next.saved_to))).toContain('Second');
      });
    }
  }
});

