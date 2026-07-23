import fs from 'node:fs/promises';
import path from 'node:path';
import { buildDocxFromParts } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { getDocumentOutline } from './get_document_outline.js';

const TEST_FEATURE = 'add-deterministic-heading-provenance';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

type OutlineEntry = {
  paragraph_id: string;
  text: string;
  level: number | null;
  source: string;
};

function outlineEntries(value: unknown): OutlineEntry[] {
  return ((value as { outline?: OutlineEntry[] }).outline ?? []);
}

async function writeDocx(params: {
  bodyXml: string;
  stylesXml?: string;
  numberingXml?: string;
  filename: string;
}): Promise<string> {
  const tmpDir = await createTrackedTempDir('heading-provenance-outline-');
  const filePath = path.join(tmpDir, params.filename);
  const buffer = await buildDocxFromParts(params);
  await fs.writeFile(filePath, new Uint8Array(buffer));
  return filePath;
}

const STYLES_XML =
  `<w:styles xmlns:w="${W_NS}">` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading9"><w:name w:val="Heading 9"/></w:style>` +
  `</w:styles>`;

const NUMBERING_XML =
  `<w:numbering xmlns:w="${W_NS}">` +
  `<w:abstractNum w:abstractNumId="1">` +
  `<w:lvl w:ilvl="0"><w:pStyle w:val="Heading2"/></w:lvl>` +
  `</w:abstractNum>` +
  `<w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num>` +
  `</w:numbering>`;

describe('get_document_outline deterministic heading provenance', () => {
  registerCleanup();

  test.openspec('[HEAD-OUTLINE-01] Default outline includes mixed deterministic sources')(
    'includes style, active list metadata, and outline-property headings by default',
    async ({ given, when, then, and }: AllureBddContext) => {
      const manager = createTestSessionManager();
      const filePath = await writeDocx({
        filename: 'mixed-deterministic.docx',
        stylesXml: STYLES_XML,
        numberingXml: NUMBERING_XML,
        bodyXml:
          `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Styled</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr>` +
          `</w:pPr><w:r><w:t>Numbered</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>Outlined</w:t></w:r></w:p>`,
      });

      await given('one heading from each deterministic source', () => {});
      const result = await getDocumentOutline(manager, { file_path: filePath });
      assertSuccess(result, 'get_document_outline');
      const outline = outlineEntries(result);
      await when('the default JSON outline is requested', () => {});

      await then('all three entries retain document order, source, level, and text', () => {
        expect(outline.map(({ text, level, source }) => ({ text, level, source }))).toEqual([
          { text: 'Styled', level: 1, source: 'word_style' },
          { text: 'Numbered', level: 2, source: 'list_metadata' },
          { text: 'Outlined', level: 3, source: 'outline_level' },
        ]);
      });
      await and('every entry exposes a stable paragraph id', () => {
        expect(outline.every(({ paragraph_id }) => paragraph_id.startsWith('_bk_'))).toBe(true);
      });
    },
  );

  test.openspec('[HEAD-OUTLINE-02] Heuristic boundary remains opt-in')(
    'keeps heuristic headings opt-in while deterministic headings remain default',
    async ({ given, when, then }: AllureBddContext) => {
      const manager = createTestSessionManager();
      const filePath = await writeDocx({
        filename: 'heuristic-boundary.docx',
        stylesXml: STYLES_XML,
        bodyXml:
          `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Deterministic</w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>Heuristic Title</w:t></w:r></w:p>`,
      });

      await given('one deterministic and one short bare heuristic heading', () => {});
      const defaults = await getDocumentOutline(manager, { file_path: filePath });
      const optedIn = await getDocumentOutline(manager, {
        file_path: filePath,
        include_heuristic_headings: true,
      });
      assertSuccess(defaults, 'default get_document_outline');
      assertSuccess(optedIn, 'opted-in get_document_outline');
      await when('the outline is requested without and with heuristic opt-in', () => {});

      await then('default returns only deterministic and opt-in adds the existing heuristic source', () => {
        expect(outlineEntries(defaults).map(({ source }) => source)).toEqual(['word_style']);
        expect(outlineEntries(optedIn).map(({ source }) => source)).toEqual([
          'word_style',
          'title_bare',
        ]);
      });
    },
  );

  test.openspec('[HEAD-OUTLINE-03] Structured levels exceed Markdown syntax safely')(
    'preserves level 9 in JSON and clamps Markdown to ATX depth 6',
    async ({ given, when, then, and }: AllureBddContext) => {
      const manager = createTestSessionManager();
      const filePath = await writeDocx({
        filename: 'deep-heading.docx',
        stylesXml: STYLES_XML,
        bodyXml:
          `<w:p><w:pPr><w:pStyle w:val="Heading9"/></w:pPr>` +
          `<w:r><w:t>Deep Heading</w:t></w:r></w:p>`,
      });

      await given('a deterministic Heading 9 paragraph', () => {});
      const json = await getDocumentOutline(manager, { file_path: filePath });
      const markdown = await getDocumentOutline(manager, {
        file_path: filePath,
        format: 'markdown',
      });
      assertSuccess(json, 'JSON get_document_outline');
      assertSuccess(markdown, 'Markdown get_document_outline');
      await when('JSON and Markdown projections are requested', () => {});

      await then('structured JSON retains the exact level 9', () => {
        expect(outlineEntries(json)[0]?.level).toBe(9);
      });
      await and('Markdown uses the deepest valid ATX syntax without altering JSON', () => {
        expect((markdown as { content?: string }).content).toBe('###### Deep Heading');
      });
    },
  );

  test.openspec('[HEAD-OUTLINE-04] Generated reference lists the complete taxonomy')(
    'documents all heading sources, deterministic defaults, precedence, and Markdown clamp',
    async ({ given, when, then, and }: AllureBddContext) => {
      const referencePath = path.resolve(
        import.meta.dirname,
        '../../docs/tool-reference.generated.md',
      );
      await given('the generated MCP tool reference', () => {});
      const reference = await fs.readFile(referencePath, 'utf8');
      await when('the get_document_outline contract is inspected', () => {});

      await then('it lists every deterministic and heuristic source value', () => {
        for (const source of [
          'word_style',
          'list_metadata',
          'outline_level',
          'run_in_header',
          'title_with_period',
          'title_with_colon',
          'title_caps_centered',
          'title_bare',
        ]) {
          expect(reference).toContain(source);
        }
      });
      await and('it states precedence, deterministic defaults, and the ATX clamp', () => {
        expect(reference).toContain('selected in that precedence order and included by default');
        expect(reference).toContain('Markdown clamps visual ATX depth to 6');
      });
    },
  );
});
