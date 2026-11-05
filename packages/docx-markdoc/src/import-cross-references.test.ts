import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { DocxDocument, buildParagraphIndex, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from './compile.js';
import { createDocumentFromMarkdoc } from './create/create.js';
import { importDocxToMarkdoc } from './import.js';
import { parseMarkdoc } from './markdoc.js';
import { slugForBookmarkName } from './xref.js';

const TEST_FEATURE = 'restore-imported-cross-references';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1260 cross-references survive import and compile',
  severity: 'critical',
});
const conforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' });

const EVIDENCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/oracle/word/evidence');

type WordEvidence = {
  sourceMarkdoc: string;
  before: { fields: Array<{ story: string; instruction: string; result: string }> };
  after: { fields: Array<{ story: string; instruction: string; result: string }> };
};

/** Each scenario creates, imports and compiles several documents; coverage instrumentation slows that several times over. */
const LOAD_SENSITIVE_TIMEOUT_MS = 60_000;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PRESERVE = { annotationPresentation: { unspecified: { as: 'preserve' as const } } };

/** A `create` agreement with numbered headings and references in the body, a table cell and a footnote, in every form. */
const AGREEMENT = [
  '---',
  'title: Supply Agreement',
  'heading-numbers: legal',
  '---',
  '',
  '# SUPPLY AGREEMENT',
  '',
  '## Definitions {% #definitions %}',
  '',
  '### Defined Terms {% #defined-terms %}',
  '',
  '1. Products {% #products %}',
  '2. Price {% #price %}',
  '   1. Adjustment {% #price-adjustment %}',
  '',
  '## Delivery {% #delivery %}',
  '',
  '### Delivery Terms {% #delivery-terms %}',
  '',
  'Deliveries follow {% xref to="defined-terms" /%} and clause {% xref to="price-adjustment" number="paragraph" /%} of it.',
  '',
  'The {% xref to="delivery-terms" show="text" /%} section governs.',
  '',
  '{% xref to="price" /%} sets the price.',
  '',
  'Notes apply.{% fnref id="note" /%}',
  '',
  '{% table %}',
  '* Term',
  '* Reference',
  '---',
  '* Adjustment',
  '* {% xref to="price-adjustment" /%}',
  '{% /table %}',
  '',
  '{% footnote id="note" %}Compare {% xref to="price-adjustment" /%} and the {% xref to="products" show="text" /%} clause.{% /footnote %}',
].join('\n');

type Field = { part: string; instruction: string; result: string; paragraph: string };

async function partXml(docx: Buffer, name: string): Promise<Document | null> {
  const file = (await JSZip.loadAsync(docx)).file(name);
  return file ? parseXml(await file.async('string')) : null;
}

/** Every complex field of the body and the footnotes, in order, with its paragraph's text. */
async function fieldsOf(docx: Buffer): Promise<Field[]> {
  const fields: Field[] = [];
  for (const name of ['word/document.xml', 'word/footnotes.xml']) {
    const xml = await partXml(docx, name);
    if (!xml) continue;
    for (const paragraph of Array.from(xml.getElementsByTagNameNS(W, 'p'))) {
      const index = buildParagraphIndex(paragraph);
      for (const field of index.fields) {
        const result = index.runs.filter((run) => run.fieldResultId === field.id).map((run) => run.visibleText).join('');
        fields.push({ part: name, instruction: field.instruction, result, paragraph: index.text });
      }
    }
  }
  return fields;
}

/** The text of the paragraph each named bookmark starts in, by name. */
async function bookmarkTargets(docx: Buffer): Promise<Record<string, string>> {
  const xml = (await partXml(docx, 'word/document.xml'))!;
  const targets: Record<string, string> = {};
  for (const start of Array.from(xml.getElementsByTagNameNS(W, 'bookmarkStart'))) {
    const name = start.getAttributeNS(W, 'name') ?? '';
    if (name.startsWith('_bk_')) continue;
    let paragraph: Node | null = start.parentNode;
    while (paragraph && (paragraph as Element).localName !== 'p') paragraph = paragraph.parentNode;
    targets[name] = paragraph ? buildParagraphIndex(paragraph as Element).text : '';
  }
  return targets;
}

async function rewrite(docx: Buffer, name: string, edit: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  const before = await zip.file(name)!.async('string');
  const after = edit(before);
  expect(after, `rewrite of ${name} changed nothing`).not.toBe(before);
  zip.file(name, after);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function failure(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'succeeded',
    (error: { code?: string; details?: { reason?: string } | unknown[] }) => {
      const details = error.details;
      if (Array.isArray(details)) return `${error.code}:${details.map((item) => (item as { code?: string }).code).join(',')}`;
      return details && typeof details === 'object' && 'reason' in details ? `${error.code}:${details.reason}` : `${error.code}`;
    },
  );
}

/** The anchored `{% para %}` block holding `needle`. */
function block(markdoc: string, needle: string): { block: string; open: string; body: string } {
  const found = markdoc.split('\n\n').find((candidate) => candidate.startsWith('{% para ') && candidate.includes(needle));
  if (!found) throw new Error(`No para block holds ${needle}`);
  const [open, body] = found.split('\n');
  return { block: found, open: open!, body: body! };
}

/** Turn the para block holding `needle` into a change block whose after state is `after(body)`. */
function change(markdoc: string, needle: string, after: (body: string) => string, edit = 'edit-1'): string {
  const { block: found, open, body } = block(markdoc, needle);
  const attributes = open.slice('{% para '.length, -' %}'.length);
  return markdoc.replace(found, [
    `{% change ${attributes} edit="${edit}" format="inherit-source-paragraph" %}`,
    '{% before %}', body, '{% /before %}',
    '{% after %}', after(body), '{% /after %}',
    '{% /change %}',
  ].join('\n'));
}

function replaceOnce(text: string, from: string, to: string): string {
  expect(text, `expected ${JSON.stringify(from)}`).toContain(from);
  return text.replace(from, to);
}

async function acceptedText(docx: Buffer, projection: 'accept' | 'reject'): Promise<string> {
  const document = await DocxDocument.load(docx);
  await (projection === 'accept' ? document.acceptChanges() : document.rejectChanges());
  return document.buildDocumentView({ includeSemanticTags: false, showFormatting: false }).nodes.map((node) => node.raw_text ?? node.text).join('\n');
}

describe('Traceability: cross-references survive import and compile', () => {
  conforming.openspec('[SDX-MDOC-XREFIMPORT-01] import restores each REF field as an xref tag and compile writes the same fields back')(
    'Scenario: import restores each REF field as an xref tag and compile writes the same fields back',
    async () => {
      const created = await createDocumentFromMarkdoc(AGREEMENT);
      expect(created.certificate.passed).toBe(true);
      const imported = await importDocxToMarkdoc(created.docx);

      // Body, table-cell and footnote references come back as tags over their cached results, in each form.
      expect(block(imported.markdoc, 'Deliveries follow').body).toBe(
        'Deliveries follow&#32;{% xref to="defined-terms" %}Section 1.01{% /xref %}&#32;and clause&#32;{% xref to="price-adjustment" number="paragraph" %}(i){% /xref %}&#32;of it.',
      );
      expect(block(imported.markdoc, 'section governs').body).toBe('The&#32;{% xref to="delivery-terms" show="text" %}Delivery Terms{% /xref %}&#32;section governs.');
      expect(block(imported.markdoc, 'sets the price').body).toBe('{% xref to="price" %}Section 1.01(b){% /xref %}&#32;sets the price.');
      // A table cell holding only a reference.
      expect(imported.markdoc).toContain('\n{% xref to="price-adjustment" %}Section 1.01(b)(i){% /xref %}\n');
      expect(imported.markdoc).toContain('{% xref to="price-adjustment" %}{% annotation-run size=20 %}Section 1.01(b)(i){% /annotation-run %}{% /xref %}');
      expect(imported.markdoc).toContain('{% xref to="products" show="text" %}{% annotation-run size=20 %}Products{% /annotation-run %}{% /xref %}');
      // The dialect validates, and each paragraph's text projection is still its source text.
      const parsed = parseMarkdoc(imported.markdoc);
      expect(parsed.valid).toBe(true);
      const scaffold = parsed.valid ? parsed.ir.scaffold : [];
      expect(scaffold.find((paragraph) => paragraph.originalText.startsWith('Deliveries follow'))).toMatchObject({
        originalText: 'Deliveries follow Section 1.01 and clause (i) of it.',
        originalCrossReferences: [
          { start: 18, end: 30, text: 'Section 1.01', reference: { bookmark: 'defined_terms', show: 'number', number: 'full', hyperlink: true } },
          { start: 42, end: 45, text: '(i)', reference: { bookmark: 'price_adjustment', show: 'number', number: 'paragraph', hyperlink: true } },
        ],
      });

      // Import → compile with nothing edited: every field keeps its instruction, its bookmark and its target, and the
      // footnote, which compile writes again, holds its REF fields rather than their text.
      const compiled = await compileMarkdoc(imported.anchoredSource, imported.markdoc, PRESERVE);
      expect(compiled.certificate.passed).toBe(true);
      const before = await fieldsOf(created.docx);
      const after = await fieldsOf(compiled.tracked);
      expect(before.map(({ part, instruction }) => [part, instruction])).toEqual([
        ['word/document.xml', 'REF defined_terms \\w \\h'],
        ['word/document.xml', 'REF price_adjustment \\n \\h'],
        ['word/document.xml', 'REF delivery_terms \\h'],
        ['word/document.xml', 'REF price \\w \\h'],
        ['word/document.xml', 'REF price_adjustment \\w \\h'],
        ['word/footnotes.xml', 'REF price_adjustment \\w \\h'],
        ['word/footnotes.xml', 'REF products \\h'],
      ]);
      expect(after.map(({ part, instruction, result }) => [part, instruction, result])).toEqual(before.map(({ part, instruction, result }) => [part, instruction, result]));
      expect(after.find((field) => field.part === 'word/footnotes.xml')?.paragraph).toBe(' Compare Section 1.01(b)(i) and the Products clause.');
      const targets = await bookmarkTargets(compiled.tracked);
      expect(targets).toEqual(await bookmarkTargets(created.docx));
      expect(targets).toMatchObject({ defined_terms: 'Defined Terms', price: 'Price', price_adjustment: 'Adjustment', products: 'Products', delivery_terms: 'Delivery Terms' });

      // Importing the compiled document again gives the same tags.
      const again = await importDocxToMarkdoc(compiled.tracked);
      const tags = (markdoc: string) => markdoc.match(/\{% xref [^%]*%\}/gu);
      expect(tags(again.markdoc)).toEqual(tags(imported.markdoc));
      expect(tags(imported.markdoc)).toHaveLength(7);
    },
    LOAD_SENSITIVE_TIMEOUT_MS,
  );

  conforming.openspec('[SDX-MDOC-XREFIMPORT-02] an edit beside cross-references changes the text around each field and keeps the field')(
    'Scenario: an edit beside cross-references changes the text around each field and keeps the field',
    async () => {
      const created = await createDocumentFromMarkdoc(AGREEMENT);
      const imported = await importDocxToMarkdoc(created.docx);
      let edited = change(imported.markdoc, 'Deliveries follow', (body) => replaceOnce(
        replaceOnce(body, 'Deliveries follow&#32;', 'Deliveries under this Agreement follow&#32;'),
        '{% /xref %}&#32;of it.', '{% /xref %}, as amended, of it.',
      ));
      // Text typed at the very start of a paragraph that opens with a field, and directly after a field.
      edited = change(edited, 'sets the price', (body) => replaceOnce(`Subject to ${body}`, '{% /xref %}&#32;sets the price.', '{% /xref %}, as adjusted, sets the price.'), 'edit-2');
      edited = change(edited, 'Section 1.01(b)(i){% /xref %}\n{% /para', (body) => `See ${body}`, 'edit-3');
      const compiled = await compileMarkdoc(imported.anchoredSource, edited, PRESERVE);
      expect(compiled.certificate.passed).toBe(true);
      expect(compiled.certificate.rejectAllEqualsSource && compiled.certificate.acceptAllEqualsClean).toBe(true);

      // The fields are those of the source, with the same instructions and results, in edited paragraphs.
      const fields = await fieldsOf(compiled.clean);
      expect(fields.map(({ instruction, result }) => [instruction, result])).toEqual((await fieldsOf(created.docx)).map(({ instruction, result }) => [instruction, result]));
      expect(fields.map((field) => field.paragraph).filter((text, index, all) => all.indexOf(text) === index)).toEqual([
        'Deliveries under this Agreement follow Section 1.01 and clause (i), as amended, of it.',
        'The Delivery Terms section governs.',
        'Subject to Section 1.01(b), as adjusted, sets the price.',
        'See Section 1.01(b)(i)',
        ' Compare Section 1.01(b)(i) and the Products clause.',
      ]);
      // The inserted words sit outside the fields: each field's result is only its cached number.
      const tracked = await fieldsOf(compiled.tracked);
      expect(tracked.map((field) => field.result)).toEqual(fields.map((field) => field.result));
      expect(await acceptedText(compiled.tracked, 'reject')).toBe(await acceptedText(imported.anchoredSource, 'reject'));
      expect(await acceptedText(compiled.tracked, 'accept')).toContain('Subject to Section 1.01(b), as adjusted, sets the price.');

      // A field marker may share its run with the text beside it (Word merges runs on save): an insertion at that
      // edge still lands outside the field, and the paragraph's text is exactly the after state.
      const shared = await rewrite(created.docx, 'word/document.xml', (xml) => xml
        .replace('Deliveries follow </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>', 'Deliveries follow </w:t><w:fldChar w:fldCharType="begin"/></w:r>')
        .replace('<w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> and clause </w:t></w:r>', '<w:fldChar w:fldCharType="end"/><w:t xml:space="preserve"> and clause </w:t></w:r>'));
      const sharedImport = await importDocxToMarkdoc(shared);
      const sharedEdit = change(sharedImport.markdoc, 'Deliveries follow', (body) => replaceOnce(
        replaceOnce(body, '&#32;{% xref to="defined-terms" %}', '&#32;NEW{% xref to="defined-terms" %}'),
        'Section 1.01{% /xref %}&#32;and clause', 'Section 1.01{% /xref %}NEW&#32;and clause',
      ));
      const sharedCompiled = await compileMarkdoc(sharedImport.anchoredSource, sharedEdit, PRESERVE);
      expect(sharedCompiled.certificate.passed).toBe(true);
      const sharedFields = await fieldsOf(sharedCompiled.clean);
      expect(sharedFields.slice(0, 2).map(({ instruction, result, paragraph }) => [instruction, result, paragraph])).toEqual([
        ['REF defined_terms \\w \\h', 'Section 1.01', 'Deliveries follow NEWSection 1.01NEW and clause (i) of it.'],
        ['REF price_adjustment \\n \\h', '(i)', 'Deliveries follow NEWSection 1.01NEW and clause (i) of it.'],
      ]);

      // The edited document imports again with the same references in the edited paragraphs.
      const again = await importDocxToMarkdoc(compiled.clean);
      expect(block(again.markdoc, 'as adjusted').body).toBe('Subject to&#32;{% xref to="price" %}Section 1.01(b){% /xref %}, as adjusted, sets the price.');
      expect(block(again.markdoc, 'See').body).toBe('See&#32;{% xref to="price-adjustment" %}Section 1.01(b)(i){% /xref %}');
    },
    LOAD_SENSITIVE_TIMEOUT_MS,
  );

  conforming.openspec('[SDX-MDOC-XREFIMPORT-03] the tag names its target by id where the bookmark name maps back, and by the bookmark name otherwise')(
    'Scenario: the tag names its target by id where the bookmark name maps back, and by the bookmark name otherwise',
    async () => {
      expect(slugForBookmarkName('price_adjustment')).toBe('price-adjustment');
      expect(slugForBookmarkName('_Ref123456789')).toBeUndefined();
      expect(slugForBookmarkName('Price')).toBeUndefined();
      expect(slugForBookmarkName('price__adjustment')).toBeUndefined();
      // A shortened name maps forward from a 40-character id too, so it does not name one id.
      expect(slugForBookmarkName('purchase_price_adjustment_and_w_1d68a756')).toBeUndefined();
      const longId = 'purchase-price-adjustment-and-working-capital-true-up';
      const created = await createDocumentFromMarkdoc([
        '1. Price {% #price %}',
        `2. Adjustment {% #${longId} %}`,
        '',
        `See {% xref to="price" /%} and {% xref to="${longId}" /%}.`,
        '',
        'Also {% xref to="price" number="paragraph" /%} here.',
      ].join('\n'));
      // Word's own Insert > Cross-reference names a hidden _Ref bookmark; it may also leave out \h.
      const wordNamed = await rewrite(created.docx, 'word/document.xml', (xml) => xml
        .replaceAll('w:name="price"', 'w:name="_Ref201812345"')
        .replaceAll(' REF price \\w \\h ', ' REF _Ref201812345 \\w \\h ')
        .replace(' REF price \\n \\h ', ' REF _Ref201812345 \\n '));
      const imported = await importDocxToMarkdoc(wordNamed);
      expect(block(imported.markdoc, 'See').body).toMatch(/^See&#32;\{% xref bookmark="_Ref201812345" %\}1\{% \/xref %\}&#32;and&#32;\{% xref bookmark="purchase_price_adjustment_and_w_[0-9a-f]{8}" %\}2\{% \/xref %\}\.$/u);
      expect(block(imported.markdoc, 'Also').body).toBe('Also&#32;{% xref bookmark="_Ref201812345" number="paragraph" hyperlink=false %}1{% /xref %}&#32;here.');

      // Both spellings compile back to the same fields, and an edit keeps a field without \h as it is.
      const edited = change(imported.markdoc, 'Also', (body) => replaceOnce(body, '&#32;here.', '&#32;applies here.'));
      const compiled = await compileMarkdoc(imported.anchoredSource, edited, PRESERVE);
      expect((await fieldsOf(compiled.clean)).map((field) => field.instruction)).toEqual([
        'REF _Ref201812345 \\w \\h',
        expect.stringMatching(/^REF purchase_price_adjustment_and_w_[0-9a-f]{8} \\w \\h$/u),
        'REF _Ref201812345 \\n',
      ]);
      // to="id" and bookmark="its name" are the same reference.
      const plain = await importDocxToMarkdoc(created.docx);
      const spelledOut = plain.markdoc.replace('{% xref to="price" number="paragraph" %}', '{% xref bookmark="price" number="paragraph" %}');
      expect(spelledOut).not.toBe(plain.markdoc);
      expect(await failure(compileMarkdoc(plain.anchoredSource, spelledOut, PRESERVE))).toBe('succeeded');
    },
    LOAD_SENSITIVE_TIMEOUT_MS,
  );

  test.openspec('[SDX-MDOC-XREFIMPORT-04] a REF field the dialect cannot carry stays text, and compile refuses to rewrite it')(
    'Scenario: a REF field the dialect cannot carry stays text, and compile refuses to rewrite it',
    async () => {
      const created = await createDocumentFromMarkdoc(AGREEMENT);
      /**
       * Import a mutated copy and report: why each REF field stayed text, what an unedited compile does, and what an
       * edit of the "sets the price" paragraph does.
       */
      const probe = async (name: string, edit: (xml: string) => string): Promise<string> => {
        const docx = await rewrite(created.docx, name, edit);
        const imported = await importDocxToMarkdoc(docx);
        const kept = imported.crossReferences.keptAsText.map((item) => item.reason).join(',');
        const unedited = await failure(compileMarkdoc(imported.anchoredSource, imported.markdoc, PRESERVE));
        const edited = await failure(compileMarkdoc(imported.anchoredSource, change(imported.markdoc, 'sets the price', (body) => replaceOnce(body, 'sets the price', 'fixes the price')), PRESERVE));
        if (unedited === 'succeeded') {
          // Left untouched, the field is still the source's field.
          const compiled = await compileMarkdoc(imported.anchoredSource, imported.markdoc, PRESERVE);
          expect((await fieldsOf(compiled.tracked)).map((field) => field.instruction)).toEqual((await fieldsOf(docx)).map((field) => field.instruction));
        }
        return `${kept} | ${unedited} | ${edited}`;
      };
      const field = ' REF price \\w \\h ';
      const separate = '<w:fldChar w:fldCharType="separate"/></w:r>';
      const original = await importDocxToMarkdoc(created.docx);
      expect(original.crossReferences).toEqual({ restored: 7, keptAsText: [] });
      // Switches outside \w, \n and \h: a relative number (\r), a page-position switch, a format switch, two number switches.
      expect(await probe('word/document.xml', (xml) => xml.replace(field, ' REF price \\r \\h '))).toBe('unknown-switch | succeeded | XREF_SOURCE_UNSUPPORTED:unknown-switch');
      expect(await probe('word/document.xml', (xml) => xml.replace(field, ' REF price \\p \\h '))).toBe('unknown-switch | succeeded | XREF_SOURCE_UNSUPPORTED:unknown-switch');
      expect(await probe('word/document.xml', (xml) => xml.replace(field, ' REF price \\w \\h \\* MERGEFORMAT '))).toBe('unknown-switch | succeeded | XREF_SOURCE_UNSUPPORTED:unknown-switch');
      expect(await probe('word/document.xml', (xml) => xml.replace(field, ' REF price \\w \\n \\h '))).toBe('duplicate-switch | succeeded | XREF_SOURCE_UNSUPPORTED:duplicate-switch');
      // A bookmark that is missing, or named twice.
      expect(await probe('word/document.xml', (xml) => xml.replace(field, ' REF nowhere \\w \\h '))).toBe('missing-bookmark | succeeded | XREF_SOURCE_UNSUPPORTED:missing-bookmark');
      expect(await probe('word/document.xml', (xml) => xml.replace('w:name="definitions"', 'w:name="price"'))).toBe('duplicate-bookmark | succeeded | XREF_SOURCE_UNSUPPORTED:duplicate-bookmark');
      // A field nested in the reference's result.
      const nestedAt = xmlIndexAfter(await partText(created.docx, 'word/document.xml'), field, separate);
      const at = (xml: string, inserted: string) => `${xml.slice(0, nestedAt)}${inserted}${xml.slice(nestedAt)}`;
      expect(await probe('word/document.xml', (xml) => at(xml, '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'))).toBe('nested-field | succeeded | XREF_SOURCE_UNSUPPORTED:nested-field');
      // A result edited in a way a field cannot carry: a tracked insertion in it (a source with revisions takes no
      // operative edit at all), a tab in it, no text at all.
      expect(await probe('word/document.xml', (xml) => at(xml, '<w:ins w:id="900" w:author="Reviewer" w:date="2026-11-04T00:00:00Z"><w:r><w:t>X</w:t></w:r></w:ins>'))).toBe('tracked-change | succeeded | EXISTING_REVISIONS_WITH_OPERATIVE_EDITS_UNSUPPORTED');
      expect(await probe('word/document.xml', (xml) => at(xml, '<w:r><w:tab/></w:r>'))).toBe('unsupported-result-content | succeeded | XREF_SOURCE_UNSUPPORTED:unsupported-result-content');
      expect(await probe('word/document.xml', (xml) => xml.replace(/(REF price \\w \\h <\/w:instrText><\/w:r><w:r><w:fldChar w:fldCharType="separate"\/><\/w:r><w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?)<w:t[^>]*>[^<]*<\/w:t>/u, '$1'))).toBe('empty-result | succeeded | XREF_SOURCE_UNSUPPORTED:empty-result');
      // A reference without a result.
      expect(await probe('word/document.xml', (xml) => xml.replace(`${field}</w:instrText></w:r><w:r>${separate}`, `${field}</w:instrText></w:r>`)
        .replace(/(REF price \\w \\h <\/w:instrText><\/w:r>)<w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:t[^>]*>[^<]*<\/w:t><\/w:r>/u, '$1'))).toBe('missing-result | succeeded | XREF_SOURCE_UNSUPPORTED:missing-result');
      // In a footnote, which compile always writes again, the same field fails even when nothing is edited.
      expect(await probe('word/footnotes.xml', (xml) => xml.replace(' REF products \\h ', ' REF products \\t \\h '))).toBe('unknown-switch | XREF_SOURCE_UNSUPPORTED:unknown-switch | XREF_SOURCE_UNSUPPORTED:unknown-switch');
      expect(await probe('word/footnotes.xml', (xml) => xml.replace(' REF products \\h ', ' REF gone \\h '))).toBe('missing-bookmark | XREF_SOURCE_UNSUPPORTED:missing-bookmark | XREF_SOURCE_UNSUPPORTED:missing-bookmark');
      // Other fields in a footnote still fail import as before.
      const page = await rewrite(created.docx, 'word/footnotes.xml', (xml) => xml.replace(' REF products \\h ', ' PAGE '));
      expect(await failure(importDocxToMarkdoc(page))).toBe('ANNOTATION_IMPORT_UNSUPPORTED:unsupported-field');
      // A source whose REF field sits in its own tracked deletion compiles unedited: the field leaves the accepted
      // projection of the source and of the output alike.
      const deletedField = await rewrite(created.docx, 'word/document.xml', (xml) => xml.replace(
        /(<w:r><w:fldChar w:fldCharType="begin"\/>(?:(?!<w:fldChar w:fldCharType="end"\/>).)*<w:fldChar w:fldCharType="end"\/><\/w:r>)/u,
        (fieldXml) => `<w:del w:id="901" w:author="Prior" w:date="2026-11-04T00:00:00Z">${fieldXml.replaceAll('<w:t ', '<w:delText ').replaceAll('<w:t>', '<w:delText>').replaceAll('</w:t>', '</w:delText>')}</w:del>`,
      ));
      const deletedImport = await importDocxToMarkdoc(deletedField);
      expect(await failure(compileMarkdoc(deletedImport.anchoredSource, deletedImport.markdoc, PRESERVE))).toBe('succeeded');

      // A REF unlinked into plain text (Ctrl+Shift+F9) is ordinary text and imports as text.
      const unlinked = await rewrite(created.docx, 'word/document.xml', (xml) => xml.replace(
        /<w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:fldChar w:fldCharType="begin"\/><\/w:r><w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:instrText[^>]*> REF price \\w \\h <\/w:instrText><\/w:r><w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:fldChar w:fldCharType="separate"\/><\/w:r>(<w:r>(?:(?!<\/w:r>).)*<\/w:r>)<w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:fldChar w:fldCharType="end"\/><\/w:r>/u,
        '$1',
      ));
      const unlinkedImport = await importDocxToMarkdoc(unlinked);
      expect(block(unlinkedImport.markdoc, 'sets the price').body).toBe('Section 1.01(b) sets the price.');
      expect(unlinkedImport.crossReferences).toEqual({ restored: 6, keptAsText: [] });
    },
    LOAD_SENSITIVE_TIMEOUT_MS,
  );

  test.openspec('[SDX-MDOC-XREFIMPORT-05] compile fails closed on xref tags that disagree with the source or that it cannot write')(
    'Scenario: compile fails closed on xref tags that disagree with the source or that it cannot write',
    async () => {
      const created = await createDocumentFromMarkdoc(AGREEMENT);
      const imported = await importDocxToMarkdoc(created.docx);
      const compile = (markdoc: string) => failure(compileMarkdoc(imported.anchoredSource, markdoc, PRESERVE));
      const price = block(imported.markdoc, 'sets the price');
      expect(await compile(imported.markdoc)).toBe('succeeded');
      // A tag retargeted, switched to another form, or removed (its text left in place) no longer matches the source.
      expect(await compile(imported.markdoc.replace(price.body, price.body.replace('to="price"', 'to="products"')))).toBe('XREF_DRIFT');
      expect(await compile(imported.markdoc.replace(price.body, price.body.replace('to="price"', 'to="price" number="paragraph"')))).toBe('XREF_DRIFT');
      expect(await compile(imported.markdoc.replace(price.body, price.body.replace('{% xref to="price" %}', '').replace('{% /xref %}', '')))).toBe('XREF_DRIFT');
      // An edit may change the text around a reference, not the reference: retyping its number, dropping it, adding
      // one, or formatting runs beside it is refused.
      expect(await compile(change(imported.markdoc, 'sets the price', (body) => body.replace('Section 1.01(b)', 'Section 1.01(c)')))).toBe('XREF_EDIT_UNSUPPORTED');
      expect(await compile(change(imported.markdoc, 'sets the price', (body) => body.replace('{% xref to="price" %}', '').replace('{% /xref %}', '')))).toBe('XREF_EDIT_UNSUPPORTED');
      expect(await compile(change(imported.markdoc, 'sets the price', (body) => `${body} See {% xref to="products" %}Section 1.01(a){% /xref %}.`))).toBe('XREF_EDIT_UNSUPPORTED');
      expect(await compile(change(imported.markdoc, 'section governs', (body) => body.replace('governs.', '{% run-format underline="single" %}governs{% /run-format %}.')))).toBe('XREF_EDIT_UNSUPPORTED');
      // A new paragraph cannot carry a reference yet, and a header or footer paragraph never does.
      const anchor = /id="([^"]+)"/u.exec(price.open)![1]!;
      expect(await compile(`${imported.markdoc}\n{% insert-after anchor="${anchor}" edit="new" style-source="${anchor}" %}\n{% after %}\nSee {% xref to="price" %}Section 1.01(b){% /xref %}.\n{% /after %}\n{% /insert-after %}\n`)).toBe('INVALID_MARKDOC:XREF_UNSUPPORTED_LOCATION');
      const inStory = parseMarkdoc(imported.markdoc.replace(price.open, price.open.replace('{% para ', '{% para story="s1" ')));
      expect(inStory.valid ? [] : inStory.issues.map((item) => item.code)).toContain('XREF_UNSUPPORTED_LOCATION');
      // Malformed tags.
      for (const tag of [
        '{% xref to="Price" %}Section 1.01(b){% /xref %}',
        '{% xref to="price" bookmark="price" %}Section 1.01(b){% /xref %}',
        '{% xref %}Section 1.01(b){% /xref %}',
        '{% xref to="price" show="text" number="full" %}Section 1.01(b){% /xref %}',
        '{% xref to="price" number="relative" %}Section 1.01(b){% /xref %}',
      ]) {
        expect(await compile(imported.markdoc.replace(price.body, price.body.replace(/\{% xref to="price" %\}Section 1\.01\(b\)\{% \/xref %\}/u, tag))), tag).toMatch(/^INVALID_MARKDOC:/u);
      }
      expect(await compile(imported.markdoc.replace(price.body, price.body.replace('{% xref to="price" %}Section 1.01(b){% /xref %}', '{% xref to="price" %}{% /xref %}Section 1.01(b)')))).toBe('INVALID_MARKDOC:INVALID_CROSS_REFERENCE');
      // A note's reference names a bookmark that must mark one paragraph of the source.
      expect(await compile(imported.markdoc.replace('{% xref to="products" show="text" %}', '{% xref to="nowhere" show="text" %}'))).toBe('XREF_TARGET_MISSING');
      // Deleting a paragraph other references point at would leave them dangling.
      const products = block(imported.markdoc, 'Products\n');
      const deleted = imported.markdoc.replace(products.block, change(products.block, 'Products', () => '', 'delete-products').trim());
      expect(await compile(deleted)).toBe('XREF_TARGET_MISSING');
    },
    LOAD_SENSITIVE_TIMEOUT_MS,
  );
  conforming.openspec('[SDX-MDOC-XREFIMPORT-06] a document Word edited and updated fields in imports with live references, and compile keeps each field')(
    'Scenario: a document Word edited and updated fields in imports with live references, and compile keeps each field',
    async () => {
      // Word 16.114.3 inserted clause (b) Services before Price and updated every field (issue-1260-word-16.114.json).
      const evidence = JSON.parse(readFileSync(path.join(EVIDENCE_DIR, 'issue-1260-word-16.114.json'), 'utf8')) as WordEvidence;
      expect(evidence.sourceMarkdoc.trim()).toBe(AGREEMENT.trim());
      const created = await createDocumentFromMarkdoc(AGREEMENT);
      const createdFields = await fieldsOf(created.docx);
      // The results `create` caches are those Word computes for the unedited document.
      expect(createdFields.map((field) => field.result)).toEqual(evidence.before.fields.map((field) => field.result));

      const word = readFileSync(path.join(EVIDENCE_DIR, 'issue-1260-word-16.114.docx'));
      const wordFields = await fieldsOf(word);
      expect(wordFields.map((field) => field.instruction)).toEqual(createdFields.map((field) => field.instruction));
      expect(wordFields.map((field) => field.result)).toEqual(evidence.after.fields.map((field) => field.result));
      expect(wordFields.map((field) => field.result)).toContain('Section 1.01(c)(i)');

      // Import restores every field as a tag over the number Word wrote.
      const imported = await importDocxToMarkdoc(word);
      expect(imported.crossReferences).toEqual({ restored: 7, keptAsText: [] });
      expect(block(imported.markdoc, 'sets the price').body).toBe('{% xref to="price" %}Section 1.01(c){% /xref %}&#32;sets the price.');
      expect(imported.markdoc).toContain('\n{% xref to="price-adjustment" %}Section 1.01(c)(i){% /xref %}\n');
      expect(imported.markdoc).toMatch(/\{% xref to="price-adjustment" %\}(\{% annotation-run [^%]*%\})?Section 1\.01\(c\)\(i\)/u);

      // An edit beside a reference compiles, and every field keeps its instruction, result, bookmark and target.
      const edited = change(imported.markdoc, 'sets the price', (body) => `Subject to ${body}`);
      const compiled = await compileMarkdoc(imported.anchoredSource, edited, PRESERVE);
      expect(compiled.certificate.passed).toBe(true);
      const compiledFields = await fieldsOf(compiled.clean);
      expect(compiledFields.map(({ part, instruction, result }) => [part, instruction, result])).toEqual(wordFields.map(({ part, instruction, result }) => [part, instruction, result]));
      expect(compiledFields.map((field) => field.paragraph)).toContain('Subject to Section 1.01(c) sets the price.');
      const targets = await bookmarkTargets(compiled.clean);
      expect(targets).toEqual(await bookmarkTargets(imported.anchoredSource));
      expect(targets).toMatchObject({ defined_terms: 'Defined Terms', price: 'Price', price_adjustment: 'Adjustment', products: 'Products', delivery_terms: 'Delivery Terms' });
      const again = await importDocxToMarkdoc(compiled.clean);
      expect(again.crossReferences.restored).toBe(7);
      expect(block(again.markdoc, 'sets the price').body).toBe('Subject to&#32;{% xref to="price" %}Section 1.01(c){% /xref %}&#32;sets the price.');
    },
    LOAD_SENSITIVE_TIMEOUT_MS,
  );
});

async function partText(docx: Buffer, name: string): Promise<string> {
  return (await JSZip.loadAsync(docx)).file(name)!.async('string');
}

/** The offset just after the first `marker` that follows `anchor` in `xml`. */
function xmlIndexAfter(xml: string, anchor: string, marker: string): number {
  const at = xml.indexOf(anchor);
  expect(at).toBeGreaterThan(-1);
  const found = xml.indexOf(marker, at);
  expect(found).toBeGreaterThan(-1);
  return found + marker.length;
}
