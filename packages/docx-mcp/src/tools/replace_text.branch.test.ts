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

  test('distributes replacements across overlapping runs in non-markup mode', async () => {
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
      instruction: 'distributed replacement branch',
    });
    assertSuccess(edited, 'replace distributed parts');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const runs = getParagraphRuns(pEl!).filter((r) => r.text.length > 0);
    expect(runs.length).toBeGreaterThan(1);

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [paraId],
      format: 'simple',
    });
    assertSuccess(read, 'read distributed replacement');
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
          expect(xml).toContain(replacement.new_string);
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
