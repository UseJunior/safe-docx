import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { childElements, getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-generation-document-defaults';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });
const conforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.5.1' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.26' });

const BASELINE_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const FOUR_CHANNELS = ['w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'];

function body(text: string): DocumentSpec['sections'] {
  return [{ blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text }] }] }];
}

/** A house style declared once: Times New Roman on all four rFonts channels, 11pt, 8pt after, 1.15 lines. */
function houseStyleSpec(): DocumentSpec {
  return {
    meta: { title: 'House style', createdIso: '2026-10-07T00:00:00Z' },
    numbering: [{ numId: 'clauses', levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.', runProps: { font: 'Arial' } }] }],
    styles: [{ styleId: 'Caption', name: 'Caption', type: 'paragraph', basedOn: 'Normal', run: { font: 'Garamond' } }],
    defaults: {
      run: { font: 'Times New Roman', sizePt: 11 },
      paragraph: { spacing: { afterTwips: 160, lineTwips: 276, lineRule: 'auto' } },
    },
    sections: [{
      blocks: [
        { kind: 'paragraph', runs: [{ kind: 'text', text: 'Body text inherits the house defaults.' }] },
        { kind: 'paragraph', list: { numId: 'clauses', ilvl: 0 }, runs: [{ kind: 'text', text: 'Direct override.', font: 'Georgia' }] },
      ],
    }],
  };
}

function validateAgainstSchema(parts: Record<string, string>): void {
  const dir = mkdtempSync(resolve(tmpdir(), 'safe-docx-doc-defaults-'));
  try {
    const schema = resolve(process.cwd(), '../../spec-compliance/ecma-376/validation/wml-document-transitional.xsd');
    const files = Object.entries(parts).map(([name, xml]) => {
      const path = resolve(dir, name);
      writeFileSync(path, xml);
      return path;
    });
    const result = spawnSync('xmllint', ['--noout', '--nonet', '--schema', schema, ...files], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function attr(element: Element, name: string): string | null {
  return element.getAttribute(`w:${name}`);
}

describe('Traceability: document defaults and four-channel fonts', () => {
  conforming.openspec('[SDX-GEN-110] declared document defaults set the house font, size, and spacing once')(
    'Scenario: declared document defaults set the house font, size, and spacing once',
    async ({ given, when, then, attachPrettyJson, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a spec declaring run and paragraph defaults, a direct run font, and a numbering-level font', async () => {
        spec = houseStyleSpec();
        await attachPrettyJson('spec', spec);
      });

      let stylesXml!: string;
      let documentXml!: string;
      let numberingXml!: string;
      let fontTableXml!: string;
      await when('the document is generated and its parts are read back', async () => {
        const buffer = await generateDocx(spec);
        expect((await checkGeneratedPackage(buffer)).issues).toEqual([]);
        stylesXml = (await readZipText(buffer, 'word/styles.xml'))!;
        documentXml = (await readZipText(buffer, 'word/document.xml'))!;
        numberingXml = (await readZipText(buffer, 'word/numbering.xml'))!;
        fontTableXml = (await readZipText(buffer, 'word/fontTable.xml'))!;
        await attachPrettyXml('word/styles.xml', stylesXml);
      });

      await then('w:rPrDefault pins all four rFonts channels and the declared size', async () => {
        const styles = parseXml(stylesXml);
        const rPrDefault = styles.getElementsByTagName('w:rPrDefault').item(0)!;
        const rFonts = rPrDefault.getElementsByTagName('w:rFonts').item(0)!;
        for (const slot of ['ascii', 'hAnsi', 'eastAsia', 'cs']) expect(attr(rFonts, slot), slot).toBe('Times New Roman');
        expect(attr(rPrDefault.getElementsByTagName('w:sz').item(0)!, 'val')).toBe('22');
        expect(attr(rPrDefault.getElementsByTagName('w:szCs').item(0)!, 'val')).toBe('22');
      });

      await then('w:pPrDefault carries the declared spacing', async () => {
        const styles = parseXml(stylesXml);
        const pPrDefault = styles.getElementsByTagName('w:pPrDefault').item(0)!;
        const pPr = getDirectChildrenByName(pPrDefault, 'pPr')[0]!;
        const spacing = getDirectChildrenByName(pPr, 'spacing')[0]!;
        expect([attr(spacing, 'after'), attr(spacing, 'line'), attr(spacing, 'lineRule')]).toEqual(['160', '276', 'auto']);
      });

      await then('body paragraphs carry no direct font or spacing; they inherit', async () => {
        const document = parseXml(documentXml);
        const paragraphs = Array.from(document.getElementsByTagName('w:p'));
        // The first paragraph has no direct formatting; the second exercises overrides.
        expect(paragraphs[0]!.getElementsByTagName('w:rPr')).toHaveLength(0);
        expect(paragraphs[0]!.getElementsByTagName('w:pPr')).toHaveLength(0);
      });

      await then('the font table lists the house default first and drops the unused Calibri baseline', async () => {
        const names = Array.from(parseXml(fontTableXml).getElementsByTagName('w:font')).map((font) => attr(font, 'name'));
        expect(names).toEqual(['Times New Roman', 'Arial', 'Garamond', 'Georgia']);
      });

      await then('direct run, style and numbering-level fonts pin the same four channels', async () => {
        const styleFonts = Array.from(parseXml(stylesXml).getElementsByTagName('w:style'))
          .find((style) => attr(style, 'styleId') === 'Caption')!.getElementsByTagName('w:rFonts').item(0)!;
        expect(Array.from(styleFonts.attributes).map((a) => a.name)).toEqual(FOUR_CHANNELS);
        expect(new Set(FOUR_CHANNELS.map((name) => styleFonts.getAttribute(name)))).toEqual(new Set(['Garamond']));
        const direct = parseXml(documentXml).getElementsByTagName('w:rFonts').item(0)!;
        expect(Array.from(direct.attributes).map((a) => a.name)).toEqual(FOUR_CHANNELS);
        expect(new Set(FOUR_CHANNELS.map((name) => direct.getAttribute(name)))).toEqual(new Set(['Georgia']));
        const level = parseXml(numberingXml).getElementsByTagName('w:rFonts').item(0)!;
        expect(Array.from(level.attributes).map((a) => a.name)).toEqual(FOUR_CHANNELS);
        expect(new Set(FOUR_CHANNELS.map((name) => level.getAttribute(name)))).toEqual(new Set(['Arial']));
      });

      await then('the styles, numbering and document parts validate against the transitional WML schema', async () => {
        validateAgainstSchema({ 'styles.xml': stylesXml, 'numbering.xml': numberingXml, 'document.xml': documentXml });
      });
    },
  );

  test.openspec('[SDX-GEN-110] omitting defaults keeps the Calibri 11pt baseline')(
    'Scenario: omitting defaults keeps the Calibri 11pt baseline',
    async () => {
      const stylesXml = (await readZipText(await generateDocx({ sections: body('Plain.') }), 'word/styles.xml'))!;
      expect(stylesXml).toContain(BASELINE_DOC_DEFAULTS);
      const partial = (await readZipText(await generateDocx({ defaults: { run: { sizePt: 12 } }, sections: body('Plain.') }), 'word/styles.xml'))!;
      const rPrDefault = parseXml(partial).getElementsByTagName('w:rPrDefault').item(0)!;
      const rFonts = rPrDefault.getElementsByTagName('w:rFonts').item(0)!;
      expect(attr(rFonts, 'ascii')).toBe('Calibri');
      expect(attr(rFonts, 'eastAsia')).toBe('Calibri');
      expect(attr(rPrDefault.getElementsByTagName('w:sz').item(0)!, 'val')).toBe('24');
      expect(childElements(parseXml(partial).getElementsByTagName('w:pPrDefault').item(0)!)).toHaveLength(0);
      // An explicit undefined must not erase the baseline (it would leave font and size to reader fallbacks).
      const erased = (await readZipText(await generateDocx({ defaults: { run: { font: undefined, sizePt: undefined } }, sections: body('Plain.') }), 'word/styles.xml'))!;
      expect(erased).toContain(BASELINE_DOC_DEFAULTS);
      const fontTable = (await readZipText(await generateDocx({ sections: body('Plain.') }), 'word/fontTable.xml'))!;
      expect(Array.from(parseXml(fontTable).getElementsByTagName('w:font')).map((font) => attr(font, 'name'))).toEqual(['Calibri']);
    },
  );

  test.openspec('[SDX-GEN-110] invalid defaults are rejected before emission')(
    'Scenario: invalid defaults are rejected before emission',
    async () => {
      const invalid: Array<[DocumentSpec['defaults'], string]> = [
        [{ run: { font: '' } }, '/defaults/run/font'],
        [{ run: { font: '  ' } }, '/defaults/run/font'],
        [{ run: { sizePt: 0 } }, '/defaults/run/sizePt'],
        [{ paragraph: { spacing: { afterTwips: -1 } } }, '/defaults/paragraph/spacing/afterTwips'],
      ];
      for (const [defaults, path] of invalid) {
        const error = await generateDocx({ defaults, sections: body('x') }).catch((caught: unknown) => caught);
        expect(error, path).toBeInstanceOf(GenerationSpecError);
        expect((error as GenerationSpecError).path).toBe(path);
      }
    },
  );

  test.openspec('[SDX-GEN-110] an explicit false overrides a true paragraph default')(
    'Scenario: an explicit false overrides a true paragraph default',
    async () => {
      const buffer = await generateDocx({
        defaults: { paragraph: { keepNext: true, keepLines: true, pageBreakBefore: true } },
        styles: [{ styleId: 'Exception', name: 'Exception', type: 'paragraph', basedOn: 'Normal', paragraph: { keepNext: false, keepLines: false, pageBreakBefore: false } }],
        sections: [{ blocks: [
          { kind: 'paragraph', keepNext: false, keepLines: false, pageBreakBefore: false, runs: [{ kind: 'text', text: 'Direct override.' }] },
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Inherits the defaults.' }] },
        ] }],
      });
      const stylesXml = (await readZipText(buffer, 'word/styles.xml'))!;
      const documentXml = (await readZipText(buffer, 'word/document.xml'))!;
      const toggles = (element: Element) => ['keepNext', 'keepLines', 'pageBreakBefore'].map((name) => {
        const found = getDirectChildrenByName(getDirectChildrenByName(element, 'pPr')[0] ?? element, name)[0];
        return found ? (found.getAttribute('w:val') ?? 'on') : null;
      });
      const styles = parseXml(stylesXml);
      expect(toggles(styles.getElementsByTagName('w:pPrDefault').item(0)!)).toEqual(['on', 'on', 'on']);
      const exception = Array.from(styles.getElementsByTagName('w:style')).find((style) => attr(style, 'styleId') === 'Exception')!;
      expect(toggles(exception)).toEqual(['0', '0', '0']);
      const [direct, inherited] = Array.from(parseXml(documentXml).getElementsByTagName('w:p'));
      expect(toggles(direct!)).toEqual(['0', '0', '0']);
      expect(inherited!.getElementsByTagName('w:pPr')).toHaveLength(0);
      validateAgainstSchema({ 'styles.xml': stylesXml, 'document.xml': documentXml });
    },
  );
});
