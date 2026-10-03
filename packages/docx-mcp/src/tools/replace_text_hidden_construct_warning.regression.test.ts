/**
 * Regression test for issue #1097: an untracked (clean) replace_text whose
 * range spans content that is not in the paragraph text — a result-less field
 * such as an `XE` index entry, or a footnote / endnote reference — removed it
 * and returned success with no warning. The clean path already warned for a
 * `w:sym` character (#1044) and the tracked path records the removal as a
 * `w:del` (#1082); the caller of a clean edit was the only one who could not
 * tell that something it never saw was deleted.
 *
 * Exercises the package path — open → replace_text (→ save clean) — and
 * asserts the issue's acceptance criteria: the response names the field
 * instruction or the note id it removed, and an edit that removes none of
 * these raises no new warning.
 */
import path from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';
import { readDocumentXmlFromPath } from '../testing/docx_test_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Replace Text' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const T = (s: string): string => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;

const XE_FIELD =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> XE "Alpha" </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const REF_FIELD_WITH_RESULT =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> REF Sec1 \\h </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  T('Section 1') +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const FOOTNOTE_REF = '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>';
const ENDNOTE_REF = '<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="1"/></w:r>';

const FOOTNOTES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="${W_NS}">` +
  '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Note text.</w:t></w:r></w:p></w:footnote>' +
  '</w:footnotes>';

const ENDNOTES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:endnotes xmlns:w="${W_NS}">` +
  '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
  '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
  '<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> End note text.</w:t></w:r></w:p></w:endnote>' +
  '</w:endnotes>';

function wrapDoc(paragraph: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    '<w:body>' +
    '<w:p><w:r><w:t xml:space="preserve">Intro paragraph.</w:t></w:r></w:p>' +
    paragraph +
    '<w:p><w:r><w:t xml:space="preserve">Closing paragraph.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
}

async function cleanReplace(
  paragraph: string,
  oldString: string,
  newString: string,
  extraFiles?: Record<string, string>,
): Promise<{ warnings: string[]; afterText: string; savedXml: string }> {
  const mgr = createTestSessionManager({ defaultAiAuthor: null });
  const session = await openSession([], { mgr, xml: wrapDoc(paragraph), extraFiles });
  const replaced = await replaceText(mgr, {
    file_path: session.inputPath,
    target_paragraph_id: session.paraIds[1]!,
    old_string: oldString,
    new_string: newString,
    instruction: 'edit',
  });
  assertSuccess(replaced, 'replace_text');
  const outPath = path.join(session.tmpDir, 'out-clean.docx');
  assertSuccess(await save(mgr, { file_path: session.inputPath, save_to_local_path: outPath, save_format: 'clean' }), 'save clean');
  return {
    warnings: (replaced as { warnings?: string[] }).warnings ?? [],
    afterText: String(replaced.after_text),
    savedXml: await readDocumentXmlFromPath(outPath),
  };
}

describe('replace_text — a clean range spanning a result-less field or a note reference (#1097)', () => {
  registerCleanup();

  test('a clean replace that removes a result-less XE field warns and names the field instruction', async ({ given, when, then }: AllureBddContext) => {
    const paragraph = await given('a paragraph "Alpha ⟨XE "Alpha"⟩Bravo" whose index entry is not in the paragraph text', () =>
      `<w:p>${T('Alpha ')}${XE_FIELD}${T('Bravo')}</w:p>`);

    const result = await when('replace_text replaces "Alpha Bravo" with "Charlie" without tracking', () =>
      cleanReplace(paragraph, 'Alpha Bravo', 'Charlie'));

    await then('the response warns that a field with instruction XE "Alpha" was removed, and the saved paragraph has no field', () => {
      expect(result.afterText).toBe('Charlie');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toBe(
        'The replaced range spanned a field with no result (instruction: XE "Alpha") not shown in the paragraph text; it was removed with the replaced text.',
      );
      expect(result.savedXml).not.toContain('instrText');
    });
  });

  test('control: an empty w:fldSimple inside the range survives the clean replace and raises no warning', async ({ given, when, then }: AllureBddContext) => {
    const paragraph = await given('a paragraph with an empty w:fldSimple PAGE field between two words', () =>
      `<w:p>${T('Alpha ')}<w:fldSimple w:instr=" PAGE "/>${T(' Bravo')}</w:p>`);

    const result = await when('replace_text replaces the range spanning the field', () =>
      cleanReplace(paragraph, 'a  B', 'X'));

    await then('the field marker is still in the saved paragraph and nothing is reported removed', () => {
      expect(result.afterText).toBe('AlphXravo');
      expect(result.warnings).toEqual([]);
      expect(result.savedXml).toContain('<w:fldSimple w:instr=" PAGE "/>');
    });
  });

  test('a clean replace that removes a footnote reference warns and names the note id', async ({ given, when, then }: AllureBddContext) => {
    const paragraph = await given('a paragraph "Alpha⟨footnoteReference 1⟩ Bravo" with its footnotes part', () =>
      `<w:p>${T('Alpha')}${FOOTNOTE_REF}${T(' Bravo')}</w:p>`);

    const result = await when('replace_text replaces "Alpha Bravo" with "Charlie" without tracking', () =>
      cleanReplace(paragraph, 'Alpha Bravo', 'Charlie', { 'word/footnotes.xml': FOOTNOTES_XML }));

    await then('the response warns that footnote reference 1 was removed and that its body remains', () => {
      expect(result.afterText).toBe('Charlie');
      expect(result.warnings).toEqual([
        'The replaced range spanned a footnote reference (note id 1) not shown in the paragraph text; it was removed with the replaced text. Its note body stays in the notes part, no longer referenced.',
      ]);
      expect(result.savedXml).not.toContain('footnoteReference');
    });
  });

  test('a clean replace that removes an endnote reference warns and names the note id', async ({ given, when, then }: AllureBddContext) => {
    const paragraph = await given('a paragraph "Alpha⟨endnoteReference 1⟩ Bravo" with its endnotes part', () =>
      `<w:p>${T('Alpha')}${ENDNOTE_REF}${T(' Bravo')}</w:p>`);

    const result = await when('replace_text replaces "Alpha Bravo" with "Charlie" without tracking', () =>
      cleanReplace(paragraph, 'Alpha Bravo', 'Charlie', { 'word/endnotes.xml': ENDNOTES_XML }));

    await then('the response warns that endnote reference 1 was removed', () => {
      expect(result.afterText).toBe('Charlie');
      expect(result.warnings).toEqual([
        'The replaced range spanned an endnote reference (note id 1) not shown in the paragraph text; it was removed with the replaced text. Its note body stays in the notes part, no longer referenced.',
      ]);
      expect(result.savedXml).not.toContain('endnoteReference');
    });
  });

  test('a range spanning both a field and a note reference reports each in document order', async ({ given, when, then }: AllureBddContext) => {
    const paragraph = await given('a paragraph with an XE field and then a footnote reference inside the same range', () =>
      `<w:p>${T('Alpha ')}${XE_FIELD}${T('Bravo')}${FOOTNOTE_REF}${T(' Charlie')}</w:p>`);

    const result = await when('replace_text replaces the whole paragraph text', () =>
      cleanReplace(paragraph, 'Alpha Bravo Charlie', 'Delta', { 'word/footnotes.xml': FOOTNOTES_XML }));

    await then('two warnings name the field first and the note second', () => {
      expect(result.afterText).toBe('Delta');
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toContain('field with no result (instruction: XE "Alpha")');
      expect(result.warnings[1]).toContain('footnote reference (note id 1)');
    });
  });

  test('control: an edit that removes none of these raises no new warning', async ({ given, when, then }: AllureBddContext) => {
    const paragraph = await given('a paragraph with an XE field and a footnote reference after the edited word', () =>
      `<w:p>${T('Alpha ')}${XE_FIELD}${T('Bravo')}${FOOTNOTE_REF}${T(' Charlie')}</w:p>`);

    const beforeField = await when('replace_text edits only the text before the field', () =>
      cleanReplace(paragraph, 'Alpha', 'Alfa', { 'word/footnotes.xml': FOOTNOTES_XML }));
    const betweenThem = await when('replace_text edits only the text between the field and the note reference', () =>
      cleanReplace(paragraph, 'Bravo', 'Beta', { 'word/footnotes.xml': FOOTNOTES_XML }));
    const afterNote = await when('replace_text edits only the text after the note reference', () =>
      cleanReplace(paragraph, 'Charlie', 'Gamma', { 'word/footnotes.xml': FOOTNOTES_XML }));

    await then('no warning is raised and the field and reference are still in the saved paragraph', () => {
      for (const result of [beforeField, betweenThem, afterNote]) {
        expect(result.warnings).toEqual([]);
        expect(result.savedXml).toContain('XE "Alpha"');
        expect(result.savedXml).toContain('footnoteReference');
      }
    });
  });

  test('control: a field whose cached result is in the paragraph text is not reported as hidden', async ({ given, when, then }: AllureBddContext) => {
    const paragraph = await given('a paragraph "See ⟨REF Sec1⟩Section 1 above" whose field result the caller can see', () =>
      `<w:p>${T('See ')}${REF_FIELD_WITH_RESULT}${T(' above')}</w:p>`);

    const result = await when('replace_text edits the cached result "Section 1" to "Section 2"', () =>
      cleanReplace(paragraph, 'Section 1', 'Section 2'));

    await then('no hidden-construct warning is raised and the field is still there', () => {
      expect(result.afterText).toBe('See Section 2 above');
      expect(result.savedXml).toContain('REF Sec1');
      expect(result.warnings.filter((w) => w.includes('not shown in the paragraph text'))).toEqual([]);
    });
  });

  test('tracked mode: the same range over an XE field says the field was deleted as a tracked change', async ({ given, when, then }: AllureBddContext) => {
    const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX' });
    const session = await given('the XE paragraph opened with tracked emission', () =>
      openSession([], { mgr, xml: wrapDoc(`<w:p>${T('Alpha ')}${XE_FIELD}${T('Bravo')}</w:p>`) }));

    const replaced = await when('replace_text replaces "Alpha Bravo" with "Charlie"', () =>
      replaceText(mgr, {
        file_path: session.inputPath,
        target_paragraph_id: session.paraIds[1]!,
        old_string: 'Alpha Bravo',
        new_string: 'Charlie',
        instruction: 'edit',
      }));

    await then('the warning names the instruction and points at rejecting the deletion', () => {
      assertSuccess(replaced, 'replace_text');
      const warnings = (replaced as { warnings?: string[] }).warnings ?? [];
      expect(warnings).toEqual([
        'The replaced range spanned a field with no result (instruction: XE "Alpha") not shown in the paragraph text; it was deleted with the replaced text as a tracked change; reject the deletion to restore.',
      ]);
    });
  });

  test('control: a field and a note reference already inside a tracked deletion are not reported', async ({ given, when, then }: AllureBddContext) => {
    const paragraph = await given('a paragraph whose XE field and footnote reference sit inside an existing w:del', () =>
      `<w:p>${T('Alpha ')}<w:del w:id="90" w:author="Reviewer" w:date="2024-01-01T00:00:00Z">` +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:delInstrText xml:space="preserve"> XE "Alpha" </w:delInstrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' +
      `</w:del>${T('Bravo')}</w:p>`);

    const result = await when('replace_text replaces "Alpha Bravo" with "Charlie" without tracking', () =>
      cleanReplace(paragraph, 'Alpha Bravo', 'Charlie', { 'word/footnotes.xml': FOOTNOTES_XML }));

    await then('no hidden-construct warning is raised: the deleted constructs were never live', () => {
      expect(result.afterText).toBe('Charlie');
      expect(result.warnings.filter((w) => w.includes('not shown in the paragraph text'))).toEqual([]);
    });
  });
});

