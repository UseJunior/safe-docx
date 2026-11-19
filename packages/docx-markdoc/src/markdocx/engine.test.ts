import Markdoc from '@markdoc/markdoc';
import type {BlockSpec, InlineSpec, ParagraphSpec} from '@usejunior/docx-core';
import {describe, expect} from 'vitest';
import {itAllure as it} from '../../../docx-core/src/testing/allure-test.js';

import {createMarkdocxRenderer, type InlineStyle, type Theme} from './engine.js';

function text(runs: InlineSpec[]): string {
  return runs.map((run) => (run.kind === 'text' ? run.text : '')).join('');
}

const tinyTheme: Theme = {
  bodyParagraph(runs, overrides = {}) {
    return {kind: 'paragraph', styleId: 'body', runs, ...overrides};
  },
  sectionHeadingParagraph(runs) {
    return {kind: 'paragraph', styleId: 'h2', runs};
  },
  subHeadingParagraph(runs) {
    return {kind: 'paragraph', styleId: 'h3', runs};
  },
  horizontalRule() {
    return [{kind: 'paragraph', styleId: 'rule', runs: [{kind: 'text', text: '---'}]}];
  },
  renderText(value: string, style: InlineStyle) {
    return [{kind: 'text', text: value, bold: style.bold, italic: style.italic}];
  },
  fieldRuns(value: string, filled: boolean, style: InlineStyle) {
    return [{kind: 'text', text: filled ? value : `[${value}]`, bold: style.bold || !filled, italic: style.italic}];
  },
  listLevel(level) {
    return {numId: 'tinyList', ilvl: level, continuationIndentTwips: 480 + level * 240, itemAfterTwips: 60};
  },
};

describe('markdocx renderer engine', () => {
  it('renders a non-agreement Markdoc AST with caller-supplied styling seams', () => {
    const ast = Markdoc.parse(['# Hi', '', 'A **bold** word.', '', '- item'].join('\n'));
    // No agreement frontmatter, no field resolver (the doc has no fields): proves
    // the seam is genuinely generic, not agreement-shaped.
    const renderer = createMarkdocxRenderer({theme: tinyTheme});

    const blocks = renderer.renderBlocks([ast], {listDepth: 0});

    expect(blocks).toHaveLength(2);
    expect(text((blocks[0] as ParagraphSpec).runs)).toBe('A bold word.');
    expect((blocks[0] as ParagraphSpec).runs.find((run) => run.kind === 'text' && run.text === 'bold')).toMatchObject({
      bold: true,
    });
    expect(blocks[1]).toMatchObject<BlockSpec>({
      kind: 'paragraph',
      styleId: 'body',
      list: {numId: 'tinyList', ilvl: 0},
      spacing: {afterTwips: 60},
      runs: [{kind: 'text', text: 'item'}],
    });
  });

  it('left-indents body paragraphs generically when paragraphIndentTwips is set', () => {
    const ast = Markdoc.parse('Plain paragraph.');
    const renderer = createMarkdocxRenderer({theme: tinyTheme});
    const [block] = renderer.renderBlocks([ast], {listDepth: 0, paragraphIndentTwips: 360});
    expect(block).toMatchObject({kind: 'paragraph', styleId: 'body', indent: {leftTwips: 360}});
  });
});
