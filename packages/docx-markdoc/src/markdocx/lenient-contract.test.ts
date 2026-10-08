import Markdoc from '@markdoc/markdoc';
import type { ParagraphSpec } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { MarkdocxUnhandledNodeError } from './ast.js';
import { defaultPreset } from './default-theme.js';
import { createMarkdocxRenderer, type BlockTagPlugin } from './engine.js';

const TEST_FEATURE = 'add-markdocx-generic-engine';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1162 upstreamed generic Markdoc engine',
  severity: 'critical',
});

function render(source: string, options: Partial<Parameters<typeof createMarkdocxRenderer>[0]> = {}) {
  return createMarkdocxRenderer({ theme: defaultPreset.theme, ...options }).renderBlocks([Markdoc.parse(source)], { listDepth: 0 });
}

const texts = (blocks: ReturnType<typeof render>): string[] =>
  blocks.map((block) => (block.kind === 'paragraph' ? block.runs.map((run) => (run.kind === 'text' ? run.text : '')).join('') : '<table>'));

describe('Traceability: upstreamed generic Markdoc engine', () => {
  test.openspec('[SDX-MDOC-156] the engine keeps its lenient adapter contract')(
    'Scenario: the engine keeps its lenient adapter contract',
    () => {
      // Links keep their text and drop the hyperlink; code renders as plain text; soft and hard breaks become spaces.
      expect(texts(render('See [the plan](https://example.com) and `code`.\nNext line\\\nLast.'))).toEqual([
        'See the plan and code. Next line Last.',
      ]);
      // Whitespace-only paragraphs render nothing.
      expect(render('   ')).toEqual([]);
      // Fields resolve through the caller; an unresolved field throws rather than vanishing.
      const resolved = render('Pay {% field name="amount" /%}.', { resolveField: () => ({ text: 'Amount', filled: false }) });
      expect((resolved[0] as ParagraphSpec).runs).toContainEqual(expect.objectContaining({ text: '[Amount]', bold: true }));
      expect(() => render('Pay {% field name="amount" /%}.')).toThrow(/no resolveField was provided/);
      // List nesting deeper than the cap reuses the deepest level instead of failing.
      const nested = render('- a\n  - b\n    - c\n      - d\n        - e');
      expect(nested.map((block) => (block as ParagraphSpec).list?.ilvl)).toEqual([0, 1, 2, 3, 3]);
    },
  );

  test.openspec('[SDX-MDOC-156] domain behaviour plugs in through tags and transformBlock')(
    'Scenario: domain behaviour plugs in through tags and transformBlock',
    () => {
      const callout: BlockTagPlugin = {
        tag: 'callout',
        renderBlock: (node, api, state) => api.renderBlocks(node.children, state).map((block) => ({ ...block, styleId: 'Callout' }) as ParagraphSpec),
      };
      const blocks = render('{% callout %}\nNote this.\n{% /callout %}\n\nPlain.', {
        blockTags: [callout],
        transformBlock: (node) => (node.type === 'paragraph' && JSON.stringify(node).includes('Plain.')
          ? [{ kind: 'paragraph', styleId: 'Replaced', runs: [{ kind: 'text', text: 'Swapped.' }] }]
          : null),
      });
      expect(blocks.map((block) => [(block as ParagraphSpec).styleId, texts([block])[0]])).toEqual([
        ['Callout', 'Note this.'],
        ['Replaced', 'Swapped.'],
      ]);
    },
  );

  test.openspec('[SDX-MDOC-156] unhandled nodes fail loudly with a typed error')(
    'Scenario: unhandled nodes fail loudly with a typed error',
    () => {
      for (const [source, nodeType, tag] of [
        ['![logo](logo.png)', 'image', undefined],
        ['> quoted', 'blockquote', undefined],
        ['{% mystery /%}', 'tag', 'mystery'],
        ['Text {% inline-mystery /%} here.', 'tag', 'inline-mystery'],
      ] as const) {
        let caught: unknown;
        try {
          render(source);
        } catch (error) {
          caught = error;
        }
        expect(caught, source).toBeInstanceOf(MarkdocxUnhandledNodeError);
        expect(caught, source).toMatchObject({ nodeType, ...(tag ? { tag } : {}) });
      }
    },
  );
});
