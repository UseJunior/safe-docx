import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { SafeDocxError } from '../src/primitives/errors.js';
import { formatParagraphTextRange, getParagraphRuns, getParagraphText, replaceParagraphTextRange } from '../src/primitives/text.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Text Primitives' });

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function firstParagraph(doc: Document): Element {
  const p = doc.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0);
  if (!p) throw new Error('missing paragraph');
  return p;
}

describe('text primitives', () => {
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.28' })
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.31' })(
      'formats an exact text-preserving range while retaining undeclared properties and fragmentation',
      async ({ given, when, then, and }: AllureBddContext) => {
        let paragraph!: Element;
        await given('two same-format physical runs whose second half is highlighted', async () => {
          paragraph = firstParagraph(makeDoc(
            '<w:p>'
            + '<w:r><w:rPr><w:b/><w:highlight w:val="yellow"/></w:rPr><w:t>Com</w:t></w:r>'
            + '<w:r><w:rPr><w:b/><w:highlight w:val="yellow"/></w:rPr><w:t>plete</w:t></w:r>'
            + '<w:r><w:rPr><w:i/></w:rPr><w:t> tail</w:t></w:r>'
            + '</w:p>',
          ));
        });
        await when('the Complete range removes highlight and sets underline', async () => {
          formatParagraphTextRange(paragraph, 0, 8, { highlight: 'none', underline: 'single' });
        });
        await then('the visible text is unchanged', () => {
          expect(getParagraphText(paragraph)).toBe('Complete tail');
        });
        await and('both retained fragments keep bold, gain underline, and lose highlight', () => {
          const runs = getParagraphRuns(paragraph);
          expect(runs.slice(0, 2).map((run) => run.r.toString())).toEqual([
            expect.stringContaining('<w:b/>'),
            expect.stringContaining('<w:b/>'),
          ]);
          for (const run of runs.slice(0, 2)) {
            expect(run.r.toString()).toContain('<w:u w:val="single"/>');
            expect(run.r.toString()).not.toContain('<w:highlight');
          }
          expect(runs.at(-1)!.r.toString()).toContain('<w:i/>');
        });
      },
    );

  test('rejects an embedded-object range without mutating the paragraph', async ({ given, when, then }: AllureBddContext) => {
    let paragraph!: Element;
    let before!: string;
    let failure!: unknown;
    await given('visible text shares a run with an embedded drawing', async () => {
      paragraph = firstParagraph(makeDoc('<w:p><w:r><w:drawing/><w:t>Complete</w:t></w:r><w:r><w:t> tail</w:t></w:r></w:p>'));
      before = paragraph.toString();
    });
    await when('the visible range is formatted', async () => {
      try {
        formatParagraphTextRange(paragraph, 0, 8, { highlight: 'none' });
      } catch (error) {
        failure = error;
      }
    });
    await then('the operation fails transactionally', () => {
      expect(failure).toMatchObject({ code: 'UNSUPPORTED_EDIT' });
      expect(paragraph.toString()).toBe(before);
    });
  });

  test('preserves intentional xml:space and removes duplicate underline properties', async ({ given, when, then }: AllureBddContext) => {
    let paragraph!: Element;
    await given('a compact whole-run source with xml:space and duplicate underline properties', async () => {
      paragraph = firstParagraph(makeDoc(
        '<w:p><w:r><w:rPr><w:u w:val="single"/><w:u w:val="single"/><w:highlight w:val="yellow"/></w:rPr>'
        + '<w:t xml:space="preserve">Complete</w:t></w:r></w:p>',
      ));
    });
    await when('the whole run removes underline and highlight without changing text', async () => {
      formatParagraphTextRange(paragraph, 0, 8, { underline: 'none', highlight: 'none' });
    });
    await then('the text marker survives and every duplicate declared property is gone', () => {
      const xml = paragraph.toString();
      expect(xml).toContain('xml:space="preserve"');
      expect(xml).not.toContain('<w:u');
      expect(xml).not.toContain('<w:highlight');
      expect(getParagraphText(paragraph)).toBe('Complete');
    });
  });

  test('rejects special run content inside a formatting interval without mutation', async ({ given, when, then }: AllureBddContext) => {
    const specialElements = [
      '<w:sym w:font="Wingdings" w:char="F0FC"/>',
      '<w:noBreakHyphen/>',
      '<w:softHyphen/>',
      '<w:cr/>',
      '<w:ptab/>',
    ];
    await given('special character elements appear in their own run or beside visible text', () => {});
    await when('a retained formatting range encloses that content', () => {});
    await then('every shape is rejected transactionally', () => {
      for (const special of specialElements) {
        for (const body of [
          `<w:p><w:r><w:t>Alpha</w:t></w:r><w:r>${special}</w:r><w:r><w:t>beta</w:t></w:r></w:p>`,
          `<w:p><w:r><w:t>Alpha</w:t>${special}<w:t>beta</w:t></w:r></w:p>`,
        ]) {
          const paragraph = firstParagraph(makeDoc(body));
          const before = paragraph.toString();
          expect(() => formatParagraphTextRange(paragraph, 0, 9, { underline: 'single' }))
            .toThrowError(SafeDocxError);
          expect(paragraph.toString()).toBe(before);
        }
      }
    });
  });

  test('uses paragraph-owned run offsets, admits pagination cache, and rejects enclosed empty runs', async ({ given, when, then }: AllureBddContext) => {
    let withTextBox!: Element;
    await given('nested text-box runs precede a flat span containing a symbol', () => {
      withTextBox = firstParagraph(makeDoc(
        '<w:p><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Box text</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r>'
        + '<w:r><w:t>Alpha</w:t></w:r><w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r><w:r><w:t>beta</w:t></w:r></w:p>',
      ));
    });
    await when('the flat visible span is formatted', () => {});
    await then('nested runs do not desynchronise the transactional special-content guard', () => {
      const before = withTextBox.toString();
      expect(() => formatParagraphTextRange(withTextBox, 0, 9, { underline: 'single' }))
        .toThrowError(SafeDocxError);
      expect(withTextBox.toString()).toBe(before);
    });
    await then('pagination cache is admitted but an enclosed empty run is rejected', () => {
      const cache = firstParagraph(makeDoc(
        '<w:p><w:r><w:lastRenderedPageBreak/><w:t>Alphabeta</w:t></w:r></w:p>',
      ));
      expect(() => formatParagraphTextRange(cache, 0, 9, { underline: 'single' })).not.toThrow();
      expect(getParagraphText(cache)).toBe('Alphabeta');

      const empty = firstParagraph(makeDoc(
        '<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:rPr><w:b/></w:rPr></w:r><w:r><w:t>beta</w:t></w:r></w:p>',
      ));
      const before = empty.toString();
      expect(() => formatParagraphTextRange(empty, 0, 9, { underline: 'single' }))
        .toThrowError(SafeDocxError);
      expect(empty.toString()).toBe(before);

      const emptyText = firstParagraph(makeDoc(
        '<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:t/></w:r><w:r><w:t>beta</w:t></w:r></w:p>',
      ));
      const emptyTextBefore = emptyText.toString();
      expect(() => formatParagraphTextRange(emptyText, 0, 9, { underline: 'single' }))
        .toThrowError(SafeDocxError);
      expect(emptyText.toString()).toBe(emptyTextBefore);
    });
  });

  test('extracts paragraph runs and tracks field-result visibility', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: Document;
    let runs!: ReturnType<typeof getParagraphRuns>;
    await given('a paragraph with a REF field, field result runs, and a tail run', async () => {
      doc = makeDoc(
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>REF Clause_1</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/><w:t>Visible</w:t></w:r>` +
        `<w:r><w:t> Result</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t> tail</w:t><w:tab/><w:br/></w:r>` +
        `</w:p>`
      );
    });
    await when('getParagraphRuns is called on the paragraph', async () => {
      runs = getParagraphRuns(firstParagraph(doc));
    });
    await then('visible run texts are Visible, space-Result, and tail with tab and newline', () => {
      expect(runs.map((r) => r.text)).toEqual(['Visible', ' Result', ' tail\t\n']);
    });
    await and('field result flags are true for the first two runs and false for the tail', () => {
      expect(runs.map((r) => r.isFieldResult)).toEqual([true, true, false]);
    });
    await and('getParagraphText returns the concatenated visible text', () => {
      expect(getParagraphText(firstParagraph(doc))).toBe('Visible Result tail\t\n');
    });
  });

  test('replaces a cross-run range and applies additive run props', async ({ given, when, then, and }: AllureBddContext) => {
    let p!: Element;
    await given('a paragraph with a bold run Hello and an italic run space-world', async () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>` +
        `<w:r><w:rPr><w:i/></w:rPr><w:t> world</w:t></w:r>` +
        `</w:p>`
      );
      p = firstParagraph(doc);
    });
    await when('replaceParagraphTextRange replaces chars 3-8 with X-tab-Y plus underline and highlight', async () => {
      replaceParagraphTextRange(p, 3, 8, [
        {
          text: 'X\tY',
          addRunProps: { underline: true, highlight: true },
        },
      ]);
    });
    await then('paragraph text is HelX-tab-Yrld', () => {
      expect(getParagraphText(p)).toBe('HelX\tYrld');
    });
    await and('the XML contains underline and highlight run properties', () => {
      const xml = p.toString();
      expect(xml).toContain('<w:u w:val="single"/>');
      expect(xml).toContain('<w:highlight w:val="yellow"/>');
    });
  });

  test('throws UNSUPPORTED_EDIT when a multi-run edit intersects field results', async ({ given, when, then, and }: AllureBddContext) => {
    let p!: Element;
    await given('a paragraph whose only visible text spans field result runs', async () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>REF X</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/><w:t>Visible</w:t></w:r>` +
        `<w:r><w:t> Result</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`
      );
      p = firstParagraph(doc);
    });
    await when('replaceParagraphTextRange is called spanning field result runs', async () => {});
    await then('it throws a SafeDocxError', () => {
      expect(() => replaceParagraphTextRange(p, 0, 13, 'Updated')).toThrowError(SafeDocxError);
    });
    await and('the error code is UNSUPPORTED_EDIT', () => {
      try {
        replaceParagraphTextRange(p, 0, 13, 'Updated');
      } catch (e: unknown) {
        if (!(e instanceof SafeDocxError)) throw e;
        expect(e.code).toBe('UNSUPPORTED_EDIT');
      }
    });
  });

  test('throws UNSAFE_CONTAINER_BOUNDARY when replacement spans different run containers', async ({ given, when, then, and }: AllureBddContext) => {
    let p!: Element;
    await given('a paragraph with a hyperlink run followed by a plain run', async () => {
      const doc = makeDoc(
        `<w:p>` +
        `<w:hyperlink r:id="rId1"><w:r><w:t>Link</w:t></w:r></w:hyperlink>` +
        `<w:r><w:t>Tail</w:t></w:r>` +
        `</w:p>`
      );
      p = firstParagraph(doc);
    });
    await when('replaceParagraphTextRange is called spanning the hyperlink boundary', async () => {});
    await then('it throws a SafeDocxError', () => {
      expect(() => replaceParagraphTextRange(p, 2, 6, 'Changed')).toThrowError(SafeDocxError);
    });
    await and('the error code is UNSAFE_CONTAINER_BOUNDARY', () => {
      try {
        replaceParagraphTextRange(p, 2, 6, 'Changed');
      } catch (e: unknown) {
        if (!(e instanceof SafeDocxError)) throw e;
        expect(e.code).toBe('UNSAFE_CONTAINER_BOUNDARY');
      }
    });
  });
});
