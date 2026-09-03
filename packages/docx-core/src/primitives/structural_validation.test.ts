import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import type { DocumentViewNode } from './document_view-types.js';
import { validateStructuralInsertion, validateStructuralInsertions } from './structural_validation.js';

function node(id: string, level: number | null, numId = level == null ? null : '1'): DocumentViewNode {
  return {
    id, list_label: '', header: '', style: level == null ? 'body' : `Heading${level}`,
    text: id, clean_text: id, tagged_text: id,
    list_metadata: { list_level: level == null ? -1 : level - 1, label_type: null, label_string: '', header_text: null, header_style: null, header_formatting: null, is_auto_numbered: level != null },
    style_fingerprint: { list_level: level == null ? -1 : level - 1, left_indent_pt: 0, first_line_indent_pt: 0, style_name: '', alignment: 'LEFT' },
    paragraph_style_id: null, paragraph_style_name: '', paragraph_alignment: 'LEFT',
    paragraph_indents_pt: { left: 0, first_line: 0 },
    numbering: { num_id: numId, ilvl: level == null ? null : level - 1, is_auto_numbered: level != null },
    heading: level == null ? undefined : { text: id, source: 'word_style', level },
    header_formatting: null, body_run_formatting: null,
  };
}

describe('structural insertion validation', () => {
  test('detects a parent/child slice and suggests the last descendant before the boundary', () => {
    const nodes = [node('parent', 1), node('child', 2), node('grandchild', 3), node('body', null), node('sibling', 1)];
    expect(validateStructuralInsertion(nodes, { operationId: 'op', position: 'AFTER', anchorId: 'parent' }))
      .toContainEqual(expect.objectContaining({ code: 'PARENT_CHILD_SLICE', suggested_anchor_id: 'body' }));
  });

  test('does not diagnose child-peer, sibling, or ancestor-boundary placement', () => {
    const cases: Array<[DocumentViewNode[], string, string]> = [
      [[node('parent', 1), node('child', 2)], 'parent', 'child'],
      [[node('first', 1), node('second', 1)], 'first', 'first'],
      [[node('parent', 1), node('next', 1), node('child', 2)], 'parent', 'parent'],
    ];
    for (const [nodes, anchorId, sourceId] of cases) {
      expect(validateStructuralInsertion(nodes, { operationId: 'op', position: 'AFTER', anchorId, styleSourceId: sourceId })
        .filter((item) => item.code === 'PARENT_CHILD_SLICE')).toEqual([]);
    }
  });

  test('reports an intentional nested level as advisory, not parent slicing', () => {
    const diagnostics = validateStructuralInsertion([node('parent', 1), node('child', 2)], {
      operationId: 'op', position: 'AFTER', anchorId: 'parent', styleSourceId: 'child',
    });
    expect(diagnostics.map((item) => [item.code, item.severity])).toEqual([['LIST_LEVEL_MISMATCH', 'warning']]);
  });

  test('detects a foreign numbering definition inserted into the middle of a list', () => {
    const diagnostics = validateStructuralInsertion([node('a', 1, '1'), node('b', 1, '1'), node('foreign', 1, '9')], {
      operationId: 'op', position: 'AFTER', anchorId: 'a', styleSourceId: 'foreign',
    });
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'MID_LIST_RENUMBERING', severity: 'error' }));
  });

  test('aggregates in operation and registry order', () => {
    const nodes = [node('p1', 1), node('c1', 2), node('p2', 1), node('c2', 2)];
    const diagnostics = validateStructuralInsertions(nodes, [
      { operationId: 'z', position: 'AFTER', anchorId: 'p2' },
      { operationId: 'a', position: 'AFTER', anchorId: 'p1' },
    ]);
    expect(diagnostics.map((item) => item.operation_id)).toEqual(['z', 'a']);
  });

  test('requires both halves of a repeated run-in style pair without inspecting title text', () => {
    const nodes = [
      node('h1', 2), { ...node('b1', null), style: 'HeadingPara2' },
      node('h2', 2), { ...node('b2', null), style: 'HeadingPara2' },
      node('anchor', 1),
    ];
    expect(validateStructuralInsertions(nodes, [{
      operationId: 'heading', position: 'AFTER', anchorId: 'anchor', styleSourceId: 'h1',
    }])).toContainEqual(expect.objectContaining({ code: 'BONDED_PARAGRAPH_PAIR_REQUIRED' }));
  });

  test('accepts a complete heading/body pair in the insertion order needed for AFTER', () => {
    const nodes = [
      node('h1', 2), { ...node('b1', null), style: 'HeadingPara2' },
      node('h2', 2), { ...node('b2', null), style: 'HeadingPara2' },
      node('anchor', 1),
    ];
    const diagnostics = validateStructuralInsertions(nodes, [
      { operationId: 'body', position: 'AFTER', anchorId: 'anchor', styleSourceId: 'b1' },
      { operationId: 'heading', position: 'AFTER', anchorId: 'anchor', styleSourceId: 'h1' },
    ]);
    expect(diagnostics.filter((item) => item.code === 'BONDED_PARAGRAPH_PAIR_REQUIRED' || item.code === 'RUN_IN_PAIR_ORDER')).toEqual([]);
  });

  test('rejects pair order that would put the body before its heading', () => {
    const nodes = [
      node('h1', 2), { ...node('b1', null), style: 'HeadingPara2' },
      node('h2', 2), { ...node('b2', null), style: 'HeadingPara2' },
      node('anchor', 1),
    ];
    expect(validateStructuralInsertions(nodes, [
      { operationId: 'heading', position: 'AFTER', anchorId: 'anchor', styleSourceId: 'h1' },
      { operationId: 'body', position: 'AFTER', anchorId: 'anchor', styleSourceId: 'b1' },
    ])).toContainEqual(expect.objectContaining({ code: 'RUN_IN_PAIR_ORDER' }));
  });
});
