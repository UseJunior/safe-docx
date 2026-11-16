import { describe, expect } from 'vitest';
import { SessionManager } from '../session/manager.js';
import { testAllure } from '../testing/allure-test.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { batchEdit } from './batch_edit.js';
import { insertParagraph } from './insert_paragraph.js';
import { replaceText } from './replace_text.js';
import { FORMATTING_CONVENTION_WARNING_CODE } from './formatting_convention.js';

/**
 * batch_edit's AI-revision preflight runs the batch on a copy before the
 * session is touched (issue #1478). These tests check that the preflight
 * judges the edit that actually runs: a batch of one step must reach the same
 * verdict (blocked or not, and the same formatting-convention warnings) as the
 * standalone tool given the same input.
 */
const test = testAllure
  .epic('Document Editing')
  .withLabels({ feature: 'Batch Edit Preflight Parity' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX AI';

function docXml(body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`
  );
}

const BOLD_ITALIC = '<w:rPr><w:b/><w:i/></w:rPr>';

/** A paragraph with one bold-italic parenthetical defined term. */
function definedTermParagraph(index: number): string {
  return (
    `<w:p>` +
    `<w:r><w:t xml:space="preserve">Section ${index}. The receiving party (the “</w:t></w:r>` +
    `<w:r>${BOLD_ITALIC}<w:t>Term ${index}</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">”) shall act reasonably.</w:t></w:r>` +
    `</w:p>`
  );
}

/** Ten bold-italic definitions: a document convention the check enforces. */
const CONVENTION_BODY = Array.from({ length: 10 }, (_, i) => definedTermParagraph(i + 1)).join('');

/**
 * The last paragraph's defined term was added by a human reviewer as a tracked
 * insertion, so the term sits right next to an existing tracked change.
 */
const TRACKED_TARGET =
  `<w:p>` +
  `<w:r><w:t xml:space="preserve">The agent shall serve the notice </w:t></w:r>` +
  `<w:ins w:id="501" w:author="Reviewer" w:date="2026-08-12T00:00:00Z">` +
  `<w:r><w:t xml:space="preserve">(the “</w:t></w:r>` +
  `<w:r>${BOLD_ITALIC}<w:t>Notice</w:t></w:r>` +
  `<w:r><w:t xml:space="preserve">”)</w:t></w:r>` +
  `</w:ins>` +
  `<w:r><w:t xml:space="preserve"> within ten days.</w:t></w:r>` +
  `</w:p>`;

const PLAIN_TARGET =
  `<w:p><w:r><w:t xml:space="preserve">The fee is payable on demand.</w:t></w:r></w:p>`;

async function twinSessions(body: string) {
  const xml = docXml(body);
  const standalone = await openSession([], { mgr: new SessionManager({ defaultAiAuthor: AI }), xml });
  const batch = await openSession([], { mgr: new SessionManager({ defaultAiAuthor: AI }), xml });
  return { standalone, batch };
}

function conventionWarnings(result: object): string[] {
  const raw = ((result as { warnings?: unknown }).warnings ?? []) as Array<string | { warning: string }>;
  return raw
    .map((w) => (typeof w === 'string' ? w : w.warning))
    .filter((w) => w.startsWith(FORMATTING_CONVENTION_WARNING_CODE));
}

async function bodyText(opened: Awaited<ReturnType<typeof openSession>>): Promise<string[]> {
  const session = await opened.mgr.getSessionByFilePath(opened.filePath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  return session.doc.buildDocumentView({ includeSemanticTags: false }).nodes.map((n) => n.clean_text);
}

describe('batch_edit AI-revision preflight judges the edit that runs (#1478)', () => {
  registerCleanup();

  test('replace sharing a prefix and suffix with a tracked defined term', async () => {
    const { standalone, batch } = await twinSessions(CONVENTION_BODY + TRACKED_TARGET);
    const targetId = standalone.paraIds[standalone.paraIds.length - 1]!;
    const edit = {
      target_paragraph_id: targetId,
      old_string: 'notice (the “Notice”) within ten days',
      new_string: 'notice (the “Notice”) within thirty days',
      instruction: 'lengthen the notice window',
    };

    const single = await replaceText(standalone.mgr, { file_path: standalone.filePath, ...edit });
    const batched = await batchEdit(batch.mgr, {
      file_path: batch.filePath,
      steps: [{ step_id: 's1', operation: 'replace_text', ...edit }],
    });

    assertSuccess(single, 'replace_text');
    assertSuccess(batched, 'batch_edit');
    // Only "ten" → "thirty" changes; the human's term is untouched, so the
    // convention check has nothing inserted to judge.
    expect(conventionWarnings(single)).toEqual([]);
    expect(conventionWarnings(batched)).toEqual(conventionWarnings(single));
    expect(await bodyText(batch)).toEqual(await bodyText(standalone));
  });

  test('replace whose new_string carries formatting tags', async () => {
    const { standalone, batch } = await twinSessions(CONVENTION_BODY + PLAIN_TARGET);
    const targetId = standalone.paraIds[standalone.paraIds.length - 1]!;
    const edit = {
      target_paragraph_id: targetId,
      old_string: 'The fee is payable',
      // Bold only: diverges from the bold-italic convention.
      new_string: 'The fee is payable (each, a “<b>Fee Item</b>”)',
      instruction: 'introduce a defined term for the fee',
    };

    const single = await replaceText(standalone.mgr, { file_path: standalone.filePath, ...edit });
    const batched = await batchEdit(batch.mgr, {
      file_path: batch.filePath,
      steps: [{ step_id: 's1', operation: 'replace_text', ...edit }],
    });

    assertSuccess(single, 'replace_text');
    assertSuccess(batched, 'batch_edit');
    expect(conventionWarnings(single)).toHaveLength(1);
    expect(conventionWarnings(batched)).toEqual(conventionWarnings(single));
    expect(await bodyText(batch)).toEqual(await bodyText(standalone));
  });

  test('multi-paragraph insert with formatting tags', async () => {
    const { standalone, batch } = await twinSessions(CONVENTION_BODY + PLAIN_TARGET);
    const anchorId = standalone.paraIds[standalone.paraIds.length - 1]!;
    const edit = {
      positional_anchor_node_id: anchorId,
      new_string:
        'Late payments accrue interest.\r\n\r\nInterest is charged on each overdue amount (each, a “<b>Late Amount</b>”) monthly.',
      instruction: 'add two interest paragraphs',
    };

    const single = await insertParagraph(standalone.mgr, { file_path: standalone.filePath, ...edit });
    const batched = await batchEdit(batch.mgr, {
      file_path: batch.filePath,
      steps: [{ step_id: 's1', operation: 'insert_paragraph', ...edit }],
    });

    assertSuccess(single, 'insert_paragraph');
    assertSuccess(batched, 'batch_edit');
    // Bold only in the second paragraph: diverges from the bold-italic convention.
    expect(conventionWarnings(single)).toHaveLength(1);
    expect(conventionWarnings(batched)).toEqual(conventionWarnings(single));
    expect(await bodyText(batch)).toEqual(await bodyText(standalone));
  });
});
