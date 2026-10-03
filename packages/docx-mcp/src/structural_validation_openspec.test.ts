import { describe, expect } from 'vitest';
import { isRecognizedBondedInsertionPair, validateStructuralInsertion, validateStructuralInsertions, type DocumentViewNode } from '@usejunior/docx-core';
import { testAllure } from './testing/allure-test.js';

const TEST_FEATURE = 'add-markdoc-structural-validation';
const scenario = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

function node(id: string, level: number | null, style?: string): DocumentViewNode {
  const resolvedStyle = style ?? (level == null ? 'Normal' : `Heading${level}`);
  return {
    id, list_label: '', header: '', style: resolvedStyle, text: id, clean_text: id, tagged_text: id,
    list_metadata: { list_level: level == null ? -1 : level - 1, label_type: null, label_string: '', header_text: null, header_style: null, header_formatting: null, is_auto_numbered: level != null },
    style_fingerprint: { list_level: level == null ? -1 : level - 1, left_indent_pt: 0, first_line_indent_pt: 0, style_name: resolvedStyle, alignment: 'LEFT' },
    paragraph_style_id: resolvedStyle, paragraph_style_name: resolvedStyle, paragraph_alignment: 'LEFT',
    paragraph_indents_pt: { left: 0, first_line: 0 },
    numbering: { num_id: level == null ? null : '1', ilvl: level == null ? null : level - 1, is_auto_numbered: level != null },
    heading: level == null ? undefined : { text: id, source: 'word_style', level },
    header_formatting: null, body_run_formatting: null,
  };
}

describe('OpenSpec traceability: add-markdoc-structural-validation', () => {
  scenario.openspec('Parent-child slicing fails before mutation')('Scenario: Parent-child slicing fails before mutation', () => {
    const diagnostics = validateStructuralInsertion([node('p', 1), node('c', 2), node('g', 3)], {
      operationId: 'op', position: 'AFTER', anchorId: 'p',
    });
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PARENT_CHILD_SLICE', severity: 'error', suggested_anchor_id: 'g' }));
  });

  scenario.openspec('Nested peer insertion is not misdiagnosed')('Scenario: Nested peer insertion is not misdiagnosed', () => {
    const diagnostics = validateStructuralInsertion([node('p', 1), node('c', 2)], {
      operationId: 'op', position: 'AFTER', anchorId: 'p', styleSourceId: 'c',
    });
    expect(diagnostics.some((item) => item.code === 'PARENT_CHILD_SLICE')).toBe(false);
  });

  scenario.openspec('Validation output is actionable and stable')('Scenario: Validation output is actionable and stable', () => {
    const [diagnostic] = validateStructuralInsertion([node('p', 1), node('c', 2)], {
      operationId: 'op', position: 'AFTER', anchorId: 'p',
    });
    expect(diagnostic).toMatchObject({ operation_id: 'op', anchor_id: 'p', evidence: { anchor_level: 1, intended_level: 1 } });
  });

  scenario.openspec('Bonded run-in subsection requires two paragraphs')('Scenario: Bonded run-in subsection requires two paragraphs', () => {
    const nodes = [node('h1', 2), node('b1', null, 'HeadingPara2'), node('h2', 2), node('b2', null, 'HeadingPara2'), node('p', 1)];
    expect(validateStructuralInsertions(nodes, [{ operationId: 'heading', position: 'AFTER', anchorId: 'p', styleSourceId: 'h1' }]))
      .toContainEqual(expect.objectContaining({ code: 'BONDED_PARAGRAPH_PAIR_REQUIRED' }));
  });

  scenario.openspec('Unsafe insertion returns corrective guidance')('Scenario: Unsafe insertion returns corrective guidance', () => {
    const [diagnostic] = validateStructuralInsertion([node('p', 1), node('c', 2)], {
      operationId: 'insert_paragraph', position: 'AFTER', anchorId: 'p',
    });
    expect(diagnostic?.suggested_anchor_id).toBe('c');
  });

  scenario.openspec('Atomic bonded pair shares one insertion slot')('Scenario: Atomic bonded pair shares one insertion slot', () => {
    const nodes = [node('h1', 2), node('b1', null, 'HeadingPara2'), node('h2', 2), node('b2', null, 'HeadingPara2'), node('p', 1)];
    expect(isRecognizedBondedInsertionPair(nodes, [
      { operationId: 'body', position: 'AFTER', anchorId: 'p', styleSourceId: 'b1' },
      { operationId: 'heading', position: 'AFTER', anchorId: 'p', styleSourceId: 'h1' },
    ])).toBe(true);
  });
});
