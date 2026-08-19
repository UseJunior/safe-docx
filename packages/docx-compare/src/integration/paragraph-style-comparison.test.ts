import {
  DocxArchive,
  childElements,
  extractRevisions,
  findChildByTagName,
  insertParagraphBookmarks,
  parseXml,
} from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { compareDocumentsAtomizer as compareDocuments } from '../baselines/atomizer/pipeline.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';
import { parseDocumentXml } from '../baselines/atomizer/xmlToWmlElement.js';

const AUTHOR = 'Paragraph Style Comparison';
const DATE = new Date('2026-07-28T16:00:00Z');
const TEST_FEATURE = 'docx-comparison';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Direct w:pStyle Comparison',
    severity: 'critical',
  })
  .conformance({
    spec: 'ECMA-376',
    edition: 5,
    part: 1,
    section: '17.13.5.29',
  });

function styledParagraph(style: string | null, runXml: string): string {
  const pPr = style === null ? '' : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`;
  return `<w:p>${pPr}${runXml}</w:p>`;
}

function textRun(text: string): string {
  return `<w:r><w:t>${text}</w:t></w:r>`;
}

async function documentXml(docx: Buffer): Promise<string> {
  return (await DocxArchive.load(docx)).getDocumentXml();
}

async function compareBodies(
  originalBody: string,
  revisedBody: string,
  ignoreFormatting = false,
) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised, {
    formatDetection: { detectFormatChanges: !ignoreFormatting },
    author: AUTHOR,
    date: DATE,
  });
  return {
    result,
    xml: await documentXml(result.document),
  };
}

function firstParagraph(xml: string): Element {
  const paragraph = parseDocumentXml(xml).getElementsByTagName('w:p').item(0);
  if (!paragraph) throw new Error('document has no paragraph');
  return paragraph;
}

function directStyle(pPr: Element | null): string | null {
  const style = pPr
    ? childElements(pPr).find((child) => child.tagName === 'w:pStyle')
    : undefined;
  return style?.getAttribute('w:val') ?? null;
}

function liveStyle(xml: string): string | null {
  return directStyle(findChildByTagName(firstParagraph(xml), 'w:pPr'));
}

function paragraphPropertyChanges(xml: string): Element[] {
  return Array.from(parseDocumentXml(xml).getElementsByTagName('w:pPrChange'));
}

function snapshotStyle(change: Element): string | null {
  return directStyle(findChildByTagName(change, 'w:pPr'));
}

describe('direct paragraph style comparison', () => {
  test('tagged publication reports row and cell direct-property revisions in public stats', async () => {
    const table = (row: string, cell: string) =>
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
      `<w:tr>${row}<w:tc>${cell}<w:p><w:r><w:t>same</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const original = await buildDocxFromBodyXml(table('', ''));
    const revised = await buildDocxFromBodyXml(table(
      '<w:trPr><w:tblHeader/></w:trPr>',
      '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>',
    ));

    const result = await compareDocuments(original, revised, {
      author: AUTHOR,
      date: DATE,
    });

    expect(result.stats.formatChanges).toBe(2);
    expect(result.stats.formatChangeAtoms).toBe(2);
    const publishedXml = await documentXml(result.document);
    const published = parseDocumentXml(publishedXml);
    const emittedPropertyRevisions = [
      ...Array.from(published.getElementsByTagName('w:trPrChange')),
      ...Array.from(published.getElementsByTagName('w:tcPrChange')),
    ];
    expect(emittedPropertyRevisions).toHaveLength(result.stats.formatChanges);
  });

  test('counts every word-split atom in one direct-run formatting range', async () => {
    const original = await buildDocxFromBodyXml(
      '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Alpha beta</w:t></w:r></w:p>',
    );
    const revised = await buildDocxFromBodyXml(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Alpha beta</w:t></w:r></w:p>',
    );

    const result = await compareDocuments(original, revised, {
      author: AUTHOR, date: DATE,
    });

    expect(result.stats.formatChanges).toBe(1);
    expect(result.stats.formatChangeAtoms).toBe(3);
  });

  test.openspec('[SDX-CMP-PSTYLE-01] Non-empty paragraph style replacement is detected once')(
    'tracks one paragraph change for fragmented non-empty text',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await given('a Heading1 paragraph split across two runs', () =>
        styledParagraph('Heading1', textRun('Same ') + textRun('text')),
      );
      const revised = await given('the same text with Normal style and different run splits', () =>
        styledParagraph('Normal', textRun('Same text')),
      );

      const compared = await when('comparison runs', () =>
        compareBodies(original, revised),
      );
        await then('one paragraph-level format change is reported', () => {
          expect(compared.result.stats.formatChanges).toBe(1);
          expect(compared.result.stats.formatChangeAtoms).toBe(1);
        });
        await and('serialized run-boundary revisions are reported exactly', () => {
          expect(compared.result.stats.insertions).toBe(1);
          expect(compared.result.stats.deletions).toBe(1);
        });
    },
  );

  test.openspec('[SDX-CMP-PSTYLE-02] Empty paragraph style replacement uses the same classification')(
    'tracks an empty paragraph style change without delete-insert markup',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await given('an empty Heading1 paragraph', () =>
        styledParagraph('Heading1', ''),
      );
      const revised = await given('the same empty paragraph with Normal style', () =>
        styledParagraph('Normal', ''),
      );

      const compared = await when('comparison runs', () =>
        compareBodies(original, revised),
      );
        await then('the empty paragraph contributes one format change', () => {
          expect(compared.result.stats.formatChanges).toBe(1);
        });
        await and('paragraph insertion and deletion remain zero', () => {
          expect(compared.result.stats.insertions).toBe(0);
          expect(compared.result.stats.deletions).toBe(0);
          expect(compared.xml).not.toMatch(/<w:rPr><w:(?:ins|del)\b/);
        });
    },
  );

  test.openspec('[SDX-CMP-PSTYLE-03] Run fragmentation does not multiply paragraph changes')(
    'deduplicates a direct style change across many text atoms',
    async ({ given, when, then }: AllureBddContext) => {
      const original = await given('a paragraph with five independently formatted runs', () =>
        styledParagraph(
          'Heading1',
          ['One', ' ', 'two', ' ', 'three'].map(textRun).join(''),
        ),
      );
      const revised = await given('the same run sequence under a new style', () =>
        styledParagraph(
          'Normal',
          ['One', ' ', 'two', ' ', 'three'].map(textRun).join(''),
        ),
      );

      const compared = await when('comparison runs', () =>
        compareBodies(original, revised),
      );
      await then('one style revision is emitted and counted', () => {
        expect(compared.result.stats.formatChanges).toBe(1);
        expect(paragraphPropertyChanges(compared.xml)).toHaveLength(1);
      });
    },
  );

  test.openspec('[SDX-CMP-PSTYLE-04] Style replacement emits a reversible pPrChange')(
    'emits revised live style and an extractable original snapshot',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await given('a Heading1 paragraph', () =>
        styledParagraph('Heading1', textRun('Reversible')),
      );
      const revised = await given('the same paragraph with Normal style', () =>
        styledParagraph('Normal', textRun('Reversible')),
      );

      const compared = await when('comparison runs', () =>
        compareBodies(original, revised),
      );
      const changes = paragraphPropertyChanges(compared.xml);
        await then('the live and snapshotted styles use the correct sides', () => {
          expect(liveStyle(compared.xml)).toBe('Normal');
          expect(changes).toHaveLength(1);
          expect(snapshotStyle(changes[0]!)).toBe('Heading1');
          expect(changes[0]!.getAttribute('w:author')).toBe(AUTHOR);
          expect(changes[0]!.getAttribute('w:date')).toBe('2026-07-28T16:00:00Z');
          expect(changes[0]!.getAttribute('w:id')).not.toBe('');
        });
        await and('accept and reject recover revised and original styles', () => {
          expect(liveStyle(acceptAllChanges(compared.xml))).toBe('Normal');
          expect(liveStyle(rejectAllChanges(compared.xml))).toBe('Heading1');
        });
        await and('revision extraction reports the paragraph property change', () => {
          const doc = parseXml(compared.xml);
          insertParagraphBookmarks(doc, 'paragraph-style-test');
          const extracted = extractRevisions(doc, []);
          expect(extracted.total_changes).toBe(1);
          expect(extracted.changes[0]!.revisions).toEqual([
            expect.objectContaining({
              type: 'FORMAT_CHANGE',
              author: AUTHOR,
            }),
          ]);
        });
    },
  );

  test.openspec('[SDX-CMP-PSTYLE-05] Style addition and removal remain reversible')(
    'tracks direct style addition and removal',
    async ({ given, when, then }: AllureBddContext) => {
      const cases = await given('paragraph pairs that add and remove a direct style', () => [
        { original: null, revised: 'Normal' },
        { original: 'Heading1', revised: null },
      ] as const);

      for (const pair of cases) {
        const compared = await when(`comparison maps ${pair.original} to ${pair.revised}`, () =>
          compareBodies(
            styledParagraph(pair.original, textRun('Same')),
            styledParagraph(pair.revised, textRun('Same')),
          ),
        );
          await then('accept and reject recover the corresponding style states', () => {
            expect(liveStyle(acceptAllChanges(compared.xml))).toBe(pair.revised);
            expect(liveStyle(rejectAllChanges(compared.xml))).toBe(pair.original);
            expect(paragraphPropertyChanges(compared.xml)).toHaveLength(1);
          });
      }
    },
  );

  test.openspec('[SDX-CMP-PSTYLE-06] ignoreFormatting suppresses paragraph style markup')(
    'keeps the revised style untracked',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await given('an empty Heading1 paragraph', () =>
        styledParagraph('Heading1', ''),
      );
      const revised = await given('the same paragraph with Normal style', () =>
        styledParagraph('Normal', ''),
      );

      const compared = await when('comparison ignores formatting', () =>
        compareBodies(original, revised, true),
      );
        await then('no format change or paragraph property markup is emitted', () => {
          expect(compared.result.stats.formatChanges).toBe(0);
          expect(paragraphPropertyChanges(compared.xml)).toHaveLength(0);
        });
        await and('both projections retain the revised style', () => {
          expect(liveStyle(acceptAllChanges(compared.xml))).toBe('Normal');
          expect(liveStyle(rejectAllChanges(compared.xml))).toBe('Normal');
        });
    },
  );

  test(
    'pairs consecutive empty paragraphs positionally and tracks only the changed style',
    async ({ given, when, then }: AllureBddContext) => {
      const anchor = styledParagraph(null, textRun('Anchor'));
      const tail = styledParagraph(null, textRun('Tail'));
      const original = await given('two consecutive styled empty paragraphs', () =>
        anchor +
        styledParagraph('Heading1', '') +
        styledParagraph('Normal', '') +
        tail,
      );
      const revised = await given('only the first empty paragraph changes style', () =>
        anchor +
        styledParagraph('Normal', '') +
        styledParagraph('Normal', '') +
        tail,
      );

      const compared = await when('comparison runs', () =>
        compareBodies(original, revised),
      );
      await then('exactly one paragraph style revision is emitted', () => {
        expect(compared.result.stats.formatChanges).toBe(1);
        expect(paragraphPropertyChanges(compared.xml)).toHaveLength(1);
      });
    },
  );

  test(
    'reports both text and direct-style changes in a divergent paragraph',
    async ({ given, when, then }: AllureBddContext) => {
      const original = await given('a Heading1 paragraph with original text', () =>
        styledParagraph('Heading1', textRun('Original text')),
      );
      const revised = await given('a Normal paragraph with different text', () =>
        styledParagraph('Normal', textRun('Revised text')),
      );

      const compared = await when('comparison runs', () =>
        compareBodies(original, revised),
      );
      await then('the published text replacement and property revision are both counted', () => {
        expect(compared.result.stats.formatChanges).toBe(1);
        expect(compared.result.stats.formatChangeAtoms).toBe(1);
        expect(paragraphPropertyChanges(compared.xml)).toHaveLength(
          compared.result.stats.formatChanges,
        );
        expect(compared.result.stats.insertions).toBe(1);
        expect(compared.result.stats.deletions).toBe(1);
      });
    },
  );
});
