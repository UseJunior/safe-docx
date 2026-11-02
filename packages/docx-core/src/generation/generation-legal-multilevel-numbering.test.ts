import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { childElements } from '../primitives/dom-helpers.js';
import { computeListLabelForParagraph, parseNumberingXml, type NumberingCounters } from '../primitives/numbering.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { generateDocx } from './compile.js';
import { CompileContext } from './context.js';
import { emitStylesPart } from './emit/styles-part.js';
import { GenerationInternalError, GenerationSpecError } from './errors.js';
import { LVL_ORDER } from './ordering.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec, NumberingSpec, ParagraphSpec, StyleSpec } from './types.js';
import { validateSpec } from './validate-spec.js';

const TEST_FEATURE = 'add-legal-multilevel-numbering';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WML_XSD_PATH = path.resolve(__dirname, '../../../../spec-compliance/ecma-376/schemas/transitional/wml.xsd');
const CREATED = '2026-11-02T00:00:00Z';

/** Child element local names of a complexType, in schema declaration order. */
function schemaSequence(xsd: string, typeName: string): string[] {
  const start = xsd.indexOf(`<xsd:complexType name="${typeName}">`);
  if (start < 0) throw new Error(`complexType ${typeName} not found`);
  const body = xsd.slice(start, xsd.indexOf('</xsd:complexType>', start));
  return Array.from(body.matchAll(/<xsd:element name="([A-Za-z]+)"/g), (m) => m[1]!);
}

function localNames(el: Element): string[] {
  return childElements(el).map((child) => child.localName);
}

function wVal(parent: Element, name: string): string | null {
  return parent.getElementsByTagName(`w:${name}`).item(0)?.getAttribute('w:val') ?? null;
}

function text(value: string): ParagraphSpec['runs'] {
  return [{ kind: 'text', text: value }];
}

async function numberingDom(spec: DocumentSpec): Promise<Document> {
  const buffer = await generateDocx(spec);
  return parseXml((await readZipText(buffer, 'word/numbering.xml'))!);
}

function levelsOf(doc: Document, abstractIndex = 0): Element[] {
  const abstract = doc.getElementsByTagName('w:abstractNum').item(abstractIndex)!;
  return Array.from(abstract.getElementsByTagName('w:lvl'));
}

function expectSpecError(spec: DocumentSpec, code: string, errorPath: string, message?: RegExp): void {
  let caught: unknown;
  try {
    validateSpec(spec);
  } catch (err) {
    caught = err;
  }
  expect(caught, `${errorPath} should be rejected`).toBeInstanceOf(GenerationSpecError);
  const specError = caught as GenerationSpecError;
  expect(specError.code).toBe(code);
  expect(specError.path).toBe(errorPath);
  if (message) expect(specError.message).toMatch(message);
}

/** A single-definition document whose one paragraph uses level 0. */
function withNumbering(numbering: NumberingSpec[], styles?: StyleSpec[]): DocumentSpec {
  return {
    meta: { createdIso: CREATED },
    styles,
    numbering,
    sections: [{ blocks: [{ kind: 'paragraph', list: { numId: numbering[0]!.numId, ilvl: 0 }, runs: text('x') }] }],
  };
}

const HEADING_STYLES: StyleSpec[] = [
  {
    styleId: 'Heading1',
    name: 'heading 1',
    type: 'paragraph',
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: { alignment: 'center', keepNext: true, spacing: { beforeTwips: 240, afterTwips: 240 } },
    run: { bold: true },
  },
  {
    styleId: 'Heading2',
    name: 'heading 2',
    type: 'paragraph',
    basedOn: 'Normal',
    next: 'Normal',
    paragraph: { keepNext: true, spacing: { beforeTwips: 120, afterTwips: 120 } },
    run: { bold: true },
  },
];

/**
 * The US legal outline from issue #1235: ARTICLE I / Section 1.01 / (a) /
 * (i) / (A). Article and Section levels are linked to Heading 1 / Heading 2;
 * clause levels put the label at 0.5" (firstLine), the text at the next tab
 * stop, and wrap back to the margin (left 0).
 */
function legalOutline(): NumberingSpec {
  return {
    numId: 'legal',
    levels: [
      { ilvl: 0, numFmt: 'upperRoman', lvlText: 'ARTICLE %1', pStyle: 'Heading1', suff: 'nothing', lvlJc: 'center', indentTwips: { left: 0, firstLine: 0 } },
      { ilvl: 1, numFmt: 'decimalZero', lvlText: 'Section %1.%2', isLgl: true, pStyle: 'Heading2', indentTwips: { left: 0, firstLine: 720 }, tabs: [{ posTwips: 2160, align: 'left' }] },
      { ilvl: 2, numFmt: 'lowerLetter', lvlText: '(%3)', indentTwips: { left: 0, firstLine: 720 }, tabs: [{ posTwips: 1440, align: 'left' }] },
      { ilvl: 3, numFmt: 'lowerRoman', lvlText: '(%4)', indentTwips: { left: 0, firstLine: 1440 }, tabs: [{ posTwips: 2160, align: 'left' }] },
      { ilvl: 4, numFmt: 'upperLetter', lvlText: '(%5)', indentTwips: { left: 0, firstLine: 2160 }, tabs: [{ posTwips: 2880, align: 'left' }] },
    ],
  };
}

const article = (title: string): ParagraphSpec => ({ kind: 'paragraph', styleId: 'Heading1', runs: [{ kind: 'break' }, { kind: 'text', text: title }] });
const section = (title: string): ParagraphSpec => ({ kind: 'paragraph', styleId: 'Heading2', runs: text(title) });
const clause = (ilvl: number, body: string): ParagraphSpec => ({ kind: 'paragraph', list: { numId: 'legal', ilvl }, runs: text(body) });

/** The two-article acceptance document, with the labels Word and LibreOffice display. */
function twoArticleAgreement(): { spec: DocumentSpec; expectedLabels: string[] } {
  const rows: Array<[ParagraphSpec, string]> = [
    [article('DEFINITIONS'), 'ARTICLE I'],
    [section('Defined Terms.'), 'Section 1.01'],
    [clause(2, 'first lettered clause.'), '(a)'],
    [clause(3, 'first roman sub-clause.'), '(i)'],
    [clause(4, 'first capital sub-sub-clause.'), '(A)'],
    [clause(4, 'second capital sub-sub-clause.'), '(B)'],
    [clause(3, 'second roman sub-clause.'), '(ii)'],
    [clause(2, 'second lettered clause.'), '(b)'],
    [section('Interpretation.'), 'Section 1.02'],
    [clause(2, 'restarts in each Section.'), '(a)'],
    [article('PURCHASE AND SALE'), 'ARTICLE II'],
    [section('Purchase and Sale of Shares.'), 'Section 2.01'],
    [clause(2, 'restarts under Section 2.01.'), '(a)'],
    [clause(3, 'restarts under the new clause.'), '(i)'],
    [section('Closing.'), 'Section 2.02'],
  ];
  return {
    spec: {
      meta: { title: 'Two-article legal outline', createdIso: CREATED },
      styles: HEADING_STYLES,
      numbering: [legalOutline()],
      sections: [{ blocks: rows.map(([paragraph]) => paragraph) }],
    },
    expectedLabels: rows.map(([, label]) => label),
  };
}

/**
 * Read-side labels for a generated document: a paragraph's numbering comes
 * from its own w:numPr, else from its paragraph style's w:numPr (the link a
 * level's w:pStyle declares).
 */
async function readSideLabels(buffer: Buffer): Promise<string[]> {
  const model = parseNumberingXml(parseXml((await readZipText(buffer, 'word/numbering.xml'))!));
  const styles = parseXml((await readZipText(buffer, 'word/styles.xml'))!);
  const styleNumPr = new Map<string, Element>();
  for (const style of Array.from(styles.getElementsByTagName('w:style'))) {
    const numPr = style.getElementsByTagName('w:numPr').item(0);
    if (numPr) styleNumPr.set(style.getAttribute('w:styleId')!, numPr);
  }
  const body = parseXml((await readZipText(buffer, 'word/document.xml'))!);
  const counters: NumberingCounters = new Map();
  const labels: string[] = [];
  for (const p of Array.from(body.getElementsByTagName('w:p'))) {
    const pStyle = wVal(p, 'pStyle');
    const numPr = p.getElementsByTagName('w:numPr').item(0) ?? (pStyle ? styleNumPr.get(pStyle) : undefined);
    if (!numPr) continue;
    labels.push(
      computeListLabelForParagraph(model, counters, { numId: wVal(numPr, 'numId')!, ilvl: Number(wVal(numPr, 'ilvl') ?? '0') }),
    );
  }
  return labels;
}

describe('Traceability: legal multilevel numbering', () => {
  /**
   * @see https://github.com/UseJunior/safe-docx/issues/1235
   */
  test
    .openspec('[SDX-GEN-112] legal outline level properties are authorable')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.6' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.4' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.10' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.17' },
    )(
    'Scenario: legal outline level properties are authorable',
    async ({ given, when, then, and, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('levels declaring decimalZero, isLgl, and lvlRestart', async () => {
        spec = withNumbering([
          {
            numId: 'outline',
            levels: [
              { ilvl: 0, numFmt: 'upperRoman', lvlText: 'ARTICLE %1', lvlRestart: 0 },
              { ilvl: 1, numFmt: 'decimalZero', lvlText: 'Section %1.%2', isLgl: true },
              { ilvl: 2, numFmt: 'lowerLetter', lvlText: '(%3)', isLgl: false },
              { ilvl: 3, numFmt: 'lowerRoman', lvlText: '(%4)', lvlRestart: 2 },
              { ilvl: 4, numFmt: 'upperLetter', lvlText: '(%5)', lvlRestart: 0 },
            ],
          },
        ]);
      });

      let levels!: Element[];
      await when('the document is generated', async () => {
        const buffer = await generateDocx(spec);
        expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
        const numberingXml = (await readZipText(buffer, 'word/numbering.xml'))!;
        await attachPrettyXml('word/numbering.xml', numberingXml);
        levels = levelsOf(parseXml(numberingXml));
      });

      await then('each level carries the authored format, legal flag, and restart threshold', async () => {
        expect(wVal(levels[1]!, 'numFmt')).toBe('decimalZero');
        expect(levels[1]!.getElementsByTagName('w:isLgl')).toHaveLength(1);
        expect(levels[1]!.getElementsByTagName('w:isLgl').item(0)!.hasAttribute('w:val')).toBe(false);
        expect(levels[2]!.getElementsByTagName('w:isLgl')).toHaveLength(0);
        expect(wVal(levels[0]!, 'lvlRestart')).toBe('0');
        expect(wVal(levels[3]!, 'lvlRestart')).toBe('2');
        expect(wVal(levels[4]!, 'lvlRestart')).toBe('0');
        expect(levels[1]!.getElementsByTagName('w:lvlRestart')).toHaveLength(0);
      });

      await and('level children follow the CT_Lvl sequence of the vendored schema', async () => {
        const schemaOrder = schemaSequence(readFileSync(WML_XSD_PATH, 'utf-8'), 'CT_Lvl');
        expect(schemaOrder.filter((name) => (LVL_ORDER as readonly string[]).includes(name))).toEqual([...LVL_ORDER]);
        for (const lvl of levels) {
          const names = localNames(lvl);
          expect(names).toEqual(schemaOrder.filter((name) => names.includes(name)));
        }
        expect(localNames(levels[3]!).slice(0, 4)).toEqual(['start', 'numFmt', 'lvlRestart', 'lvlText']);
      });

      await and('a spec without the new properties emits the pre-change numbering part byte for byte', async () => {
        const legacy = await generateDocx(
          withNumbering([
            {
              numId: 'clauses',
              levels: [
                { ilvl: 0, numFmt: 'decimal', lvlText: '%1.', suff: 'space', indentTwips: { left: 720, hanging: 360 } },
                { ilvl: 1, numFmt: 'lowerLetter', lvlText: '(%2)', indentTwips: {} },
              ],
            },
          ]),
        );
        expect(await readZipText(legacy, 'word/numbering.xml')).toBe(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>' +
            '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:suff w:val="space"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
            '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/><w:lvlJc w:val="left"/><w:pPr><w:ind/></w:pPr></w:lvl>' +
            '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
        );
      });

      await and('lvlRestart values Word cannot honor, and malformed legal flags, are rejected', async () => {
        const level = (overrides: Record<string, unknown>) =>
          withNumbering([
            {
              numId: 'n',
              levels: [
                { ilvl: 0, numFmt: 'decimal', lvlText: '%1.' },
                { ilvl: 1, numFmt: 'decimal', lvlText: '%1.%2' },
                { ilvl: 2, numFmt: 'lowerLetter', lvlText: '(%3)', ...overrides } as never,
              ],
            },
          ]);
        // lvlRestart = ilvl restates the default; Word drops the level's numbering.
        expectSpecError(level({ lvlRestart: 2 }), 'invalid_value', '/numbering/0/levels/2/lvlRestart', /from 1 to 1/);
        expectSpecError(level({ lvlRestart: 3 }), 'invalid_value', '/numbering/0/levels/2/lvlRestart');
        expectSpecError(level({ lvlRestart: -1 }), 'invalid_value', '/numbering/0/levels/2/lvlRestart');
        expectSpecError(level({ lvlRestart: 1.5 }), 'invalid_value', '/numbering/0/levels/2/lvlRestart');
        expectSpecError(level({ isLgl: 'yes' }), 'invalid_value', '/numbering/0/levels/2/isLgl');
        expectSpecError(
          withNumbering([{ numId: 'n', levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.' }, { ilvl: 1, numFmt: 'decimal', lvlText: '%2', lvlRestart: 1 }] }]),
          'invalid_value',
          '/numbering/0/levels/1/lvlRestart',
          /must be 0 \(never restart\) at this level/,
        );
        expect(() => validateSpec(level({ lvlRestart: 1 }))).not.toThrow();
      });
    },
  );

  /**
   * @see https://github.com/UseJunior/safe-docx/issues/1235
   */
  test
    .openspec('[SDX-GEN-113] numbering levels link to paragraph styles')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.23' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.19' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.4.17' },
    )(
    'Scenario: numbering levels link to paragraph styles',
    async ({ given, when, then, and, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a second definition whose levels link Heading 1 and a style with no paragraph properties', async () => {
        spec = {
          meta: { createdIso: CREATED },
          styles: [
            ...HEADING_STYLES,
            { styleId: 'Clause', name: 'Clause', type: 'paragraph' },
          ],
          numbering: [
            { numId: 'bullets', levels: [{ ilvl: 0, numFmt: 'bullet', lvlText: '•' }] },
            {
              numId: 'outline',
              levels: [
                { ilvl: 0, numFmt: 'upperRoman', lvlText: 'ARTICLE %1', pStyle: 'Heading1' },
                { ilvl: 1, numFmt: 'decimal', lvlText: '%1.%2', pStyle: 'Clause' },
              ],
            },
          ],
          sections: [{ blocks: [{ kind: 'paragraph', styleId: 'Heading1', runs: text('Definitions') }] }],
        };
      });

      let numbering!: Document;
      let styles!: Document;
      await when('the document is generated', async () => {
        const buffer = await generateDocx(spec);
        expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
        const stylesXml = (await readZipText(buffer, 'word/styles.xml'))!;
        await attachPrettyXml('word/styles.xml', stylesXml);
        numbering = parseXml((await readZipText(buffer, 'word/numbering.xml'))!);
        styles = parseXml(stylesXml);
      });

      const styleById = (id: string) =>
        Array.from(styles.getElementsByTagName('w:style')).find((style) => style.getAttribute('w:styleId') === id)!;

      await then('each linked level names its style through w:pStyle', async () => {
        const levels = levelsOf(numbering, 1);
        expect(wVal(levels[0]!, 'pStyle')).toBe('Heading1');
        expect(wVal(levels[1]!, 'pStyle')).toBe('Clause');
        expect(levelsOf(numbering, 0)[0]!.getElementsByTagName('w:pStyle')).toHaveLength(0);
      });

      await and("each linked style carries w:numPr naming its definition's default instance and level", async () => {
        const heading = styleById('Heading1').getElementsByTagName('w:pPr').item(0)!;
        expect(localNames(heading)).toEqual(['keepNext', 'numPr', 'spacing', 'jc']);
        const numPr = heading.getElementsByTagName('w:numPr').item(0)!;
        expect(localNames(numPr)).toEqual(['ilvl', 'numId']);
        expect(wVal(numPr, 'ilvl')).toBe('0');
        expect(wVal(numPr, 'numId')).toBe('2');
        const clauseNumPr = styleById('Clause').getElementsByTagName('w:numPr').item(0)!;
        expect(wVal(clauseNumPr, 'ilvl')).toBe('1');
        expect(wVal(clauseNumPr, 'numId')).toBe('2');
        expect(styleById('Heading2').getElementsByTagName('w:numPr')).toHaveLength(0);
      });

      await and('a level linking an undeclared, non-paragraph, empty, or already-linked style is rejected', async () => {
        const linked = (pStyle: unknown, styles: StyleSpec[] = HEADING_STYLES, extra: NumberingSpec[] = []) =>
          withNumbering(
            [{ numId: 'n', levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.', pStyle: pStyle as string }] }, ...extra],
            styles,
          );
        expectSpecError(linked('Heading9'), 'dangling_style_reference', '/numbering/0/levels/0/pStyle');
        expectSpecError(linked('Normal'), 'dangling_style_reference', '/numbering/0/levels/0/pStyle');
        expectSpecError(
          linked('Emphasis', [...HEADING_STYLES, { styleId: 'Emphasis', name: 'Emphasis', type: 'character', run: { italic: true } }]),
          'invalid_value',
          '/numbering/0/levels/0/pStyle',
          /not a paragraph style/,
        );
        expectSpecError(linked(''), 'invalid_value', '/numbering/0/levels/0/pStyle');
        expectSpecError(
          linked('Heading1', HEADING_STYLES, [{ numId: 'm', levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.', pStyle: 'Heading1' }] }]),
          'invalid_value',
          '/numbering/1/levels/0/pStyle',
          /already linked to numbering level n\/0/,
        );
      });

      await and('the styles emitter refuses a link whose definition has no allocated instance id', async () => {
        expect(() => emitStylesPart(spec, new CompileContext())).toThrow(GenerationInternalError);
      });
    },
  );

  /**
   * @see https://github.com/UseJunior/safe-docx/issues/1235
   */
  test
    .openspec('[SDX-GEN-114] level indents take firstLine and tab stops')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.22' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.26' },
    )(
    'Scenario: level indents take firstLine and tab stops',
    async ({ given, when, then, and }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('levels declaring firstLine indents, tab stops, or tab stops alone', async () => {
        spec = withNumbering([
          {
            numId: 'clauses',
            levels: [
              { ilvl: 0, numFmt: 'lowerLetter', lvlText: '(%1)', indentTwips: { left: 0, firstLine: 720 }, tabs: [{ posTwips: 1440, align: 'left' }] },
              { ilvl: 1, numFmt: 'lowerRoman', lvlText: '(%2)', tabs: [{ posTwips: 2160, align: 'right', leader: 'dot' }] },
              { ilvl: 2, numFmt: 'upperLetter', lvlText: '(%3)', tabs: [] },
            ],
          },
        ]);
      });

      let levels!: Element[];
      await when('the document is generated', async () => {
        levels = levelsOf(await numberingDom(spec));
      });

      await then('the level pPr carries w:tabs before w:ind, and w:ind carries left and firstLine', async () => {
        const pPr = levels[0]!.getElementsByTagName('w:pPr').item(0)!;
        expect(localNames(pPr)).toEqual(['tabs', 'ind']);
        const ind = pPr.getElementsByTagName('w:ind').item(0)!;
        expect(ind.getAttribute('w:left')).toBe('0');
        expect(ind.getAttribute('w:firstLine')).toBe('720');
        expect(ind.hasAttribute('w:hanging')).toBe(false);
        const tab = pPr.getElementsByTagName('w:tab').item(0)!;
        expect([tab.getAttribute('w:val'), tab.getAttribute('w:pos')]).toEqual(['left', '1440']);
      });

      await and('tab stops alone emit a pPr without w:ind, and an empty tab list emits no pPr', async () => {
        const pPr = levels[1]!.getElementsByTagName('w:pPr').item(0)!;
        expect(localNames(pPr)).toEqual(['tabs']);
        expect(pPr.getElementsByTagName('w:tab').item(0)!.getAttribute('w:leader')).toBe('dot');
        expect(levels[2]!.getElementsByTagName('w:pPr')).toHaveLength(0);
      });

      await and('conflicting or malformed indents and tab stops are rejected', async () => {
        const level = (overrides: Record<string, unknown>) =>
          withNumbering([{ numId: 'n', levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.', ...overrides } as never] }]);
        expectSpecError(level({ indentTwips: { firstLine: 720, hanging: 360 } }), 'invalid_value', '/numbering/0/levels/0/indentTwips', /mutually exclusive/);
        expectSpecError(level({ indentTwips: { firstLine: -1 } }), 'invalid_value', '/numbering/0/levels/0/indentTwips/firstLine');
        expectSpecError(level({ tabs: [{ posTwips: 720, align: 'decimal' }] }), 'invalid_value', '/numbering/0/levels/0/tabs/0/align');
        expectSpecError(level({ tabs: [{ posTwips: -5, align: 'left' }] }), 'invalid_value', '/numbering/0/levels/0/tabs/0/posTwips');
        expectSpecError(level({ tabs: [{ posTwips: 720, align: 'left', leader: 'hyphen' }] }), 'invalid_value', '/numbering/0/levels/0/tabs/0/leader');
        expectSpecError(level({ tabs: { posTwips: 720 } }), 'invalid_value', '/numbering/0/levels/0/tabs');
        expectSpecError(level({ tabs: [null] }), 'invalid_value', '/numbering/0/levels/0/tabs/0', /must be objects/);
      });
    },
  );

  /**
   * @see https://github.com/UseJunior/safe-docx/issues/1235
   */
  test
    .openspec('[SDX-GEN-115] numbering instances restart a definition')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.15' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.8' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.26' },
    )(
    'Scenario: numbering instances restart a definition',
    async ({ given, when, then, and, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('two definitions, the first with two additional instances', async () => {
        spec = {
          meta: { createdIso: CREATED },
          numbering: [
            {
              numId: 'steps',
              levels: [
                { ilvl: 0, numFmt: 'decimal', lvlText: '%1.' },
                { ilvl: 1, numFmt: 'lowerLetter', lvlText: '(%2)' },
              ],
              instances: [
                { numId: 'steps-again', levelOverrides: [{ ilvl: 1, startOverride: 1 }, { ilvl: 0, startOverride: 1 }] },
                { numId: 'steps-from-seven', levelOverrides: [{ ilvl: 0, startOverride: 7 }] },
              ],
            },
            { numId: 'bullets', levels: [{ ilvl: 0, numFmt: 'bullet', lvlText: '•' }] },
          ],
          sections: [
            {
              blocks: [
                { kind: 'paragraph', list: { numId: 'steps', ilvl: 0 }, runs: text('A one') },
                { kind: 'paragraph', list: { numId: 'steps-again', ilvl: 0 }, runs: text('B one') },
                { kind: 'paragraph', list: { numId: 'steps-from-seven', ilvl: 0 }, runs: text('C seven') },
                { kind: 'paragraph', list: { numId: 'bullets', ilvl: 0 }, runs: text('bullet') },
              ],
            },
          ],
        };
      });

      let buffer!: Buffer;
      let nums!: Element[];
      await when('the document is generated', async () => {
        buffer = await generateDocx(spec);
        expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
        const numberingXml = (await readZipText(buffer, 'word/numbering.xml'))!;
        await attachPrettyXml('word/numbering.xml', numberingXml);
        nums = Array.from(parseXml(numberingXml).getElementsByTagName('w:num'));
      });

      await then('default instances keep ids 1..N and additional instances follow, referencing their definition', async () => {
        expect(nums.map((num) => [num.getAttribute('w:numId'), wVal(num, 'abstractNumId')])).toEqual([
          ['1', '0'],
          ['2', '1'],
          ['3', '0'],
          ['4', '0'],
        ]);
      });

      await and('each additional instance lists its overrides in ascending ilvl, each holding only startOverride', async () => {
        const schemaOrder = schemaSequence(readFileSync(WML_XSD_PATH, 'utf-8'), 'CT_Num');
        expect(schemaOrder).toEqual(['abstractNumId', 'lvlOverride']);
        expect(localNames(nums[2]!)).toEqual(['abstractNumId', 'lvlOverride', 'lvlOverride']);
        const overrides = Array.from(nums[2]!.getElementsByTagName('w:lvlOverride'));
        expect(overrides.map((override) => override.getAttribute('w:ilvl'))).toEqual(['0', '1']);
        for (const override of overrides) expect(localNames(override)).toEqual(['startOverride']);
        expect(wVal(nums[3]!, 'startOverride')).toBe('7');
        expect(localNames(nums[0]!)).toEqual(['abstractNumId']);
      });

      await and('paragraphs bind to the numeric id of the instance they name', async () => {
        const body = parseXml((await readZipText(buffer, 'word/document.xml'))!);
        const ids = Array.from(body.getElementsByTagName('w:numPr')).map((numPr) => wVal(numPr, 'numId'));
        expect(ids).toEqual(['1', '3', '4', '2']);
      });

      await and('malformed instances are rejected', async () => {
        const instances = (value: unknown) =>
          withNumbering([
            { numId: 'n', levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.' }], instances: value as never },
            { numId: 'm', levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.' }] },
          ]);
        const restart = [{ ilvl: 0, startOverride: 1 }];
        expectSpecError(instances({ numId: 'x' }), 'invalid_value', '/numbering/0/instances');
        expectSpecError(instances([null]), 'invalid_value', '/numbering/0/instances/0', /must be objects/);
        expectSpecError(
          instances([{ numId: 'x', levelOverrides: [null] }]),
          'invalid_value',
          '/numbering/0/instances/0/levelOverrides/0',
          /must be objects/,
        );
        expectSpecError(instances([{ levelOverrides: restart }]), 'invalid_value', '/numbering/0/instances/0/numId');
        expectSpecError(instances([{ numId: 'n', levelOverrides: restart }]), 'invalid_value', '/numbering/0/instances/0/numId', /Duplicate/);
        expectSpecError(instances([{ numId: 'm', levelOverrides: restart }]), 'invalid_value', '/numbering/0/instances/0/numId', /Duplicate/);
        expectSpecError(
          instances([{ numId: 'x', levelOverrides: restart }, { numId: 'x', levelOverrides: restart }]),
          'invalid_value',
          '/numbering/0/instances/1/numId',
        );
        expectSpecError(instances([{ numId: 'x' }]), 'invalid_value', '/numbering/0/instances/0/levelOverrides', /shared sequence/);
        expectSpecError(instances([{ numId: 'x', levelOverrides: [] }]), 'invalid_value', '/numbering/0/instances/0/levelOverrides');
        expectSpecError(
          instances([{ numId: 'x', levelOverrides: [{ ilvl: 3, startOverride: 1 }] }]),
          'dangling_numbering_reference',
          '/numbering/0/instances/0/levelOverrides/0/ilvl',
        );
        expectSpecError(
          instances([{ numId: 'x', levelOverrides: [...restart, ...restart] }]),
          'invalid_value',
          '/numbering/0/instances/0/levelOverrides/1/ilvl',
        );
        expectSpecError(
          instances([{ numId: 'x', levelOverrides: [{ ilvl: 0, startOverride: '1' }] }]),
          'invalid_value',
          '/numbering/0/instances/0/levelOverrides/0/startOverride',
        );
      });
    },
  );

  /**
   * @see https://github.com/UseJunior/safe-docx/issues/1235
   */
  test
    .openspec('[SDX-GEN-116] a two-article agreement carries US legal outline numbering')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.4' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.17' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.23' },
    )(
    'Scenario: a two-article agreement carries US legal outline numbering',
    async ({ given, when, then, and, attachPrettyXml, attachPrettyJson }: AllureBddContext) => {
      let agreement!: ReturnType<typeof twoArticleAgreement>;
      await given('a two-article agreement whose headings use only Heading 1 / Heading 2', async () => {
        agreement = twoArticleAgreement();
      });

      let buffer!: Buffer;
      let levels!: Element[];
      await when('the agreement is generated', async () => {
        buffer = await generateDocx(agreement.spec);
        expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
        const numberingXml = (await readZipText(buffer, 'word/numbering.xml'))!;
        await attachPrettyXml('word/numbering.xml', numberingXml);
        levels = levelsOf(parseXml(numberingXml));
      });

      await then('the Section level is legal, zero-padded, and linked to Heading 2 under a roman Article level', async () => {
        expect([wVal(levels[0]!, 'numFmt'), wVal(levels[0]!, 'lvlText'), wVal(levels[0]!, 'pStyle')]).toEqual([
          'upperRoman',
          'ARTICLE %1',
          'Heading1',
        ]);
        expect([wVal(levels[1]!, 'numFmt'), wVal(levels[1]!, 'lvlText'), wVal(levels[1]!, 'pStyle')]).toEqual([
          'decimalZero',
          'Section %1.%2',
          'Heading2',
        ]);
        expect(levels[1]!.getElementsByTagName('w:isLgl')).toHaveLength(1);
      });

      await and('clause levels restart after the previous level by default, with no explicit w:lvlRestart', async () => {
        // Word drops a level's numbering when lvlRestart restates the default,
        // so "(a) restarts in each Section" relies on the reader default.
        for (const lvl of levels) expect(lvl.getElementsByTagName('w:lvlRestart')).toHaveLength(0);
        const clauseInd = levels[2]!.getElementsByTagName('w:ind').item(0)!;
        expect([clauseInd.getAttribute('w:left'), clauseInd.getAttribute('w:firstLine')]).toEqual(['0', '720']);
      });

      await and('the read-side labels read ARTICLE I, Section 1.01, (a), (i), (A) … ARTICLE II, Section 2.01, (a)', async () => {
        const labels = await readSideLabels(buffer);
        await attachPrettyJson('labels', labels);
        expect(labels).toEqual(agreement.expectedLabels);
      });

      await and('a re-render of the same spec is byte-identical', async () => {
        expect((await generateDocx(twoArticleAgreement().spec)).equals(buffer)).toBe(true);
      });
    },
  );

  /**
   * @see https://github.com/UseJunior/safe-docx/issues/1235
   */
  test
    .openspec('[SDX-GEN-117] read-side labels honor legal numbering and restart thresholds')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.4' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.10' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.26' },
    )(
    'Scenario: read-side labels honor legal numbering and restart thresholds',
    async ({ given, when, then, and }: AllureBddContext) => {
      let numberingXml!: string;
      await given('a numbering part with isLgl, decimalZero, lvlRestart, and a startOverride instance', async () => {
        numberingXml =
          '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:abstractNum w:abstractNumId="0">' +
          '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl>' +
          '<w:lvl w:ilvl="1"><w:start w:val="9"/><w:numFmt w:val="decimalZero"/><w:isLgl/><w:lvlText w:val="%1.%2"/></w:lvl>' +
          '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlRestart w:val="0"/><w:lvlText w:val="(%3)"/></w:lvl>' +
          '<w:lvl w:ilvl="3"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlRestart w:val="1"/><w:isLgl w:val="0"/><w:lvlText w:val="(%4)"/></w:lvl>' +
          '<w:lvl w:ilvl="4"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:isLgl/><w:lvlText w:val="%5 %4"/></w:lvl>' +
          '</w:abstractNum>' +
          '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
          '<w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num>' +
          '</w:numbering>';
      });

      let labels!: string[];
      await when('labels are computed for a paragraph sequence', async () => {
        const model = parseNumberingXml(parseXml(numberingXml));
        const counters: NumberingCounters = new Map();
        const at = (numId: string, ilvl: number) => computeListLabelForParagraph(model, counters, { numId, ilvl });
        labels = [at('1', 0), at('1', 1), at('1', 1), at('1', 2), at('1', 3), at('1', 1), at('1', 2), at('1', 3), at('1', 0), at('1', 3), at('1', 4), at('2', 0)];
      });

      await then('legal levels print Arabic numerals and keep decimalZero padding past nine', async () => {
        expect(labels.slice(0, 3)).toEqual(['I.', '1.09', '1.10']);
      });

      await and('lvlRestart 0 never restarts and lvlRestart 1 restarts only after level one', async () => {
        // (a) continues across Sections (lvlRestart 0); (i) continues across
        // Sections but restarts after the next Article (lvlRestart 1).
        expect(labels.slice(3, 10)).toEqual(['(a)', '(i)', '1.11', '(b)', '(ii)', 'II.', '(i)']);
      });

      await and('bullet placeholders stay glyphs under isLgl and a startOverride instance starts at its override', async () => {
        expect(labels[10]).toBe('• 1');
        expect(labels[11]).toBe('IV.');
      });

      await and('lvlRestart 2 restarts its level only when level one or two is used', async () => {
        const model = parseNumberingXml(
          parseXml(
            '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0">' +
              '<w:lvl w:ilvl="0"><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl>' +
              '<w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>' +
              '<w:lvl w:ilvl="2"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%3)"/></w:lvl>' +
              '<w:lvl w:ilvl="3"><w:numFmt w:val="lowerRoman"/><w:lvlRestart w:val="2"/><w:lvlText w:val="(%4)"/></w:lvl>' +
              '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
          ),
        );
        const counters: NumberingCounters = new Map();
        const at = (ilvl: number) => computeListLabelForParagraph(model, counters, { numId: '1', ilvl });
        // (i) continues across lettered clauses, restarts at the next Section.
        expect([at(0), at(1), at(2), at(3), at(2), at(3), at(1), at(2), at(3)]).toEqual([
          'I.', 'I.1', '(a)', '(i)', '(b)', '(ii)', 'I.2', '(a)', '(i)',
        ]);
      });

      await and('levels starting at zero or below count up through zero, and decimalZero pads only one through nine', async () => {
        const labelsFor = async (numFmt: 'decimal' | 'decimalZero', startOverride: number) => {
          const buffer = await generateDocx({
            meta: { createdIso: CREATED },
            numbering: [
              {
                numId: 'n',
                levels: [
                  { ilvl: 0, numFmt, lvlText: '%1' },
                  { ilvl: 1, numFmt: 'lowerLetter', lvlText: '(%2)' },
                ],
                instances: [{ numId: 'restart', levelOverrides: [{ ilvl: 0, startOverride }] }],
              },
            ],
            sections: [
              {
                blocks: [0, 0, 1, 0, 0].map((ilvl) => ({ kind: 'paragraph' as const, list: { numId: 'restart', ilvl }, runs: text('x') })),
              },
            ],
          });
          return readSideLabels(buffer);
        };
        expect(await labelsFor('decimal', 0)).toEqual(['0', '1', '(a)', '2', '3']);
        expect(await labelsFor('decimalZero', 0)).toEqual(['0', '01', '(a)', '02', '03']);
        expect(await labelsFor('decimal', -1)).toEqual(['-1', '0', '(a)', '1', '2']);
      });
    },
  );
});
