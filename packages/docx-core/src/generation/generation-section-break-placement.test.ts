import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { childElements } from '../primitives/dom-helpers.js';
import { auditSectPr } from '../primitives/sectPrAudit.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec, HeaderFooterSpec, ParagraphSpec } from './types.js';

const TEST_FEATURE = 'add-generation-section-break-placement';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });
const conforming = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.18' });

function paragraph(text: string, extra: Partial<ParagraphSpec> = {}): ParagraphSpec {
  return { kind: 'paragraph', runs: [{ kind: 'text', text }], ...extra };
}

function footer(text: string): HeaderFooterSpec {
  return { blocks: [paragraph(text, { alignment: 'center' })] };
}

/** Three sections: the first binds its break to its last paragraph, the second uses the default dedicated paragraph. */
function threeSectionSpec(): DocumentSpec {
  return {
    sections: [
      {
        breakType: 'nextPage',
        breakPlacement: 'lastParagraph',
        footers: { default: footer('First footer') },
        blocks: [paragraph('Resolutions.'), paragraph('Legend line.', { alignment: 'center' })],
      },
      {
        breakType: 'nextPage',
        footers: { default: footer('Signature page footer') },
        blocks: [paragraph('Signature page.')],
      },
      { breakPlacement: 'lastParagraph', blocks: [paragraph('Exhibit.')] },
    ],
  };
}

function validateAgainstSchema(xml: string): void {
  const dir = mkdtempSync(resolve(tmpdir(), 'safe-docx-break-placement-'));
  try {
    const schema = resolve(process.cwd(), '../../spec-compliance/ecma-376/validation/wml-document-transitional.xsd');
    const path = resolve(dir, 'document.xml');
    writeFileSync(path, xml);
    const result = spawnSync('xmllint', ['--noout', '--nonet', '--schema', schema, path], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function paragraphText(p: Element): string {
  return Array.from(p.getElementsByTagName('w:t')).map((t) => t.textContent ?? '').join('');
}

describe('Traceability: section break placement', () => {
  conforming.openspec("[SDX-GEN-111] a section break can bind to the section's last paragraph")(
    "Scenario: a section break can bind to the section's last paragraph",
    async ({ given, when, then, attachPrettyJson, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('three sections, the first with breakPlacement lastParagraph and the second with the default', async () => {
        spec = threeSectionSpec();
        await attachPrettyJson('spec', spec);
      });

      let documentXml!: string;
      let buffer!: Buffer;
      await when('the document is generated', async () => {
        buffer = await generateDocx(spec);
        expect((await checkGeneratedPackage(buffer)).issues).toEqual([]);
        documentXml = (await readZipText(buffer, 'word/document.xml'))!;
        await attachPrettyXml('word/document.xml', documentXml);
      });

      await then('only the default-placement break adds an empty paragraph', async () => {
        const body = parseXml(documentXml).getElementsByTagName('w:body').item(0)!;
        const paragraphs = childElements(body).filter((el) => el.nodeName === 'w:p');
        expect(paragraphs.map(paragraphText)).toEqual(['Resolutions.', 'Legend line.', 'Signature page.', '', 'Exhibit.']);
      });

      await then('the first sectPr is the last pPr child of the legend paragraph, after its own formatting', async () => {
        const body = parseXml(documentXml).getElementsByTagName('w:body').item(0)!;
        const legend = childElements(body).filter((el) => el.nodeName === 'w:p')[1]!;
        const pPr = childElements(legend)[0]!;
        expect(pPr.nodeName).toBe('w:pPr');
        expect(childElements(pPr).map((el) => el.nodeName)).toEqual(['w:jc', 'w:sectPr']);
      });

      await then('each section\'s footer reference resolves to that section\'s own footer text', async () => {
        const rels = parseXml((await readZipText(buffer, 'word/_rels/document.xml.rels'))!);
        const targets = new Map(Array.from(rels.getElementsByTagName('Relationship'))
          .map((rel) => [rel.getAttribute('Id')!, rel.getAttribute('Target')!]));
        const sectPrs = Array.from(parseXml(documentXml).getElementsByTagName('w:sectPr'));
        const footerTexts: Array<string | null> = [];
        for (const sectPr of sectPrs) {
          const ref = sectPr.getElementsByTagName('w:footerReference').item(0);
          if (!ref) {
            footerTexts.push(null);
            continue;
          }
          const part = parseXml((await readZipText(buffer, `word/${targets.get(ref.getAttribute('r:id')!)}`))!);
          footerTexts.push(Array.from(part.getElementsByTagName('w:t')).map((t) => t.textContent).join(''));
        }
        expect(footerTexts).toEqual(['First footer', 'Signature page footer', null]);
      });

      await then('the section audit sees two paragraph-level breaks, one body-level sectPr and both footer bindings', async () => {
        const audit = auditSectPr(
          documentXml,
          await readZipText(buffer, 'word/_rels/document.xml.rels'),
          new Map([
            ['word/footer1.xml', (await readZipText(buffer, 'word/footer1.xml'))!],
            ['word/footer2.xml', (await readZipText(buffer, 'word/footer2.xml'))!],
          ]),
        );
        expect(audit.ok).toBe(true);
        expect(audit.stats.paragraphLevelSectPrCount).toBe(2);
        expect(audit.stats.bodyLevelSectPrCount).toBe(1);
        expect(audit.bindings.map((binding) => binding.kind)).toEqual(['footer', 'footer']);
      });

      await then('document.xml validates against the transitional WML schema', async () => {
        validateAgainstSchema(documentXml);
      });
    },
  );

  test.openspec('[SDX-GEN-111] a paragraph without its own properties gains a pPr holding only the sectPr')(
    'Scenario: a paragraph without its own properties gains a pPr holding only the sectPr',
    async () => {
      const xml = (await readZipText(await generateDocx({
        sections: [
          { breakPlacement: 'lastParagraph', blocks: [paragraph('Plain.')] },
          { blocks: [paragraph('Next.')] },
        ],
      }), 'word/document.xml'))!;
      const body = parseXml(xml).getElementsByTagName('w:body').item(0)!;
      const first = childElements(body)[0]!;
      expect(childElements(first).map((el) => el.nodeName)).toEqual(['w:pPr', 'w:r']);
      expect(childElements(childElements(first)[0]!).map((el) => el.nodeName)).toEqual(['w:sectPr']);
      expect(childElements(body).filter((el) => el.nodeName === 'w:p')).toHaveLength(2);
      validateAgainstSchema(xml);
    },
  );

  test.openspec('[SDX-GEN-111] a last-paragraph break keeps first-page footers, titlePg and page-number restarts')(
    'Scenario: a last-paragraph break keeps first-page footers, titlePg and page-number restarts',
    async () => {
      const xml = (await readZipText(await generateDocx({
        sections: [
          {
            breakPlacement: 'lastParagraph',
            pageNumbering: { start: 3, format: 'lowerRoman' },
            footers: { first: footer('Cover footer'), default: footer('Body footer') },
            blocks: [paragraph('Cover.'), paragraph('Body.', { keepNext: true })],
          },
          { blocks: [paragraph('Next.')] },
        ],
      }), 'word/document.xml'))!;
      const body = parseXml(xml).getElementsByTagName('w:body').item(0)!;
      const last = childElements(body).filter((el) => el.nodeName === 'w:p')[1]!;
      const pPr = childElements(last)[0]!;
      expect(childElements(pPr).map((el) => el.nodeName)).toEqual(['w:keepNext', 'w:sectPr']);
      const sectPr = childElements(pPr)[1]!;
      expect(Array.from(sectPr.getElementsByTagName('w:footerReference')).map((ref) => ref.getAttribute('w:type')).sort()).toEqual(['default', 'first']);
      expect(sectPr.getElementsByTagName('w:titlePg')).toHaveLength(1);
      const pgNumType = sectPr.getElementsByTagName('w:pgNumType').item(0)!;
      expect([pgNumType.getAttribute('w:start'), pgNumType.getAttribute('w:fmt')]).toEqual(['3', 'lowerRoman']);
      expect(childElements(body).filter((el) => el.nodeName === 'w:p')).toHaveLength(3);
      validateAgainstSchema(xml);
    },
  );

  test.openspec('[SDX-GEN-111] lastParagraph placement is rejected when a non-final section ends with a table')(
    'Scenario: lastParagraph placement is rejected when a non-final section ends with a table',
    async () => {
      const table = {
        kind: 'table' as const,
        columnWidthsTwips: [4680, 4680],
        rows: [{ cells: [{ blocks: [paragraph('A')] }, { blocks: [paragraph('B')] }] }],
      };
      const invalid: Array<[DocumentSpec, string]> = [
        [{ sections: [{ breakPlacement: 'lastParagraph', blocks: [paragraph('x'), table] }, { blocks: [paragraph('y')] }] }, '/sections/0/breakPlacement'],
        [{ sections: [{ breakPlacement: 'lastParagraph', blocks: [] }, { blocks: [paragraph('y')] }] }, '/sections/0/breakPlacement'],
        [{ sections: [{ breakPlacement: 'sideways' as never, blocks: [paragraph('x')] }] }, '/sections/0/breakPlacement'],
      ];
      for (const [spec, path] of invalid) {
        const error = await generateDocx(spec).catch((caught: unknown) => caught);
        expect(error, path).toBeInstanceOf(GenerationSpecError);
        expect((error as GenerationSpecError).path).toBe(path);
      }
      // The final section's properties always bind at body level, so a trailing table there is fine.
      await expect(generateDocx({ sections: [{ breakPlacement: 'lastParagraph', blocks: [table] }] })).resolves.toBeInstanceOf(Buffer);
    },
  );
});
