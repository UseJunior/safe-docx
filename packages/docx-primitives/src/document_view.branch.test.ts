import { describe, expect } from 'vitest';
import { itAllure as it } from '../test/helpers/allure-test.js';
import {
  buildDocumentView,
  buildNodesForDocumentView,
  discoverStyles,
  type DocumentViewNode,
} from './document_view.js';
import { LabelType } from './list_labels.js';
import { parseXml } from './xml.js';

const test = it.epic('DOCX Primitives').withLabels({ feature: 'Document View' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wrapDoc(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

function makeParagraphs(bodyXml: string): Array<{ id: string; p: Element }> {
  const doc = parseXml(wrapDoc(bodyXml));
  const ps = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
  return ps.map((p, idx) => ({ id: `jr_para_${idx + 1}`, p }));
}

function makeNode(overrides: Partial<DocumentViewNode>): DocumentViewNode {
  return {
    id: 'jr_para_1',
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

describe('document_view branch coverage', () => {
  test('buildDocumentView returns empty output when w:body is absent', () => {
    const doc = parseXml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}"></w:document>`,
    );

    const result = buildDocumentView({
      documentXml: doc,
      stylesXml: null,
      numberingXml: null,
    });

    expect(result.nodes).toEqual([]);
    expect(result.styles.styles.size).toBe(0);
  });

  test('legacy semantic path emits highlighting tags but ignores w:highlight w:val="none"', () => {
    const bodyXml =
      `<w:p>` +
        `<w:r><w:rPr><w:highlight w:val="none"/></w:rPr><w:t>plain</w:t></w:r>` +
        `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>hot</w:t></w:r>` +
        `<w:r><w:t>end</w:t></w:r>` +
      `</w:p>`;

    const { nodes } = buildNodesForDocumentView({
      paragraphs: makeParagraphs(bodyXml),
      stylesXml: null,
      numberingXml: null,
      include_semantic_tags: true,
      show_formatting: false,
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.tagged_text).toContain('plain<highlighting>hot</highlighting>end');
    expect(nodes[0]!.tagged_text).not.toContain('<highlighting>plain');
  });

  test('header fallback extracts long run-in titles and rejects overlong header candidates', () => {
    const valid = 'Governing Law and Venue: this agreement is governed as stated.';
    const tooLong =
      'This Header Text Is Deliberately More Than Sixty Characters Long For Rejection: body content follows.';
    const bodyXml =
      `<w:p><w:r><w:t>${valid}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>${tooLong}</w:t></w:r></w:p>`;

    const { nodes } = buildNodesForDocumentView({
      paragraphs: makeParagraphs(bodyXml),
      stylesXml: null,
      numberingXml: null,
      include_semantic_tags: false,
      show_formatting: false,
    });

    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.header).toBe('Governing Law and Venue');
    expect(nodes[0]!.list_metadata.header_style).toBe('title_with_colon');
    expect(nodes[1]!.header).toBe('');
    expect(nodes[1]!.list_metadata.header_text).toBeNull();
  });

  test('injects [^N] markers from footnote refs, skipping reserved IDs and field-code text', () => {
    const bodyXml =
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:footnoteReference w:id="2"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:t>IGNORED</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>B</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:footnoteReference w:id="-1"/></w:r>` +
        `<w:r><w:t>C</w:t></w:r>` +
        `<w:r><w:footnoteReference w:id="3"/></w:r>` +
      `</w:p>`;

    const documentXml = parseXml(wrapDoc(bodyXml));
    const paragraphs = Array.from(documentXml.getElementsByTagNameNS(W_NS, 'p'))
      .map((p, idx) => ({ id: `jr_para_${idx + 1}`, p }));
    const footnotesXml = parseXml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:footnotes xmlns:w="${W_NS}">` +
        `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
        `<w:footnote w:id="2"><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="3"><w:p><w:r><w:t>Three</w:t></w:r></w:p></w:footnote>` +
      `</w:footnotes>`,
    );

    const { nodes } = buildNodesForDocumentView({
      paragraphs,
      stylesXml: null,
      numberingXml: null,
      include_semantic_tags: false,
      show_formatting: false,
      documentXml,
      footnotesXml,
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.tagged_text).toContain('A[^1]');
    expect(nodes[0]!.tagged_text).toContain('C[^2]');
    expect(nodes[0]!.tagged_text).not.toContain('IGNORED');
    expect(nodes[0]!.tagged_text).not.toContain('[^0]');
  });

  test('trims manual list-label boundary whitespace in formatting mode', () => {
    const bodyXml = `<w:p><w:r><w:t>(a)   obligation survives termination.</w:t></w:r></w:p>`;

    const { nodes } = buildNodesForDocumentView({
      paragraphs: makeParagraphs(bodyXml),
      stylesXml: null,
      numberingXml: null,
      include_semantic_tags: true,
      show_formatting: true,
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.list_label).toBe('(a)');
    expect(nodes[0]!.tagged_text.startsWith('obligation')).toBe(true);
  });

  test('discoverStyles assigns deterministic suffixes for multiple groups sharing same semantic base', () => {
    const nodes: DocumentViewNode[] = [
      makeNode({
        id: 'jr_para_1',
        clean_text: 'Body A',
        tagged_text: 'Body A',
        style_fingerprint: {
          list_level: -1,
          left_indent_pt: 0,
          first_line_indent_pt: 0,
          style_name: 'Body Text',
          alignment: 'LEFT',
        },
      }),
      makeNode({
        id: 'jr_para_2',
        clean_text: 'Body B',
        tagged_text: 'Body B',
        style_fingerprint: {
          list_level: -1,
          left_indent_pt: 0,
          first_line_indent_pt: 0,
          style_name: 'Body Text',
          alignment: 'CENTER',
        },
      }),
    ];

    const styles = discoverStyles(nodes);
    const ids = [...styles.styles.keys()].sort();
    expect(ids).toEqual(['body', 'body_1']);
  });

  test('discoverStyles covers list-level and non-list semantic classification branches', () => {
    const styles = discoverStyles([
      makeNode({
        id: 'jr_para_article',
        style_fingerprint: { list_level: 0, left_indent_pt: 0, first_line_indent_pt: 0, style_name: 'List Paragraph', alignment: 'LEFT' },
        list_metadata: { ...makeNode({}).list_metadata, label_type: LabelType.ARTICLE, list_level: 0 },
      }),
      makeNode({
        id: 'jr_para_section',
        style_fingerprint: { list_level: 0, left_indent_pt: 4, first_line_indent_pt: 0, style_name: 'List Paragraph', alignment: 'LEFT' },
        list_metadata: { ...makeNode({}).list_metadata, label_type: LabelType.SECTION, list_level: 0 },
      }),
      makeNode({
        id: 'jr_para_subsection_letter',
        style_fingerprint: { list_level: 1, left_indent_pt: 8, first_line_indent_pt: 0, style_name: 'List Paragraph', alignment: 'LEFT' },
        list_metadata: { ...makeNode({}).list_metadata, label_type: LabelType.LETTER, list_level: 1 },
      }),
      makeNode({
        id: 'jr_para_subsection_number',
        style_fingerprint: { list_level: 1, left_indent_pt: 12, first_line_indent_pt: 0, style_name: 'List Paragraph', alignment: 'LEFT' },
        list_metadata: { ...makeNode({}).list_metadata, label_type: LabelType.NUMBER, list_level: 1 },
      }),
      makeNode({
        id: 'jr_para_level2_roman',
        style_fingerprint: { list_level: 2, left_indent_pt: 16, first_line_indent_pt: 0, style_name: 'List Paragraph', alignment: 'LEFT' },
        list_metadata: { ...makeNode({}).list_metadata, label_type: LabelType.ROMAN, list_level: 2 },
      }),
      makeNode({
        id: 'jr_para_indent',
        style_fingerprint: { list_level: -1, left_indent_pt: 10, first_line_indent_pt: 0, style_name: 'Body Text', alignment: 'LEFT' },
      }),
      makeNode({
        id: 'jr_para_heading',
        style_fingerprint: { list_level: -1, left_indent_pt: 0, first_line_indent_pt: 0, style_name: 'Heading 2', alignment: 'LEFT' },
      }),
      makeNode({
        id: 'jr_para_quote',
        style_fingerprint: { list_level: -1, left_indent_pt: 0, first_line_indent_pt: 0, style_name: 'Quote Block', alignment: 'RIGHT' },
      }),
    ]);

    const ids = new Set(styles.styles.keys());
    expect(ids.has('article')).toBe(true);
    expect(ids.has('section')).toBe(true);
    expect(ids.has('subsection')).toBe(true);
    expect(ids.has('subsection_number')).toBe(true);
    expect(ids.has('level_2_roman')).toBe(true);
    expect(ids.has('indent_block')).toBe(true);
    expect(ids.has('heading')).toBe(true);
    expect(ids.has('block_quote')).toBe(true);
  });

  test('legacy semantic mode strips manual list labels before definition-tag emission', () => {
    const bodyXml = `<w:p><w:r><w:t>(a) "Service" means platform access.</w:t></w:r></w:p>`;

    const { nodes } = buildNodesForDocumentView({
      paragraphs: makeParagraphs(bodyXml),
      stylesXml: null,
      numberingXml: null,
      include_semantic_tags: true,
      show_formatting: false,
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.tagged_text).not.toContain('(a)');
    expect(nodes[0]!.tagged_text).toContain('<definition>Service</definition> means platform access.');
  });
});
