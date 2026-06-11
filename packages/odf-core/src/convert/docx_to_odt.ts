/**
 * Native DOCX → ODT conversion (issue #331).
 *
 * Traverses docx-core's structured document view — the same intentionally-lossy semantic
 * model the markdown/HTML serializers consume — and emits a fresh ODT package. No external
 * binary is involved at runtime; LibreOffice exists only as a differential test oracle.
 *
 * `formattingMode: 'full'` is required (not the `'compact'` default): compact mode encodes
 * the document's dominant formatting as a modal baseline rather than per-run tags, which
 * would silently drop bold/italic/underline on mostly-bold documents.
 */

import { DocxDocument, serializeXml, type DocumentViewNode } from '@usejunior/docx-core';

import { OdfArchive } from '../shared/odf/OdfArchive.js';
import { ODF_NS } from '../shared/odf/namespaces.js';
import { appendInlineContent, TextStyleRegistry } from './inline.js';
import { ListDomBuilder, ListStyleRegistry } from './lists.js';
import { appendTable, registerCellStyle } from './tables.js';
import { appendTextWithWhitespace, buildMetaXml, buildStylesXml, createContentScaffold } from './package.js';
import { LossinessCollector, type ConvertDocxToOdtOptions, type ConvertDocxToOdtResult } from './types.js';

/** A heading is structural only when Word's style said so — heuristic headings stay paragraphs. */
function isStructuralHeading(node: DocumentViewNode): boolean {
  return node.heading?.source === 'word_style' && typeof node.heading.level === 'number';
}

/** Convert a `.docx` buffer to a fresh `.odt` package plus a lossiness report. */
export async function convertDocxToOdt(
  docx: Buffer,
  options?: ConvertDocxToOdtOptions,
): Promise<ConvertDocxToOdtResult> {
  const source = await DocxDocument.load(docx);
  // The document view only yields nodes for `_bk_`-bookmarked paragraphs, and bookmarks are
  // normally injected per MCP session — a raw `.docx` has none. Prime the loaded copy the
  // same way the session manager does (the input buffer is never written back).
  source.normalize();
  source.insertParagraphBookmarks('_convert');
  const { nodes } = source.buildDocumentView({ showFormatting: true, formattingMode: 'full' });
  const numbering = source.getNumberingModel();

  const lossiness = new LossinessCollector();
  // The view only surfaces bookmarked paragraphs; text-empty paragraphs that anchor nothing
  // stay unsurfaced and therefore drop out of the conversion. Report the count, not silence.
  const totalParagraphs = source.getParagraphs().length;
  if (totalParagraphs > nodes.length) {
    lossiness.add(
      'unsurfaced-paragraphs-dropped',
      `${totalParagraphs - nodes.length} text-empty paragraph(s) not surfaced by the document view`,
    );
  }
  const { doc, automaticStyles, body } = createContentScaffold();
  const textStyles = new TextStyleRegistry(doc, automaticStyles);
  const listStyles = new ListStyleRegistry(doc, automaticStyles, numbering);
  const cellStyleName = registerCellStyle(doc, automaticStyles);

  const fillParagraph = (p: Element, node: DocumentViewNode): void => {
    appendInlineContent(doc, p, node.tagged_text, textStyles, lossiness);
  };
  const newParagraph = (styleName: string): Element => {
    const p = doc.createElementNS(ODF_NS.TEXT, 'text:p');
    p.setAttributeNS(ODF_NS.TEXT, 'text:style-name', styleName);
    body.appendChild(p);
    return p;
  };

  let listBuilder: ListDomBuilder | null = null;
  let tableCount = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    // ── Tables: consume the whole run of same-table_id nodes at once ──
    if (node.table_context) {
      listBuilder = null;
      const tableId = node.table_context.table_id;
      const group: DocumentViewNode[] = [];
      while (i < nodes.length && nodes[i]!.table_context?.table_id === tableId) {
        group.push(nodes[i]!);
        i++;
      }
      i--; // for-loop re-increments
      tableCount += 1;
      appendTable(doc, body, group, tableCount, cellStyleName, fillParagraph, lossiness);
      continue;
    }

    // ── Word-styled headings ──
    if (isStructuralHeading(node)) {
      listBuilder = null;
      const level = Math.min(6, Math.max(1, node.heading!.level as number));
      const h = doc.createElementNS(ODF_NS.TEXT, 'text:h');
      h.setAttributeNS(ODF_NS.TEXT, 'text:outline-level', String(level));
      h.setAttributeNS(ODF_NS.TEXT, 'text:style-name', `Heading_20_${level}`);
      body.appendChild(h);
      fillParagraph(h, node);
      continue;
    }

    if (node.list_metadata.list_level >= 0) {
      // ── Auto-numbered / bullet items (any numPr): nested text:list ──
      if (node.list_metadata.is_auto_numbered) {
        const numId = node.numbering.num_id;
        // Bullet vs number comes from the numbering model's numFmt — `LabelType` has no
        // bullet member, so the label classification can't signal it.
        const bulletHint = listStyles.isBulletLevel(numId, node.numbering.ilvl);
        const styleName = listStyles.styleFor(numId, bulletHint);
        if (!listBuilder) listBuilder = new ListDomBuilder(doc, body);
        const p = listBuilder.item(node.list_metadata.list_level, styleName);
        fillParagraph(p, node);
        continue;
      }
      // ── Manual/legal labels (`Section 2.1`, `(a)`): literal paragraph text, NO text:list.
      //    Deliberate divergence from the HTML serializer's <ul><li> wrapping — an ODF list
      //    renderer would print its own number next to the legal label. ──
      listBuilder = null;
      const p = newParagraph('Standard');
      const label = node.list_metadata.label_string.trim();
      if (label) appendTextWithWhitespace(doc, p, `${label} `);
      fillParagraph(p, node);
      continue;
    }

    // ── Normal paragraphs (heuristic headings land here; empty paragraphs are kept) ──
    listBuilder = null;
    fillParagraph(newParagraph('Standard'), node);
  }

  const archive = OdfArchive.create({
    contentXml: serializeXml(doc),
    stylesXml: buildStylesXml(),
    metaXml: buildMetaXml(options?.metadata),
  });
  const odt = await archive.save();
  return { odt, lossiness: lossiness.toArray() };
}
