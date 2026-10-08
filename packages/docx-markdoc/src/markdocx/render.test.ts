import JSZip from 'jszip';
import {describe, expect} from 'vitest';
import {itAllure as it} from '../../../docx-core/src/testing/allure-test.js';

import {MDX_BULLET_NUM_ID, MDX_ORDERED_NUM_ID} from './default-theme.js';
import {renderMarkdocxToDocumentSpec, renderMarkdocxToDocx} from './render.js';

const representativeMarkdown = [
  '# Title',
  '',
  'A **bold** word and an *italic* word.',
  '',
  '1. one',
  '2. two',
  '',
  '- a',
  '- b',
  '',
  '---',
  '',
  '## Section',
  '',
  '### Subsection',
].join('\n');

async function unzipDocx(bytes: Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const parts: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name].dir) parts[name] = await zip.file(name)!.async('string');
  }
  return parts;
}

function styleXml(stylesXml: string, styleId: string): string {
  const match = stylesXml.match(new RegExp(`<w:style[^>]*w:styleId="${styleId}"[\\s\\S]*?</w:style>`));
  if (!match) throw new Error(`Missing style ${styleId}`);
  return match[0];
}

describe('standalone markdocx render API', () => {
  it('renders markdown to a valid OOXML package with the no-blue-H2 default', async () => {
    const bytes = await renderMarkdocxToDocx(representativeMarkdown, {
      meta: {title: 'Representative Markdown', createdIso: '2024-01-01T00:00:00Z'},
    });

    expect(Buffer.from(bytes).subarray(0, 2).toString('latin1')).toBe('PK');
    const parts = await unzipDocx(bytes);
    expect(parts).toHaveProperty('[Content_Types].xml');
    expect(parts).toHaveProperty('word/document.xml');
    expect(parts).toHaveProperty('word/styles.xml');
    expect(parts).toHaveProperty('word/numbering.xml');

    const h2 = styleXml(parts['word/styles.xml'], 'MdxHeading2');
    expect(h2).toContain('w:val="1A1A1A"');
    expect(h2).toContain('w:basedOn w:val="Normal"');
    expect(h2).not.toMatch(/<w:basedOn[^>]*w:val="Heading ?2"/i);
    expect(h2).not.toMatch(/(?:2E74B5|4F81BD|0000FF)/i);
    expect(parts['word/styles.xml']).not.toMatch(/(?:2E74B5|4F81BD|0000FF)/i);

    expect(parts['word/numbering.xml']).toContain('w:val="bullet"');
    expect(parts['word/numbering.xml']).toContain('w:val="decimal"');
    expect(parts['word/document.xml']).toContain('<w:b/>');
    expect(parts['word/document.xml']).toContain('<w:i/>');
    expect(parts['word/document.xml']).toContain('____________________________');
  });

  it('keeps ordered and unordered list references distinct in the DocumentSpec', () => {
    const spec = renderMarkdocxToDocumentSpec(representativeMarkdown);
    const listParagraphs = spec.sections[0].blocks.flatMap((block) =>
      block.kind === 'paragraph' && block.list ? [block] : [],
    );

    expect(listParagraphs.map((paragraph) => paragraph.list?.numId)).toEqual([
      MDX_ORDERED_NUM_ID,
      MDX_ORDERED_NUM_ID,
      MDX_BULLET_NUM_ID,
      MDX_BULLET_NUM_ID,
    ]);
    expect(new Set(listParagraphs.map((paragraph) => paragraph.list?.numId))).toEqual(
      new Set([MDX_ORDERED_NUM_ID, MDX_BULLET_NUM_ID]),
    );
  });
});
