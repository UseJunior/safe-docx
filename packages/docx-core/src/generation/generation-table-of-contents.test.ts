/**
 * Tables of contents and TC entries (`ParagraphSpec.tableOfContents`,
 * `tableOfContentsEntry`).
 *
 * A TOC field spans the paragraphs of its cached result, from the one that
 * opens it to the one that closes it, and lists the TC fields of the levels
 * it names. These assertions prove the field characters and instructions
 * are written where Word writes them, that TC entries sit after their
 * paragraph's bookmark, and that malformed shapes are refused before
 * compilation.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { BlockSpec, DocumentSpec, ParagraphSpec } from './types.js';

const TEST_FEATURE = 'add-created-run-in-numbering-and-toc';
const test = testAllure
  .epic('Document Generation')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.68' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const TOC_STYLES = [1, 2, 3].map((level) => ({ styleId: `TOC${level}`, name: `toc ${level}`, type: 'paragraph' as const, basedOn: 'Normal' }));

function tocSpec(blocks: BlockSpec[]): DocumentSpec {
  return {
    meta: { title: 'TOC', author: 'safe-docx', createdIso: '2026-01-01T00:00:00Z' },
    styles: TOC_STYLES,
    sections: [{ blocks }],
  };
}

const TOC_BLOCKS: BlockSpec[] = [
  { kind: 'paragraph', styleId: 'TOC1', tableOfContents: { opens: { levels: { from: 1, to: 3 } } }, runs: [{ kind: 'text', text: '1. Services' }] },
  { kind: 'paragraph', styleId: 'TOC2', tableOfContents: { closes: true }, runs: [{ kind: 'text', text: '1.01 Engagement' }] },
  {
    kind: 'paragraph',
    bookmark: 'services',
    runs: [{ kind: 'text', text: 'Services.', bold: true }, { kind: 'tableOfContentsEntry', text: '1. Services', level: 1 }],
  },
  {
    kind: 'paragraph',
    runs: [{ kind: 'text', text: 'Engagement. See ' }, { kind: 'crossReference', bookmark: 'services', show: 'text' }, { kind: 'tableOfContentsEntry', text: '1.01 Engagement', level: 2 }],
  },
];

/** Each body paragraph as a sequence of tokens: field characters, instructions, text and bookmark marks, in order. */
async function paragraphTokens(buffer: Buffer): Promise<string[][]> {
  const document = parseXml((await readZipText(buffer, 'word/document.xml'))!);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'p')).map((paragraph) => Array.from(paragraph.getElementsByTagNameNS(W_NS, '*')).flatMap((node) => {
    switch (node.localName) {
      case 'fldChar': return [`<${node.getAttributeNS(W_NS, 'fldCharType')}>`];
      case 'instrText': return [`{${node.textContent}}`];
      case 't': return [node.textContent ?? ''];
      case 'bookmarkStart': return ['[bm'];
      case 'bookmarkEnd': return ['bm]'];
      default: return [];
    }
  }));
}

describe('Tables of contents and TC entries', () => {
  test.openspec('[SDX-GEN-137] a table of contents and its TC entries are written as complex fields')(
    'Scenario: a table of contents and its TC entries are written as complex fields',
    async ({ given, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a spec with a two-entry table of contents and two TC entries, one on a bookmarked paragraph', async () => {
        buffer = await generateDocx(tocSpec(TOC_BLOCKS));
        await attachPrettyJson('paragraphs', await paragraphTokens(buffer));
      });

      await then('the table of contents opens in its first paragraph and closes in its last', async () => {
        const [first, last] = await paragraphTokens(buffer);
        expect(first).toEqual(['<begin>', '{ TOC \\f \\l "1-3" \\n }', '<separate>', '1. Services']);
        expect(last).toEqual(['1.01 Engagement', '<end>']);
      });

      await then('each TC entry is a field without a result, after the paragraph bookmark', async () => {
        const [, , heading, body] = await paragraphTokens(buffer);
        expect(heading).toEqual(['[bm', 'Services.', 'bm]', '<begin>', '{ TC "1. Services" \\l 1 }', '<end>']);
        // A text reference to the heading copies its text runs, not its TC entry.
        expect(body).toEqual(['Engagement. See ', '<begin>', '{ REF services \\h }', '<separate>', 'Services.', '<end>', '<begin>', '{ TC "1.01 Engagement" \\l 2 }', '<end>']);
      });

      await then('the package passes the structural checks and compiles byte-identically', async () => {
        const result = await checkGeneratedPackage(buffer);
        expect(result.ok, JSON.stringify(result.issues)).toBe(true);
        expect((await generateDocx(tocSpec(TOC_BLOCKS))).equals(buffer)).toBe(true);
        // One paragraph that both opens and closes the field is a one-entry table of contents.
        const single = await generateDocx(tocSpec([{ kind: 'paragraph', styleId: 'TOC1', tableOfContents: { opens: { levels: { from: 1, to: 1 } }, closes: true }, runs: [{ kind: 'text', text: 'Only' }] }]));
        expect((await paragraphTokens(single))[0]).toEqual(['<begin>', '{ TOC \\f \\l "1-1" \\n }', '<separate>', 'Only', '<end>']);
      });

      await then('malformed entries and tables of contents are refused before compilation', async () => {
        const paragraph = (extra: Partial<ParagraphSpec>, runs: ParagraphSpec['runs'] = [{ kind: 'text', text: 'x' }]): ParagraphSpec => ({ kind: 'paragraph', runs, ...extra });
        const refused: Array<[string, DocumentSpec]> = [
          ['not last', tocSpec([paragraph({}, [{ kind: 'tableOfContentsEntry', text: 'A', level: 1 }, { kind: 'text', text: 'x' }])])],
          ['double quote', tocSpec([paragraph({}, [{ kind: 'text', text: 'x' }, { kind: 'tableOfContentsEntry', text: 'A "B"', level: 1 }])])],
          ['level 0', tocSpec([paragraph({}, [{ kind: 'text', text: 'x' }, { kind: 'tableOfContentsEntry', text: 'A', level: 0 }])])],
          ['never closes', tocSpec([paragraph({ tableOfContents: { opens: { levels: { from: 1, to: 3 } } } })])],
          ['nested', tocSpec([paragraph({ tableOfContents: { opens: { levels: { from: 1, to: 3 } } } }), paragraph({ tableOfContents: { opens: { levels: { from: 1, to: 3 } }, closes: true } })])],
          ['reversed levels', tocSpec([paragraph({ tableOfContents: { opens: { levels: { from: 3, to: 1 } }, closes: true } })])],
          ['bookmark', tocSpec([paragraph({ bookmark: 'toc', tableOfContents: { opens: { levels: { from: 1, to: 3 } }, closes: true } })])],
          ['close without open', tocSpec([paragraph({ tableOfContents: { closes: true } })])],
          ['cross-reference', tocSpec([
            paragraph({ bookmark: 'target' }),
            paragraph({ tableOfContents: { opens: { levels: { from: 1, to: 3 } }, closes: true } }, [{ kind: 'crossReference', bookmark: 'target' }]),
          ])],
          ['table cell', tocSpec([{ kind: 'table', columnWidthsTwips: [2000], rows: [{ cells: [{ blocks: [paragraph({ tableOfContents: { opens: { levels: { from: 1, to: 3 } }, closes: true } })] }] }] }])],
          ['footer toc', { ...tocSpec([paragraph({})]), sections: [{ blocks: [paragraph({})], footers: { default: { blocks: [paragraph({ tableOfContents: { opens: { levels: { from: 1, to: 3 } } } })] } } }] }],
          ['footer entry', { ...tocSpec([paragraph({})]), sections: [{ blocks: [paragraph({})], footers: { default: { blocks: [paragraph({}, [{ kind: 'text', text: 'f' }, { kind: 'tableOfContentsEntry', text: 'F', level: 1 }])] } } }] }],
        ];
        for (const [name, spec] of refused) {
          await expect(generateDocx(spec), name).rejects.toBeInstanceOf(GenerationSpecError);
        }
      });
    },
  );
});
