import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import { renderToon, type DocumentViewNode } from './document_view.js';

function makeNode(overrides: Partial<DocumentViewNode>): DocumentViewNode {
  return {
    id: '_bk_000000000001',
    list_label: '',
    header: '',
    style: 'body',
    text: '',
    clean_text: '',
    tagged_text: '',
    list_metadata: {
      list_level: -1,
      label_type: null,
      label_string: '',
      header_text: null,
      header_style: null,
      header_formatting: null,
      is_auto_numbered: false,
    },
    style_fingerprint: {
      list_level: -1,
      left_indent_pt: 0,
      first_line_indent_pt: 0,
      style_name: 'Body Text',
      alignment: 'LEFT',
    },
    paragraph_style_id: null,
    paragraph_style_name: 'Body Text',
    paragraph_alignment: 'LEFT',
    paragraph_indents_pt: { left: 0, first_line: 0 },
    numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
    header_formatting: null,
    body_run_formatting: null,
    ...overrides,
  };
}

describe('document_view renderToon', () => {
  it('strips header prefix punctuation from tagged text when header column is present', () => {
    const nodes: DocumentViewNode[] = [
      makeNode({
        id: '_bk_000000000111',
        header: 'Definitions',
        tagged_text: 'Definitions: the following terms apply.',
      }),
      makeNode({
        id: '_bk_000000000112',
        header: 'Scope',
        tagged_text: 'Scope. applies to all sections',
      }),
    ];

    const toon = renderToon(nodes);
    expect(toon).toContain('_bk_000000000111 |  | Definitions | body | the following terms apply.');
    expect(toon).toContain('_bk_000000000112 |  | Scope | body | applies to all sections');
  });

  it('promotes header to text when stripping leaves an empty body', () => {
    const nodes: DocumentViewNode[] = [
      makeNode({
        id: '_bk_000000000113',
        header: 'Title',
        tagged_text: 'Title',
      }),
    ];

    const toon = renderToon(nodes);
    // Header column is cleared and the text column keeps the title.
    expect(toon).toContain('_bk_000000000113 |  |  | body | Title');
  });

  it('preserves tagged text when no header is present', () => {
    const nodes: DocumentViewNode[] = [
      makeNode({
        id: '_bk_000000000114',
        header: '',
        tagged_text: 'plain body paragraph',
      }),
    ];

    const toon = renderToon(nodes);
    expect(toon).toContain('_bk_000000000114 |  |  | body | plain body paragraph');
  });
});
