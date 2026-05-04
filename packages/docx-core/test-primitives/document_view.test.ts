import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { renderToon, type DocumentViewNode } from '../src/primitives/document_view.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Document View' });

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
  test('strips header prefix punctuation from tagged text when header column is present', async ({ given, when, then }: AllureBddContext) => {
    let nodes: DocumentViewNode[];
    let toon: string;

    await given('nodes with header and tagged_text containing header prefix', async () => {
      nodes = [
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
    });

    await when('renderToon is called', async () => {
      toon = renderToon(nodes!);
    });

    await then('header prefix punctuation is stripped from text', async () => {
      expect(toon).toContain('_bk_000000000111 |  | Definitions | body | the following terms apply.');
      expect(toon).toContain('_bk_000000000112 |  | Scope | body | applies to all sections');
    });
  });

  test('promotes header to text when stripping leaves an empty body', async ({ given, when, then }: AllureBddContext) => {
    let nodes: DocumentViewNode[];
    let toon: string;

    await given('a node where tagged_text equals header exactly', async () => {
      nodes = [
        makeNode({
          id: '_bk_000000000113',
          header: 'Title',
          tagged_text: 'Title',
        }),
      ];
    });

    await when('renderToon is called', async () => {
      toon = renderToon(nodes!);
    });

    await then('header is cleared and title is kept in text column', async () => {
      // Header column is cleared and the text column keeps the title.
      expect(toon).toContain('_bk_000000000113 |  |  | body | Title');
    });
  });

  test('preserves tagged text when no header is present', async ({ given, when, then }: AllureBddContext) => {
    let nodes: DocumentViewNode[];
    let toon: string;

    await given('a node with empty header and plain body text', async () => {
      nodes = [
        makeNode({
          id: '_bk_000000000114',
          header: '',
          tagged_text: 'plain body paragraph',
        }),
      ];
    });

    await when('renderToon is called', async () => {
      toon = renderToon(nodes!);
    });

    await then('tagged text is preserved unchanged', async () => {
      expect(toon).toContain('_bk_000000000114 |  |  | body | plain body paragraph');
    });
  });

  test('emits comment and reply lines after the paragraph row', async ({ given, when, then }: AllureBddContext) => {
    let toon: string;

    await given('a node with a comment thread', async () => {});

    await when('renderToon is called', async () => {
      toon = renderToon([
        makeNode({
          id: '_bk_000000000115',
          tagged_text: 'commented paragraph',
          comments: [{
            id: 12,
            author: 'Alice',
            date: '2026-04-30',
            initials: 'AL',
            text: 'Root note',
            replies: [{
              id: 13,
              author: 'Bob',
              date: '2026-05-01',
              initials: 'BO',
              text: 'Reply note',
              replies: [],
            }],
          }],
        }),
      ]);
    });

    await then('the paragraph row is followed by #COMMENT and #REPLY lines', async () => {
      const lines = toon.split('\n');
      expect(lines).toContain('_bk_000000000115 |  |  | body | commented paragraph');
      expect(lines).toContain('#COMMENT _bk_000000000115 c12 Alice 2026-04-30 | Root note');
      expect(lines).toContain('#REPLY c13 -> c12 Bob 2026-05-01 | Reply note');
    });
  });

  test('escapes literal pipes in rendered comment fields', async ({ given, when, then }: AllureBddContext) => {
    let toon: string;

    await given('a node with comment content containing pipe characters', async () => {});

    await when('renderToon is called', async () => {
      toon = renderToon([
        makeNode({
          id: '_bk_000000000116',
          tagged_text: 'pipe paragraph',
          comments: [{
            id: 21,
            author: 'A|B',
            date: null,
            initials: 'AB',
            text: 'Clause | note',
            replies: [],
          }],
        }),
      ]);
    });

    await then('pipe characters are escaped on the comment line', async () => {
      expect(toon).toContain('#COMMENT _bk_000000000116 c21 A\\|B - | Clause \\| note');
    });
  });
});
