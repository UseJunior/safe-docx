import { describe, expect } from 'vitest';
import { getParagraphRuns, readZipText } from '@usejunior/docx-core';
import { itAllure as it, type AllureBddContext, allureStep } from '../testing/allure-test.js';
import { replaceText } from './replace_text.js';
import { readFile } from './read_file.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { firstParaIdFromToon } from '../testing/docx_test_utils.js';

const test = it.epic('Document Editing').withLabels({ feature: 'Replace Text' });
const humanReadableReplaceTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

function runHasHighlight(run: Element): boolean {
  const rPr = run.getElementsByTagNameNS(W_NS, 'rPr').item(0);
  if (!rPr) return false;
  return !!rPr.getElementsByTagNameNS(W_NS, 'highlight').item(0);
}

describe('replace_text branch coverage', () => {
  registerCleanup();

  test('returns EDIT_ERROR for unbalanced non-definition tag variants', async () => {
    const opened = await openSession(['replace target text']);
    const paraId = firstParaIdFromToon(opened.content);

    const cases: Array<{ newString: string; expected: string }> = [
      { newString: '</header>bad', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '<header>bad', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '</RunInHeader>bad', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '<RunInHeader>bad', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '</highlight>bad', expected: 'UNBALANCED_HIGHLIGHT_TAGS' },
      { newString: '<highlight>bad', expected: 'UNBALANCED_HIGHLIGHT_TAGS' },
      { newString: '</b>bad', expected: 'UNBALANCED_BOLD_TAGS' },
      { newString: '<b>bad', expected: 'UNBALANCED_BOLD_TAGS' },
      { newString: '</i>bad', expected: 'UNBALANCED_ITALIC_TAGS' },
      { newString: '<i>bad', expected: 'UNBALANCED_ITALIC_TAGS' },
      { newString: '</u>bad', expected: 'UNBALANCED_UNDERLINE_TAGS' },
      { newString: '<u>bad', expected: 'UNBALANCED_UNDERLINE_TAGS' },
    ];

    for (const tc of cases) {
      const result = await replaceText(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: paraId,
        old_string: 'replace target text',
        new_string: tc.newString,
        instruction: tc.expected,
      });
      assertFailure(result, tc.expected, tc.newString);
    }
  });

  test('returns deterministic tool errors for anchor/match failures', async () => {
    const opened = await openSession(['foo foo']);
    const paraId = firstParaIdFromToon(opened.content);

    const multiple = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'foo',
      new_string: 'bar',
      instruction: 'multiple match path',
    });
    assertFailure(multiple, 'MULTIPLE_MATCHES', 'multiple matches');

    const notFound = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'missing',
      new_string: 'bar',
      instruction: 'not found path',
    });
    assertFailure(notFound, 'TEXT_NOT_FOUND', 'text not found');

    const missingAnchor = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: '_bk_missing',
      old_string: 'foo foo',
      new_string: 'bar',
      instruction: 'missing anchor path',
    });
    assertFailure(missingAnchor, 'ANCHOR_NOT_FOUND', 'anchor missing');
  });

  test('non-markup replacement across mixed-format runs uses template from trimmed range', async () => {
    // "Alpha " (plain) + "Beta" (bold) → "Gamma Delta"
    // No shared prefix/suffix → full range replacement with predominant template run.
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:t>Alpha </w:t></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Beta</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'Alpha Beta',
      new_string: 'Gamma Delta',
      instruction: 'full replacement uses template run',
    });
    assertSuccess(edited, 'replace with template run');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [paraId],
      format: 'simple',
    });
    assertSuccess(read, 'read replacement');
    expect(String(read.content)).toContain('Gamma Delta');
  });

  test('clears highlighted placeholder styling when replacing likely field tokens', async () => {
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>[CLIENT]</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: '[CLIENT]',
      new_string: 'Acme Corp',
      instruction: 'clear placeholder highlight',
    });
    assertSuccess(edited, 'replace highlighted placeholder');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const allRuns = Array.from(pEl!.getElementsByTagNameNS(W_NS, 'r'));
    const acmeRuns = allRuns.filter((r) => {
      const text = Array.from(r.getElementsByTagNameNS(W_NS, 't'))
        .map((t) => t.textContent ?? '')
        .join('');
      return text.includes('Acme');
    });
    expect(acmeRuns.length).toBeGreaterThan(0);
    expect(acmeRuns.some((r) => runHasHighlight(r))).toBe(false);
  });

  test('applies <font> tags with color, size, and face in replacement text', async () => {
    const opened = await openSession(['replace target text']);
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'replace target text',
      new_string: '<font color="FF0000" size="14" face="Arial">styled text</font>',
      instruction: 'font tag branch',
    });
    assertSuccess(edited, 'replace with font tags');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const runs = Array.from(pEl!.getElementsByTagNameNS(W_NS, 'r'));
    const styledRun = runs.find((r) => {
      const text = Array.from(r.getElementsByTagNameNS(W_NS, 't'))
        .map((t) => t.textContent ?? '')
        .join('');
      return text.includes('styled text');
    });
    expect(styledRun).toBeTruthy();
    const rPr = styledRun!.getElementsByTagNameNS(W_NS, 'rPr').item(0);
    expect(rPr).toBeTruthy();
    expect(rPr!.getElementsByTagNameNS(W_NS, 'color').item(0)?.getAttribute('w:val')).toBe('FF0000');
    expect(rPr!.getElementsByTagNameNS(W_NS, 'sz').item(0)?.getAttribute('w:val')).toBe('28');
    const rFonts = rPr!.getElementsByTagNameNS(W_NS, 'rFonts').item(0);
    expect(rFonts?.getAttribute('w:ascii')).toBe('Arial');
  });

  test('applies balanced markup replacement path with header/highlight tags', async () => {
    const opened = await openSession(['replace me']);
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'replace me',
      new_string: '<header><u>Heading:</u></header> body <highlight>text</highlight>',
      instruction: 'hasMarkup branch',
    });
    assertSuccess(edited, 'replace with markup');

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [paraId],
      format: 'simple',
    });
    assertSuccess(read, 'read markup replacement');
    expect(String(read.content)).toContain('Heading: body text');
  });

  test('normalizes semantic/formatting/hyperlink tags in old/new strings before replacing in default mode', async () => {
    const opened = await openSession(['Original target']);
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string:
        '<a href="https://example.test">' +
        '<highlight><b><i><u>Original target</u></i></b></highlight>' +
        '</a>',
      new_string: '<a href="https://example.test">Replaced target</a>',
      instruction: 'strip semantic and hyperlink tags before replace',
    });
    assertSuccess(edited, 'replace after old/new normalization');

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [paraId],
      format: 'simple',
    });
    assertSuccess(read, 'read normalized replacement');
    expect(String(read.content)).toContain('Replaced target');
    expect(String(read.content)).not.toContain('<a ');
  });

  // ── Fix 1: Range-trimmed formatting preservation tests ──────────────

  test('preserves bold+plain formatting when appending text after unchanged prefix (Fix 1)', async () => {
    // Bold "MAE" + plain " means X" — replace entire span, appending text.
    // The range trimming should keep "MAE" means X" in original runs and only operate on the changed suffix.
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>\u201CMAE\u201D</w:t></w:r>` +
        `<w:r><w:t xml:space="preserve"> means X</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: '\u201CMAE\u201D means X',
      new_string: '\u201CMAE\u201D means X; provided however',
      instruction: 'append text preserving formatting',
    });
    assertSuccess(edited, 'replace with appended text');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const runs = getParagraphRuns(pEl!).filter((r) => r.text.length > 0);

    // The bold run containing "MAE" should still exist and be bold.
    const boldRun = runs.find((r) => r.text.includes('\u201CMAE\u201D'));
    expect(boldRun).toBeTruthy();
    const boldRPr = boldRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0);
    expect(boldRPr).toBeTruthy();
    expect(boldRPr!.getElementsByTagNameNS(W_NS, 'b').length).toBeGreaterThan(0);

    // The full text should contain the appended text.
    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toContain('; provided however');
  });

  test('prefix change preserves suffix formatting (Fix 1)', async () => {
    // Bold "Hello" + italic " World" → "Goodbye World"
    // Range trim: prefix is empty (first char differs), suffix is " World" (unchanged).
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>` +
        `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> World</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'Hello World',
      new_string: 'Goodbye World',
      instruction: 'prefix change preserves suffix',
    });
    assertSuccess(edited, 'replace prefix');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const runs = getParagraphRuns(pEl!).filter((r) => r.text.length > 0);

    // " World" should still be italic (untouched by range trim).
    const worldRun = runs.find((r) => r.text.includes(' World'));
    expect(worldRun).toBeTruthy();
    const worldRPr = worldRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0);
    expect(worldRPr).toBeTruthy();
    expect(worldRPr!.getElementsByTagNameNS(W_NS, 'i').length).toBeGreaterThan(0);

    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toBe('Goodbye World');
  });

  test('suffix change preserves prefix formatting (Fix 1)', async () => {
    // Bold "Hello" + italic " World" → "Hello Earth"
    // Range trim: prefix "Hello" stays bold, only " World" → " Earth".
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>` +
        `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> World</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'Hello World',
      new_string: 'Hello Earth',
      instruction: 'suffix change preserves prefix',
    });
    assertSuccess(edited, 'replace suffix');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const runs = getParagraphRuns(pEl!).filter((r) => r.text.length > 0);

    // "Hello" should still be bold (untouched by range trim).
    const helloRun = runs.find((r) => r.text.includes('Hello'));
    expect(helloRun).toBeTruthy();
    const helloRPr = helloRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0);
    expect(helloRPr).toBeTruthy();
    expect(helloRPr!.getElementsByTagNameNS(W_NS, 'b').length).toBeGreaterThan(0);

    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toBe('Hello Earth');
  });

  test('identical text after normalization is a no-op (Fix 1)', async () => {
    const opened = await openSession(['Hello World']);
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'Hello World',
      new_string: 'Hello World',
      instruction: 'no-op identical text',
    });
    assertSuccess(edited, 'no-op replace');

    // Text should be unchanged.
    const session = opened.mgr.getSession(opened.sessionId);
    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toBe('Hello World');
  });

  test('pure insertion at end when prefix covers all of old text (Fix 1)', async () => {
    const opened = await openSession(['AB']);
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'AB',
      new_string: 'ABX',
      instruction: 'append X at end',
    });
    assertSuccess(edited, 'insert at end');

    const session = opened.mgr.getSession(opened.sessionId);
    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toBe('ABX');
  });

  test('pure insertion in middle when prefix and suffix cover old text (Fix 1)', async () => {
    const opened = await openSession(['AB']);
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'AB',
      new_string: 'AXB',
      instruction: 'insert X between A and B',
    });
    assertSuccess(edited, 'insert in middle');

    const session = opened.mgr.getSession(opened.sessionId);
    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toBe('AXB');
  });

  // ── Fix 3: Field code preservation via diff trimming ──────────────

  test('edit around field preserves field structure (Fix 3)', async () => {
    // Paragraph: "total " + [FIELD: $1,000] + " dollars"
    // Replace entire span → "total " + [FIELD: $1,000] + " US dollars"
    // The diff should trim to just inserting "US " before "dollars", leaving the field untouched.
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:t xml:space="preserve">total </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> REF amount </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>$1,000</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> dollars</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'total $1,000 dollars',
      new_string: 'total $1,000 US dollars',
      instruction: 'edit around field preserves field',
    });
    assertSuccess(edited, 'edit around field');

    // Verify field structures (fldChar) still exist in the DOM.
    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const fldChars = Array.from(pEl!.getElementsByTagNameNS(W_NS, 'fldChar'));
    expect(fldChars.length).toBe(3); // begin, separate, end

    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toContain('US dollars');
  });

  test('edit before field preserves field (Fix 3)', async () => {
    // "The " + [FIELD: Agreement] → "This " + [FIELD: Agreement]
    // Diff trims: "Th" prefix is common, "e" → "is" change, " [FIELD] Agreement" suffix is preserved.
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:t xml:space="preserve">The </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> DOCPROPERTY title </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>Agreement</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'The Agreement',
      new_string: 'This Agreement',
      instruction: 'edit before field',
    });
    assertSuccess(edited, 'edit before field');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const fldChars = Array.from(pEl!.getElementsByTagNameNS(W_NS, 'fldChar'));
    expect(fldChars.length).toBe(3);

    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toContain('This');
    expect(afterText).toContain('Agreement');
  });

  test('edit after field preserves field (Fix 3)', async () => {
    // [FIELD: effective] + " date" → [FIELD: effective] + " commencement date"
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> REF term </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>effective</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> date</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'effective date',
      new_string: 'effective commencement date',
      instruction: 'edit after field',
    });
    assertSuccess(edited, 'edit after field');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const fldChars = Array.from(pEl!.getElementsByTagNameNS(W_NS, 'fldChar'));
    expect(fldChars.length).toBe(3);

    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toContain('commencement date');
  });

  test('edit that changes field text still throws UNSUPPORTED_EDIT (Fix 3)', async () => {
    // Try to change the field result text itself — primitive should reject.
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:t xml:space="preserve">see </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> REF x </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>Visible</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> here</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'see Visible here',
      new_string: 'see Changed here',
      instruction: 'edit that changes field text',
    });
    // This should fail with UNSUPPORTED_EDIT wrapped as EDIT_ERROR because the
    // trimmed range "Visible" → "Changed" crosses the field result run.
    assertFailure(edited, 'EDIT_ERROR', 'edit crossing field');
  });

  humanReadableReplaceTest
    .allure({
      title: 'replace_text exposes edited document XML previews',
      description: [
        'This test confirms replace_text edits are visible both in plain-text reads and raw DOCX XML output.',
        'It attaches a Word-like preview and pretty XML preview as evidence for manual review.',
      ].join('\n'),
    })(
    'Scenario: edited document XML previews are attached for replace_text',
    async ({
      given,
      when,
      then,
      attachXmlPreviews,
      attachJsonLastStep,
    }: AllureBddContext) => {
      const inputParagraphs = ['Hello world', 'Second paragraph'];
      const replacement = {
        old_string: 'Hello world',
        new_string: 'Hi world',
        instruction: 'replace_text xml preview evidence',
      } as const;
      const debugContext = {
        scenario: 'replace_text xml preview evidence',
        input_paragraphs: inputParagraphs,
        replacement,
        expected_output_contains: replacement.new_string,
      } as const;

      let debugResult: Record<string, unknown> | null = null;

      try {
        const { mgr, sessionId, firstParaId } = await given(
          'a clean two-paragraph document is open in a session',
          () => openSession(inputParagraphs, { trackOpenStep: false }),
          { paragraph_count: inputParagraphs.length },
        );

        const editResult = await when(
          'I run replace_text on the first paragraph',
          () => replaceText(mgr, {
            session_id: sessionId,
            target_paragraph_id: firstParaId,
            old_string: replacement.old_string,
            new_string: replacement.new_string,
            instruction: replacement.instruction,
          }),
          {
            target_paragraph_id: firstParaId,
            old_string: replacement.old_string,
            new_string: replacement.new_string,
          },
        );
        assertSuccess(editResult, 'replace_text');

        const readResult = await then(
          'the replacement appears in read_file output',
          async () => {
            const read = await readFile(mgr, {
              session_id: sessionId,
              node_ids: [firstParaId],
              format: 'simple',
            });
            assertSuccess(read, 'read after replace_text');
            expect(String(read.content)).toContain(replacement.new_string);
            return read;
          },
          { expected_text: replacement.new_string },
        );

        await allureStep('Evidence: edited document XML previews are attached for review', async () => {
          const session = mgr.getSession(sessionId);
          const { buffer } = await session.doc.toBuffer({ cleanBookmarks: true });
          const outputXml = await readZipText(buffer, 'word/document.xml');
          expect(outputXml).not.toBeNull();
          const xml = String(outputXml ?? '');
          // With range trimming, the replacement text may span multiple runs in the XML,
          // so check paragraph text instead of raw XML for contiguous string.
          const afterText = session.doc.getParagraphTextById(firstParaId) ?? '';
          expect(afterText).toContain(replacement.new_string);
          await attachXmlPreviews(xml, {
            wordLikeName: '01 Output Word-like preview',
            xmlName: '02 Output XML fixture (pretty XML)',
            wordLike: {
              baseText: [replacement.new_string, inputParagraphs[1]].join('\n'),
            },
          });
          debugResult = {
            edit_result: editResult,
            read_result: readResult,
            output_xml_contains: replacement.new_string,
          };
        });
      } finally {
        await attachJsonLastStep({
          context: debugContext,
          result: debugResult,
          stepName: 'Attach debug JSON (context + result)',
        });
      }
    },
  );
});
