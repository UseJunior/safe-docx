import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { testAllure } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import { OOXML } from '../primitives/namespaces.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const test = testAllure.epic('Document Generation').withLabels({ feature: 'ECMA-376 Structural Vocabularies' });

function validateEmittedWml(parts: Record<string, string>): void {
  const dir = mkdtempSync(resolve(tmpdir(), 'safe-docx-structural-schema-'));
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

function representativeSpec(): DocumentSpec {
  return {
    styles: [
      { styleId: 'TableBody', name: 'Table Body', type: 'paragraph', basedOn: 'Normal', next: 'Normal' },
    ],
    numbering: [
      {
        numId: 'clauses',
        levels: [
          { ilvl: 0, numFmt: 'decimal', lvlText: '%1.', suff: 'tab', indentTwips: { left: 720, hanging: 360 } },
          { ilvl: 1, numFmt: 'lowerLetter', lvlText: '(%2)', suff: 'space' },
        ],
      },
    ],
    sections: [{
      blocks: [{
        kind: 'table',
        layout: 'fixed',
        columnWidthsTwips: [2400, 6960],
        borders: { top: { style: 'single', sizeEighthPt: 8, colorHex: '000000' } },
        rows: [{
          header: true,
          heightTwips: 360,
          heightRule: 'atLeast',
          cells: [
            { shadingHex: 'D9EAF7', vAlign: 'center', marginsTwips: { top: 0 }, blocks: [{ kind: 'paragraph', styleId: 'TableBody', list: { numId: 'clauses', ilvl: 0 }, runs: [{ kind: 'text', text: 'Term' }] }] },
            { blocks: [{ kind: 'paragraph', styleId: 'TableBody', runs: [{ kind: 'text', text: 'Meaning' }] }] },
          ],
        }],
      }],
    }],
  };
}

describe('ECMA-376 tables, numbering, and styles evidence', () => {
  test
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.37' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.16' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.4.18' },
    )('authors connected structural vocabularies and preserves them across package round trip', async () => {
      const generated = await generateDocx(representativeSpec());
      expect((await checkGeneratedPackage(generated)).issues).toEqual([]);

      const documentBefore = (await readZipText(generated, 'word/document.xml'))!;
      const numberingBefore = (await readZipText(generated, 'word/numbering.xml'))!;
      const stylesBefore = (await readZipText(generated, 'word/styles.xml'))!;
      const documentDom = parseXml(documentBefore);
      expect(documentDom.getElementsByTagNameNS(OOXML.W_NS, 'tbl')).toHaveLength(1);
      expect(documentDom.getElementsByTagNameNS(OOXML.W_NS, 'numPr')).toHaveLength(1);
      expect(documentDom.getElementsByTagNameNS(OOXML.W_NS, 'pStyle').item(0)?.getAttributeNS(OOXML.W_NS, 'val')).toBe('TableBody');

      const loaded = await DocxDocument.load(generated);
      const saved = await loaded.toBuffer();
      expect(await readZipText(saved.buffer, 'word/document.xml')).toBe(documentBefore);
      expect(await readZipText(saved.buffer, 'word/numbering.xml')).toBe(numberingBefore);
      expect(await readZipText(saved.buffer, 'word/styles.xml')).toBe(stylesBefore);
      validateEmittedWml({ 'document.xml': documentBefore, 'numbering.xml': numberingBefore, 'styles.xml': stylesBefore });
    });

  test
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.52' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.17' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.4.17' },
    )('rejects invalid runtime enum values before emitting schema-invalid XML', async () => {
      const cases: Array<[string, (spec: DocumentSpec) => void]> = [
        ['/sections/0/blocks/0/layout', (spec) => { (spec.sections[0]!.blocks[0] as any).layout = 'fluid'; }],
        ['/sections/0/blocks/0/borders/top/style', (spec) => { (spec.sections[0]!.blocks[0] as any).borders.top.style = 'wave'; }],
        ['/sections/0/blocks/0/rows/0/heightRule', (spec) => { (spec.sections[0]!.blocks[0] as any).rows[0].heightRule = 'auto'; }],
        ['/sections/0/blocks/0/rows/0/cells/0/vAlign', (spec) => { (spec.sections[0]!.blocks[0] as any).rows[0].cells[0].vAlign = 'middle'; }],
        ['/numbering/0/levels/0/numFmt', (spec) => { (spec.numbering![0]!.levels[0] as any).numFmt = 'ordinalish'; }],
        ['/numbering/0/levels/0/suff', (spec) => { (spec.numbering![0]!.levels[0] as any).suff = 'comma'; }],
        ['/numbering/0/levels/0/indentTwips/left', (spec) => { spec.numbering![0]!.levels[0]!.indentTwips!.left = -1; }],
        ['/styles/0/type', (spec) => { (spec.styles![0] as any).type = 'table'; }],
      ];
      for (const [path, mutate] of cases) {
        const spec = representativeSpec();
        mutate(spec);
        await expect(generateDocx(spec)).rejects.toMatchObject({ code: 'invalid_value', path });
      }
    });

  test
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.2' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.18' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.4.17' },
    )('rejects duplicate definitions and dangling style, numbering, and level references', async () => {
      const duplicateStyle = representativeSpec();
      duplicateStyle.styles!.push({ ...duplicateStyle.styles![0]! });
      await expect(generateDocx(duplicateStyle)).rejects.toMatchObject({ code: 'invalid_value', path: '/styles/1/styleId' });

      const duplicateNumbering = representativeSpec();
      duplicateNumbering.numbering!.push({ ...duplicateNumbering.numbering![0]! });
      await expect(generateDocx(duplicateNumbering)).rejects.toMatchObject({ code: 'invalid_value', path: '/numbering/1/numId' });

      const dangling = representativeSpec();
      (dangling.sections[0]!.blocks[0] as any).rows[0].cells[0].blocks[0].list = { numId: 'missing', ilvl: 0 };
      await expect(generateDocx(dangling)).rejects.toMatchObject({ code: 'dangling_numbering_reference' });

      const missingLevel = representativeSpec();
      (missingLevel.sections[0]!.blocks[0] as any).rows[0].cells[0].blocks[0].list.ilvl = 8;
      await expect(generateDocx(missingLevel)).rejects.toMatchObject({ code: 'dangling_numbering_reference' });

      const danglingBasedOn = representativeSpec();
      danglingBasedOn.styles![0]!.basedOn = 'MissingBase';
      await expect(generateDocx(danglingBasedOn)).rejects.toMatchObject({
        code: 'dangling_style_reference',
        path: '/styles/0/basedOn',
      });

      const danglingNext = representativeSpec();
      danglingNext.styles![0]!.next = 'MissingNext';
      await expect(generateDocx(danglingNext)).rejects.toMatchObject({
        code: 'dangling_style_reference',
        path: '/styles/0/next',
      });
    });

  test
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.16' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.81' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.25' },
    )('enforces exact integer domains before serializing table and numbering measures', async () => {
      const fields: Array<[string, (spec: DocumentSpec, value: number) => void, boolean]> = [
        ['/sections/0/blocks/0/columnWidthsTwips/0', (spec, value) => { (spec.sections[0]!.blocks[0] as any).columnWidthsTwips[0] = value; }, false],
        ['/sections/0/blocks/0/rows/0/heightTwips', (spec, value) => { (spec.sections[0]!.blocks[0] as any).rows[0].heightTwips = value; }, true],
        ['/sections/0/blocks/0/rows/0/cells/0/widthTwips', (spec, value) => { (spec.sections[0]!.blocks[0] as any).rows[0].cells[0].widthTwips = value; }, false],
        ['/sections/0/blocks/0/rows/0/cells/0/marginsTwips/top', (spec, value) => { (spec.sections[0]!.blocks[0] as any).rows[0].cells[0].marginsTwips.top = value; }, true],
        ['/sections/0/blocks/0/borders/top/sizeEighthPt', (spec, value) => { (spec.sections[0]!.blocks[0] as any).borders.top.sizeEighthPt = value; }, true],
        ['/numbering/0/levels/0/start', (spec, value) => { spec.numbering![0]!.levels[0]!.start = value; }, true],
      ];
      for (const [path, mutate, allowsZero] of fields) {
        for (const value of [0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 1e100, -1]) {
          if (value === -1 && path.endsWith('/start')) continue;
          const spec = representativeSpec();
          mutate(spec, value);
          await expect(generateDocx(spec)).rejects.toMatchObject({ code: 'invalid_value', path });
        }
        if (!allowsZero) {
          const spec = representativeSpec();
          mutate(spec, 0);
          await expect(generateDocx(spec)).rejects.toMatchObject({ code: 'invalid_value', path });
        }
      }

      const negativeStart = representativeSpec();
      negativeStart.numbering![0]!.levels[0]!.start = -1;
      await expect(generateDocx(negativeStart)).rejects.toMatchObject({
        code: 'invalid_value',
        path: '/numbering/0/levels/0/start',
      });

      const boundary = representativeSpec();
      const table = boundary.sections[0]!.blocks[0] as any;
      table.columnWidthsTwips[0] = Number.MAX_SAFE_INTEGER - table.columnWidthsTwips[1];
      table.rows[0].heightTwips = 0;
      table.rows[0].cells[0].widthTwips = Number.MAX_SAFE_INTEGER;
      table.rows[0].cells[0].marginsTwips.top = 0;
      table.borders.top.sizeEighthPt = 0;
      boundary.numbering![0]!.levels[0]!.start = Number.MAX_SAFE_INTEGER;
      const generated = await generateDocx(boundary);
      validateEmittedWml({
        'document.xml': (await readZipText(generated, 'word/document.xml'))!,
        'numbering.xml': (await readZipText(generated, 'word/numbering.xml'))!,
        'styles.xml': (await readZipText(generated, 'word/styles.xml'))!,
      });

      const otherBoundaries = representativeSpec();
      const otherTable = otherBoundaries.sections[0]!.blocks[0] as any;
      otherTable.columnWidthsTwips[0] = 1;
      otherTable.rows[0].heightTwips = Number.MAX_SAFE_INTEGER;
      otherTable.rows[0].cells[0].widthTwips = 1;
      otherTable.rows[0].cells[0].marginsTwips.top = Number.MAX_SAFE_INTEGER;
      otherTable.borders.top.sizeEighthPt = Number.MAX_SAFE_INTEGER;
      const otherGenerated = await generateDocx(otherBoundaries);
      validateEmittedWml({
        'document.xml': (await readZipText(otherGenerated, 'word/document.xml'))!,
        'numbering.xml': (await readZipText(otherGenerated, 'word/numbering.xml'))!,
        'styles.xml': (await readZipText(otherGenerated, 'word/styles.xml'))!,
      });
    });
});
