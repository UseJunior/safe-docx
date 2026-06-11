/**
 * Native DOCX → ODT conversion (issues #331, #406).
 *
 * Traverses docx-core's structured document view — the same intentionally-lossy semantic
 * model the markdown/HTML serializers consume — and emits a fresh ODT package. No external
 * binary is involved at runtime; LibreOffice exists only as a differential test oracle.
 *
 * `formattingMode: 'full'` is required (not the `'compact'` default): compact mode encodes
 * the document's dominant formatting as a modal baseline rather than per-run tags, which
 * would silently drop bold/italic/underline on mostly-bold documents.
 *
 * Two narrow raw-DOM supplements cover what the view cannot carry: table borders/grid widths
 * (read from the source `w:tbl` by the view's `table_index`) and text-empty body paragraphs
 * (vertical spacing the view never surfaces, preserved as empty `text:p` by bookmark
 * correlation).
 */

import {
  DocxDocument,
  getParagraphBookmarkId,
  getParagraphText,
  serializeXml,
  W_NS,
  type DocumentViewNode,
} from '@usejunior/docx-core';

import { OdfArchive } from '../shared/odf/OdfArchive.js';
import { ODF_NS } from '../shared/odf/namespaces.js';
import { appendInlineContent, FontFaceRegistry, TextStyleRegistry } from './inline.js';
import { ListDomBuilder, ListStyleRegistry } from './lists.js';
import { appendTable, TableStyleRegistry } from './tables.js';
import { ParagraphStyleRegistry } from './paragraph_styles.js';
import {
  appendTextWithWhitespace,
  buildMetaXml,
  buildStylesXml,
  createContentScaffold,
  deriveSourceNamedStyles,
} from './package.js';
import { LossinessCollector, type ConvertDocxToOdtOptions, type ConvertDocxToOdtResult } from './types.js';

/** A heading is structural only when Word's style said so — heuristic headings stay paragraphs. */
function isStructuralHeading(node: DocumentViewNode): boolean {
  return node.heading?.source === 'word_style' && typeof node.heading.level === 'number';
}

/** True when the paragraph element sits inside a table cell (any depth up to the body). */
function isInsideTableCell(p: Element): boolean {
  let current: Node | null = p.parentNode;
  while (current && current.nodeType === 1) {
    const el = current as Element;
    if (el.namespaceURI === W_NS && el.localName === 'body') return false;
    if (el.namespaceURI === W_NS && el.localName === 'tc') return true;
    current = el.parentNode;
  }
  return false;
}

/**
 * Text-empty body-level paragraphs are never surfaced by the document view (it only yields
 * bookmarked paragraphs with content) but they are vertical spacing in the source. Correlate
 * `getParagraphs()` order with surfaced node ids via the bookmarks `normalize()` installed:
 * each unsurfaced empty body paragraph is preserved before its nearest following surfaced
 * node (`emptyBefore`) or at the end (`trailingEmpty`); in-table ones stay reported.
 */
function planUnsurfacedParagraphs(
  source: DocxDocument,
  nodes: DocumentViewNode[],
  lossiness: LossinessCollector,
): { emptyBefore: Map<string, number>; trailingEmpty: number } {
  const surfacedIds = new Set(nodes.map((n) => n.id));
  const emptyBefore = new Map<string, number>();
  let pending = 0;
  for (const p of source.getParagraphs()) {
    const id = getParagraphBookmarkId(p);
    if (id && surfacedIds.has(id)) {
      if (pending > 0) emptyBefore.set(id, pending);
      pending = 0;
      continue;
    }
    if (getParagraphText(p).trim() !== '') {
      // Unsurfaced despite content (e.g. exotic containers) — same drop as before, reported.
      lossiness.add('unsurfaced-paragraphs-dropped', 'non-empty paragraph not surfaced by the document view');
    } else if (isInsideTableCell(p)) {
      // Cell-internal spacing needs cell-level positioning the grid emitter does not model.
      lossiness.add('unsurfaced-table-paragraphs-dropped', 'text-empty paragraph inside a table cell');
    } else {
      pending += 1;
    }
  }
  return { emptyBefore, trailingEmpty: pending };
}

/** The direct `w:tbl` children of `w:body`, in order — the view's `table_index` space. */
function bodyLevelTables(source: DocxDocument): Element[] {
  const docXml = source.getDocumentXmlClone();
  const body = docXml.getElementsByTagNameNS(W_NS, 'body').item(0);
  if (!body) return [];
  const tables: Element[] = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const child = body.childNodes[i]!;
    if (child.nodeType === 1 && (child as Element).localName === 'tbl' && (child as Element).namespaceURI === W_NS) {
      tables.push(child as Element);
    }
  }
  return tables;
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
  const { emptyBefore, trailingEmpty } = planUnsurfacedParagraphs(source, nodes, lossiness);
  const sourceTables = bodyLevelTables(source);

  const { doc, fontFaceDecls, automaticStyles, body } = createContentScaffold();
  const fontFaces = new FontFaceRegistry(doc, fontFaceDecls);
  const textStyles = new TextStyleRegistry(doc, automaticStyles, fontFaces);
  const paragraphStyles = new ParagraphStyleRegistry(doc, automaticStyles);
  const listStyles = new ListStyleRegistry(doc, automaticStyles, numbering);
  const tableStyles = new TableStyleRegistry(doc, automaticStyles);

  const fillParagraph = (p: Element, node: DocumentViewNode): void => {
    appendInlineContent(doc, p, node.tagged_text, textStyles, lossiness);
  };
  const newParagraph = (styleName: string): Element => {
    const p = doc.createElementNS(ODF_NS.TEXT, 'text:p');
    p.setAttributeNS(ODF_NS.TEXT, 'text:style-name', styleName);
    body.appendChild(p);
    return p;
  };
  const appendEmptyParagraphs = (count: number): void => {
    for (let n = 0; n < count; n++) newParagraph('Standard');
  };

  let listBuilder: ListDomBuilder | null = null;
  let tableCount = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    // ── Preserved vertical spacing: unsurfaced empty body paragraphs before this node ──
    const emptyCount = emptyBefore.get(node.id) ?? 0;
    if (emptyCount > 0) {
      listBuilder = null;
      appendEmptyParagraphs(emptyCount);
    }

    // ── Tables: consume the whole run of same-table_id nodes at once ──
    if (node.table_context) {
      listBuilder = null;
      const tableId = node.table_context.table_id;
      const sourceTbl = sourceTables[node.table_context.table_index] ?? null;
      const group: DocumentViewNode[] = [];
      while (i < nodes.length && nodes[i]!.table_context?.table_id === tableId) {
        group.push(nodes[i]!);
        i++;
      }
      i--; // for-loop re-increments
      tableCount += 1;
      appendTable(
        doc,
        body,
        group,
        tableCount,
        sourceTbl,
        tableStyles,
        fillParagraph,
        (n) => paragraphStyles.styleFor('Standard', n),
        lossiness,
      );
      continue;
    }

    // ── Word-styled headings ──
    if (isStructuralHeading(node)) {
      listBuilder = null;
      const level = Math.min(6, Math.max(1, node.heading!.level as number));
      const h = doc.createElementNS(ODF_NS.TEXT, 'text:h');
      h.setAttributeNS(ODF_NS.TEXT, 'text:outline-level', String(level));
      h.setAttributeNS(ODF_NS.TEXT, 'text:style-name', paragraphStyles.styleFor(`Heading_20_${level}`, node));
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
        // Alignment only: the nested text:list supplies indentation, and re-applying the
        // source margins would double-indent the item.
        const p = listBuilder.item(
          node.list_metadata.list_level,
          styleName,
          paragraphStyles.styleFor('Standard', node, { indents: false }),
        );
        fillParagraph(p, node);
        continue;
      }
      // ── Manual/legal labels (`Section 2.1`, `(a)`): literal paragraph text, NO text:list.
      //    Deliberate divergence from the HTML serializer's <ul><li> wrapping — an ODF list
      //    renderer would print its own number next to the legal label. ──
      listBuilder = null;
      const p = newParagraph(paragraphStyles.styleFor('Standard', node));
      const label = node.list_metadata.label_string.trim();
      if (label) appendTextWithWhitespace(doc, p, `${label} `);
      fillParagraph(p, node);
      continue;
    }

    // ── Normal paragraphs (heuristic headings land here; empty paragraphs are kept) ──
    listBuilder = null;
    fillParagraph(newParagraph(paragraphStyles.styleFor('Standard', node)), node);
  }

  appendEmptyParagraphs(trailingEmpty);

  const archive = OdfArchive.create({
    contentXml: serializeXml(doc),
    stylesXml: buildStylesXml(deriveSourceNamedStyles(source.getStylesModel())),
    metaXml: buildMetaXml(options?.metadata),
  });
  const odt = await archive.save();
  return { odt, lossiness: lossiness.toArray() };
}
