import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import { parseStylesXml, extractEffectiveRunFormatting } from '../primitives/styles.js';
import { getDirectChildrenByName, childElements } from '../primitives/dom-helpers.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { OOXML } from '../primitives/namespaces.js';
import { generateDocx } from './compile.js';
import { buildRunPropsElement } from './emit/properties.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec, HighlightColor } from './types.js';

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
            borders: { bottom: { style: 'single', sizeEighthPt: 8, colorHex: '2F75B5' } },
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
      let listSpec!: DocumentSpec;
      await given('paragraphs referencing a styleId and a numId absent from the document-level definitions', async () => {
        spec = styledSpec();
        spec.sections[0]!.blocks.push({ kind: 'paragraph', styleId: 'GhostStyle', runs: [{ kind: 'text', text: 'x' }] });
        listSpec = {
          sections: [
            { blocks: [{ kind: 'paragraph', list: { numId: 'ghostList', ilvl: 0 }, runs: [{ kind: 'text', text: 'x' }] }] },
          ],
        };
      });

      let error: unknown;
      let numberingError: unknown;
      await when('generateDocx compiles each spec', async () => {
        error = await generateDocx(spec).then(
          () => null,
          (err: unknown) => err,
        );
        numberingError = await generateDocx(listSpec).then(
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
        expect(numberingError).toBeInstanceOf(GenerationSpecError);
        const numError = numberingError as GenerationSpecError;
        expect(numError.code).toBe('dangling_numbering_reference');
        expect(numError.path).toBe('/sections/0/blocks/0/list/numId');
        await attachPrettyJson('rejections', {
          style: { code: specError.code, path: specError.path },
          numbering: { code: numError.code, path: numError.path },
        });
      });
    },
  );

  test('StyleSpec paragraph properties use the same runtime validation as authored paragraphs', async () => {
    const cases: Array<[string, (paragraph: NonNullable<NonNullable<DocumentSpec['styles']>[number]['paragraph']>) => void]> = [
      ['alignment', (paragraph) => { paragraph.alignment = 'distributed' as never; }],
      ['borders/bottom/colorHex', (paragraph) => { paragraph.borders = { bottom: { style: 'single', colorHex: '#blue' } }; }],
      ['spacing/beforeTwips', (paragraph) => { paragraph.spacing = { beforeTwips: -1 }; }],
      ['tabs/0/posTwips', (paragraph) => { paragraph.tabs = [{ posTwips: -1, align: 'left' }]; }],
      ['indent/firstLineTwips', (paragraph) => { paragraph.indent = { firstLineTwips: -1 }; }],
      ['indent', (paragraph) => { paragraph.indent = { firstLineTwips: 120, hangingTwips: 120 }; }],
    ];

    for (const [suffix, mutate] of cases) {
      const spec = styledSpec();
      const paragraph = spec.styles![0]!.paragraph!;
      mutate(paragraph);
      await expect(generateDocx(spec)).rejects.toMatchObject({
        code: 'invalid_value',
        path: `/styles/0/paragraph/${suffix}`,
      });
    }
  });

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
    .openspec('[SDX-GEN-041] run properties are emitted at most once')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.28' })(
    'Scenario: run properties are emitted at most once',
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

      await then('each direct rPr property occurs at most once with exact authored values', async () => {
        const names = wChildNames(rPr);
        await attachPrettyJson('rpr-child-order', names);
        expect(names).toEqual(['rFonts', 'b', 'bCs', 'i', 'iCs', 'color', 'sz', 'szCs', 'u']);
        expect(new Set(names).size).toBe(names.length);
        expect(getDirectChildrenByName(rPr, 'rFonts')[0]!.getAttribute('w:ascii')).toBe('Georgia');
        expect(getDirectChildrenByName(rPr, 'rFonts')[0]!.getAttribute('w:hAnsi')).toBe('Georgia');
        expect(getDirectChildrenByName(rPr, 'rFonts')[0]!.getAttribute('w:cs')).toBe('Georgia');
        expect(getDirectChildrenByName(rPr, 'color')[0]!.getAttribute('w:val')).toBe('1F4E79');
        expect(getDirectChildrenByName(rPr, 'sz')[0]!.getAttribute('w:val')).toBe('24');
        expect(getDirectChildrenByName(rPr, 'szCs')[0]!.getAttribute('w:val')).toBe('24');
        expect(getDirectChildrenByName(rPr, 'u')[0]!.getAttribute('w:val')).toBe('single');
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

      await then('the direct run properties survive a package load/save round-trip unchanged', async () => {
        const loaded = await DocxDocument.load(buffer);
        const saved = await loaded.toBuffer();
        const savedDocument = await loadPart(saved.buffer, 'word/document.xml');
        const savedRPr = savedDocument.getElementsByTagNameNS(OOXML.W_NS, 'rPr').item(0)!;
        expect(wChildNames(savedRPr)).toEqual(wChildNames(rPr));
        expect(savedRPr.toString()).toBe(rPr.toString());
      });

      await then('malformed run property values are rejected before XML emission', async () => {
        const malformed: DocumentSpec = {
          sections: [{ blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'x', colorHex: '#red', sizePt: 0, highlight: 'glow' as HighlightColor }] }] }],
        };
        await expect(generateDocx(malformed)).rejects.toMatchObject({
          code: 'invalid_value',
          path: '/sections/0/blocks/0/runs/0/colorHex',
        });
        const invalidUnderline = styledSpec();
        (invalidUnderline.sections[0]!.blocks[0] as any).runs = [{ kind: 'text', text: 'x', underline: 'zigzag' }];
        await expect(generateDocx(invalidUnderline)).rejects.toMatchObject({ code: 'invalid_value', path: '/sections/0/blocks/0/runs/0/underline' });
      });

      await then('live builder attributes are namespace-correct before and after serialization', async () => {
        const host = parseXml(`<x:root xmlns:x="urn:test" xmlns:q="${OOXML.W_NS}"/>`);
        const live = buildRunPropsElement(host, { font: 'Georgia', underline: 'single' })!;
        const font = getDirectChildrenByName(live, 'rFonts')[0]!;
        const underline = getDirectChildrenByName(live, 'u')[0]!;
        expect(font.getAttributeNodeNS(OOXML.W_NS, 'ascii')?.value).toBe('Georgia');
        expect(underline.getAttributeNodeNS(OOXML.W_NS, 'val')?.value).toBe('single');
        const reparsed = parseXml(live.toString()).documentElement;
        expect(getDirectChildrenByName(reparsed, 'u')[0]!.getAttributeNS(OOXML.W_NS, 'val')).toBe('single');
      });
    },
  );

  test
    .openspec('[SDX-GEN-042] paragraph properties are emitted in schema order')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.26' })(
    'Scenario: paragraph properties are emitted in schema order',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a paragraph specifying alignment, spacing, indentation, tab stops, and a bottom border', async () => {
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
        expect(names).toEqual(['pBdr', 'tabs', 'spacing', 'ind', 'jc']);
        const pBdr = getDirectChildrenByName(pPr, 'pBdr')[0]!;
        const bottom = getDirectChildrenByName(pBdr, 'bottom')[0]!;
        expect(bottom.getAttribute('w:val')).toBe('single');
        expect(bottom.getAttribute('w:sz')).toBe('8');
        expect(bottom.getAttribute('w:space')).toBe('0');
        expect(bottom.getAttribute('w:color')).toBe('2F75B5');
        const jc = pPr.getElementsByTagName('w:jc').item(0)!;
        expect(jc.getAttribute('w:val')).toBe('both');
        const tab = pPr.getElementsByTagName('w:tab').item(0)!;
        expect(tab.getAttribute('w:pos')).toBe('4320');
        expect(tab.getAttribute('w:leader')).toBe('dot');
        const spacing = getDirectChildrenByName(pPr, 'spacing')[0]!;
        expect(spacing.getAttribute('w:before')).toBe('0');
        expect(spacing.getAttribute('w:after')).toBe('200');
        expect(spacing.getAttribute('w:line')).toBe('276');
        expect(spacing.getAttribute('w:lineRule')).toBe('auto');
        const ind = getDirectChildrenByName(pPr, 'ind')[0]!;
        expect(ind.getAttribute('w:left')).toBe('720');
        expect(ind.getAttribute('w:hanging')).toBe('360');
      });

      await then('the direct paragraph properties survive a package load/save round-trip unchanged', async () => {
        const loaded = await DocxDocument.load(buffer);
        const saved = await loaded.toBuffer();
        const savedDocument = await loadPart(saved.buffer, 'word/document.xml');
        const savedParagraph = savedDocument.getElementsByTagNameNS(OOXML.W_NS, 'p').item(1)!;
        const savedPPr = getDirectChildrenByName(savedParagraph, 'pPr')[0]!;
        expect(wChildNames(savedPPr)).toEqual(wChildNames(pPr));
        expect(savedPPr.toString()).toBe(pPr.toString());
      });

      await then('malformed paragraph property values are rejected before XML emission', async () => {
        const malformed: DocumentSpec = {
          sections: [{ blocks: [{ kind: 'paragraph', tabs: [{ posTwips: -1, align: 'left' }], runs: [{ kind: 'text', text: 'x' }] }] }],
        };
        await expect(generateDocx(malformed)).rejects.toMatchObject({
          code: 'invalid_value',
          path: '/sections/0/blocks/0/tabs/0/posTwips',
        });
        const probes: Array<{ path: string; mutate: (paragraph: any) => void }> = [
          { path: '/sections/0/blocks/0/alignment', mutate: (p) => { p.alignment = 'diagonal'; } },
          { path: '/sections/0/blocks/0/borders/bottom/style', mutate: (p) => { p.borders = { bottom: { style: 'bogus' } }; } },
          { path: '/sections/0/blocks/0/spacing/beforeTwips', mutate: (p) => { p.spacing = { beforeTwips: -1 }; } },
          { path: '/sections/0/blocks/0/tabs/0/posTwips', mutate: (p) => { p.tabs = [{ posTwips: 1.5, align: 'left' }]; } },
          { path: '/sections/0/blocks/0/indent/firstLineTwips', mutate: (p) => { p.indent = { firstLineTwips: -1 }; } },
          { path: '/sections/0/blocks/0/indent', mutate: (p) => { p.indent = { firstLineTwips: 120, hangingTwips: 120 }; } },
        ];
        for (const probe of probes) {
          const invalid = styledSpec();
          invalid.sections[0]!.blocks = [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'x' }] }];
          probe.mutate(invalid.sections[0]!.blocks[0]);
          await expect(generateDocx(invalid)).rejects.toMatchObject({ code: 'invalid_value', path: probe.path });
        }
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
