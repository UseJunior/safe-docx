import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import { parseStylesXml, extractEffectiveRunFormatting } from '../primitives/styles.js';
import { getDirectChildrenByName, childElements } from '../primitives/dom-helpers.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { OOXML } from '../primitives/namespaces.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function styledSpec(): DocumentSpec {
  return {
    meta: { title: 'Styled generation', createdIso: '2026-06-10T00:00:00Z' },
    styles: [
      {
        styleId: 'SectionHeading',
        name: 'Section Heading',
        type: 'paragraph',
        basedOn: 'Normal',
        next: 'Normal',
        paragraph: { alignment: 'center', spacing: { beforeTwips: 240, afterTwips: 120 }, keepNext: true },
        run: { bold: true, sizePt: 14, font: 'Georgia' },
      },
    ],
    sections: [
      {
        blocks: [
          { kind: 'paragraph', styleId: 'SectionHeading', runs: [{ kind: 'text', text: 'ARTICLE I — DEFINITIONS' }] },
          {
            kind: 'paragraph',
            alignment: 'justify',
            spacing: { beforeTwips: 0, afterTwips: 200, lineTwips: 276, lineRule: 'auto' },
            indent: { leftTwips: 720, hangingTwips: 360 },
            tabs: [{ posTwips: 4320, align: 'center', leader: 'dot' }],
            runs: [
              { kind: 'text', text: 'Confidential Information', bold: true, italic: true },
              { kind: 'text', text: ' means information disclosed by either party, marked ' },
              { kind: 'text', text: 'confidential', underline: 'single', colorHex: 'C00000', font: 'Georgia', sizePt: 11.5 },
              { kind: 'text', text: '.' },
            ],
          },
        ],
      },
    ],
  };
}

async function loadPart(buffer: Buffer, part: string): Promise<Document> {
  const xml = await readZipText(buffer, part);
  expect(xml, `${part} missing from package`).not.toBeNull();
  return parseXml(xml!);
}

function wChildNames(el: Element): string[] {
  return childElements(el).filter((c) => c.namespaceURI === OOXML.W_NS).map((c) => c.localName);
}

describe('Traceability: styles and run/paragraph formatting emission', () => {
  test.openspec('[SDX-GEN-004] dangling references are rejected before emission')(
    'Scenario: dangling references are rejected before emission',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a paragraph referencing a styleId absent from the declared styles', async () => {
        spec = styledSpec();
        spec.sections[0]!.blocks.push({ kind: 'paragraph', styleId: 'GhostStyle', runs: [{ kind: 'text', text: 'x' }] });
      });

      let error: unknown;
      await when('generateDocx compiles the spec', async () => {
        error = await generateDocx(spec).then(
          () => null,
          (err: unknown) => err,
        );
      });

      await then('compilation fails with a typed error identifying the dangling reference and its path', async () => {
        expect(error).toBeInstanceOf(GenerationSpecError);
        const specError = error as GenerationSpecError;
        expect(specError.code).toBe('dangling_style_reference');
        expect(specError.path).toBe('/sections/0/blocks/2/styleId');
        expect(specError.message).toContain('GhostStyle');
        await attachPrettyJson('rejection', { code: specError.code, path: specError.path });
      });
    },
  );

  test
    .openspec('[SDX-GEN-040] declared styles are emitted into the style table')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.4.18' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.7.5.1' },
    )(
    'Scenario: declared styles are emitted into the style table',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a spec declaring a named paragraph style based on Normal', async () => {
        buffer = await generateDocx(styledSpec());
        expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
      });

      let stylesDoc!: Document;
      await when('word/styles.xml is parsed back', async () => {
        stylesDoc = await loadPart(buffer, 'word/styles.xml');
        await attachPrettyXml('word/styles.xml', (await readZipText(buffer, 'word/styles.xml'))!);
      });

      await then('it contains docDefaults, Normal, and the declared style with its basedOn link', async () => {
        const model = parseStylesXml(stylesDoc);
        expect(model.byId.has('Normal')).toBe(true);
        const declared = model.byId.get('SectionHeading');
        expect(declared?.basedOn).toBe('Normal');
        expect(stylesDoc.getElementsByTagName('w:docDefaults')).toHaveLength(1);
      });

      await then('paragraphs referencing the style carry the matching w:pStyle', async () => {
        const documentDoc = await loadPart(buffer, 'word/document.xml');
        const firstParagraph = documentDoc.getElementsByTagName('w:p').item(0)!;
        const pStyle = firstParagraph.getElementsByTagName('w:pStyle').item(0);
        expect(pStyle?.getAttribute('w:val')).toBe('SectionHeading');
      });
    },
  );

  test
    .openspec('[SDX-GEN-041] run properties are emitted in schema order')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.28' })(
    'Scenario: run properties are emitted in schema order',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a run specifying bold, italic, underline, color, font, and size', async () => {
        const spec = styledSpec();
        spec.sections[0]!.blocks = [
          {
            kind: 'paragraph',
            runs: [{ kind: 'text', text: 'kitchen sink', bold: true, italic: true, underline: 'single', colorHex: '1F4E79', font: 'Georgia', sizePt: 12 }],
          },
        ];
        buffer = await generateDocx(spec);
      });

      let rPr!: Element;
      let documentDoc!: Document;
      await when('the run properties are parsed back', async () => {
        documentDoc = await loadPart(buffer, 'word/document.xml');
        rPr = documentDoc.getElementsByTagName('w:rPr').item(0)!;
        expect(rPr).toBeTruthy();
      });

      await then('the rPr children appear in the WML schema sequence', async () => {
        const names = wChildNames(rPr);
        await attachPrettyJson('rpr-child-order', names);
        expect(names).toEqual(['rFonts', 'b', 'bCs', 'i', 'iCs', 'color', 'sz', 'szCs', 'u']);
      });

      await then('the formatting survives a round-trip through the run-formatting reader', async () => {
        const run = documentDoc.getElementsByTagName('w:r').item(0)!;
        const stylesDoc = await loadPart(buffer, 'word/styles.xml');
        const formatting = extractEffectiveRunFormatting({
          run,
          paragraphPPr: null,
          paragraphStyleId: null,
          styles: parseStylesXml(stylesDoc),
        });
        expect(formatting).toMatchObject({
          bold: true,
          italic: true,
          underline: true,
          colorHex: '1F4E79',
          fontName: 'Georgia',
          fontSizePt: 12,
        });
      });
    },
  );

  test
    .openspec('[SDX-GEN-042] paragraph properties are emitted in schema order')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.26' })(
    'Scenario: paragraph properties are emitted in schema order',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a paragraph specifying alignment, spacing, indentation, and tab stops', async () => {
        buffer = await generateDocx(styledSpec());
      });

      let pPr!: Element;
      await when('the second paragraph’s properties are parsed back', async () => {
        const documentDoc = await loadPart(buffer, 'word/document.xml');
        const paragraph = documentDoc.getElementsByTagName('w:p').item(1)!;
        pPr = getDirectChildrenByName(paragraph, 'pPr')[0]!;
        expect(pPr).toBeTruthy();
      });

      await then('the pPr children appear in the WML schema sequence with the requested values', async () => {
        const names = wChildNames(pPr);
        await attachPrettyJson('ppr-child-order', names);
        expect(names).toEqual(['tabs', 'spacing', 'ind', 'jc']);
        const jc = pPr.getElementsByTagName('w:jc').item(0)!;
        expect(jc.getAttribute('w:val')).toBe('both');
        const tab = pPr.getElementsByTagName('w:tab').item(0)!;
        expect(tab.getAttribute('w:pos')).toBe('4320');
        expect(tab.getAttribute('w:leader')).toBe('dot');
      });
    },
  );

  test('phase 2 styled artifact loads through the document façade with formatting intact', async () => {
    const buffer = await generateDocx(styledSpec());
    const doc = await DocxDocument.load(buffer);
    doc.insertParagraphBookmarks('sdx-gen-phase2');
    const texts = doc.readParagraphs().paragraphs.map((p) => p.text);
    expect(texts[0]).toContain('ARTICLE I');
    expect(texts[1]).toContain('Confidential Information');
    const { writeIntegrationArtifact } = await import('../integration/output-artifacts.js');
    const outputPath = await writeIntegrationArtifact('generation-phase2-styled.docx', buffer);
    expect(outputPath).toContain('generation-phase2-styled.docx');
  });
});
