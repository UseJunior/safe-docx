import JSZip from 'jszip';
import Markdoc from '@markdoc/markdoc';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { parseXml, type ParagraphSpec } from '@usejunior/docx-core';
import { itAllure as it } from '../../../docx-core/src/testing/allure-test.js';
import { defaultPreset } from '../markdocx/default-theme.js';
import { createMarkdocxRenderer } from '../markdocx/engine.js';
import { parseCreateCliArgs, runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc } from './create.js';
import { resolveCreationProfile } from './profile.js';
import { paragraphReadbackText, readCreatedDocx } from './readback.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(() => undefined, (error: { code?: string }) => error.code);
}

describe('creation edge cases', () => {
  it('validates and merges the house profile', async () => {
    expect(resolveCreationProfile(undefined).font).toBe('Times New Roman');
    expect(resolveCreationProfile({ font: 'Garamond', sizePt: 12 })).toMatchObject({ font: 'Garamond', sizePt: 12, lineSpacing: 1.15 });
    for (const bad of [null, [], 'x', { unknown: 1 }, { font: ' ' }, { sizePt: 0 }, { lineSpacing: -1 }, { titleSizePt: Number.NaN }, { marginsIn: -1 }, { spacingAfterPt: -2 }, { signatureTabIn: -1 }, { justify: 'yes' }, { marginsIn: 5 }]) {
      expect(() => resolveCreationProfile(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: 'INVALID_CREATION_PROFILE' }));
    }
    const { docx } = await createDocumentFromMarkdoc('Body.', { profile: { font: 'Garamond', justify: false } });
    const styles = await (await JSZip.loadAsync(docx)).file('word/styles.xml')!.async('string');
    expect(styles).toContain('w:eastAsia="Garamond"');
  });

  it('rejects malformed frontmatter, section attributes and page-break placement', async () => {
    for (const [source, expected] of [
      ['---\npage-numbers: maybe\n---\n\nBody', 'UNSUPPORTED_CREATION_FRONTMATTER'],
      ['---\ndate: 2026-13-45\n---\n\nBody', 'UNSUPPORTED_CREATION_FRONTMATTER'],
      ['---\ntitle:\n---\n\nBody', 'UNSUPPORTED_CREATION_FRONTMATTER'],
      ['A\n\n{% section footer="" /%}\n\nB', 'INVALID_SECTION'],
      ['A\n\n{% section page-numbers="yes" /%}\n\nB', 'INVALID_SECTION'],
      ['A\n\n{% page-break /%}\n\n{% table %}\n* x\n{% /table %}', 'PAGE_BREAK_BEFORE_TABLE'],
      ['A\n\n{% page-break /%}\n\n{% page-break /%}\n\nB', 'DUPLICATE_PAGE_BREAK'],
      ['A\n\n{% page-break /%}\n\n{% section /%}\n\nB', 'PAGE_BREAK_BEFORE_SECTION'],
      ['{% signer name="" /%}', 'INVALID_SIGNER'],
      ['{% signer name="A" date="" /%}', 'INVALID_SIGNER'],
      ['{% center %}\n- list\n{% /center %}', 'UNSUPPORTED_CREATION_SYNTAX'],
      ['> - quoted list', 'UNSUPPORTED_CREATION_SYNTAX'],
      ['1. a\n   1. b\n      1. c\n         1. d', 'LIST_TOO_DEEP'],
      ['{% table %}\n{% /table %}', 'UNSUPPORTED_CREATION_SYNTAX'],
    ] as const) {
      expect(await code(createDocumentFromMarkdoc(source)), source).toBe(expected);
    }
    // A dated, authored source sets core properties without reading the clock; a signer may omit the date.
    const dated = await createDocumentFromMarkdoc('---\ntitle: T\nauthor: "A. Author"\ndate: 2026-10-01\n---\n\n{% signer name="Jane Roe" /%}');
    const core = await (await JSZip.loadAsync(dated.docx)).file('docProps/core.xml')!.async('string');
    expect(core).toContain('2026-10-01T00:00:00Z');
    expect(dated.readback.paragraphs).toEqual([`${'_'.repeat(30)}\nJane Roe`]);
  });

  it('parses CLI arguments strictly and rejects a malformed profile file', async () => {
    expect(parseCreateCliArgs(['a.mdoc', 'out', '--style-profile', 'p.json', '--replace'])).toMatchObject({ profilePath: 'p.json', replace: true, pdf: true });
    for (const args of [['a.mdoc'], ['a.mdoc', 'out', 'extra'], ['a.mdoc', 'out', '--bogus'], ['a.mdoc', 'out', '--style-profile'], ['a.mdoc', 'out', '--style-profile', 'p', '--style-profile', 'q']]) {
      expect(() => parseCreateCliArgs(args), args.join(' ')).toThrow();
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-edges-'));
    try {
      const source = path.join(dir, 'doc.mdoc');
      await writeFile(source, 'Body.');
      await writeFile(path.join(dir, 'bad.json'), '{ not json');
      expect(await code(runCreateCommand([source, path.join(dir, 'out'), '--no-pdf', '--style-profile', path.join(dir, 'bad.json')]))).toBe('INVALID_CREATION_PROFILE_JSON');
      await writeFile(path.join(dir, 'house.json'), '{"font":"Garamond"}');
      const result = await runCreateCommand([source, path.join(dir, 'out2'), '--no-pdf', '--style-profile', path.join(dir, 'house.json')]);
      expect(result.created.certificate.profileSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(await readFile(result.outputs.certificate, 'utf8')).profile.font).toBe('Garamond');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads fields, tabs and breaks back without cached results, and refuses broken packages', async () => {
    const paragraph = parseXml(`<w:p xmlns:w="${W}"><w:pPr><w:tabs><w:tab w:val="left" w:pos="100"/></w:tabs></w:pPr>`
      + '<w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/></w:r>'
      + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> NUMPAGES </w:instrText></w:r>'
      + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>').documentElement!;
    expect(paragraphReadbackText(paragraph)).toBe('A\tB\n<NUMPAGES>');
    const zip = new JSZip();
    zip.file('word/document.xml', `<w:document xmlns:w="${W}"/>`);
    expect(await code(readCreatedDocx(await zip.generateAsync({ type: 'nodebuffer' })))).toBe('CREATION_READBACK_FAILED');
    const noRels = new JSZip();
    noRels.file('word/document.xml', `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`);
    expect(await code(readCreatedDocx(await noRels.generateAsync({ type: 'nodebuffer' })))).toBe('CREATION_READBACK_FAILED');
  });

  it('keeps the lenient engine behaviour for continuation paragraphs and nested blocks in list items', () => {
    const renderer = createMarkdocxRenderer({ theme: defaultPreset.theme });
    const blocks = renderer.renderBlocks([Markdoc.parse('- first\n\n  continued\n\n  ## Heading in item')], { listDepth: 0 });
    expect(blocks.map((block) => (block as ParagraphSpec).styleId)).toEqual(['MdxBody', 'MdxBody', 'MdxHeading2']);
    expect((blocks[1] as ParagraphSpec).indent).toEqual({ leftTwips: 720 });
  });
});
