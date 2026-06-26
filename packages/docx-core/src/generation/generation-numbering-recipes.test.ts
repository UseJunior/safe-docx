import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import {
  computeListLabelForParagraph,
  parseNumberingXml,
  type NumberingCounters,
} from '../primitives/numbering.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec, NumberingSpec } from './types.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function listItem(text: string, numId: string, ilvl: number): DocumentSpec['sections'][number]['blocks'][number] {
  return { kind: 'paragraph', list: { numId, ilvl }, runs: [{ kind: 'text', text }] };
}

/** Article/section/clause: decimal, multi-level decimal, lowerRoman. */
function legalNumbering(): NumberingSpec {
  return {
    numId: 'articles',
    levels: [
      { ilvl: 0, numFmt: 'decimal', lvlText: '%1.', indentTwips: { left: 720, hanging: 360 } },
      { ilvl: 1, numFmt: 'decimal', lvlText: '%1.%2', indentTwips: { left: 1440, hanging: 360 } },
      { ilvl: 2, numFmt: 'lowerRoman', lvlText: '(%3)', indentTwips: { left: 2160, hanging: 360 } },
    ],
  };
}

function nestedListSpec(): DocumentSpec {
  return {
    meta: { title: 'Generation numbering', createdIso: '2026-06-11T00:00:00Z' },
    numbering: [legalNumbering()],
    sections: [
      {
        blocks: [
          listItem('Definitions', 'articles', 0),
          listItem('Confidential Information', 'articles', 1),
          listItem('Exclusions', 'articles', 1),
          listItem('publicly available information', 'articles', 2),
          listItem('Obligations', 'articles', 0),
          listItem('Standard of care', 'articles', 1),
        ],
      },
    ],
  };
}

describe('Traceability: numbering and legal-document recipes', () => {
  test
    .openspec('[SDX-GEN-060] numbering definitions are emitted')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.16' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.1' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.15' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.19' },
    )(
    'Scenario: numbering definitions are emitted',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a spec declaring a three-level numbering definition used by list paragraphs', async () => {
        buffer = await generateDocx(nestedListSpec());
        expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
      });

      let numberingXml!: string;
      let documentXml!: string;
      await when('word/numbering.xml and word/document.xml are parsed back', async () => {
        numberingXml = (await readZipText(buffer, 'word/numbering.xml'))!;
        documentXml = (await readZipText(buffer, 'word/document.xml'))!;
        expect(numberingXml).toBeTruthy();
        await attachPrettyXml('word/numbering.xml', numberingXml);
      });

      await then('the part holds a matching abstract definition and instance', async () => {
        const numberingDoc = parseXml(numberingXml);
        const abstract = numberingDoc.getElementsByTagName('w:abstractNum').item(0)!;
        expect(abstract.getAttribute('w:abstractNumId')).toBe('0');
        expect(abstract.getElementsByTagName('w:lvl')).toHaveLength(3);
        const num = numberingDoc.getElementsByTagName('w:num').item(0)!;
        expect(num.getAttribute('w:numId')).toBe('1');
        expect(num.getElementsByTagName('w:abstractNumId').item(0)!.getAttribute('w:val')).toBe('0');
      });

      await then('list paragraphs reference it via w:numPr with the declared level', async () => {
        const documentDoc = parseXml(documentXml);
        const numPrs = Array.from(documentDoc.getElementsByTagName('w:numPr'));
        expect(numPrs).toHaveLength(6);
        const first = numPrs[0]!;
        expect(first.getElementsByTagName('w:ilvl').item(0)!.getAttribute('w:val')).toBe('0');
        expect(first.getElementsByTagName('w:numId').item(0)!.getAttribute('w:val')).toBe('1');
        expect(numPrs[3]!.getElementsByTagName('w:ilvl').item(0)!.getAttribute('w:val')).toBe('2');
      });
    },
  );

  test.openspec('[SDX-GEN-061] generated labels match the read-side computation')(
    'Scenario: generated labels match the read-side computation',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a generated document with nested numbered lists', async () => {
        buffer = await generateDocx(nestedListSpec());
        expect(buffer.length).toBeGreaterThan(0);
      });

      let labels!: string[];
      await when('the read-side list-label computation runs over the loaded document', async () => {
        const doc = await DocxDocument.load(buffer);
        const numberingXml = (await readZipText(buffer, 'word/numbering.xml'))!;
        const model = parseNumberingXml(parseXml(numberingXml));
        const documentDoc = doc.getDocumentXmlClone();
        const counters: NumberingCounters = new Map();
        labels = [];
        for (const numPr of Array.from(documentDoc.getElementsByTagName('w:numPr'))) {
          const ilvl = Number(numPr.getElementsByTagName('w:ilvl').item(0)!.getAttribute('w:val'));
          const numId = numPr.getElementsByTagName('w:numId').item(0)!.getAttribute('w:val')!;
          labels.push(computeListLabelForParagraph(model, counters, { numId, ilvl }));
        }
        await attachPrettyJson('computed-labels', labels);
      });

      await then('the computed labels match the labels implied by the numbering definition', async () => {
        expect(labels).toEqual(['1.', '1.1', '1.2', '(i)', '2.', '2.1']);
        expect(new Set(labels).size).toBe(labels.length);
      });
    },
  );

  test
    .openspec('[SDX-GEN-062] bullet and ordinal formats are both supported')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.17' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.11' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.25' },
    )(
    'Scenario: bullet and ordinal formats are both supported',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('numbering definitions using bullet, decimal, and roman formats across levels', async () => {
        spec = {
          numbering: [
            {
              numId: 'mixed',
              levels: [
                { ilvl: 0, numFmt: 'bullet', lvlText: '•', suff: 'tab', runProps: { font: 'Symbol' } },
                { ilvl: 1, numFmt: 'decimal', start: 3, lvlText: '%2)' },
                { ilvl: 2, numFmt: 'upperRoman', lvlText: '%3.' },
              ],
            },
          ],
          sections: [
            {
              blocks: [
                listItem('bullet item', 'mixed', 0),
                listItem('decimal item', 'mixed', 1),
                listItem('roman item', 'mixed', 2),
              ],
            },
          ],
        };
        expect(spec.numbering![0]!.levels).toHaveLength(3);
      });

      let levels!: Element[];
      await when('the document is generated and the levels parsed back', async () => {
        const buffer = await generateDocx(spec);
        const numberingXml = (await readZipText(buffer, 'word/numbering.xml'))!;
        await attachPrettyXml('word/numbering.xml', numberingXml);
        levels = Array.from(parseXml(numberingXml).getElementsByTagName('w:lvl'));
        expect(levels).toHaveLength(3);
      });

      await then('each level carries the declared numFmt, level text, and start value', async () => {
        const fmt = (lvl: Element) => lvl.getElementsByTagName('w:numFmt').item(0)!.getAttribute('w:val');
        const text = (lvl: Element) => lvl.getElementsByTagName('w:lvlText').item(0)!.getAttribute('w:val');
        expect(levels.map(fmt)).toEqual(['bullet', 'decimal', 'upperRoman']);
        expect(levels.map(text)).toEqual(['•', '%2)', '%3.']);
        expect(levels[1]!.getElementsByTagName('w:start').item(0)!.getAttribute('w:val')).toBe('3');
        expect(levels[0]!.getElementsByTagName('w:rFonts').item(0)!.getAttribute('w:ascii')).toBe('Symbol');
      });
    },
  );

  test('phase 5 numbering artifact loads through the document façade with labels intact', async () => {
    const spec: DocumentSpec = {
      meta: { title: 'SDX generation phase 5', author: 'safe-docx tests', createdIso: '2026-06-11T00:00:00Z' },
      numbering: [legalNumbering()],
      sections: [
        {
          blocks: [
            listItem('Definitions', 'articles', 0),
            listItem('Confidential Information means non-public information.', 'articles', 1),
            listItem('Obligations', 'articles', 0),
            { kind: 'paragraph', runs: [{ kind: 'text', text: 'IN WITNESS WHEREOF, the parties execute this Agreement.' }] },
          ],
        },
      ],
    };
    const buffer = await generateDocx(spec);
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('sdx-gen-phase5');
    const texts = doc.readParagraphs().paragraphs.map((p) => p.text);
    expect(texts.join('\n')).toContain('Definitions');
    expect(texts.join('\n')).toContain('Obligations');
    const { writeIntegrationArtifact } = await import('../integration/output-artifacts.js');
    const outputPath = await writeIntegrationArtifact('generation-phase5-numbering.docx', buffer);
    expect(outputPath).toContain('generation-phase5-numbering.docx');
  });
});
