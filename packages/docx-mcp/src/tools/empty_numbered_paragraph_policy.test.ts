/**
 * The `on_empty_numbered_paragraph` policy of replace_text and batch_edit
 * (issue #1047): an edit that leaves the paragraph it touched numbered but
 * empty, so Word shows a bare list label, is warned about, refused, resolved
 * by removing the paragraph, or ignored. One test per scenario of the
 * `add-empty-numbered-paragraph-policy` change.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect } from 'vitest';
import {
  DocxArchive,
  acceptChanges,
  getParagraphBookmarkId,
  getParagraphText,
  parseXml,
  rejectChanges,
  serializeXml,
} from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTestSessionManager,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import type { DocxSession, SessionManager } from '../session/manager.js';
import { batchEdit } from './batch_edit.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';

const TEST_FEATURE = 'add-empty-numbered-paragraph-policy';
const test = testAllure
  .epic('Document Editing')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.19' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const NUMBERING_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W_NS}">`
  + '<w:abstractNum w:abstractNumId="0">'
  + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/></w:lvl>'
  + '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimalZero"/><w:pStyle w:val="Heading2"/><w:lvlText w:val="Section 1.%2"/></w:lvl>'
  + '</w:abstractNum>'
  + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
  + '</w:numbering>';

/** Heading2 is numbered only through its style, as in Word's legal outline templates. */
const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W_NS}">`
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>'
  + '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>'
  + '</w:styles>';

const COMMENTS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W_NS}">`
  + '<w:comment w:id="7" w:author="Reviewer"><w:p><w:r><w:t>Check this obligation.</w:t></w:r></w:p></w:comment>'
  + '</w:comments>';

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const item = (inner: string): string =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${inner}</w:p>`;
const heading = (inner: string): string => `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${inner}</w:p>`;

function documentXml(middle: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>`
    + `<w:p>${run('The parties agree as follows:')}</w:p>`
    + item(run('first obligation'))
    + middle
    + item(run('third obligation'))
    + `<w:p>${run('Closing paragraph.')}</w:p>`
    + '<w:sectPr/></w:body></w:document>';
}

async function openList(middle: string, mode: 'tracked' | 'untracked', extra: Record<string, string> = {}) {
  const mgr = createTestSessionManager({ defaultAiAuthor: mode === 'tracked' ? 'SafeDocX' : null });
  const opened = await openSession([], {
    mgr,
    xml: documentXml(middle),
    extraFiles: { 'word/numbering.xml': NUMBERING_XML, 'word/styles.xml': STYLES_XML, ...extra },
  });
  // The session object stays the same across edits (each edit replaces its doc).
  const session = (await mgr.getSessionByFilePath(opened.inputPath)) as DocxSession;
  return { ...opened, mgr, session };
}

/** The paragraph id of the first body paragraph whose text contains `needle`, or of the paragraph at `index`. */
function paragraphId(session: DocxSession, find: string | number): string {
  const paragraphs = session.doc.getParagraphs();
  const p = typeof find === 'number' ? paragraphs[find] : paragraphs.find((x) => getParagraphText(x).includes(find));
  const id = p ? getParagraphBookmarkId(p) : null;
  if (!id) throw new Error(`no paragraph for ${String(find)}`);
  return id;
}

function emptyNumberedWarnings(result: Record<string, unknown>): string[] {
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return warnings
    .map((w) => (typeof w === 'string' ? w : (w as { warning: string }).warning))
    .filter((w) => /empty numbered paragraph/u.test(w));
}

async function savedDocumentXml(mgr: SessionManager, inputPath: string, outPath: string, format: 'clean' | 'tracked'): Promise<Document> {
  assertSuccess(await save(mgr, { file_path: inputPath, save_to_local_path: outPath, save_format: format }), `save ${format}`);
  const archive = await DocxArchive.load(await fs.readFile(outPath));
  return parseXml((await archive.getFile('word/document.xml'))!);
}

/** The text of each paragraph that shows a direct list label (numId 1), in order. */
function numberedTexts(doc: Document): string[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))
    .filter((p) => p.getElementsByTagNameNS(W_NS, 'numId').length > 0)
    .map((p) => ['t', 'delText']
      .flatMap((name) => Array.from(p.getElementsByTagNameNS(W_NS, name)))
      .map((t) => t.textContent ?? '')
      .join(''));
}

describe('on_empty_numbered_paragraph (#1047)', () => {
  registerCleanup();

  describe('the check after replace_text', () => {
    for (const mode of ['untracked', 'tracked'] as const) {
      test.openspec('An edit that leaves only whitespace in a list item is reported')(
        `${mode}: removing a list item's text but not its trailing space is reported`,
        async ({ given, when, then }: AllureBddContext) => {
          const s = await given('a numbered list whose middle item ends with a space', () =>
            openList(item(run('second obligation ')), mode),
          );
          const id = paragraphId(s.session, 'second obligation');
          const result = await when('replace_text removes the text without the trailing space', () =>
            replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'delete item (b)' }),
          );
          await then('the edit succeeds with one warning naming the paragraph, its label and its text before', () => {
            assertSuccess(result, 'replace_text');
            const warnings = emptyNumberedWarnings(result);
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain(id);
            expect(warnings[0]).toContain('"(b)"');
            expect(warnings[0]).toContain('"second obligation"');
            expect(warnings[0]).toContain('remove_paragraph');
          });
        },
      );
    }

    test.openspec('A pre-existing empty numbered paragraph is not reported')(
      'an empty numbered paragraph the input already had is not reported',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list whose middle item is already empty', () =>
          openList(item(''), 'untracked'),
        );
        const emptyId = paragraphId(s.session, 2);
        expect(getParagraphText(s.session.doc.getParagraphs()[2]!)).toBe('');
        const firstId = paragraphId(s.session, 'first obligation');
        const results = await when('replace_text edits the neighbouring item and adds a space to the empty one', async () => [
          await replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: firstId, old_string: 'first', new_string: 'initial', instruction: 'reword' }),
          await batchEdit(s.mgr, {
            file_path: s.inputPath,
            steps: [{ step_id: 'reword-third', operation: 'replace_text', target_paragraph_id: paragraphId(s.session, 'third obligation'), old_string: 'third', new_string: 'final', instruction: 'reword' }],
          }),
        ]);
        await then('no empty numbered paragraph warning is reported and the empty item is untouched', () => {
          for (const result of results) {
            assertSuccess(result, 'edit');
            expect(emptyNumberedWarnings(result)).toEqual([]);
          }
          expect(s.session.doc.getParagraphElementById(emptyId)).not.toBeNull();
        });
      },
    );

    test.openspec('A whole-paragraph tracked deletion is not reported')(
      'tracked: blanking a list item completely is a tracked deletion, not an empty numbered paragraph',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list in the default tracked mode', () =>
          openList(item(run('second obligation')), 'tracked'),
        );
        const id = paragraphId(s.session, 'second obligation');
        const result = await when('replace_text blanks the middle item completely', () =>
          replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'delete item (b)' }),
        );
        await then('there is no warning and the tracked save keeps the text in w:delText with a deleted mark', async () => {
          assertSuccess(result, 'replace_text');
          expect(emptyNumberedWarnings(result)).toEqual([]);
          const tracked = await savedDocumentXml(s.mgr, s.inputPath, path.join(s.tmpDir, 'tracked.docx'), 'tracked');
          expect(numberedTexts(tracked)).toEqual(['first obligation', 'second obligation', 'third obligation']);
          expect(tracked.getElementsByTagNameNS(W_NS, 'delText')).toHaveLength(1);
        });
      },
    );

    test.openspec('An image-only list item is not reported')(
      'blanking the text of a list item that also holds a drawing is not reported',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list item holding text and a drawing', () =>
          openList(item(run('see figure') + '<w:r><w:drawing/></w:r>'), 'untracked'),
        );
        const id = paragraphId(s.session, 'see figure');
        const result = await when('replace_text blanks the text', () =>
          replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'see figure', new_string: '', instruction: 'drop caption' }),
        );
        await then('there is no warning and the drawing stays', () => {
          assertSuccess(result, 'replace_text');
          expect(emptyNumberedWarnings(result)).toEqual([]);
          expect(s.session.doc.getParagraphElementById(id)?.getElementsByTagNameNS(W_NS, 'drawing')).toHaveLength(1);
        });
      },
    );

    test.openspec('A list item kept for an anchor is reported with the reason')(
      'blanking a list item wrapped in a comment range names the comment as what keeps it',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list item whose text is wrapped in a comment range', () =>
          openList(
            item(`<w:commentRangeStart w:id="7"/>${run('second obligation')}<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r>`),
            'untracked',
            { 'word/comments.xml': COMMENTS_XML },
          ),
        );
        const id = paragraphId(s.session, 'second obligation');
        const result = await when('replace_text blanks its complete text', () =>
          replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'delete item (b)' }),
        );
        await then('the warning says the comment anchor keeps the paragraph', () => {
          assertSuccess(result, 'replace_text');
          const warnings = emptyNumberedWarnings(result);
          expect(warnings).toHaveLength(1);
          expect(warnings[0]).toContain('kept because it holds a comment anchor');
        });
      },
    );

    test.openspec('A style-numbered heading is checked')(
      'blanking a style-numbered heading that holds a bookmark names its heading label',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a heading numbered only through Heading2 that holds a cross-reference bookmark', () =>
          openList(heading(`<w:bookmarkStart w:id="90" w:name="_Ref100000001"/>${run('Bravo. The second thing.')}<w:bookmarkEnd w:id="90"/>`), 'tracked'),
        );
        const id = paragraphId(s.session, 'Bravo.');
        const result = await when('replace_text blanks its complete text', () =>
          replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'Bravo. The second thing.', new_string: '', instruction: 'delete section' }),
        );
        await then('the warning names the heading label and the bookmark', () => {
          assertSuccess(result, 'replace_text');
          const warnings = emptyNumberedWarnings(result);
          expect(warnings).toHaveLength(1);
          expect(warnings[0]).toContain('"Section 1.01"');
          expect(warnings[0]).toContain('bookmark "_Ref100000001"');
        });
      },
    );
  });

  describe('policy values', () => {
    test.openspec('error refuses the edit and leaves the document unchanged')(
      'error: the edit is refused and the session document is unchanged',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list in tracked mode', () => openList(item(run('second obligation')), 'tracked'));
        const id = paragraphId(s.session, 'second obligation');
        // Package bytes carry zip timestamps, so compare the main part.
        const documentPart = async (): Promise<string | null> =>
          (await DocxArchive.load((await s.session.doc.toBuffer({ cleanBookmarks: false })).buffer)).getFile('word/document.xml');
        const before = await documentPart();
        const editCount = s.session.editCount;
        const result = await when('replace_text with error would leave the item holding a space', () =>
          replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: ' ', instruction: 'empty item (b)', on_empty_numbered_paragraph: 'error' }),
        );
        await then('it fails with EMPTY_NUMBERED_PARAGRAPH and nothing changed', async () => {
          assertFailure(result, 'EMPTY_NUMBERED_PARAGRAPH');
          expect((result as { error: { message: string } }).error.message).toContain(id);
          const current = s.session;
          expect(current.editCount).toBe(editCount);
          expect(await documentPart()).toBe(before);
          expect(current.doc.getParagraphTextById(id)).toBe('second obligation');
        });
      },
    );

    test.openspec('ignore reports nothing')(
      'ignore: no warning and the empty numbered paragraph remains',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list in untracked mode', () => openList(item(run('second obligation')), 'untracked'));
        const id = paragraphId(s.session, 'second obligation');
        const result = await when('replace_text with ignore leaves the item holding a space', () =>
          replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: ' ', instruction: 'empty item (b)', on_empty_numbered_paragraph: 'ignore' }),
        );
        await then('the edit succeeds without a warning and the paragraph remains', () => {
          assertSuccess(result, 'replace_text');
          expect(result.warnings).toBeUndefined();
          expect(s.session.doc.getParagraphTextById(id)).toBe(' ');
        });
      },
    );

    test.openspec('remove_paragraph removes the list item untracked')(
      'remove_paragraph, untracked: the emptied item is removed and the list numbers on',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a three-item numbered list in untracked mode, the middle item ending with a space', () =>
          openList(item(run('second obligation ')), 'untracked'),
        );
        const id = paragraphId(s.session, 'second obligation');
        const result = await when('replace_text with remove_paragraph removes the text but not the space', () =>
          replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'delete item (b)', on_empty_numbered_paragraph: 'remove_paragraph' }),
        );
        await then('the paragraph is gone, the response says so, and the clean save has two items', async () => {
          assertSuccess(result, 'replace_text');
          expect(result.warnings).toEqual([expect.stringContaining(`Paragraph ${id} was left as an empty numbered paragraph and was removed`)]);
          expect(s.session.doc.getParagraphElementById(id)).toBeNull();
          const clean = await savedDocumentXml(s.mgr, s.inputPath, path.join(s.tmpDir, 'clean.docx'), 'clean');
          expect(numberedTexts(clean)).toEqual(['first obligation', 'third obligation']);
        });
      },
    );

    test.openspec('remove_paragraph deletes the list item as a tracked change')(
      'remove_paragraph, tracked: accept-all removes the item and reject-all restores it',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a three-item numbered list in tracked mode, the middle item ending with a space', () =>
          openList(item(run('second obligation ')), 'tracked'),
        );
        const id = paragraphId(s.session, 'second obligation');
        const result = await when('replace_text with remove_paragraph removes the text but not the space', () =>
          replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'delete item (b)', on_empty_numbered_paragraph: 'remove_paragraph' }),
        );
        await then('the tracked output deletes the text and the mark; accept leaves two items and reject restores the original', async () => {
          assertSuccess(result, 'replace_text');
          expect(result.warnings).toEqual([expect.stringContaining('deleted as a tracked change')]);
          const accepted = await savedDocumentXml(s.mgr, s.inputPath, path.join(s.tmpDir, 'tracked.docx'), 'tracked');
          const rejected = parseXml(serializeXml(accepted));
          acceptChanges(accepted);
          expect(numberedTexts(accepted)).toEqual(['first obligation', 'third obligation']);
          rejectChanges(rejected);
          expect(numberedTexts(rejected)).toEqual(['first obligation', 'second obligation ', 'third obligation']);
        });
      },
    );

    test.openspec('remove_paragraph keeps a paragraph the blanking rules keep')(
      'remove_paragraph: a list item holding a bookmark is kept and the bookmark is named',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list item holding a cross-reference bookmark', () =>
          openList(item(`<w:bookmarkStart w:id="91" w:name="_Ref200000002"/>${run('second obligation')}<w:bookmarkEnd w:id="91"/>`), 'untracked'),
        );
        const id = paragraphId(s.session, 'second obligation');
        const result = await when('replace_text with remove_paragraph blanks its complete text', () =>
          replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'delete item (b)', on_empty_numbered_paragraph: 'remove_paragraph' }),
        );
        await then('the paragraph remains and the warning names the bookmark', () => {
          assertSuccess(result, 'replace_text');
          const warnings = emptyNumberedWarnings(result);
          expect(warnings).toHaveLength(1);
          expect(warnings[0]).toContain('"remove_paragraph", but the paragraph was not removed');
          expect(warnings[0]).toContain('bookmark "_Ref200000002"');
          expect(s.session.doc.getParagraphElementById(id)).not.toBeNull();
        });
      },
    );

    test.openspec('An unknown policy value is rejected')(
      'an unknown on_empty_numbered_paragraph value is rejected by replace_text and batch_edit',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list', () => openList(item(run('second obligation')), 'untracked'));
        const id = paragraphId(s.session, 'second obligation');
        const results = await when('both tools are called with on_empty_numbered_paragraph "delete"', async () => [
          await replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second', new_string: '', instruction: 'x', on_empty_numbered_paragraph: 'delete' }),
          await batchEdit(s.mgr, {
            file_path: s.inputPath,
            on_empty_numbered_paragraph: 'delete',
            steps: [{ step_id: 's1', operation: 'replace_text', target_paragraph_id: id, old_string: 'second', new_string: '', instruction: 'x' }],
          }),
        ]);
        await then('both fail with INVALID_PARAMS and the paragraph is unchanged', () => {
          for (const result of results) assertFailure(result, 'INVALID_PARAMS');
          expect(s.session.doc.getParagraphTextById(id)).toBe('second obligation');
          expect(s.session.editCount).toBe(0);
        });
      },
    );
  });

  describe('reasons, partial batches and batch removal', () => {
    test.openspec('An edit that leaves only whitespace in a list item is reported')(
      'untracked: a blanked list item whose only marker is its paragraph-id bookmark gets the retry remedy',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list item that holds an internal _bk_ bookmark inside the paragraph', () =>
          openList(item(`<w:bookmarkStart w:id="93" w:name="_bk_inner00001"/>${run('second obligation')}<w:bookmarkEnd w:id="93"/>`), 'untracked'),
        );
        const id = paragraphId(s.session, 'second obligation');
        const results = await when('replace_text blanks its text under warn', async () => [
          await replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'delete item (b)' }),
        ]);
        await then('the warning names no holder and tells the caller to retry with remove_paragraph', () => {
          assertSuccess(results[0]!, 'replace_text');
          const warnings = emptyNumberedWarnings(results[0]!);
          expect(warnings).toHaveLength(1);
          expect(warnings[0]).not.toContain('is kept because');
          expect(warnings[0]).toContain('To delete the list item, repeat the edit with on_empty_numbered_paragraph: "remove_paragraph".');
        });
      },
    );

    const keepCases = [
      { name: 'section properties', middle: item(run('second obligation')).replace('</w:numPr></w:pPr>', '</w:numPr><w:sectPr/></w:pPr>'), reason: 'section properties (w:sectPr)' },
      { name: 'a resultless field', middle: item(run('second obligation') + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> XE "second" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'), reason: 'a field with no visible result' },
      { name: 'a table cell', middle: `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>${item(run('second obligation'))}</w:tc></w:tr></w:tbl>`, reason: 'table cell\'s only paragraph' },
    ];
    for (const keep of keepCases) {
      test.openspec('A list item kept for an anchor is reported with the reason')(
        `untracked: a blanked list item kept for ${keep.name} names that reason`,
        async ({ given, when, then }: AllureBddContext) => {
          const s = await given(`a numbered list item kept for ${keep.name}`, () => openList(keep.middle, 'untracked'));
          const id = paragraphId(s.session, 'second obligation');
          const result = await when('replace_text blanks its complete text', () =>
            replaceText(s.mgr, { file_path: s.inputPath, target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'delete item' }),
          );
          await then('the warning names the reason', () => {
            assertSuccess(result, 'replace_text');
            const warnings = emptyNumberedWarnings(result);
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain(keep.reason);
          });
        },
      );
    }

    for (const policy of ['warn', 'remove_paragraph'] as const) {
      test.openspec('A batch warning carries the step_id of the step that emptied the paragraph')(
        `${policy}: a batch that stops on a failing step reports what its completed steps left, without removing it`,
        async ({ given, when, then }: AllureBddContext) => {
          const s = await given('a numbered list whose middle item ends with a space', () =>
            openList(item(run('second obligation ')), 'untracked'),
          );
          const firstId = paragraphId(s.session, 'first obligation');
          const secondId = paragraphId(s.session, 'second obligation');
          const result = await when('step one empties the item and step three fails after step two makes its match ambiguous', () =>
            batchEdit(s.mgr, {
              file_path: s.inputPath,
              on_empty_numbered_paragraph: policy,
              steps: [
                { step_id: 'drop-second', operation: 'replace_text', target_paragraph_id: secondId, old_string: 'second obligation', new_string: '', instruction: 'delete item (b)' },
                { step_id: 'echo', operation: 'replace_text', target_paragraph_id: firstId, old_string: 'first', new_string: 'obligation', instruction: 'reword' },
                { step_id: 'ambiguous', operation: 'replace_text', target_paragraph_id: firstId, old_string: 'obligation', new_string: 'duty', instruction: 'reword' },
              ],
            }),
          );
          await then('the batch fails at the third step, warns with drop-second, and leaves the item in place', () => {
            expect(result.success).toBe(false);
            expect((result as { failed_step_id?: string }).failed_step_id).toBe('ambiguous');
            const entries = ((result as { warnings?: Array<{ step_id: string; warning: string }> }).warnings ?? []).filter((w) => /empty numbered paragraph/u.test(w.warning));
            expect(entries.map((e) => e.step_id)).toEqual(['drop-second']);
            expect(s.session.doc.getParagraphTextById(secondId)).toBe(' ');
          });
        },
      );
    }

    test.openspec('remove_paragraph in a batch runs after the last step')(
      'remove_paragraph, tracked batch: the emptied item is deleted as a tracked change and a kept item is reported',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a tracked list with an item ending in a space and an item holding a bookmark', () =>
          openList(item(run('second obligation ')) + item(`<w:bookmarkStart w:id="92" w:name="_Ref300000003"/>${run('bookmarked obligation')}<w:bookmarkEnd w:id="92"/>`), 'tracked'),
        );
        const secondId = paragraphId(s.session, 'second obligation');
        const keptId = paragraphId(s.session, 'bookmarked obligation');
        const result = await when('a batch empties both with remove_paragraph', () =>
          batchEdit(s.mgr, {
            file_path: s.inputPath,
            on_empty_numbered_paragraph: 'remove_paragraph',
            steps: [
              { step_id: 'drop-second', operation: 'replace_text', target_paragraph_id: secondId, old_string: 'second obligation', new_string: '', instruction: 'delete' },
              { step_id: 'drop-kept', operation: 'replace_text', target_paragraph_id: keptId, old_string: 'bookmarked obligation', new_string: '', instruction: 'delete' },
            ],
          }),
        );
        await then('drop-second gets a tracked-removal notice, drop-kept a kept warning naming the bookmark, and accept-all leaves one empty item', async () => {
          assertSuccess(result, 'batch_edit');
          const warnings = result.warnings as Array<{ step_id: string; warning: string }>;
          expect(warnings.find((w) => w.step_id === 'drop-second')?.warning).toContain('deleted as a tracked change');
          expect(warnings.find((w) => w.step_id === 'drop-kept')?.warning).toContain('bookmark "_Ref300000003"');
          const clean = await savedDocumentXml(s.mgr, s.inputPath, path.join(s.tmpDir, 'clean.docx'), 'clean');
          expect(numberedTexts(clean)).toEqual(['first obligation', '', 'third obligation']);
        });
      },
    );

    test.openspec('ignore reports nothing')(
      'ignore: a batch that empties a list item reports nothing',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list whose middle item ends with a space', () => openList(item(run('second obligation ')), 'untracked'));
        const result = await when('a batch empties it with ignore', () =>
          batchEdit(s.mgr, {
            file_path: s.inputPath,
            on_empty_numbered_paragraph: 'ignore',
            steps: [{ step_id: 'drop-second', operation: 'replace_text', target_paragraph_id: paragraphId(s.session, 'second obligation'), old_string: 'second obligation', new_string: '', instruction: 'delete' }],
          }),
        );
        await then('no warnings', () => {
          assertSuccess(result, 'batch_edit');
          expect(result.warnings).toBeUndefined();
        });
      },
    );
  });

  describe('batch_edit', () => {
    test.openspec('A batch warning carries the step_id of the step that emptied the paragraph')(
      'the warning carries the step_id of the step that emptied the list item',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list whose middle item ends with a space', () =>
          openList(item(run('second obligation ')), 'tracked'),
        );
        const result = await when('a three-step batch empties the middle item in its second step', () =>
          batchEdit(s.mgr, {
            file_path: s.inputPath,
            steps: [
              { step_id: 'reword-first', operation: 'replace_text', target_paragraph_id: paragraphId(s.session, 'first obligation'), old_string: 'first', new_string: 'initial', instruction: 'reword' },
              { step_id: 'drop-second', operation: 'replace_text', target_paragraph_id: paragraphId(s.session, 'second obligation'), old_string: 'second obligation', new_string: '', instruction: 'delete item (b)' },
              { step_id: 'reword-third', operation: 'replace_text', target_paragraph_id: paragraphId(s.session, 'third obligation'), old_string: 'third', new_string: 'final', instruction: 'reword' },
            ],
          }),
        );
        await then('exactly one empty numbered paragraph warning, stamped with drop-second', () => {
          assertSuccess(result, 'batch_edit');
          const entries = (result.warnings as Array<{ step_id: string; warning: string }>).filter((w) => /empty numbered paragraph/u.test(w.warning));
          expect(entries).toHaveLength(1);
          expect(entries[0]!.step_id).toBe('drop-second');
          expect(entries[0]!.warning).toContain('"(b)"');
        });
      },
    );

    test.openspec('A paragraph a later step fills again is not reported')(
      'a list item emptied by one step and filled by a later step is not reported',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list whose middle item starts with a tab', () =>
          openList(item('<w:r><w:tab/></w:r>' + run('second obligation')), 'untracked'),
        );
        const id = paragraphId(s.session, 'second obligation');
        const result = await when('step one leaves only the tab and step two replaces the tab with new text', () =>
          batchEdit(s.mgr, {
            file_path: s.inputPath,
            steps: [
              { step_id: 'clear', operation: 'replace_text', target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'clear' },
              { step_id: 'refill', operation: 'replace_text', target_paragraph_id: id, old_string: '\t', new_string: '\trevised obligation', instruction: 'refill' },
            ],
          }),
        );
        await then('there is no empty numbered paragraph warning', () => {
          assertSuccess(result, 'batch_edit');
          expect(emptyNumberedWarnings(result)).toEqual([]);
          expect(s.session.doc.getParagraphTextById(id)).toBe('\trevised obligation');
        });
      },
    );

    test.openspec('remove_paragraph in a batch runs after the last step')(
      'remove_paragraph: a later step can still insert after the emptied item, which is removed at the end',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list in untracked mode whose middle item ends with a space', () =>
          openList(item(run('second obligation ')), 'untracked'),
        );
        const id = paragraphId(s.session, 'second obligation');
        const result = await when('step one empties the item and step two inserts a paragraph after it, with remove_paragraph', () =>
          batchEdit(s.mgr, {
            file_path: s.inputPath,
            on_empty_numbered_paragraph: 'remove_paragraph',
            steps: [
              { step_id: 'drop-second', operation: 'replace_text', target_paragraph_id: id, old_string: 'second obligation', new_string: '', instruction: 'delete item (b)' },
              { step_id: 'add-note', operation: 'insert_paragraph', positional_anchor_node_id: id, position: 'AFTER', new_string: 'Inserted note.', instruction: 'add note' },
            ],
          }),
        );
        await then('both steps succeed, the emptied item is removed, and the notice carries drop-second', async () => {
          assertSuccess(result, 'batch_edit');
          expect(result.completed_step_ids).toEqual(['drop-second', 'add-note']);
          const notices = (result.warnings as Array<{ step_id: string; warning: string }>).filter((w) => /was removed/u.test(w.warning));
          expect(notices).toEqual([{ step_id: 'drop-second', warning: expect.stringContaining(id) }]);
          expect(s.session.doc.getParagraphElementById(id)).toBeNull();
          const clean = await savedDocumentXml(s.mgr, s.inputPath, path.join(s.tmpDir, 'clean.docx'), 'clean');
          const texts = Array.from(clean.getElementsByTagNameNS(W_NS, 'p')).map((p) => getParagraphText(p));
          expect(texts).toContain('Inserted note.');
          expect(texts.filter((t) => t.trim() === '')).toEqual([]);
        });
      },
    );

    test.openspec('error refuses the whole batch before any step is applied')(
      'error: the batch is refused before its first step touches the document',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list in tracked mode whose middle item ends with a space', () =>
          openList(item(run('second obligation ')), 'tracked'),
        );
        const firstId = paragraphId(s.session, 'first obligation');
        const result = await when('a batch whose second step empties the middle item runs with error', () =>
          batchEdit(s.mgr, {
            file_path: s.inputPath,
            on_empty_numbered_paragraph: 'error',
            steps: [
              { step_id: 'reword-first', operation: 'replace_text', target_paragraph_id: firstId, old_string: 'first', new_string: 'initial', instruction: 'reword' },
              { step_id: 'drop-second', operation: 'replace_text', target_paragraph_id: paragraphId(s.session, 'second obligation'), old_string: 'second obligation', new_string: '', instruction: 'delete item (b)' },
            ],
          }),
        );
        await then('it fails with EMPTY_NUMBERED_PARAGRAPH naming drop-second, and the first step was not applied', () => {
          assertFailure(result, 'EMPTY_NUMBERED_PARAGRAPH');
          expect((result as { error: { message: string } }).error.message).toContain("'drop-second'");
          expect((result as { empty_numbered_paragraphs?: Array<{ step_id: string }> }).empty_numbered_paragraphs?.map((f) => f.step_id)).toEqual(['drop-second']);
          expect(s.session.doc.getParagraphTextById(firstId)).toBe('first obligation');
          expect(s.session.editCount).toBe(0);
        });
      },
    );

    test.openspec('error refuses the whole batch before any step is applied')(
      'error: a batch that inserts a paragraph and then empties a list item is refused with no paragraph inserted',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list whose middle item ends with a space', () => openList(item(run('second obligation ')), 'untracked'));
        const firstId = paragraphId(s.session, 'first obligation');
        const before = s.session.doc.getParagraphs().length;
        const result = await when('a batch inserts a paragraph after item (a) and then blanks item (b), with error', () =>
          batchEdit(s.mgr, {
            file_path: s.inputPath,
            on_empty_numbered_paragraph: 'error',
            steps: [
              { step_id: 'add-note', operation: 'insert_paragraph', positional_anchor_node_id: firstId, position: 'AFTER', new_string: 'inserted note', instruction: 'add a note' },
              { step_id: 'drop-second', operation: 'replace_text', target_paragraph_id: paragraphId(s.session, 'second obligation'), old_string: 'second obligation', new_string: '', instruction: 'delete item (b)' },
            ],
          }),
        );
        await then('it fails naming drop-second and the document still has its original paragraphs', () => {
          assertFailure(result, 'EMPTY_NUMBERED_PARAGRAPH');
          expect((result as { empty_numbered_paragraphs?: Array<{ step_id: string }> }).empty_numbered_paragraphs?.map((f) => f.step_id)).toEqual(['drop-second']);
          expect(s.session.doc.getParagraphs().length).toBe(before);
          expect(s.session.editCount).toBe(0);
        });
      },
    );

    test.openspec('error refuses the whole batch before any step is applied')(
      'error: a batch that inserts a paragraph and leaves every list item filled is applied',
      async ({ given, when, then }: AllureBddContext) => {
        const s = await given('a numbered list', () => openList(item(run('second obligation')), 'untracked'));
        const firstId = paragraphId(s.session, 'first obligation');
        const result = await when('a batch inserts a paragraph and rewords item (b), with error', () =>
          batchEdit(s.mgr, {
            file_path: s.inputPath,
            on_empty_numbered_paragraph: 'error',
            steps: [
              { step_id: 'add-note', operation: 'insert_paragraph', positional_anchor_node_id: firstId, position: 'AFTER', new_string: 'inserted note', instruction: 'add a note' },
              { step_id: 'reword-second', operation: 'replace_text', target_paragraph_id: paragraphId(s.session, 'second obligation'), old_string: 'second', new_string: 'next', instruction: 'reword item (b)' },
            ],
          }),
        );
        await then('both steps are applied and no empty-numbered warning is returned', () => {
          assertSuccess(result, 'batch_edit');
          expect(emptyNumberedWarnings(result)).toEqual([]);
          expect(s.session.doc.getParagraphs().map((p) => p.textContent)).toContain('inserted note');
        });
      },
    );

    for (const mode of ['untracked', 'tracked'] as const) {
      for (const newString of ['<b></b>', '<b> </b>']) {
        test.openspec('error refuses the whole batch before any step is applied')(
          `error, ${mode}: a formatting-tag replacement ${newString} that empties the item is refused before any step`,
          async ({ given, when, then }: AllureBddContext) => {
            const s = await given('a numbered list whose middle item ends with a space', () =>
              openList(item(run('second obligation ')), mode),
            );
            const firstId = paragraphId(s.session, 'first obligation');
            const secondId = paragraphId(s.session, 'second obligation');
            const result = await when(`a batch whose second step replaces the item text with ${newString} runs with error`, () =>
              batchEdit(s.mgr, {
                file_path: s.inputPath,
                on_empty_numbered_paragraph: 'error',
                steps: [
                  { step_id: 'reword-first', operation: 'replace_text', target_paragraph_id: firstId, old_string: 'first', new_string: 'initial', instruction: 'reword' },
                  { step_id: 'empty-second', operation: 'replace_text', target_paragraph_id: secondId, old_string: 'second obligation', new_string: newString, instruction: 'empty item (b)' },
                ],
              }),
            );
            await then('it fails naming empty-second and no step was applied', () => {
              assertFailure(result, 'EMPTY_NUMBERED_PARAGRAPH');
              expect((result as { error: { message: string } }).error.message).toContain('No step was applied');
              expect(s.session.doc.getParagraphTextById(firstId)).toBe('first obligation');
              expect(s.session.doc.getParagraphTextById(secondId)).toBe('second obligation ');
              expect(s.session.editCount).toBe(0);
            });
          },
        );
      }
    }
  });
});
