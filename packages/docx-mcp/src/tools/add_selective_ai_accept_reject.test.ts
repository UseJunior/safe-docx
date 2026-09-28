import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DocxZip } from '@usejunior/docx-core';
import { SessionManager, type DocxSession } from '../session/manager.js';
import { acceptAiEdits } from './accept_ai_edits.js';
import { rejectAiEdits } from './reject_ai_edits.js';
import { acceptChanges } from './accept_changes.js';
import { getFileStatus } from './get_file_status.js';
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

// #1084: a no-op accept/reject must not bump the session's edit counters or
// drop its caches; a real one still must (control).
describe('No-op accept/reject leaves the session unedited (#1084)', () => {
  registerCleanup();

  const PLAIN_BODY = `<w:p><w:r><w:t xml:space="preserve">no tracked changes here</w:t></w:r></w:p>`;

  function counters(session: DocxSession): { editCount: number; editRevision: number } {
    return { editCount: session.editCount, editRevision: session.editRevision };
  }

  async function fileStatusCounters(mgr: SessionManager, filePath: string) {
    const status = await getFileStatus(mgr, { file_path: filePath });
    assertSuccess(status, 'get_file_status');
    return { edit_count: status.edit_count, edit_revision: status.edit_revision };
  }

  test('accept_changes on a document with no tracked changes leaves edit counters unchanged', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a session on a document with no tracked changes', () =>
      openSession([], { mgr: manager(), xml: documentXml(PLAIN_BODY) }),
    );
    const session = await docxSession(opened.mgr, opened.filePath);
    const before = counters(session);
    const statusBefore = await fileStatusCounters(opened.mgr, opened.filePath);

    const result = await when('accept_changes is called', () =>
      acceptChanges(opened.mgr, { file_path: opened.filePath }),
    );

    await then('it succeeds with zero counts and the session is not marked edited', async () => {
      assertSuccess(result, 'accept_changes');
      expect(result.insertionsAccepted).toBe(0);
      expect(result.deletionsAccepted).toBe(0);
      expect(counters(session)).toEqual(before);
      expect(await fileStatusCounters(opened.mgr, opened.filePath)).toEqual(statusBefore);
    });
  });

  test('reject_ai_edits with a selector matching nothing leaves edit counters unchanged', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a session with AI and reviewer revisions', () =>
      openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
    );
    const session = await docxSession(opened.mgr, opened.filePath);
    const before = counters(session);

    const byAuthor = await when('reject_ai_edits targets an author with no revisions', () =>
      rejectAiEdits(opened.mgr, { file_path: opened.filePath, author: 'Nobody' }),
    );
    const byIds = await when('reject_ai_edits targets revision ids that do not exist', () =>
      rejectAiEdits(opened.mgr, { file_path: opened.filePath, revision_ids: [999] }),
    );

    await then('both succeed with no selection and the session is not marked edited', () => {
      assertSuccess(byAuthor, 'reject_ai_edits');
      assertSuccess(byIds, 'reject_ai_edits');
      expect(byAuthor.selected_revision_ids).toEqual([]);
      // Unknown revision_ids are no longer echoed back as selected (#1099);
      // the zero counts are what prove nothing changed.
      expect(byIds.selected_revision_ids).toEqual([]);
      expect(byIds.insertionsRemoved).toBe(0);
      expect(byIds.deletionsRestored).toBe(0);
      expect(counters(session)).toEqual(before);
    });
  });

  test('accept_ai_edits with a selector matching nothing leaves edit counters unchanged', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a session with AI and reviewer revisions', () =>
      openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
    );
    const session = await docxSession(opened.mgr, opened.filePath);
    const before = counters(session);

    const result = await when('accept_ai_edits targets an author with no revisions', () =>
      acceptAiEdits(opened.mgr, { file_path: opened.filePath, author: 'Nobody' }),
    );

    await then('it succeeds with no selection and the session is not marked edited', () => {
      assertSuccess(result, 'accept_ai_edits');
      expect(result.selected_revision_ids).toEqual([]);
      expect(counters(session)).toEqual(before);
    });
  });

  test('a real accept_changes, accept_ai_edits and reject_ai_edits still mark the session edited (control)', async ({ given, when, then }: AllureBddContext) => {
    const acceptAll = await given('a session with tracked changes', () =>
      openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
    );
    const selective = await given('a second session with tracked changes', () =>
      openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
    );
    const acceptSession = await docxSession(acceptAll.mgr, acceptAll.filePath);
    const selectiveSession = await docxSession(selective.mgr, selective.filePath);
    const acceptBefore = counters(acceptSession);
    const selectiveBefore = counters(selectiveSession);

    const accepted = await when('accept_changes resolves every revision', () =>
      acceptChanges(acceptAll.mgr, { file_path: acceptAll.filePath }),
    );
    const acceptedAi = await when('accept_ai_edits accepts one AI revision', () =>
      acceptAiEdits(selective.mgr, { file_path: selective.filePath, revision_ids: [101] }),
    );
    const rejectedAi = await when('reject_ai_edits rejects another AI revision', () =>
      rejectAiEdits(selective.mgr, { file_path: selective.filePath, revision_ids: [103] }),
    );

    await then('each real change increments edit count and revision by one', () => {
      assertSuccess(accepted, 'accept_changes');
      assertSuccess(acceptedAi, 'accept_ai_edits');
      assertSuccess(rejectedAi, 'reject_ai_edits');
      expect(counters(acceptSession)).toEqual({
        editCount: acceptBefore.editCount + 1,
        editRevision: acceptBefore.editRevision + 1,
      });
      expect(counters(selectiveSession)).toEqual({
        editCount: selectiveBefore.editCount + 2,
        editRevision: selectiveBefore.editRevision + 2,
      });
    });
  });
});

// #1099: accept/reject with revision_ids that match nothing used to report
// persistence_required: true with a save instruction, echo the unknown ids as
// selected, and record a selective action that made a later clean save fail
// with SELECTIVE_REVISIONS_WOULD_BE_DISCARDED although nothing had changed.
describe('No-op accept/reject by unknown revision id has nothing to persist (#1099)', () => {
  registerCleanup();

  const TOOLS = [
    { name: 'accept_ai_edits', call: acceptAiEdits },
    { name: 'reject_ai_edits', call: rejectAiEdits },
  ] as const;

  for (const tool of TOOLS) {
    test(`${tool.name} with revision ids that match no revision reports persistence_required: false and no next_step`, async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a session with AI and reviewer revisions', () =>
        openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
      );
      const session = await docxSession(opened.mgr, opened.filePath);

      const result = await when(`${tool.name} targets revision ids that do not exist`, () =>
        tool.call(opened.mgr, { file_path: opened.filePath, revision_ids: [999, '998'] }),
      );

      await then('it succeeds, reports nothing to persist and records no selective action', () => {
        assertSuccess(result, tool.name);
        expect(result.persistence_required).toBe(false);
        expect(result).not.toHaveProperty('next_step');
        expect(result.selected_revision_ids).toEqual([]);
        expect(session.selectiveRevisionAction).toBeNull();
      });
    });

    test(`a clean save after a no-op ${tool.name} succeeds exactly as it would without the call`, async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a session with AI and reviewer revisions', () =>
        openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
      );
      const control = await given('a control session on the same document with no accept/reject call', () =>
        openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
      );
      const cleanPath = path.join(opened.tmpDir, 'no-op-by-id-clean.docx');
      const controlPath = path.join(control.tmpDir, 'control-clean.docx');

      const saved = await when(`${tool.name} targets an unknown revision id and the session is saved clean`, async () => {
        assertSuccess(await tool.call(opened.mgr, { file_path: opened.filePath, revision_ids: [999] }), tool.name);
        return save(opened.mgr, { file_path: opened.filePath, save_to_local_path: cleanPath, save_format: 'clean' });
      });
      const controlSaved = await when('the control session is saved clean', () =>
        save(control.mgr, { file_path: control.filePath, save_to_local_path: controlPath, save_format: 'clean' }),
      );

      await then('both clean saves succeed and write the same document.xml', async () => {
        assertSuccess(saved, 'clean save after no-op selection by id');
        assertSuccess(controlSaved, 'control clean save');
        expect(saved.selective_revision_disposition).toBeUndefined();
        expect(controlSaved.selective_revision_disposition).toBeUndefined();
        const xml = await (await DocxZip.load(await fs.readFile(cleanPath))).readText('word/document.xml');
        const controlXml = await (await DocxZip.load(await fs.readFile(controlPath))).readText('word/document.xml');
        expect(xml).toBe(controlXml);
      });
    });
  }

  test('a real selective accept still records the action and blocks a clean save that would discard remaining AI revisions (control)', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a session with AI and reviewer revisions', () =>
      openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
    );
    const session = await docxSession(opened.mgr, opened.filePath);
    const cleanPath = path.join(opened.tmpDir, 'real-selective-clean.docx');

    const accepted = await when('accept_ai_edits accepts one of the two AI revisions by id', () =>
      acceptAiEdits(opened.mgr, { file_path: opened.filePath, revision_ids: [101] }),
    );
    const blocked = await when('the session is saved clean without an acknowledgement', () =>
      save(opened.mgr, { file_path: opened.filePath, save_to_local_path: cleanPath, save_format: 'clean' }),
    );

    await then('the call reports the selection to persist and the clean save is refused', () => {
      assertSuccess(accepted, 'accept_ai_edits');
      expect(accepted.selected_revision_ids).toEqual(['101']);
      expect(accepted.persistence_required).toBe(true);
      expect(accepted.next_step).toMatch(/save_format='tracked'/u);
      expect(session.selectiveRevisionAction).toMatchObject({ tool: 'accept_ai_edits', selector: 'revision_ids', selectedRevisionIds: ['101'] });
      assertFailure(blocked, 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
    });
  });

  test('a real selective reject still records the action and blocks a clean save that would discard remaining AI revisions (control)', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a session with AI and reviewer revisions', () =>
      openSession([], { mgr: manager(), xml: documentXml(MIXED_AUTHOR_BODY) }),
    );
    const session = await docxSession(opened.mgr, opened.filePath);
    const cleanPath = path.join(opened.tmpDir, 'real-selective-reject-clean.docx');

    const rejected = await when('reject_ai_edits rejects one of the two AI revisions by id', () =>
      rejectAiEdits(opened.mgr, { file_path: opened.filePath, revision_ids: [103] }),
    );
    const blocked = await when('the session is saved clean without an acknowledgement', () =>
      save(opened.mgr, { file_path: opened.filePath, save_to_local_path: cleanPath, save_format: 'clean' }),
    );

    await then('the call reports the selection to persist and the clean save is refused', () => {
      assertSuccess(rejected, 'reject_ai_edits');
      expect(rejected.selected_revision_ids).toEqual(['103']);
      expect(rejected.persistence_required).toBe(true);
      expect(rejected.next_step).toMatch(/save_format='tracked'/u);
      expect(session.selectiveRevisionAction).toMatchObject({ tool: 'reject_ai_edits', selector: 'revision_ids', selectedRevisionIds: ['103'] });
      assertFailure(blocked, 'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED');
    });
  });
});
