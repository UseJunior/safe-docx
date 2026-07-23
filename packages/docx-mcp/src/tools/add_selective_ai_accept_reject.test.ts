import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DocxZip } from '@usejunior/docx-core';
import { SessionManager, type DocxSession } from '../session/manager.js';
import { acceptAiEdits } from './accept_ai_edits.js';
import { rejectAiEdits } from './reject_ai_edits.js';
import { save } from './save.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertFailure, assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-selective-ai-accept-reject';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX AI';
const HUMAN = 'Reviewer';
const DATE = '2026-07-23T12:00:00Z';

const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

function manager(): SessionManager {
  return new SessionManager({ defaultAiAuthor: AI });
}

function documentXml(bodyInner: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`
  );
}

// Revision ids start at 101 so they never collide with the bookmark ids
// (w:id="1"...) that normalization backfills on open.
const MIXED_AUTHOR_BODY =
  `<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>` +
  `<w:ins w:id="101" w:author="${AI}" w:date="${DATE}"><w:r><w:t xml:space="preserve">ai-add </w:t></w:r></w:ins>` +
  `<w:ins w:id="102" w:author="${HUMAN}" w:date="${DATE}"><w:r><w:t xml:space="preserve">human-add </w:t></w:r></w:ins>` +
  `<w:del w:id="103" w:author="${AI}" w:date="${DATE}"><w:r><w:delText xml:space="preserve">ai-del </w:delText></w:r></w:del>` +
  `<w:del w:id="104" w:author="${HUMAN}" w:date="${DATE}"><w:r><w:delText xml:space="preserve">human-del</w:delText></w:r></w:del></w:p>`;

// A visible anchor paragraph so the session read finds a paragraph id, followed
// by the overlap paragraph (AI ins structurally containing a reviewer del).
const OVERLAP_BODY =
  `<w:p><w:r><w:t xml:space="preserve">anchor</w:t></w:r></w:p>` +
  `<w:p><w:ins w:id="107" w:author="${AI}" w:date="${DATE}">` +
  `<w:del w:id="108" w:author="${HUMAN}" w:date="${DATE}"><w:r><w:delText>x</w:delText></w:r></w:del></w:ins></w:p>`;

async function docxSession(mgr: SessionManager, filePath: string): Promise<DocxSession> {
  const session = await mgr.getSessionByFilePath(filePath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  return session;
}

async function readDocumentXml(mgr: SessionManager, filePath: string): Promise<string> {
  const session = await docxSession(mgr, filePath);
  const { buffer } = await session.doc.toBuffer({ cleanBookmarks: false });
  const zip = await DocxZip.load(buffer);
  return zip.readText('word/document.xml');
}

describe('Selective accept/reject AI edits (#123)', () => {
  registerCleanup();

  test.openspec('accept ai edits by author preserves foreign revisions')(
    'Scenario: accept ai edits by author preserves foreign revisions',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a session with interleaved AI and reviewer revisions', () =>
        openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
      );

      const result = await when('accept_ai_edits is called with the AI author', () =>
        acceptAiEdits(opened.mgr, { file_path: opened.filePath, author: AI }),
      );

      await then('AI revisions are accepted and reviewer revisions are preserved', async () => {
        assertSuccess(result, 'accept_ai_edits');
        expect(result.selected_revision_ids).toEqual(expect.arrayContaining(['101', '103']));
        const xml = await readDocumentXml(opened.mgr, opened.filePath);
        expect(xml).toContain('ai-add'); // AI insertion accepted (text kept)
        expect(xml).not.toContain('ai-del'); // AI deletion accepted (text gone)
        expect(xml).not.toContain('w:id="101"'); // AI ins wrapper removed
        expect(xml).toContain('w:id="102"'); // reviewer insertion untouched
        expect(xml).toContain('human-del'); // reviewer deletion still deleted (delText kept)
        expect(xml).toContain('w:id="104"');
      });
    },
  );

  test.openspec('reject ai edits by author preserves foreign revisions')(
    'Scenario: reject ai edits by author preserves foreign revisions',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a session with interleaved AI and reviewer revisions', () =>
        openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
      );

      const result = await when('reject_ai_edits is called with the AI author', () =>
        rejectAiEdits(opened.mgr, { file_path: opened.filePath, author: AI }),
      );

      await then('AI revisions are reverted and reviewer revisions are preserved', async () => {
        assertSuccess(result, 'reject_ai_edits');
        const xml = await readDocumentXml(opened.mgr, opened.filePath);
        expect(xml).not.toContain('ai-add'); // AI insertion rejected (text gone)
        expect(xml).toContain('ai-del'); // AI deletion rejected (text restored)
        expect(xml).toContain('w:id="102"'); // reviewer insertion untouched
        expect(xml).toContain('w:id="104"'); // reviewer deletion untouched
        expect(xml).toContain('human-add');
      });
    },
  );

  test.openspec('accept ai edits by explicit revision ids')(
    'Scenario: accept ai edits by explicit revision ids',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a session containing several AI revisions', () =>
        openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
      );

      const result = await when('accept_ai_edits is called with a subset of revision_ids', () =>
        acceptAiEdits(opened.mgr, { file_path: opened.filePath, revision_ids: [101] }),
      );

      await then('only the listed revision is accepted and reported', async () => {
        assertSuccess(result, 'accept_ai_edits');
        expect(result.selected_revision_ids).toEqual(['101']);
        const xml = await readDocumentXml(opened.mgr, opened.filePath);
        expect(xml).not.toContain('w:id="101"'); // id 1 accepted
        expect(xml).toContain('w:id="103"'); // other AI revision (id 3) untouched
        expect(xml).toContain('ai-del');
      });
    },
  );

  test('requires explicit acknowledgement before a clean save discards selectively preserved AI revisions', async () => {
    const opened = await openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) });
    const cleanPath = path.join(opened.tmpDir, 'selective-clean.docx');

    const accepted = await acceptAiEdits(opened.mgr, {
      file_path: opened.filePath,
      revision_ids: [101],
    });
    assertSuccess(accepted, 'accept_ai_edits');
    expect(accepted.persistence_required).toBe(true);

    const blocked = await save(opened.mgr, {
      file_path: opened.filePath,
      save_to_local_path: cleanPath,
      save_format: 'clean',
    });
    assertFailure(blocked, 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
    expect(blocked.preserved_revisions).toMatchObject({
      count: 1,
      author: AI,
      ids: [103],
    });
    await expect(fs.access(cleanPath)).rejects.toThrow();

    const acknowledged = await save(opened.mgr, {
      file_path: opened.filePath,
      save_to_local_path: cleanPath,
      save_format: 'clean',
      allow_discard_preserved_revisions: true,
    });
    assertSuccess(acknowledged, 'acknowledged clean save');
    expect(acknowledged.selective_revision_disposition).toMatchObject({
      acknowledged: true,
      clean_artifact_accepted_remaining_author_revisions: {
        count: 1,
        author: AI,
        ids: [103],
      },
    });
  });

  test('tracked save persists a selective revision operation without an acknowledgement', async () => {
    const opened = await openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) });
    const trackedPath = path.join(opened.tmpDir, 'selective-tracked.docx');

    const accepted = await acceptAiEdits(opened.mgr, {
      file_path: opened.filePath,
      revision_ids: [101],
    });
    assertSuccess(accepted, 'accept_ai_edits');

    const saved = await save(opened.mgr, {
      file_path: opened.filePath,
      save_to_local_path: trackedPath,
      save_format: 'tracked',
    });
    assertSuccess(saved, 'tracked save');
    const zip = await DocxZip.load(await fs.readFile(trackedPath));
    const xml = await zip.readText('word/document.xml');
    expect(xml).not.toContain('w:id="101"');
    expect(xml).toContain('w:id="103"');
    expect(xml).toContain('w:id="102"');
    expect(xml).toContain('w:id="104"');
  });

  test('a selector with no matches does not arm the clean-save safeguard', async () => {
    const opened = await openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) });
    const cleanPath = path.join(opened.tmpDir, 'no-op-selective-clean.docx');

    const accepted = await acceptAiEdits(opened.mgr, {
      file_path: opened.filePath,
      author: 'Unknown reviewer',
    });
    assertSuccess(accepted, 'accept_ai_edits');
    expect(accepted.selected_revision_ids).toEqual([]);
    expect(accepted.persistence_required).toBe(false);

    const saved = await save(opened.mgr, {
      file_path: opened.filePath,
      save_to_local_path: cleanPath,
      save_format: 'clean',
    });
    assertSuccess(saved, 'clean save after no-op selection');
    await expect(fs.access(cleanPath)).resolves.toBeUndefined();
  });

  test.openspec('missing selector is rejected')(
    'Scenario: missing selector is rejected',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a session document', () =>
        openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
      );

      const result = await when('accept_ai_edits is called with neither revision_ids nor author', () =>
        acceptAiEdits(opened.mgr, { file_path: opened.filePath }),
      );

      await then('the request is rejected with MISSING_PARAMETER', () => {
        assertFailure(result, 'MISSING_PARAMETER');
      });
    },
  );

  test.openspec('ambiguous overlap hard-errors with structured overlaps')(
    'Scenario: ambiguous overlap hard-errors with structured overlaps',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a session where an AI revision contains a reviewer revision', () =>
        openSession([], { mgr: manager(), xml: documentXml(OVERLAP_BODY) }),
      );

      const result = await when('accept_ai_edits is called for the AI author without normalize_first', () =>
        acceptAiEdits(opened.mgr, { file_path: opened.filePath, author: AI }),
      );

      await then('it fails with AMBIGUOUS_REVISION_OVERLAP and a structured overlaps list', () => {
        assertFailure(result, 'AMBIGUOUS_REVISION_OVERLAP');
        const overlaps = result.overlaps as Array<{ outerId: string; innerId: string; innerAuthor: string }>;
        expect(overlaps).toHaveLength(1);
        expect(overlaps[0]).toMatchObject({ outerId: '107', innerId: '108', innerAuthor: HUMAN });
      });
    },
  );

  test.openspec('normalize first bypasses the ambiguity error')(
    'Scenario: normalize first bypasses the ambiguity error',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a session with an ambiguous revision overlap', () =>
        openSession([], { mgr: manager(), xml: documentXml(OVERLAP_BODY) }),
      );

      const result = await when('accept_ai_edits is called with normalize_first', () =>
        acceptAiEdits(opened.mgr, { file_path: opened.filePath, author: AI, normalize_first: true }),
      );

      await then('it succeeds best-effort and the reviewer revision survives', async () => {
        assertSuccess(result, 'accept_ai_edits');
        const xml = await readDocumentXml(opened.mgr, opened.filePath);
        expect(xml).toContain('w:id="108"'); // foreign (reviewer) revision still present
      });
    },
  );
});
