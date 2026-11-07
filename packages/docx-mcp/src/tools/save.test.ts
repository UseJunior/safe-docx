import { describe, expect } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { save } from './save.js';
import { SessionManager } from '../session/manager.js';
import { openDocument } from './open_document.js';
import { grep } from './grep.js';
import { replaceText } from './replace_text.js';
import {
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { buildDocxFromParts, DocxZip, parseXml } from '@usejunior/docx-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const WORDPROCESSING_ML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'update-safe-docx-save-defaults-and-stable-node-ids';

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function xmlEscape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const serializer = new XMLSerializer();
type SerializableXmlNode = Parameters<XMLSerializer['serializeToString']>[0];

async function documentXmlFromDocx(pathToDocx: string): Promise<string> {
  const zip = await DocxZip.load(await fs.readFile(pathToDocx) as Buffer);
  return zip.readText('word/document.xml');
}

async function zipText(pathToDocx: string, partPath: string): Promise<string> {
  const zip = await DocxZip.load(await fs.readFile(pathToDocx) as Buffer);
  return zip.readText(partPath);
}

function paragraphXml(documentXml: string, index: number): string {
  const doc = parseXml(documentXml);
  const paragraph = doc.getElementsByTagName('w:p').item(index);
  if (!paragraph) throw new Error(`Missing paragraph ${index}`);
  return serializer.serializeToString(paragraph as unknown as SerializableXmlNode);
}

describe('save', () => {
  registerCleanup();

  const test = testAllure.epic('Document Editing').withLabels({ feature: 'Save' });

  async function openTestDoc(texts: string[] = ['Hello World']) {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('save-test-');
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      texts.map((t) => `<w:p><w:r><w:t>${xmlEscape(t)}</w:t></w:r></w:p>`).join('') +
      `</w:body></w:document>`;
    const buf = await makeDocxWithDocumentXml(documentXml, {
      '[Content_Types].xml': CONTENT_TYPES_XML,
      '_rels/.rels': RELS_XML,
    });
    const filePath = path.join(tmpDir, 'test.docx');
    await fs.writeFile(filePath, new Uint8Array(buf));

    const opened = await openDocument(mgr, { file_path: filePath });
    assertSuccess(opened, 'open');

    return {
      mgr,
      tmpDir,
      inputPath: filePath,
    };
  }

  test('clean save writes a valid .docx', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outPath,
      save_format: 'clean',
    });
    assertSuccess(result, 'clean save');

    const exists = await fs.stat(outPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const fileSize = (await fs.stat(outPath)).size;
    expect(fileSize).toBeGreaterThan(0);
  });

  test('tracked save includes comparison with baseline', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const outPath = path.join(tmpDir, 'tracked-output.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outPath,
      save_format: 'tracked',
      tracked_changes_author: 'Test Author',
    });

    if (!result.success) {
      const errorInfo = (result as Record<string, unknown>).error as Record<string, unknown>;
      expect.soft(errorInfo).toEqual('debug: should not reach');
    }
    assertSuccess(result, 'tracked save');
  });

  /**
   * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
   * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
   * @see #609
   */
  test
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
    )(
      'tracked save preserves run-spanning and paragraph-anchor bookmark pairs by default',
      async () => {
        const mgr = createTestSessionManager();
        const tmpDir = await createTrackedTempDir('save-bookmark-round-trip-');
        const inputPath = path.join(tmpDir, 'bookmark-source.docx');
        const outputPath = path.join(tmpDir, 'bookmark-output.docx');
        const buf = await buildDocxFromParts({
          bodyXml:
            `<w:p w14:paraId="11111111">` +
            `<w:bookmarkStart w:id="41" w:name="edit-contract-term"/>` +
            `<w:r><w:t>Existing </w:t></w:r>` +
            `<w:ins w:id="77" w:author="Reviewer" w:date="2026-07-23T12:00:00Z">` +
            `<w:r><w:t>tracked </w:t></w:r>` +
            `</w:ins>` +
            `<w:r><w:t>text</w:t></w:r>` +
            `<w:bookmarkEnd w:id="41"/>` +
            `<w:bookmarkStart w:id="42" w:name="jr_para_11111111"/>` +
            `<w:bookmarkEnd w:id="42"/>` +
            `</w:p>`,
        });
        await fs.writeFile(inputPath, new Uint8Array(buf));

        const opened = await openDocument(mgr, { file_path: inputPath });
        assertSuccess(opened, 'open');
        const saved = await save(mgr, {
          file_path: inputPath,
          save_to_local_path: outputPath,
          save_format: 'tracked',
        });
        assertSuccess(saved, 'tracked save');

        const output = parseXml(await documentXmlFromDocx(outputPath));
        const starts = Array.from(
          output.getElementsByTagNameNS(WORDPROCESSING_ML_NS, 'bookmarkStart'),
        );
        const ends = Array.from(
          output.getElementsByTagNameNS(WORDPROCESSING_ML_NS, 'bookmarkEnd'),
        );
        const startNamesById = new Map(
          starts.map((start) => [
            start.getAttributeNS(WORDPROCESSING_ML_NS, 'id'),
            start.getAttributeNS(WORDPROCESSING_ML_NS, 'name'),
          ]),
        );
        const endIds = new Set(
          ends.map((end) => end.getAttributeNS(WORDPROCESSING_ML_NS, 'id')),
        );

        expect(startNamesById.get('41')).toBe('edit-contract-term');
        expect(endIds.has('41')).toBe(true);
        expect(startNamesById.get('42')).toBe('jr_para_11111111');
        expect(endIds.has('42')).toBe(true);
        expect(starts).toHaveLength(2);
        expect(ends).toHaveLength(2);
        expect(output.getElementsByTagNameNS(WORDPROCESSING_ML_NS, 'ins')).toHaveLength(1);

        // Parse balanced start/end pairs by name — string absence alone would
        // miss an orphaned bookmarkEnd left behind by a half-removed range.
        const bookmarkNames = async (docxPath: string): Promise<string[]> => {
          const doc = parseXml(await documentXmlFromDocx(docxPath));
          const s = Array.from(doc.getElementsByTagNameNS(WORDPROCESSING_ML_NS, 'bookmarkStart'));
          const e = Array.from(doc.getElementsByTagNameNS(WORDPROCESSING_ML_NS, 'bookmarkEnd'));
          const namesById = new Map(
            s.map((el) => [
              el.getAttributeNS(WORDPROCESSING_ML_NS, 'id'),
              el.getAttributeNS(WORDPROCESSING_ML_NS, 'name'),
            ]),
          );
          for (const end of e) {
            // no orphaned bookmarkEnd
            expect(namesById.has(end.getAttributeNS(WORDPROCESSING_ML_NS, 'id'))).toBe(true);
          }
          expect(s).toHaveLength(e.length);
          return [...namesById.values()].filter((n): n is string => n !== null);
        };

        // Explicit clean_bookmarks:true strips edit-* (and safe-docx _bk_*) while
        // keeping jr_para_*, with no orphaned bookmarkEnd.
        const cleanedOutputPath = path.join(tmpDir, 'bookmark-cleaned-output.docx');
        const cleaned = await save(mgr, {
          file_path: inputPath,
          save_to_local_path: cleanedOutputPath,
          save_format: 'tracked',
          clean_bookmarks: true,
        });
        assertSuccess(cleaned, 'explicit bookmark-cleaning tracked save');
        const cleanedNames = await bookmarkNames(cleanedOutputPath);
        expect(cleanedNames).not.toContain('edit-contract-term');
        expect(cleanedNames).toContain('jr_para_11111111');

        // save_format:'both' is the harness default: the tracked variant must
        // still preserve edit-* (persistence), while the clean deliverable
        // strips it (#609).
        const bothCleanPath = path.join(tmpDir, 'both-clean.docx');
        const bothTrackedPath = path.join(tmpDir, 'both-tracked.docx');
        const both = await save(mgr, {
          file_path: inputPath,
          save_to_local_path: bothCleanPath,
          tracked_save_to_local_path: bothTrackedPath,
          save_format: 'both',
        });
        assertSuccess(both, 'both-mode save');
        const bothTrackedNames = await bookmarkNames(bothTrackedPath);
        expect(bothTrackedNames).toContain('edit-contract-term');
        expect(bothTrackedNames).toContain('jr_para_11111111');
        const bothCleanNames = await bookmarkNames(bothCleanPath);
        expect(bothCleanNames).not.toContain('edit-contract-term');
        expect(bothCleanNames).toContain('jr_para_11111111');
      },
    );

  test('tracked save emits write-time markup and preserves untouched blocks + rels (#126)', async () => {
    const mgr = new SessionManager({ defaultAiAuthor: 'Test Author' });
    const tmpDir = await createTrackedTempDir('save-tracked-minimal-');
    const originalDocumentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">` +
      `<w:body>` +
      `<w:p w14:paraId="11111111"><w:r><w:t>Alpha target text</w:t></w:r></w:p>` +
      `<w:p w14:paraId="22222222" w:rsidR="00AA00AA">` +
      `<w:r w:rsidR="00AA00AA"><w:t>Untouched</w:t></w:r>` +
      `<w:hyperlink r:id="rIdHyperlink">` +
      `<w:r w:rsidR="00AA0001"><w:t>commonpaper.com/standards/mutual-</w:t></w:r>` +
      `<w:r w:rsidR="00AA0002"><w:t>nda</w:t></w:r>` +
      `<w:r w:rsidR="00AA0003"><w:t>/1.0</w:t></w:r>` +
      `</w:hyperlink>` +
      `<w:proofErr w:type="spellStart"/>` +
      `<w:r w:rsidR="00BB00BB"><w:t xml:space="preserve"> paragraph</w:t></w:r>` +
      `<w:proofErr w:type="spellEnd"/>` +
      `</w:p>` +
      `</w:body></w:document>`;
    const buf = await makeDocxWithDocumentXml(originalDocumentXml, {
      '[Content_Types].xml': CONTENT_TYPES_XML,
      '_rels/.rels': RELS_XML,
      'word/_rels/document.xml.rels':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdHyperlink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ` +
        `Target="https://example.com/original" TargetMode="External"/>` +
        `</Relationships>`,
    });
    const inputPath = path.join(tmpDir, 'minimal-redline-source.docx');
    const trackedPath = path.join(tmpDir, 'minimal-redline-output.docx');
    await fs.writeFile(inputPath, new Uint8Array(buf));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const grepRes = await grep(mgr, {
      file_path: inputPath,
      patterns: ['target'],
      max_results: 1,
    });
    assertSuccess(grepRes, 'grep');
    const match = ((grepRes as Record<string, unknown>).matches as Array<{ para_id: string }>)[0];
    expect(match).toBeDefined();
    const editRes = await replaceText(mgr, {
      file_path: inputPath,
      target_paragraph_id: match!.para_id,
      old_string: 'target',
      new_string: 'replacement',
      instruction: 'Replace target with replacement',
    });
    assertSuccess(editRes, 'replace');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: trackedPath,
      save_format: 'tracked',
      tracked_changes_author: 'Test Author',
    });
    assertSuccess(result, 'tracked save');

    const trackedXml = await documentXmlFromDocx(trackedPath);
    const trackedRels = await zipText(trackedPath, 'word/_rels/document.xml.rels');
    // The tracked artifact is the session's write-time markup (#126). The
    // untouched paragraph keeps its content and the hyperlink relationship survives.
    expect(paragraphXml(trackedXml, 1)).toContain('Untouched');
    expect(trackedRels).toContain('Id="rIdHyperlink"');
    expect(trackedRels).toContain('https://example.com/original');

    const editedParagraph = paragraphXml(trackedXml, 0);
    expect(editedParagraph).toContain('<w:ins');
    expect(editedParagraph).toContain('<w:del');
    // Author is the write-time actor (the session AI author), not a comparison param.
    expect(editedParagraph).toContain('w:author="Test Author"');
    // Write-time minimal-diff markup: the deletion covers the removed text and the
    // insertion carries the new text (a shared suffix may fall outside the wrappers).
    expect(editedParagraph).toContain('<w:delText>targe');
    expect(editedParagraph).toContain('replacemen');
  });

  test('both-mode generates two files', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outPath,
      save_format: 'both',
    });
    assertSuccess(result, 'both save');

    // Clean file should exist
    const exists = await fs.stat(outPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    expect((result as Record<string, unknown>).blocks_restored).toBeGreaterThan(0);
  });

  test('reports stats (insertions/deletions/modifications)', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outPath,
      save_format: 'tracked',
    });
    assertSuccess(result, 'save');

    // Response should include tracked stats
    const stats = (result as Record<string, unknown>).tracked_changes_stats;
    if (stats) {
      const s = stats as Record<string, number>;
      expect(typeof s.insertions).toBe('number');
      expect(typeof s.deletions).toBe('number');
    }
  });

  test('rejects invalid save_format', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outPath,
      save_format: 'invalid' as 'clean',
    });
    assertFailure(result, 'INVALID_SAVE_FORMAT', 'bad format');
  });

  test('fails gracefully with non-existent file path', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('save-test-');
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      file_path: '/tmp/does-not-exist-safe-docx.docx',
      save_to_local_path: outPath,
      save_format: 'clean',
    });
    assertFailure(result, undefined, 'missing file');
  });

  test('blocks overwrite of original file without allow_overwrite', async () => {
    const { mgr, inputPath } = await openTestDoc();

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: inputPath,
      save_format: 'clean',
    });
    assertFailure(result, 'OVERWRITE_BLOCKED', 'overwrite blocked');
  });

  test('allows overwrite of original file with allow_overwrite=true', async () => {
    const { mgr, inputPath } = await openTestDoc();

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: inputPath,
      save_format: 'clean',
      allow_overwrite: true,
    });
    assertSuccess(result, 'overwrite allowed');
  });

  test('resolves session by file_path', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const outPath = path.join(tmpDir, 'output.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: outPath,
      save_format: 'clean',
    });
    assertSuccess(result, 'save by file_path');
  });

  // Issue #313: a symlink output_path inside an allowed root that points OUTSIDE all roots must be
  // refused — the policy now follows the final symlink (existing or dangling) instead of judging it at
  // the link's in-root location and letting `fs.writeFile` follow it out.
  test('refuses a symlink save_to_local_path that escapes the allowed roots (existing and dangling)', async () => {
    if (process.platform === 'win32') return;

    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const outsideDir = await createTrackedTempDir('save-outside-');
    const previousRoots = process.env.SAFE_DOCX_ALLOWED_ROOTS;
    process.env.SAFE_DOCX_ALLOWED_ROOTS = tmpDir;
    try {
      // Existing target outside the root.
      const existingTarget = path.join(outsideDir, 'existing.docx');
      await fs.writeFile(existingTarget, 'PRE-EXISTING');
      const existingTargetBytes = await fs.readFile(existingTarget);
      const existingLink = path.join(tmpDir, 'escape-existing.docx');
      await fs.symlink(existingTarget, existingLink);

      const viaExisting = await save(mgr, {
        file_path: inputPath,
        save_to_local_path: existingLink,
        save_format: 'clean',
        allow_overwrite: true,
      });
      assertFailure(viaExisting, 'PATH_NOT_ALLOWED', 'existing symlink escape');
      expect(Buffer.compare(await fs.readFile(existingTarget), existingTargetBytes)).toBe(0);

      // Dangling target outside the root — the case a naive realpath-only fix misses.
      const danglingTarget = path.join(outsideDir, 'created-by-write.docx');
      const danglingLink = path.join(tmpDir, 'escape-dangling.docx');
      await fs.symlink(danglingTarget, danglingLink);

      const viaDangling = await save(mgr, {
        file_path: inputPath,
        save_to_local_path: danglingLink,
        save_format: 'clean',
        allow_overwrite: true,
      });
      assertFailure(viaDangling, 'PATH_NOT_ALLOWED', 'dangling symlink escape');
      await expect(fs.access(danglingTarget)).rejects.toThrow();
    } finally {
      if (previousRoots === undefined) delete process.env.SAFE_DOCX_ALLOWED_ROOTS;
      else process.env.SAFE_DOCX_ALLOWED_ROOTS = previousRoots;
    }
  });

  // Issue #313: the in-place-overwrite guard must canonicalize via realpath so a symlink output that
  // points back at the source can't slip past the (previously lexical) check and clobber the original.
  test('refuses a symlink save_to_local_path that points back at the source document', async () => {
    if (process.platform === 'win32') return;

    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const sourceBytes = await fs.readFile(inputPath);
    const link = path.join(tmpDir, 'link-to-source.docx');
    await fs.symlink(inputPath, link);

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: link,
      save_format: 'clean',
    });
    assertFailure(result, 'OVERWRITE_BLOCKED', 'symlink to source');
    expect(Buffer.compare(await fs.readFile(inputPath), sourceBytes)).toBe(0);
  });

  // Issue #1305: Preflight both destinations and reject aliased outputs before any writes.
  test('rejects aliased outputs when saving both clean and tracked variants', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const samePath = path.join(tmpDir, 'same-destination.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: samePath,
      tracked_save_to_local_path: samePath,
      save_format: 'both',
    });
    assertFailure(result, 'ALIASED_OUTPUT_PATHS', 'aliased outputs');
    // Ensure no files or staging artifacts were written
    expect(await fs.readdir(tmpDir)).toEqual([path.basename(inputPath)]);
  });

  test('preflights destinations and avoids partial writes when tracked path policy fails', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const cleanPath = path.join(tmpDir, 'clean-output.docx');
    const outsideDir = await createTrackedTempDir('save-disallowed-');
    const trackedOutside = path.join(outsideDir, 'tracked-output.docx');

    const previousRoots = process.env.SAFE_DOCX_ALLOWED_ROOTS;
    process.env.SAFE_DOCX_ALLOWED_ROOTS = tmpDir;
    try {
      const result = await save(mgr, {
        file_path: inputPath,
        save_to_local_path: cleanPath,
        tracked_save_to_local_path: trackedOutside,
        save_format: 'both',
      });
      assertFailure(result, 'PATH_NOT_ALLOWED', 'tracked destination outside allowed roots');
      // Verify cleanPath was NOT created because preflight failed before any writes
      await expect(fs.access(cleanPath)).rejects.toThrow();
    } finally {
      if (previousRoots === undefined) delete process.env.SAFE_DOCX_ALLOWED_ROOTS;
      else process.env.SAFE_DOCX_ALLOWED_ROOTS = previousRoots;
    }
  });

  test('stages paired save writes and cleans up staging files on success', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const cleanPath = path.join(tmpDir, 'clean-success.docx');
    const trackedPath = path.join(tmpDir, 'tracked-success.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: cleanPath,
      tracked_save_to_local_path: trackedPath,
      save_format: 'both',
    });
    assertSuccess(result, 'paired save success');

    // Both destination files exist
    expect(await fs.stat(cleanPath)).toBeTruthy();
    expect(await fs.stat(trackedPath)).toBeTruthy();

    // No temporary staging or backup files left in directory
    const dirEntries = await fs.readdir(tmpDir);
    expect(dirEntries.some((f) => f.includes('staging'))).toBe(false);
    expect(dirEntries.some((f) => f.includes('backup'))).toBe(false);
  });

  test('rolls back newly created clean file when tracked write fails during paired save', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const cleanPath = path.join(tmpDir, 'clean-rollback-new.docx');
    const trackedPath = path.join(tmpDir, 'tracked-rollback-new.docx');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: cleanPath,
      tracked_save_to_local_path: trackedPath,
      save_format: 'both',
      _testHooks: {
        beforePublish: ({ index }) => {
          if (index === 1) {
            throw new Error('Simulated publish failure on tracked destination');
          }
        },
      },
    });

    assertFailure(result, 'SAVE_ERROR', 'publish failure on tracked destination');
    // Clean file was newly created, so rollback must remove it
    await expect(fs.access(cleanPath)).rejects.toThrow();
    await expect(fs.access(trackedPath)).rejects.toThrow();

    // No staging or backup files left behind
    const dirEntries = await fs.readdir(tmpDir);
    expect(dirEntries.some((f) => f.includes('staging'))).toBe(false);
    expect(dirEntries.some((f) => f.includes('backup'))).toBe(false);
  });

  test('restores pre-existing clean file from backup when tracked write fails during overwrite', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const cleanPath = path.join(tmpDir, 'clean-existing.docx');
    const trackedPath = path.join(tmpDir, 'tracked-destination.docx');

    // Write original content to cleanPath
    const originalContent = 'ORIGINAL_UNTOUCHED_CLEAN_DOCUMENT';
    await fs.writeFile(cleanPath, originalContent);

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: cleanPath,
      tracked_save_to_local_path: trackedPath,
      save_format: 'both',
      allow_overwrite: true,
      _testHooks: {
        beforePublish: ({ index }) => {
          if (index === 1) {
            throw new Error('Simulated publish failure on tracked destination during overwrite');
          }
        },
      },
    });

    assertFailure(result, 'SAVE_ERROR', 'publish failure during overwrite');

    // Clean file must be restored to its original pre-existing content!
    const restoredContent = await fs.readFile(cleanPath, 'utf8');
    expect(restoredContent).toBe(originalContent);

    // Tracked path was not published
    await expect(fs.access(trackedPath)).rejects.toThrow();

    // No staging or backup files left behind
    const dirEntries = await fs.readdir(tmpDir);
    expect(dirEntries.some((f) => f.includes('staging'))).toBe(false);
    expect(dirEntries.some((f) => f.includes('backup'))).toBe(false);
  });

  test('reports rollback failures with exact paths when recovery restore fails', async () => {
    const { mgr, tmpDir, inputPath } = await openTestDoc();
    const cleanPath = path.join(tmpDir, 'clean-rollback-failure.docx');
    const trackedPath = path.join(tmpDir, 'tracked-rollback-failure.docx');

    await fs.writeFile(cleanPath, 'INITIAL_DATA');

    const result = await save(mgr, {
      file_path: inputPath,
      save_to_local_path: cleanPath,
      tracked_save_to_local_path: trackedPath,
      save_format: 'both',
      allow_overwrite: true,
      _testHooks: {
        beforePublish: ({ index }) => {
          if (index === 1) {
            throw new Error('Simulated tracked publish failure');
          }
        },
        beforeRestore: ({ destination }) => {
          if (destination === cleanPath) {
            throw new Error('Simulated unrecoverable disk failure during backup restore');
          }
        },
      },
    });

    assertFailure(result, 'SAVE_ERROR', 'rollback failure');
    const errObj = (result as Record<string, unknown>).error as Record<string, unknown>;
    expect(String(errObj.message)).toContain(cleanPath);
    expect(String(errObj.message)).toContain('rollback failed for path(s)');

    const rollbackFailures = (result as Record<string, unknown>).rollback_failures as Array<{ path: string; error: string }>;
    expect(rollbackFailures).toBeDefined();
    expect(rollbackFailures.length).toBeGreaterThan(0);
    expect(rollbackFailures[0]?.path).toBe(cleanPath);
  });
});

