import {describe, expect} from 'vitest';
import {itAllure as it} from '../../../docx-core/src/testing/allure-test.js';
import type {Node} from '@markdoc/markdoc';

import {
  FIELD_LABEL_ACRONYMS,
  hasRenderableContent,
  isWhitespaceBlock,
  MarkdocxUnhandledNodeError,
  plainText,
  throwUnhandledBlock,
  throwUnhandledTag,
  titleCaseSnake,
} from './ast.js';

function node(type: string, attributes: Record<string, unknown> = {}, children: Node[] = []): Node {
  return {type, attributes, children} as unknown as Node;
}

describe('markdocx ast helpers', () => {
  it('detects renderable content recursively', () => {
    expect(hasRenderableContent(node('paragraph', {}, [node('text', {content: '   '})]))).toBe(false);
    expect(hasRenderableContent(node('paragraph', {}, [node('text', {content: 'Clause text'})]))).toBe(true);
    expect(hasRenderableContent(node('paragraph', {}, [node('image')]))).toBe(true);
  });

  it('detects whitespace paragraph and inline blocks', () => {
    expect(isWhitespaceBlock(node('paragraph', {}, [node('softbreak'), node('text', {content: ''})]))).toBe(true);
    expect(isWhitespaceBlock(node('inline', {}, [node('hardbreak')]))).toBe(true);
    expect(isWhitespaceBlock(node('heading', {}, []))).toBe(false);
  });

  it('extracts plain text with breaks normalized to spaces', () => {
    expect(
      plainText(
        node('paragraph', {}, [
          node('text', {content: 'First'}),
          node('softbreak'),
          node('text', {content: 'Second'}),
          node('hardbreak'),
          node('text', {content: 'Third'}),
        ]),
      ),
    ).toBe('First Second Third');
  });

  it('title-cases snake names', () => {
    expect(titleCaseSnake('company_name')).toBe('Company Name');
  });

  it('keeps acronym segments in their conventional casing', () => {
    // Acronyms in first and later positions, plus controls that must not regress.
    expect(titleCaseSnake('nda_term')).toBe('NDA Term');
    expect(titleCaseSnake('ai_policy_reference')).toBe('AI Policy Reference');
    expect(titleCaseSnake('ai_provider_covered_claims')).toBe('AI Provider Covered Claims');
    expect(titleCaseSnake('customer_ai')).toBe('Customer AI');
    expect(titleCaseSnake('date_of_safe')).toBe('Date Of SAFE');
    // Derived from the allow-list itself rather than a literal per acronym:
    // every entry renders as its canonical form in first AND non-first
    // position, so adding an acronym automatically extends the pin.
    for (const [segment, rendered] of FIELD_LABEL_ACRONYMS) {
      expect(titleCaseSnake(`${segment}_term`)).toBe(`${rendered} Term`);
      expect(titleCaseSnake(`has_${segment}`)).toBe(`Has ${rendered}`);
    }
  });

  it('splits on whitespace as well as underscores', () => {
    expect(titleCaseSnake('party 1 name')).toBe('Party 1 Name');
  });

  it('throws a typed error naming the unhandled tag', () => {
    const tag = {type: 'tag', tag: 'mystery'} as unknown as Node;
    expect(() => throwUnhandledTag(tag)).toThrow(
      'Unhandled Markdoc tag {% mystery %} in the markdocx renderer. Add a block or inline tag plugin (or a renderer branch) or the rendered document will drift from the source.',
    );
    expect(() => throwUnhandledTag(tag)).toThrow(expect.objectContaining({name: 'MarkdocxUnhandledNodeError', nodeType: 'tag', tag: 'mystery'}));
  });

  it('throws a typed error naming the unhandled block', () => {
    expect(() => throwUnhandledBlock(node('image'))).toThrow(
      'Unhandled Markdoc node "image" in the markdocx renderer. Add a block or inline tag plugin (or a renderer branch) or the rendered document will drift from the source.',
    );
    expect(() => throwUnhandledBlock(node('image'))).toThrow(MarkdocxUnhandledNodeError);
  });
});
