import { describe, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compareDocuments } from '@usejunior/docx-comparison';
import { parseXml } from '@usejunior/docx-primitives';

import { extractRevisions_tool } from './extract_revisions.js';
import { openDocument } from './open_document.js';
import { replaceText } from './replace_text.js';
import { MCP_TOOLS } from '../server.js';
import {
  type AllureBddContext,
  testAllure,
  allureStep,
  allureJsonAttachment,
  getAllureRuntime,
  type AllureStepContext,
} from '../testing/allure-test.js';
import {
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
  openSession,
} from '../testing/session-test-utils.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';

const TEST_FEATURE = 'add-extract-revisions-tool';
const REPORT_FEATURE = 'extract-revisions-tool';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SIMPLE_FIXTURE_DIR = path.resolve(
  TEST_DIR,
  '../../../docx-comparison/src/testing/fixtures/simple-word-change',
);

type StepValue = string | number | boolean;

type RevisionSummary = {
  type?: string;
  text?: string;
  author?: string;
};

type ExtractedChange = {
  para_id?: string;
  before_text?: string;
  after_text?: string;
  revisions?: RevisionSummary[];
  comments?: unknown[];
};

type ExtractRevisionsSuccess = Awaited<ReturnType<typeof extractRevisions_tool>> & {
  success: true;
  changes: ExtractedChange[];
  total_changes: number;
  has_more: boolean;
};

function asExtractRevisionsSuccess(
  result: Awaited<ReturnType<typeof extractRevisions_tool>>,
  label = 'extract_revisions',
): ExtractRevisionsSuccess {
  assertSuccess(result, label);
  return result as ExtractRevisionsSuccess;
}

async function allureStepWithParameters(
  name: string,
  parameters: Record<string, StepValue>,
  run: () => void | Promise<void>,
): Promise<void> {
  const allureRuntime = getAllureRuntime();
  if (!allureRuntime) {
    await run();
    return;
  }

  await allureRuntime.step(name, async (stepContext: AllureStepContext) => {
    for (const [key, value] of Object.entries(parameters)) {
      if (typeof stepContext.parameter === 'function') {
        await stepContext.parameter(key, String(value));
      }
    }
    await run();
  });
}

async function assertStepEqual(
  name: string,
  expected: StepValue,
  actual: StepValue,
): Promise<void> {
  await allureStepWithParameters(name, { expected, actual }, async () => {
    expect(actual).toBe(expected);
  });
}

async function createRealTrackedChangesFixture(): Promise<string> {
  const [original, revised] = await Promise.all([
    fs.readFile(path.join(SIMPLE_FIXTURE_DIR, 'original.docx')),
    fs.readFile(path.join(SIMPLE_FIXTURE_DIR, 'revised.docx')),
  ]);
  const compared = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: 'rebuild',
  });
  const tmpDir = await createTrackedTempDir('extract-revisions-real-redline-');
  const outputPath = path.join(tmpDir, 'simple-word-change.tracked.docx');
  await fs.writeFile(outputPath, compared.document);
  return outputPath;
}

describe('extract_revisions tool', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: REPORT_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });
  registerCleanup();

  // ── Insertion + deletion extraction ──────────────────────────────

  humanReadableTest
    .allure({
      title: 'Extract revisions from a paragraph with insertion and deletion',
      description: 'Extracting revisions from a document with insertions and deletions returns a response that correctly describes the inserted and deleted text and the author of each change.',
    })
    .openspec('[SDX-ER-001] extracting revisions from a document with insertions and deletions')(
    'Scenario: extracting revisions from a document with insertions and deletions',
    async ({
      given,
      when,
      then,
      and,
      attachXmlPreviews,
      attachJsonLastStep,
    }: AllureBddContext) => {
      const scenarioId = 'SDX-ER-001';
      const fixture = {
        baseText: 'Original',
        insertedText: 'added',
        insertedAuthor: 'Alice',
        deletedText: 'removed',
        deletedAuthor: 'Bob',
      } as const;

      const docXml = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<w:document xmlns:w="${W_NS}">`,
        '  <w:body>',
        '    <w:p>',
        `      <w:r><w:t>${fixture.baseText}</w:t></w:r>`,
        `      <w:ins w:author="${fixture.insertedAuthor}" w:date="2024-01-01T00:00:00Z">`,
        `        <w:r><w:t> ${fixture.insertedText}</w:t></w:r>`,
        '      </w:ins>',
        `      <w:del w:author="${fixture.deletedAuthor}" w:date="2024-01-01T00:00:00Z">`,
        `        <w:r><w:delText> ${fixture.deletedText}</w:delText></w:r>`,
        '      </w:del>',
        '    </w:p>',
        '  </w:body>',
        '</w:document>',
      ].join('\n');
      const xmlDoc = parseXml(docXml);
      const paragraphCount = xmlDoc.getElementsByTagName('w:p').length;
      const insertionCount = xmlDoc.getElementsByTagName('w:ins').length;
      const deletionCount = xmlDoc.getElementsByTagName('w:del').length;
      const xmlRootElement = xmlDoc.documentElement?.nodeName ?? '';

      const expectedBefore = `${fixture.baseText} ${fixture.deletedText}`;
      const expectedAfter = `${fixture.baseText} ${fixture.insertedText}`;
      const debugContext = {
        scenario_id: scenarioId,
        base_text: fixture.baseText,
        insertion: { text: fixture.insertedText, author: fixture.insertedAuthor },
        deletion: { text: fixture.deletedText, author: fixture.deletedAuthor },
        expected_before: expectedBefore,
        expected_after: expectedAfter,
      } as const;

      let debugResult: ExtractRevisionsSuccess | null = null;
      try {
        await given(
          'a session containing a paragraph with tracked insertion and deletion',
          async () => {
            await attachXmlPreviews(docXml, {
              wordLikeName: '01 Word-like visual preview',
              xmlName: '02 Input XML fixture (pretty XML)',
              wordLike: {
                baseText: fixture.baseText,
                insertedText: fixture.insertedText,
                deletedText: fixture.deletedText,
                insertedAuthor: fixture.insertedAuthor,
                deletedAuthor: fixture.deletedAuthor,
              },
            });
          },
        );
        await and(
          `inserted_text is "${fixture.insertedText}" by "${fixture.insertedAuthor}"`,
          async () => {},
          {
            inserted_text: fixture.insertedText,
            inserted_author: fixture.insertedAuthor,
          },
        );
        await and(
          `deleted_text is "${fixture.deletedText}" by "${fixture.deletedAuthor}"`,
          async () => {},
          {
            deleted_text: fixture.deletedText,
            deleted_author: fixture.deletedAuthor,
          },
        );

        const { mgr, sessionId } = await given(
          'the tracked-change paragraph is opened as an editable session',
          () => openSession([], { xml: docXml, trackOpenStep: false }),
        );
        await and(
          'the XML fixture is well-formed WordprocessingML',
          async () => {
            expect(xmlRootElement).toBe('w:document');
            expect(paragraphCount).toBeGreaterThan(0);
            expect(insertionCount).toBe(1);
            expect(deletionCount).toBe(1);
          },
        );

        const result = await when(
          'extract_revisions is run in the session',
          async () => asExtractRevisionsSuccess(await extractRevisions_tool(mgr, { session_id: sessionId })),
        );
        debugResult = result;

        const changes = result.changes;
        const change = changes[0];
        const revisions = Array.isArray(change?.revisions) ? change.revisions : [];
        const insertionRevision = revisions.find((revision) => revision.type === 'INSERTION');
        const deletionRevision = revisions.find((revision) => revision.type === 'DELETION');

        await then(
          'the tool reports the correct number of changed paragraphs',
          async () => {
            expect(Number(result.total_changes ?? -1)).toBe(1);
          },
          {
            expected_changed_paragraph_count: 1,
            actual_changed_paragraph_count: Number(result.total_changes ?? -1),
          },
        );
        await then(
          'the tool reports the correct number of changed entries',
          async () => {
            expect(changes).toHaveLength(1);
          },
          {
            expected_entry_count: 1,
            actual_entry_count: changes.length,
          },
        );
        await then(
          'before_text equals expected_before_text',
          async () => {
            expect(String(change.before_text ?? '')).toBe(expectedBefore);
          },
          {
            expected_before: expectedBefore,
            actual_before: String(change.before_text ?? ''),
          },
        );
        await and(
          'before_text includes base_text',
          async () => {
            expect(String(change.before_text ?? '')).toContain(fixture.baseText);
          },
          {
            base_text: fixture.baseText,
            actual_before: String(change.before_text ?? ''),
          },
        );
        await and(
          'before_text omits inserted_text',
          async () => {
            expect(String(change.before_text ?? '')).not.toContain(fixture.insertedText);
          },
          {
            inserted_text: fixture.insertedText,
            actual_before: String(change.before_text ?? ''),
          },
        );
        await and(
          'before_text includes deleted_text',
          async () => {
            expect(String(change.before_text ?? '')).toContain(fixture.deletedText);
          },
          {
            deleted_text: fixture.deletedText,
            actual_before: String(change.before_text ?? ''),
          },
        );
        await then(
          'after_text equals expected_after_text',
          async () => {
            expect(String(change.after_text ?? '')).toBe(expectedAfter);
          },
          {
            expected_after: expectedAfter,
            actual_after: String(change.after_text ?? ''),
          },
        );
        await and(
          'after_text includes base_text',
          async () => {
            expect(String(change.after_text ?? '')).toContain(fixture.baseText);
          },
          {
            base_text: fixture.baseText,
            actual_after: String(change.after_text ?? ''),
          },
        );
        await and(
          'after_text includes inserted_text',
          async () => {
            expect(String(change.after_text ?? '')).toContain(fixture.insertedText);
          },
          {
            inserted_text: fixture.insertedText,
            actual_after: String(change.after_text ?? ''),
          },
        );
        await and(
          'after_text omits deleted_text',
          async () => {
            expect(String(change.after_text ?? '')).not.toContain(fixture.deletedText);
          },
          {
            deleted_text: fixture.deletedText,
            actual_after: String(change.after_text ?? ''),
          },
        );

        await and(
          'the insertion record shows correct type/text/author',
          async () => {
            expect(insertionRevision).toBeDefined();
            expect(String(insertionRevision?.text ?? '').trim()).toBe(fixture.insertedText);
            expect(insertionRevision?.author).toBe(fixture.insertedAuthor);
          },
          {
            expected_type: 'INSERTION',
            expected_text: fixture.insertedText,
            expected_author: fixture.insertedAuthor,
            actual_type: String(insertionRevision?.type ?? ''),
            actual_text: String(insertionRevision?.text ?? '').trim(),
            actual_author: String(insertionRevision?.author ?? ''),
          },
        );

        await and(
          'the deletion record shows correct type/text/author',
          async () => {
            expect(deletionRevision).toBeDefined();
            expect(String(deletionRevision?.text ?? '').trim()).toBe(fixture.deletedText);
            expect(deletionRevision?.author).toBe(fixture.deletedAuthor);
          },
          {
            expected_type: 'DELETION',
            expected_text: fixture.deletedText,
            expected_author: fixture.deletedAuthor,
            actual_type: String(deletionRevision?.type ?? ''),
            actual_text: String(deletionRevision?.text ?? '').trim(),
            actual_author: String(deletionRevision?.author ?? ''),
          },
        );
      } finally {
        await attachJsonLastStep({
          context: debugContext,
          result: debugResult,
          stepName: 'Attach debug JSON (context + result)',
        });
      }
    },
  );

  // ── No tracked changes ──────────────────────────────────────────

  humanReadableTest
    .allure({
      description: [
        'This test checks extraction behavior when a document contains no tracked changes.',
        'Expected outcome: no changed paragraphs are returned and pagination signals no more results.',
      ].join('\n'),
    })
    .openspec('[SDX-ER-002] extracting revisions from a document with no tracked changes')(
    'Scenario: [SDX-ER-002] extracting revisions from a document with no tracked changes',
    async () => {
      const scenarioId = 'SDX-ER-002';

      const { mgr, sessionId } = await openSession(['Hello world', 'Second paragraph']);
      const readableInputSummary = {
        scenario_id: scenarioId,
        paragraphs: ['Hello world', 'Second paragraph'],
      };

      let extracted: ExtractRevisionsSuccess | undefined;
      await allureStepWithParameters(
        'Given a clean document with no tracked changes',
        { paragraph_count: readableInputSummary.paragraphs.length },
        async () => {},
      );
      await allureStep('When extract_revisions is run on the clean document', async () => {
        const result = await extractRevisions_tool(mgr, { session_id: sessionId });
        extracted = asExtractRevisionsSuccess(result);
      });
      const result = extracted!;

      await assertStepEqual('Then total_changes is 0', 0, Number(result.total_changes ?? -1));
      await assertStepEqual('And changes array length is 0', 0, result.changes.length);
      await assertStepEqual('And has_more is false', false, Boolean(result.has_more));

      // Keep technical JSON artifacts at the bottom so the narrative steps stay contiguous.
      await allureJsonAttachment('Readable input summary', readableInputSummary);
      await allureJsonAttachment('Raw result (engineer view)', result);
    },
  );

  // ── Format changes ──────────────────────────────────────────────

  humanReadableTest.openspec('property-only changes are included in extraction')(
    'Scenario: property-only changes are included in extraction',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r>` +
            `<w:rPr>` +
              `<w:b/>` +
              `<w:rPrChange w:author="Carol" w:date="2024-01-01T00:00:00Z">` +
                `<w:rPr><w:i/></w:rPr>` +
              `</w:rPrChange>` +
            `</w:rPr>` +
            `<w:t>Formatted text</w:t>` +
          `</w:r></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      await allureStep('Verify FORMAT_CHANGE', () => {
        expect(result.total_changes).toBe(1);
        const changes = result.changes as any[];
        const formatRevisions = changes[0].revisions.filter((r: any) => r.type === 'FORMAT_CHANGE');
        expect(formatRevisions.length).toBeGreaterThanOrEqual(1);
        expect(formatRevisions[0].author).toBe('Carol');
      });
    },
  );

  // ── Pagination ──────────────────────────────────────────────────

  humanReadableTest.openspec('paginating through revisions with offset and limit')(
    'Scenario: paginating through revisions with offset and limit',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>B</w:t></w:r><w:ins w:author="X"><w:r><w:t>2</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>C</w:t></w:r><w:ins w:author="X"><w:r><w:t>3</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const page1 = await allureStep('Page 1: offset=0, limit=2', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 0, limit: 2 }),
      );
      assertSuccess(page1, 'page1');
      await allureJsonAttachment('page1', page1);

      const page2 = await allureStep('Page 2: offset=2, limit=2', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 2, limit: 2 }),
      );
      assertSuccess(page2, 'page2');
      await allureJsonAttachment('page2', page2);

      await allureStep('Verify pagination', () => {
        expect(page1.total_changes).toBe(3);
        expect((page1.changes as any[]).length).toBe(2);
        expect(page1.has_more).toBe(true);

        expect(page2.total_changes).toBe(3);
        expect((page2.changes as any[]).length).toBe(1);
        expect(page2.has_more).toBe(false);
      });
    },
  );

  // ── Session unchanged after extraction ──────────────────────────

  humanReadableTest.openspec('session document is unchanged after extraction')(
    'Scenario: session document is unchanged after extraction',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Text</w:t></w:r><w:ins w:author="X"><w:r><w:t> added</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const revisionBefore = await allureStep('Get edit_revision before', () => {
        const session = mgr.getSession(sessionId);
        return session.editRevision;
      });

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify edit_revision unchanged', () => {
        const session = mgr.getSession(sessionId);
        expect(session.editRevision).toBe(revisionBefore);
        expect(result.edit_revision).toBe(revisionBefore);
      });
    },
  );

  // ── Missing session context ─────────────────────────────────────

  humanReadableTest.openspec('missing session context returns error')(
    'Scenario: missing session context returns error',
    async () => {
      const mgr = createTestSessionManager();

      const result = await allureStep('Call extract_revisions with no params', () =>
        extractRevisions_tool(mgr, {}),
      );
      assertFailure(result, 'MISSING_SESSION_CONTEXT', 'extract_revisions');
      await allureJsonAttachment('result', result);
    },
  );

  // ── Validation errors ───────────────────────────────────────────

  humanReadableTest.openspec('invalid limit is rejected')(
    'Scenario: invalid limit is rejected',
    async () => {
      const { mgr, sessionId } = await openSession(['Hello']);

      const result = await allureStep('Call with limit=0', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, limit: 0 }),
      );
      assertFailure(result, 'INVALID_LIMIT', 'extract_revisions');
      await allureJsonAttachment('result', result);

      const result2 = await allureStep('Call with limit=501', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, limit: 501 }),
      );
      assertFailure(result2, 'INVALID_LIMIT', 'extract_revisions');
    },
  );

  humanReadableTest.openspec('invalid offset is rejected')(
    'Scenario: invalid offset is rejected',
    async () => {
      const { mgr, sessionId } = await openSession(['Hello']);

      const result = await allureStep('Call with offset=-1', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: -1 }),
      );
      assertFailure(result, 'INVALID_OFFSET', 'extract_revisions');
      await allureJsonAttachment('result', result);
    },
  );

  // ── Cache behavior ─────────────────────────────────────────────

  humanReadableTest.openspec('repeated extraction at same revision uses cache')(
    'Scenario: repeated extraction at same revision uses cache',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Text</w:t></w:r><w:ins w:author="X"><w:r><w:t> added</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const result1 = await allureStep('First extraction', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result1, 'first extraction');

      await allureStep('Verify cache populated', () => {
        const session = mgr.getSession(sessionId);
        const cache = mgr.getExtractionCache(session);
        expect(cache).not.toBeNull();
      });

      const result2 = await allureStep('Second extraction (from cache)', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result2, 'second extraction');

      await allureStep('Verify consistent results', () => {
        expect(result2.total_changes).toBe(result1.total_changes);
      });
    },
  );

  // ── Empty structural paragraphs ─────────────────────────────────

  humanReadableTest.openspec('structurally-empty inserted paragraphs are filtered out')(
    'Scenario: structurally-empty inserted paragraphs are filtered out',
    async () => {
      // A paragraph with only pPr/rPr/ins (paragraph-level insertion marker)
      // and no text content — should be excluded from results.
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Normal paragraph</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="Comparison" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr></w:p>` +
          `<w:p><w:r><w:t>Another </w:t></w:r><w:ins w:author="X"><w:r><w:t>edited</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      await allureStep('Verify empty structural paragraph is filtered', () => {
        // Only the third paragraph (with real content changes) should appear
        expect(result.total_changes).toBe(1);
        const changes = result.changes as any[];
        expect(changes).toHaveLength(1);
        expect(changes[0].after_text).toContain('edited');
      });
    },
  );

  // ── Real DOCX regression guard ────────────────────────────────

  humanReadableTest.openspec('real DOCX redline with tracked changes extracts correctly')(
    'Scenario: real DOCX redline with tracked changes extracts correctly',
    async () => {
      const fixturePath = await createRealTrackedChangesFixture();

      const mgr = createTestSessionManager();

      const opened = await allureStep('Open real DOCX fixture', () =>
        openDocument(mgr, { file_path: fixturePath }),
      );
      assertSuccess(opened, 'open fixture');
      const sessionId = opened.session_id as string;

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      const changes = result.changes as any[];
      const totalChanges = result.total_changes as number;

      await allureStep('Verify changes were extracted', () => {
        expect(totalChanges).toBeGreaterThan(0);
      });

      await allureStep('Verify each change has valid structure', () => {
        const validTypes = new Set(['INSERTION', 'DELETION', 'MOVE_FROM', 'MOVE_TO', 'FORMAT_CHANGE']);
        for (const c of changes) {
          expect(c.para_id).toBeTruthy();
          expect(c.revisions.length).toBeGreaterThan(0);
          for (const r of c.revisions) {
            expect(validTypes.has(r.type)).toBe(true);
          }
        }
      });

      await allureStep('Verify pagination metadata is consistent', () => {
        expect(totalChanges).toBeGreaterThanOrEqual(changes.length);
        if (result.has_more) {
          expect(changes.length).toBe(50); // default limit
        }
      });
    },
  );

  // ── Inserted-only paragraph ────────────────────────────────────

  humanReadableTest.openspec('inserted-only paragraph has empty before text')(
    'Scenario: inserted-only paragraph has empty before text',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Existing</w:t></w:r></w:p>` +
          `<w:p>` +
            `<w:pPr><w:rPr><w:ins w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr>` +
            `<w:ins w:author="A"><w:r><w:t>New paragraph</w:t></w:r></w:ins>` +
          `</w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });
      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify inserted paragraph has empty before_text', () => {
        const changes = result.changes as any[];
        expect(changes).toHaveLength(1);
        expect(changes[0].before_text).toBe('');
        expect(changes[0].after_text).toBe('New paragraph');
      });
    },
  );

  // ── Deleted-only paragraph ────────────────────────────────────

  humanReadableTest.openspec('deleted-only paragraph has empty after text')(
    'Scenario: deleted-only paragraph has empty after text',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>Kept</w:t></w:r></w:p>` +
          `<w:p>` +
            `<w:del w:author="A" w:date="2024-01-01T00:00:00Z">` +
              `<w:r><w:delText>Deleted paragraph</w:delText></w:r>` +
            `</w:del>` +
          `</w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });
      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify deleted paragraph has empty after_text', () => {
        const changes = result.changes as any[];
        expect(changes).toHaveLength(1);
        expect(changes[0].before_text).toBe('Deleted paragraph');
        expect(changes[0].after_text).toBe('');
      });
    },
  );

  // ── Table cells ───────────────────────────────────────────────

  humanReadableTest.openspec('changed paragraphs inside table cells are extracted')(
    'Scenario: changed paragraphs inside table cells are extracted',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:tbl><w:tr><w:tc>` +
            `<w:p><w:r><w:t>Cell </w:t></w:r>` +
            `<w:ins w:author="X"><w:r><w:t>edited</w:t></w:r></w:ins></w:p>` +
          `</w:tc></w:tr></w:tbl>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });
      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify table cell changes extracted', () => {
        expect(result.total_changes).toBe(1);
        const changes = result.changes as any[];
        expect(changes[0].after_text).toContain('edited');
      });
    },
  );

  // ── Comments ──────────────────────────────────────────────────

  humanReadableTest.openspec('extracting revisions includes associated comments')(
    'Scenario: extracting revisions includes associated comments',
    async () => {
      const commentsXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:comments xmlns:w="${W_NS}" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">` +
          `<w:comment w:id="1" w:author="Reviewer" w:date="2024-01-01T00:00:00Z">` +
            `<w:p><w:r><w:t>Please review this change</w:t></w:r></w:p>` +
          `</w:comment>` +
        `</w:comments>`;

      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p>` +
            `<w:commentRangeStart w:id="1"/>` +
            `<w:r><w:t>Original</w:t></w:r>` +
            `<w:ins w:author="X"><w:r><w:t> added</w:t></w:r></w:ins>` +
            `<w:commentRangeEnd w:id="1"/>` +
            `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>` +
          `</w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], {
        xml: docXml,
        extraFiles: { 'word/comments.xml': commentsXml },
      });

      const result = await allureStep('Call extract_revisions', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');
      await allureJsonAttachment('result', result);

      await allureStep('Verify comments are associated', () => {
        const changes = result.changes as any[];
        expect(changes).toHaveLength(1);
        expect(changes[0].comments.length).toBeGreaterThanOrEqual(1);
        expect(changes[0].comments[0].author).toBe('Reviewer');
        expect(changes[0].comments[0].text).toContain('Please review');
      });
    },
  );

  // ── Offset beyond total ───────────────────────────────────────

  humanReadableTest.openspec('offset beyond total returns empty page')(
    'Scenario: offset beyond total returns empty page',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });
      const result = await allureStep('Call with offset=100', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 100 }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify empty page', () => {
        expect(result.total_changes).toBe(1);
        expect((result.changes as any[]).length).toBe(0);
        expect(result.has_more).toBe(false);
      });
    },
  );

  // ── Subsequent pages ──────────────────────────────────────────

  humanReadableTest.openspec('retrieving subsequent pages with offset')(
    'Scenario: retrieving subsequent pages with offset',
    async () => {
      const docXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
          `<w:p><w:r><w:t>A</w:t></w:r><w:ins w:author="X"><w:r><w:t>1</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>B</w:t></w:r><w:ins w:author="X"><w:r><w:t>2</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>C</w:t></w:r><w:ins w:author="X"><w:r><w:t>3</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:r><w:t>D</w:t></w:r><w:ins w:author="X"><w:r><w:t>4</w:t></w:r></w:ins></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId } = await openSession([], { xml: docXml });

      const page1 = await allureStep('Page 1', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 0, limit: 2 }),
      );
      assertSuccess(page1, 'page1');

      const page2 = await allureStep('Page 2', () =>
        extractRevisions_tool(mgr, { session_id: sessionId, offset: 2, limit: 2 }),
      );
      assertSuccess(page2, 'page2');

      await allureStep('Verify no overlap between pages', () => {
        const p1Ids = new Set((page1.changes as any[]).map((c: any) => c.para_id));
        for (const c of page2.changes as any[]) {
          expect(p1Ids.has(c.para_id)).toBe(false);
        }
      });
    },
  );

  // ── Cache invalidation on edit ────────────────────────────────

  humanReadableTest.openspec('new edit invalidates extraction cache')(
    'Scenario: new edit invalidates extraction cache',
    async ({
      given,
      when,
      then,
      and,
      attachJsonLastStep,
    }: AllureBddContext) => {
      const inputParagraphs = ['Hello world', 'Second paragraph'];
      const replaceInstruction = {
        old_string: 'Hello world',
        new_string: 'Hi world',
        instruction: 'cache invalidation test',
      } as const;
      const debugContext = {
        scenario: 'new edit invalidates extraction cache',
        input_paragraphs: inputParagraphs,
        replace_text: replaceInstruction,
        expected: {
          cache_after_first_extraction: 'present',
          cache_after_edit: 'null',
          second_edit_revision_differs: true,
        },
      } as const;

      let debugResult: Record<string, unknown> | null = null;
      try {
        const { mgr, sessionId, firstParaId } = await given(
          'a clean two-paragraph document is open in a session',
          () => openSession(inputParagraphs, { trackOpenStep: false }),
          { paragraph_count: inputParagraphs.length },
        );

        const result1 = await when(
          'I run extract_revisions for the first time',
          () => extractRevisions_tool(mgr, { session_id: sessionId }),
          { session_id: sessionId },
        );
        assertSuccess(result1, 'first extraction');
        const rev1 = result1.edit_revision;

        await then(
          'the extraction cache is populated after the first run',
          async () => {
            const session = mgr.getSession(sessionId);
            expect(mgr.getExtractionCache(session)).not.toBeNull();
          },
          { expected_cache: 'present' },
        );

        const editResult = await when(
          'I edit the first paragraph using replace_text',
          () => replaceText(mgr, {
            session_id: sessionId,
            target_paragraph_id: firstParaId,
            old_string: replaceInstruction.old_string,
            new_string: replaceInstruction.new_string,
            instruction: replaceInstruction.instruction,
          }),
          {
            target_paragraph_id: firstParaId,
            old_string: replaceInstruction.old_string,
            new_string: replaceInstruction.new_string,
          },
        );
        assertSuccess(editResult, 'replace_text');

        await and(
          'the extraction cache is invalidated by that edit',
          async () => {
            const session = mgr.getSession(sessionId);
            expect(mgr.getExtractionCache(session)).toBeNull();
          },
          { expected_cache: 'null' },
        );

        const result2 = await when(
          'I run extract_revisions again after the edit',
          () => extractRevisions_tool(mgr, { session_id: sessionId }),
          { session_id: sessionId },
        );
        assertSuccess(result2, 'second extraction');

        await and(
          'the second extraction has a newer edit revision',
          async () => {
            expect(result2.edit_revision).not.toBe(rev1);
          },
          { previous_edit_revision: String(rev1), current_edit_revision: String(result2.edit_revision) },
        );

        debugResult = {
          first_extraction: result1,
          edit_result: editResult,
          second_extraction: result2,
          first_edit_revision: rev1,
          second_edit_revision: result2.edit_revision,
        };
      } finally {
        await attachJsonLastStep({
          context: debugContext,
          result: debugResult,
          stepName: 'Attach debug JSON (context + result)',
        });
      }
    },
  );

  // ── Two-file comparison then extraction ────────────────────────

  humanReadableTest.openspec('two-file comparison then extraction workflow')(
    'Scenario: two-file comparison then extraction workflow',
    async () => {
      const fixturePath = await createRealTrackedChangesFixture();

      const mgr = createTestSessionManager();

      const opened = await allureStep('Open redline DOCX via file_path', () =>
        openDocument(mgr, { file_path: fixturePath }),
      );
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;

      const result = await allureStep('Extract revisions from redline', () =>
        extractRevisions_tool(mgr, { session_id: sessionId }),
      );
      assertSuccess(result, 'extract_revisions');

      await allureStep('Verify structured diff is returned', () => {
        expect(result.total_changes).toBeGreaterThan(0);
        expect(result.changes).toBeDefined();
        expect(Array.isArray(result.changes)).toBe(true);
      });
    },
  );

  // ── Tool registration ───────────────────────────────────────────

  test(
    'extract_revisions tool is registered in MCP_TOOLS',
    async () => {
      const tool = MCP_TOOLS.find((t) => t.name === 'extract_revisions');
      expect(tool).toBeTruthy();
      expect(tool!.annotations.readOnlyHint).toBe(true);
      expect(tool!.annotations.destructiveHint).toBe(false);
      expect(tool!.inputSchema.properties).toHaveProperty('session_id');
      expect(tool!.inputSchema.properties).toHaveProperty('file_path');
      expect(tool!.inputSchema.properties).toHaveProperty('offset');
      expect(tool!.inputSchema.properties).toHaveProperty('limit');
    },
  );
});
