import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import { validateDocument } from '../primitives/validate_document.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function minimalSpec(): DocumentSpec {
  return {
    meta: { title: 'Generation Skeleton', author: 'safe-docx tests', createdIso: '2026-06-10T00:00:00Z' },
    sections: [
      {
        blocks: [
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Hello generated world' }] },
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Second paragraph' }] },
        ],
      },
    ],
  };
}

describe('Traceability: from-scratch generation skeleton', () => {
  test.openspec('[SDX-GEN-001] a minimal spec compiles to a loadable document')(
    'Scenario: a minimal spec compiles to a loadable document',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a DocumentSpec with one section containing plain-text paragraphs', async () => {
        spec = minimalSpec();
        await attachPrettyJson('document-spec', spec);
      });

      let buffer!: Buffer;
      await when('generateDocx compiles the spec', async () => {
        buffer = await generateDocx(spec);
      });

      await then('the buffer loads via DocxDocument with the paragraph text intact', async () => {
        const doc = await DocxDocument.load(buffer);
        doc.insertParagraphBookmarks('sdx-gen-001');
        const texts = doc.readParagraphs().paragraphs.map((p) => p.text);
        expect(texts).toContain('Hello generated world');
        expect(texts).toContain('Second paragraph');
      });

      await then('validateDocument reports zero warnings', async () => {
        const doc = await DocxDocument.load(buffer);
        const result = validateDocument(doc.getDocumentXmlClone());
        await attachPrettyJson('validate-document-result', result);
        expect(result.warnings).toEqual([]);
      });
    },
  );

  test.openspec('[SDX-GEN-002] the spec is plain JSON-serializable data')(
    'Scenario: the spec is plain JSON-serializable data',
    async ({ given, when, then }: AllureBddContext) => {
      let spec!: DocumentSpec;
      let cloned!: DocumentSpec;
      await given('a valid DocumentSpec and its JSON round-trip clone', async () => {
        spec = minimalSpec();
        cloned = JSON.parse(JSON.stringify(spec)) as DocumentSpec;
        expect(cloned).toEqual(spec);
      });

      let original!: Buffer;
      let fromClone!: Buffer;
      await when('both specs are compiled', async () => {
        original = await generateDocx(spec);
        fromClone = await generateDocx(cloned);
      });

      await then('the outputs are byte-identical', async () => {
        expect(fromClone.equals(original)).toBe(true);
      });
    },
  );

  test.openspec('[SDX-GEN-003] unimplemented spec features are rejected loudly')(
    'Scenario: unimplemented spec features are rejected loudly',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let unknownBlockSpec!: DocumentSpec;
      let unknownInlineSpec!: DocumentSpec;
      await given('specs using kinds without a shipped emitter (an unrecognized block kind and inline kind, as a JSON caller could send)', async () => {
        unknownBlockSpec = JSON.parse(
          '{"sections":[{"blocks":[{"kind":"contentControl","runs":[]}]}]}',
        ) as DocumentSpec;
        unknownInlineSpec = JSON.parse(
          '{"sections":[{"blocks":[{"kind":"paragraph","runs":[{"kind":"footnote","text":"x"}]}]}]}',
        ) as DocumentSpec;
      });

      let blockError: unknown;
      let inlineError: unknown;
      await when('generateDocx compiles each spec', async () => {
        blockError = await generateDocx(unknownBlockSpec).then(
          () => null,
          (err: unknown) => err,
        );
        inlineError = await generateDocx(unknownInlineSpec).then(
          () => null,
          (err: unknown) => err,
        );
      });

      await then('each compilation fails with a typed error naming the feature and its spec path', async () => {
        expect(blockError).toBeInstanceOf(GenerationSpecError);
        expect((blockError as GenerationSpecError).code).toBe('unsupported_feature');
        expect((blockError as GenerationSpecError).path).toBe('/sections/0/blocks/0');
        expect(inlineError).toBeInstanceOf(GenerationSpecError);
        expect((inlineError as GenerationSpecError).code).toBe('unsupported_feature');
        expect((inlineError as GenerationSpecError).path).toBe('/sections/0/blocks/0/runs/0');
        await attachPrettyJson('rejections', {
          block: { code: (blockError as GenerationSpecError).code, path: (blockError as GenerationSpecError).path },
          inline: { code: (inlineError as GenerationSpecError).code, path: (inlineError as GenerationSpecError).path },
        });
      });
    },
  );

  test.openspec('[SDX-GEN-013] generation is deterministic')(
    'Scenario: generation is deterministic',
    async ({ given, when, then }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a valid DocumentSpec', async () => {
        spec = minimalSpec();
        expect(spec.sections).toHaveLength(1);
      });

      let first!: Buffer;
      let second!: Buffer;
      await when('the spec is compiled twice', async () => {
        first = await generateDocx(spec);
        second = await generateDocx(spec);
      });

      await then('the two buffers are byte-identical (no wall-clock or random inputs)', async () => {
        expect(second.equals(first)).toBe(true);
        expect(first.length).toBeGreaterThan(0);
      });
    },
  );

  test
    .openspec('[SDX-GEN-020] page size and margins are emitted in the section properties')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.13' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.11' },
    )(
    'Scenario: page size and margins are emitted in the section properties',
    async ({ given, when, then, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a section specifying page size and margins in twips', async () => {
        spec = minimalSpec();
        spec.sections[0]!.page = {
          sizeTwips: { w: 11906, h: 16838 },
          marginsTwips: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        };
      });

      let sectPr!: Element;
      await when('the document is generated and its sectPr parsed back', async () => {
        const buffer = await generateDocx(spec);
        const documentXml = await readZipText(buffer, 'word/document.xml');
        expect(documentXml).not.toBeNull();
        await attachPrettyXml('word/document.xml', documentXml!);
        const doc = parseXml(documentXml!);
        sectPr = doc.getElementsByTagName('w:sectPr').item(0)!;
        expect(sectPr).toBeTruthy();
      });

      await then('w:pgSz and w:pgMar carry the requested values, with the full margin attribute set', async () => {
        const pgSz = sectPr.getElementsByTagName('w:pgSz').item(0)!;
        const pgMar = sectPr.getElementsByTagName('w:pgMar').item(0)!;
        expect(pgSz.getAttribute('w:w')).toBe('11906');
        expect(pgSz.getAttribute('w:h')).toBe('16838');
        expect(pgMar.getAttribute('w:top')).toBe('1134');
        expect(pgMar.getAttribute('w:left')).toBe('1134');
        // Unspecified members fill in from the standard defaults rather than
        // being omitted, because readers diverge in their fallback values.
        expect(pgMar.getAttribute('w:header')).toBe('720');
        expect(pgMar.getAttribute('w:gutter')).toBe('0');
      });
    },
  );
});
