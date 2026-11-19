import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { OOXML, computeListLabelForParagraph, parseNumberingXml, parseXml, type NumberingCounters } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { createDocumentFromMarkdoc } from './create.js';
import { lowerCreationMarkdoc } from './lower.js';

const TEST_FEATURE = 'continue-created-list-numbering';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1252 continuous list numbering across headings',
  severity: 'critical',
});
const conforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.15' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.26' });

const W = OOXML.W_NS;
const EVIDENCE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../scripts/oracle/word/evidence/issue-1252-word-16.114.json');

type WordReading = { listStrings: Array<{ listString: string; text: string }>; references: Array<{ instruction: string; word: string }> };
type Evidence = {
  source: string;
  numberingInstances: string[];
  cachedResults: string[];
  before: WordReading;
  afterInsertingInFirstList: WordReading & { insertedAfter: string; insertedText: string };
  afterInsertingInRestartedList: WordReading & { insertedAfter: string; insertedText: string };
};

const wAttr = (element: Element | null | undefined, name: string): string | null =>
  element ? element.getAttributeNS(W, name) || element.getAttribute(`w:${name}`) : null;

async function parts(docx: Buffer): Promise<{ document: Document; numbering: Document }> {
  const zip = await JSZip.loadAsync(docx);
  return {
    document: parseXml(await zip.file('word/document.xml')!.async('string')),
    numbering: parseXml(await zip.file('word/numbering.xml')!.async('string')),
  };
}

function listParagraphs(document: Document): Element[] {
  return Array.from(document.getElementsByTagNameNS(W, 'p')).filter((paragraph) => paragraph.getElementsByTagNameNS(W, 'numPr').length > 0);
}

function numPrOf(paragraph: Element): { numId: string; ilvl: number } {
  const numPr = paragraph.getElementsByTagNameNS(W, 'numPr').item(0)!;
  return {
    numId: wAttr(numPr.getElementsByTagNameNS(W, 'numId').item(0), 'val')!,
    ilvl: Number(wAttr(numPr.getElementsByTagNameNS(W, 'ilvl').item(0), 'val') ?? '0'),
  };
}

/** The label docx-core's read side gives each list paragraph, in document order, with its text. */
function labels(document: Document, numbering: Document): string[] {
  const model = parseNumberingXml(numbering);
  const counters: NumberingCounters = new Map();
  return listParagraphs(document).map((paragraph) => {
    const label = computeListLabelForParagraph(model, counters, numPrOf(paragraph));
    const text = Array.from(paragraph.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('');
    return `${label} ${text}`;
  });
}

/** Insert a copy of the `index`th list paragraph right after it, as a Word user adding a clause would. */
function insertClauseAfter(document: Document, index: number, text: string): void {
  const paragraph = listParagraphs(document)[index]!;
  const copy = paragraph.cloneNode(true) as Element;
  for (const node of Array.from(copy.childNodes)) {
    if ((node as Element).localName !== 'pPr') copy.removeChild(node);
  }
  const run = document.createElementNS(W, 'w:r');
  const t = document.createElementNS(W, 'w:t');
  t.textContent = text;
  run.appendChild(t);
  copy.appendChild(run);
  paragraph.parentNode!.insertBefore(copy, paragraph.nextSibling);
}

function indexOfItem(document: Document, text: string): number {
  return listParagraphs(document).findIndex((paragraph) => Array.from(paragraph.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('') === text);
}

function nums(numbering: Document): Array<{ numId: string; abstractNumId: string; startOverrides: string[] }> {
  return Array.from(numbering.getElementsByTagNameNS(W, 'num')).map((num) => ({
    numId: wAttr(num, 'numId')!,
    abstractNumId: wAttr(num.getElementsByTagNameNS(W, 'abstractNumId').item(0), 'val')!,
    startOverrides: Array.from(num.getElementsByTagNameNS(W, 'startOverride')).map((override) => wAttr(override, 'val')!),
  }));
}

describe('Traceability: continuous list numbering in created documents', () => {
  conforming.openspec('[SDX-MDOC-LISTSEQ-01] ordered lists split by headings continue one Word list')(
    'Scenario: ordered lists split by headings continue one Word list',
    async () => {
      const source = [
        '## Purchase', '', '1. First clause.', '2. Second clause.', '   1. Sub-clause.', '',
        '## Closing', '', '3. Third clause.', '   1. Sub-clause.', '4. Fourth clause.', '',
        '- A bullet between the lists.', '',
        '## Termination', '', '5. Fifth clause.',
      ].join('\n');
      const created = await createDocumentFromMarkdoc(source);
      expect(created.certificate.passed).toBe(true);
      const { document, numbering } = await parts(created.docx);

      // One abstract definition for every ordered list, and one w:num with no start override.
      const ordered = listParagraphs(document).filter((paragraph) => !paragraph.textContent!.includes('bullet'));
      expect(new Set(ordered.map((paragraph) => numPrOf(paragraph).numId)).size).toBe(1);
      expect(numbering.getElementsByTagNameNS(W, 'abstractNum')).toHaveLength(2);
      expect(nums(numbering).every((num) => num.startOverrides.length === 0)).toBe(true);
      expect(numbering.getElementsByTagNameNS(W, 'lvlOverride')).toHaveLength(0);

      expect(labels(document, numbering)).toEqual([
        '1. First clause.', '2. Second clause.', '(a) Sub-clause.',
        '3. Third clause.', '(a) Sub-clause.', '4. Fourth clause.',
        '• A bullet between the lists.',
        '5. Fifth clause.',
      ]);

      // A clause inserted in the first list renumbers every later list.
      insertClauseAfter(document, 0, 'Inserted clause.');
      expect(labels(document, numbering)).toEqual([
        '1. First clause.', '2. Inserted clause.', '3. Second clause.', '(a) Sub-clause.',
        '4. Third clause.', '(a) Sub-clause.', '5. Fourth clause.',
        '• A bullet between the lists.',
        '6. Fifth clause.',
      ]);

      // A first list that starts past 1 sets the definition's start.
      const { document: late, numbering: lateNumbering } = await parts((await createDocumentFromMarkdoc('3. Third.\n\n## Next\n\n4. Fourth.')).docx);
      expect(wAttr(lateNumbering.getElementsByTagNameNS(W, 'start').item(0), 'val')).toBe('3');
      expect(labels(late, lateNumbering)).toEqual(['3. Third.', '4. Fourth.']);
      expect(nums(lateNumbering)).toHaveLength(1);
    },
  );

  conforming.openspec('[SDX-MDOC-LISTSEQ-02] a list whose first marker does not continue restarts with a start override')(
    'Scenario: a list whose first marker does not continue restarts with a start override',
    async () => {
      const source = [
        '## Purchase', '', '1. First clause.', '2. Second clause.', '',
        '## Schedule', '', '1. Schedule item one.', '2. Schedule item two.', '',
        '## Continuing', '', '3. Schedule item three.', '',
        '## Jump', '', '10. Tenth item.',
      ].join('\n');
      const created = await createDocumentFromMarkdoc(source);
      expect(created.certificate.passed).toBe(true);
      const { document, numbering } = await parts(created.docx);

      // One abstract definition; the restarts are instances over it with a level-0 start override.
      expect(numbering.getElementsByTagNameNS(W, 'abstractNum')).toHaveLength(1);
      expect(nums(numbering)).toEqual([
        { numId: '1', abstractNumId: '0', startOverrides: [] },
        { numId: '2', abstractNumId: '0', startOverrides: ['1'] },
        { numId: '3', abstractNumId: '0', startOverrides: ['10'] },
      ]);
      expect(listParagraphs(document).map((paragraph) => numPrOf(paragraph).numId)).toEqual(['1', '1', '2', '2', '2', '3']);

      // The restarted list keeps its numbers when a clause is inserted before it;
      // the list continuing it follows it, not the first list.
      insertClauseAfter(document, 0, 'Inserted clause.');
      expect(labels(document, numbering)).toEqual([
        '1. First clause.', '2. Inserted clause.', '3. Second clause.',
        '1. Schedule item one.', '2. Schedule item two.',
        '3. Schedule item three.',
        '10. Tenth item.',
      ]);
      insertClauseAfter(document, 3, 'Inserted schedule item.');
      expect(labels(document, numbering).slice(3)).toEqual([
        '1. Schedule item one.', '2. Inserted schedule item.', '3. Schedule item two.',
        '4. Schedule item three.',
        '10. Tenth item.',
      ]);
    },
  );

  test.openspec('[SDX-MDOC-LISTSEQ-03] cross-references into continued and restarted lists show the numbers Word shows')(
    'Scenario: cross-references into continued and restarted lists show the numbers Word shows',
    async () => {
      const source = [
        '## Purchase', '', '1. Price.', '2. Payment. See {% xref to="deliveries" /%} and {% xref to="schedule-two" /%}.', '',
        '## Closing', '', '3. Closing date.', '4. Deliveries {% #deliveries %}', '   1. Certificate {% #certificate %}', '',
        '## Schedule', '', '1. Schedule one.', '2. Schedule two {% #schedule-two %}', '',
        '## Survival', '', '5. Survival {% #survival %}', '',
        'Compare {% xref to="certificate" /%}, {% xref to="certificate" number="paragraph" /%} and {% xref to="survival" /%}.',
      ].join('\n');
      const created = await createDocumentFromMarkdoc(source);
      expect(created.certificate.passed).toBe(true);
      expect(created.certificate.checks.crossReferences.passed).toBe(true);
      expect(created.readback.crossReferences?.map((reference) => reference.text)).toEqual(['4', '2', '4(a)', '(a)', '5']);

      // `5.` follows the schedule list, which restarted at 1 and ended at 2, so it restarts too.
      const lowering = lowerCreationMarkdoc(source);
      const ordered = lowering.spec.numbering!.find((definition) => definition.levels[0]!.numFmt === 'decimal')!;
      expect(ordered.instances?.map((instance) => instance.levelOverrides)).toEqual([[{ ilvl: 0, startOverride: 1 }], [{ ilvl: 0, startOverride: 5 }]]);

      // Word 16.114, on the oracle document: before any edit its after-update REF results equal
      // the cached results; after an insertion the read side's labels are the ones Word showed.
      const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as Evidence;
      const oracle = await createDocumentFromMarkdoc(evidence.source);
      expect(oracle.certificate.passed).toBe(true);
      expect(oracle.readback.crossReferences?.map((reference) => reference.text)).toEqual(evidence.cachedResults);
      expect(evidence.before.references.map((reference) => reference.word)).toEqual(evidence.cachedResults);
      const { document: oracleDocument, numbering: oracleNumbering } = await parts(oracle.docx);
      expect(Array.from(oracleNumbering.getElementsByTagNameNS(W, 'num')).map((num) => num.toString().replace(` xmlns:w="${W}"`, ''))).toEqual(evidence.numberingInstances);
      const wordLabels = (reading: WordReading) => reading.listStrings.map((entry) => `${entry.listString} ${entry.text}`);
      expect(labels(oracleDocument, oracleNumbering)).toEqual(wordLabels(evidence.before));
      for (const reading of [evidence.afterInsertingInFirstList, evidence.afterInsertingInRestartedList]) {
        const { document: edited, numbering: editedNumbering } = await parts(oracle.docx);
        insertClauseAfter(edited, indexOfItem(edited, reading.insertedAfter), reading.insertedText);
        expect(labels(edited, editedNumbering)).toEqual(wordLabels(reading));
      }
    },
  );
});
