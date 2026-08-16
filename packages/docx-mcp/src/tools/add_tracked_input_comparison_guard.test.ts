/**
 * MCP and CLI surfaces of the tracked-input comparison guard.
 *
 * The comparison library refuses inputs that already contain tracked changes
 * (issue #742). This file pins how that typed refusal surfaces to callers of
 * the safe-docx MCP server and CLI: `compare_documents` maps it to the
 * distinct `INPUT_HAS_TRACKED_CHANGES` error code (never the catch-all
 * `COMPARE_ERROR`), and the `safe-docx compare` CLI command propagates it so
 * the process exits nonzero with a message naming the offending operand.
 *
 * Both surfaces are tested against the REAL compare function — substituting a
 * fake `compare` dependency would bypass the guard and prove nothing.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/742
 */

import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { compareDocuments_tool } from './compare_documents.js';
import { runCompareCommand } from '../cli/commands/compare.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
  openSession,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-tracked-input-comparison-guard';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REVISION_ATTRS = 'w:id="901" w:author="Earlier" w:date="2026-01-01T00:00:00Z"';

async function writeTestDocx(dir: string, name: string, bodyXml: string): Promise<string> {
  const docXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`;
  const buf = await makeDocxWithDocumentXml(docXml);
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, new Uint8Array(buf));
  return filePath;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

const CLEAN_BODY = paragraph('Clause one.') + paragraph('Clause two.');
const TRACKED_BODY =
  `<w:p><w:ins ${REVISION_ATTRS}><w:r><w:t>pre-existing edit</w:t></w:r></w:ins></w:p>`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe('Traceability: tracked-input comparison guard (MCP surface)', () => {
  const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
  registerCleanup();

  test.openspec('[SDX-TRKIN-MCP-01] compare_documents refuses tracked inputs with a distinct error code')(
    'a tracked revised input maps to INPUT_HAS_TRACKED_CHANGES, not COMPARE_ERROR',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      await given('a clean original and a revised file that already carries w:ins markup', () => {});
      const originalPath = await writeTestDocx(dir, 'original.docx', CLEAN_BODY);
      const revisedPath = await writeTestDocx(dir, 'revised.docx', TRACKED_BODY);
      const savePath = path.join(dir, 'redline.docx');

      const result = await when('Call compare_documents in two-file mode', () =>
        compareDocuments_tool(mgr, {
          original_file_path: originalPath,
          revised_file_path: revisedPath,
          save_to_local_path: savePath,
        }),
      );
      await attachPrettyJson('result', result);

      await then('the response carries the INPUT_HAS_TRACKED_CHANGES error code', () => {
        assertFailure(result, 'INPUT_HAS_TRACKED_CHANGES', 'compare_documents');
        expect(result.error?.code).not.toBe('COMPARE_ERROR');
      });

      await and('the message names the offending operand and part, with a recovery hint', () => {
        assertFailure(result);
        expect(result.error?.message).toContain('revised document already contains tracked changes');
        expect(result.error?.message).toContain('word/document.xml');
        expect(result.error?.hint).toContain('accept_changes');
      });

      await and('no output file was written', async () => {
        expect(await fileExists(savePath)).toBe(false);
      });
    },
  );

  test.openspec('[SDX-TRKIN-MCP-02] the compare CLI command surfaces the tracked-input refusal')(
    'runCompareCommand with its real compare dependency rejects and writes nothing',
    async ({ given, when, then, and }: AllureBddContext) => {
      const dir = await createTrackedTempDir();
      let failure: unknown;

      await given('a tracked original staged on disk for the CLI command', () => {});
      const originalPath = await writeTestDocx(dir, 'cli-original.docx', TRACKED_BODY);
      const revisedPath = await writeTestDocx(dir, 'cli-revised.docx', CLEAN_BODY);
      const outputPath = path.join(dir, 'cli-out.docx');

      await when('the compare command runs with its REAL default dependencies', async () => {
        try {
          await runCompareCommand({ originalPath, revisedPath, outputPath });
        } catch (error) {
          failure = error;
        }
      });

      await then('the command rejects with a message naming the original operand', () => {
        // The CLI dispatcher prints the rejection message and exits nonzero,
        // so this propagated error is the CLI's refusal surface.
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).name).toBe('TrackedInputRevisionError');
        expect((failure as Error).message).toContain(
          'original document already contains tracked changes',
        );
      });

      await and('no output file was written', async () => {
        expect(await fileExists(outputPath)).toBe(false);
      });
    },
  );

  test.openspec('[SDX-TRKIN-MCP-04] header and footer refusals carry an actionable hint')(
    'a header-part detection does not recommend the body-scoped accept_changes tool',
    async ({ given, when, then, and }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      await given('a revised file whose only tracked markup lives in word/header1.xml', () => {});
      const originalPath = await writeTestDocx(dir, 'header-original.docx', CLEAN_BODY);
      const revisedDocXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}"><w:body>${CLEAN_BODY}</w:body></w:document>`;
      const headerXml =
        `<w:hdr xmlns:w="${W_NS}"><w:p><w:ins ${REVISION_ATTRS}>` +
        `<w:r><w:t>tracked header edit</w:t></w:r></w:ins></w:p></w:hdr>`;
      const revisedBuffer = await makeDocxWithDocumentXml(revisedDocXml, {
        'word/header1.xml': headerXml,
      });
      const revisedPath = path.join(dir, 'header-revised.docx');
      await fs.writeFile(revisedPath, new Uint8Array(revisedBuffer));
      const savePath = path.join(dir, 'header-redline.docx');

      const result = await when('Call compare_documents in two-file mode', () =>
        compareDocuments_tool(mgr, {
          original_file_path: originalPath,
          revised_file_path: revisedPath,
          save_to_local_path: savePath,
        }),
      );

      await then('the refusal names the header part', () => {
        assertFailure(result, 'INPUT_HAS_TRACKED_CHANGES', 'compare_documents');
        expect(result.error?.message).toContain('word/header1.xml');
      });

      await and('the hint is actionable: accept_changes cannot clean headers, so it is not suggested', async () => {
        assertFailure(result);
        // accept_changes covers the body and note/comment stories only;
        // recommending it here would send the caller in a retry loop. The
        // hint may NAME accept_changes only to say it does not apply.
        expect(result.error?.hint).not.toContain('via accept_changes');
        expect(result.error?.hint).toContain('accept_changes does not cover headers or footers');
        expect(result.error?.hint).toContain('word/header1.xml');
        expect(await fileExists(savePath)).toBe(false);
      });
    },
  );

  test.openspec('[SDX-TRKIN-MCP-05] session-mode comparison of a tracked document is refused')(
    'a session opened on a document with pre-existing tracked changes cannot session-compare',
    async ({ given, when, then }: AllureBddContext) => {
      await given('an open session whose document already carries w:ins markup', () => {});
      const sessionDocXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}"><w:body>${CLEAN_BODY}${TRACKED_BODY}</w:body></w:document>`;
      const { mgr, inputPath, tmpDir } = await openSession([], { xml: sessionDocXml });
      const savePath = path.join(tmpDir, 'session-redline.docx');

      const result = await when('Call compare_documents in session mode', () =>
        compareDocuments_tool(mgr, {
          file_path: inputPath,
          save_to_local_path: savePath,
        }),
      );

      await then('the session comparison is refused with the distinct code and writes nothing', async () => {
        // Both session operands (the baseline and the working copy) inherit
        // the document's pre-existing markup, so the comparison must refuse
        // rather than merge two authors' revision trees.
        assertFailure(result, 'INPUT_HAS_TRACKED_CHANGES', 'compare_documents');
        expect(await fileExists(savePath)).toBe(false);
      });
    },
  );

  test.openspec('[SDX-TRKIN-MCP-03] compare_documents with clean inputs is unaffected')(
    'a clean two-file comparison still succeeds and writes the redline',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      await given('two clean documents with an ordinary edit between them', () => {});
      const originalPath = await writeTestDocx(dir, 'clean-original.docx', CLEAN_BODY);
      const revisedPath = await writeTestDocx(
        dir,
        'clean-revised.docx',
        paragraph('Clause one.') + paragraph('Clause two, amended.'),
      );
      const savePath = path.join(dir, 'clean-redline.docx');

      const result = await when('Call compare_documents in two-file mode', () =>
        compareDocuments_tool(mgr, {
          original_file_path: originalPath,
          revised_file_path: revisedPath,
          save_to_local_path: savePath,
        }),
      );

      await then('the comparison succeeds and the redline is written', async () => {
        assertSuccess(result, 'compare_documents');
        expect(await fileExists(savePath)).toBe(true);
      });
    },
  );
});
