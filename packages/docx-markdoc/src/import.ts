import { DocxDocument, OOXML, W, computeContentFingerprint, type StylesModel } from '@usejunior/docx-core';
import { sha256 } from './hash.js';
import { DocxMarkdocError } from './errors.js';
import type { AnnotationAnchor, AnnotationParagraph, AnnotationRun, AnnotationRunStyle, CanonicalAnnotation, ImportResult } from './types.js';

function escapeText(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_\[\]{}<>#!])/g, '\\$1')
    .replace(/^(\d+)\./, '$1\\.')
    // Keep OOXML tabs and explicit line breaks inside one CommonMark line.
    // At Markdown line boundaries the parser discards adjacent horizontal
    // whitespace before character references are materialized.
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;');
  // CommonMark discards syntactic whitespace at block boundaries. Character
  // references survive parsing as text, so preserve source-significant spaces
  // without introducing a second representation or raw OOXML.
  return escaped
    .replace(/^ +/, (spaces) => '&#32;'.repeat(spaces.length))
    .replace(/ +$/, (spaces) => '&#32;'.repeat(spaces.length));
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseTaggedRuns(tagged: string, annotationId: string): AnnotationRun[] {
  const runs: AnnotationRun[] = [];
  const stack: AnnotationRunStyle[] = [{}];
  const tokens = tagged.split(/(<\/?(?:b|i|u|highlight|font)(?:\s[^>]*)?>)/g).filter(Boolean);
  const current = (): AnnotationRunStyle => stack.at(-1)!;
  for (const token of tokens) {
    if (!token.startsWith('<')) {
      if (token) runs.push({ text: token, ...(Object.keys(current()).length ? { style: { ...current() } } : {}) });
      continue;
    }
    if (token.startsWith('</')) {
      if (stack.length === 1) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} has unbalanced formatting tags.`, { annotationId });
      stack.pop();
      continue;
    }
    const next = { ...current() };
    if (token === '<b>') next.bold = true;
    else if (token === '<i>') next.italic = true;
    else if (token === '<u>') next.underline = true;
    else if (token.startsWith('<highlight')) {
      const color = /\bcolor="([^"]+)"/.exec(token)?.[1] ?? 'yellow';
      next.highlight = color as AnnotationRunStyle['highlight'];
    } else if (token.startsWith('<font')) {
      if (/\b(?:name|face)=/.test(token)) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} uses unsupported font metadata.`, { annotationId, token });
      const size = /\bsize="([0-9]+(?:\.[0-9]+)?)"/.exec(token)?.[1];
      if (size) {
        const halfPoints = Number(size) * 2;
        if (!Number.isInteger(halfPoints) || halfPoints <= 0) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} has an unsupported font size.`, { annotationId, token });
        next.fontSizeHalfPoints = halfPoints;
      }
      const color = /\bcolor="([0-9A-Fa-f]{6})"/.exec(token)?.[1];
      if (color) next.color = color.toUpperCase();
      if (!color && !size) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} has an unsupported font declaration.`, { annotationId, token });
    }
    stack.push(next);
  }
  if (stack.length !== 1) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} has unbalanced formatting tags.`, { annotationId });
  return runs;
}

function bodyFromParagraphs(
  paragraphs: Array<{ tagged_text: string }>,
  container: Element,
  annotationId: string,
  marker: 'annotationRef' | 'footnoteRef',
): AnnotationParagraph[] {
  if (paragraphs.length === 0) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} has no admitted paragraphs.`, { annotationId });
  const sourceParagraphs = Array.from(container.getElementsByTagNameNS(OOXML.W_NS, W.p)) as Element[];
  return paragraphs.map((paragraph, paragraphIndex) => {
    const parsed = parseTaggedRuns(paragraph.tagged_text, annotationId);
    const sourceParagraph = sourceParagraphs[paragraphIndex];
    if (!sourceParagraph) return { runs: parsed };
    const spans: Array<{ start: number; end: number; styleId?: string; fontSizeHalfPoints?: number }> = [];
    let offset = 0;
    for (const run of Array.from(sourceParagraph.getElementsByTagNameNS(OOXML.W_NS, W.r)) as Element[]) {
      if (run.getElementsByTagNameNS(OOXML.W_NS, marker).length > 0) continue;
      const text = Array.from(run.getElementsByTagNameNS(OOXML.W_NS, W.t)).map((node) => (node as Element).textContent ?? '').join('');
      if (!text) continue;
      const rStyle = Array.from(run.getElementsByTagNameNS(OOXML.W_NS, W.rStyle))[0] as Element | undefined;
      const styleId = rStyle?.getAttributeNS(OOXML.W_NS, W.val) ?? rStyle?.getAttribute('w:val') ?? undefined;
      const size = Array.from(run.getElementsByTagNameNS(OOXML.W_NS, 'sz'))[0] as Element | undefined;
      const rawSize = size?.getAttributeNS(OOXML.W_NS, W.val) ?? size?.getAttribute('w:val') ?? undefined;
      const fontSizeHalfPoints = rawSize && /^\d+$/u.test(rawSize) ? Number(rawSize) : undefined;
      spans.push({ start: offset, end: offset + text.length, ...(styleId ? { styleId } : {}), ...(fontSizeHalfPoints ? { fontSizeHalfPoints } : {}) });
      offset += text.length;
    }
    const runs: AnnotationRun[] = [];
    let parsedOffset = 0;
    for (const run of parsed) {
      let consumed = 0;
      while (consumed < run.text.length) {
        const position = parsedOffset + consumed;
        const span = spans.find((candidate) => candidate.start <= position && candidate.end > position);
        const length = Math.min(run.text.length - consumed, span ? span.end - position : run.text.length - consumed);
        const text = run.text.slice(consumed, consumed + length);
        const style = {
          ...(run.style ?? {}),
          ...(span?.styleId ? { styleId: span.styleId } : {}),
          ...(span?.fontSizeHalfPoints ? { fontSizeHalfPoints: span.fontSizeHalfPoints } : {}),
        };
        runs.push({ text, ...(Object.keys(style).length ? { style } : {}) });
        consumed += length;
      }
      parsedOffset += run.text.length;
    }
    return { runs };
  });
}

function assertNamedStyle(styles: StylesModel, styleId: string, annotationId: string): void {
  const seen = new Set<string>();
  let current: string | null = styleId;
  while (current) {
    if (seen.has(current)) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} uses cyclic run style ${styleId}.`, { annotationId, styleId, reason: 'cyclic-style' });
    seen.add(current);
    const style = styles.byId.get(current);
    if (!style) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} references missing run style ${current}.`, { annotationId, styleId: current, reason: 'missing-style' });
    if (style.styleType !== 'character') throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} references non-character run style ${current}.`, { annotationId, styleId: current, styleType: style.styleType, reason: 'non-character-style' });
    current = style.basedOn;
  }
}

function assertAdmittedAnnotationElement(container: Element, annotationId: string, marker: 'annotationRef' | 'footnoteRef', styles: StylesModel): void {
  const admitted = new Set(['p', 'pPr', 'pStyle', 'r', 'rPr', 't', marker, 'b', 'i', 'u', 'color', 'highlight', 'rStyle', 'vertAlign', 'sz']);
  for (const node of Array.from(container.getElementsByTagNameNS(OOXML.W_NS, '*'))) {
    const element = node as Element;
    let formattingOwner = element.parentNode as Element | null;
    while (formattingOwner && formattingOwner !== container && formattingOwner.localName !== W.r && formattingOwner.localName !== W.p) {
      formattingOwner = formattingOwner.parentNode as Element | null;
    }
    const harmlessComplexScriptFallback = element.localName === 'szCs'
      && (formattingOwner?.localName === W.r || formattingOwner?.localName === W.p)
      && !/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(formattingOwner.textContent ?? '');
    if (!admitted.has(element.localName) && !harmlessComplexScriptFallback) {
      throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} contains unsupported w:${element.localName}.`, { annotationId, element: `w:${element.localName}` });
    }
    if (element.localName === W.rPr) {
      const run = element.parentNode as Element | null;
      const markerRun = Boolean(run?.getElementsByTagNameNS(OOXML.W_NS, marker).length);
      for (const property of Array.from(element.childNodes).filter((child) => child.nodeType === 1) as Element[]) {
        const allowed = ['b', 'i', 'u', 'color', 'highlight', 'sz'];
        const nonApplicableFallback = property.localName === 'szCs'
          && !/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(run?.textContent ?? '');
        if (property.localName === W.rStyle && !markerRun) {
          const styleId = property.getAttributeNS(OOXML.W_NS, W.val) ?? property.getAttribute('w:val');
          if (!styleId) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} has an empty run style reference.`, { annotationId, reason: 'missing-style-id' });
          assertNamedStyle(styles, styleId, annotationId);
        } else if (!allowed.includes(property.localName) && !nonApplicableFallback && !(markerRun && ['rStyle', 'vertAlign'].includes(property.localName))) {
          throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} contains unsupported run property w:${property.localName}.`, { annotationId, element: `w:${property.localName}` });
        }
      }
    }
  }
}

function elementByWordId(document: Document | null, localName: string, id: number): Element | null {
  if (!document) return null;
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, localName))
    .find((element) => Number((element as Element).getAttributeNS(OOXML.W_NS, 'id') ?? (element as Element).getAttribute('w:id')) === id) as Element | undefined ?? null;
}

function anchorAttributes(prefix: 'source-' | '', anchor: AnnotationAnchor): string[] {
  const kindName = prefix ? 'source-kind' : 'anchor-kind';
  const paragraphName = prefix ? 'source-paragraph' : 'paragraph';
  const offsetName = prefix ? 'source-offset' : 'offset';
  const start = anchor.kind === 'point' ? anchor.point : anchor.start;
  const attributes = [`${kindName}="${anchor.kind}"`, `${paragraphName}="${escapeAttribute(start.paragraphId)}"`, `${offsetName}=${start.offset}`];
  if (anchor.kind === 'range') {
    attributes.push(`${prefix ? 'source-end-paragraph' : 'end-paragraph'}="${escapeAttribute(anchor.end.paragraphId)}"`);
    attributes.push(`${prefix ? 'source-end-offset' : 'end-offset'}=${anchor.end.offset}`);
  }
  return attributes;
}

function annotationMarkdoc(annotation: CanonicalAnnotation): string[] {
  const attributes = [
    `id="${escapeAttribute(annotation.id)}"`,
    `audience="${annotation.audience}"`,
    `role="${annotation.semanticRole}"`,
    `source-presentation="${annotation.sourcePresentation}"`,
    ...anchorAttributes('source-', annotation.sourceAnchor),
    ...anchorAttributes('', annotation.anchor),
    ...(annotation.operationId ? [`operation="${escapeAttribute(annotation.operationId)}"`] : []),
    ...(annotation.author ? [`author="${escapeAttribute(annotation.author)}"`] : []),
    ...(annotation.initials ? [`initials="${escapeAttribute(annotation.initials)}"`] : []),
    ...(annotation.date ? [`date="${escapeAttribute(annotation.date)}"`] : []),
    ...(annotation.replyParentId ? [`reply-parent="${escapeAttribute(annotation.replyParentId)}"`] : []),
    ...(annotation.presentation ? [`presentation="${annotation.presentation}"`] : []),
  ];
  const lines = [`{% annotation ${attributes.join(' ')} %}`];
  for (const paragraph of annotation.body) {
    const content: string[] = [];
    for (const run of paragraph.runs) {
      const style = run.style;
      if (!style || Object.keys(style).length === 0) content.push(escapeText(run.text));
      else {
        const styleAttributes = [
          ...(style.styleId ? [`style="${escapeAttribute(style.styleId)}"`] : []),
          ...(style.fontSizeHalfPoints ? [`size=${style.fontSizeHalfPoints}`] : []),
          ...(style.bold ? ['bold=true'] : []), ...(style.italic ? ['italic=true'] : []), ...(style.underline ? ['underline=true'] : []),
          ...(style.color ? [`color="${style.color}"`] : []), ...(style.highlight ? [`highlight="${style.highlight}"`] : []),
        ];
        content.push(`{% annotation-run ${styleAttributes.join(' ')} %}${escapeText(run.text)}{% /annotation-run %}`);
      }
    }
    lines.push('{% annotation-p %}', content.join(''), '{% /annotation-p %}');
  }
  lines.push('{% /annotation %}', '');
  return lines;
}

export async function importDocxToMarkdoc(source: Buffer): Promise<ImportResult> {
  const document = await DocxDocument.load(source);
  const attachmentId = sha256(source).slice(0, 16);
  document.insertParagraphBookmarks(attachmentId);
  const anchoredSource = (await document.toBuffer({ cleanBookmarks: false })).buffer;
  const anchored = await DocxDocument.load(anchoredSource);
  const { nodes } = anchored.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
  const descriptor = { sha256: sha256(anchoredSource), paragraphs: nodes.length };
  const lines = [`{% source sha256="${descriptor.sha256}" paragraphs=${nodes.length} /%}`, ''];
  for (const node of nodes) {
    const text = node.raw_text ?? node.text;
    lines.push(
      `{% para id="${escapeAttribute(node.id)}" fingerprint="${computeContentFingerprint(text)}" style="${escapeAttribute(node.paragraph_style_id ?? node.style)}" %}`,
      escapeText(text),
      '{% /para %}',
      '',
    );
  }
  const annotations: CanonicalAnnotation[] = [];
  const styles = anchored.getStylesModel();
  const [commentsXml, footnotesXml] = await Promise.all([anchored.getCommentsXmlClone(), anchored.getFootnotesXmlClone()]);
  const comments = await anchored.getComments();
  const importedCommentIds = new Set<number>();
  const addCommentTree = (comment: (typeof comments)[number], parent: CanonicalAnnotation | undefined): void => {
    const id = `comment:${comment.id}`;
    if (importedCommentIds.has(comment.id)) {
      throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Comment ${comment.id} appears more than once in reply topology.`, { annotationId: id, topology: 'duplicate-or-cycle' });
    }
    importedCommentIds.add(comment.id);
    const commentElement = elementByWordId(commentsXml, W.comment, comment.id);
    if (!commentElement) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Comment ${comment.id} has no definition.`, { annotationId: id });
    assertAdmittedAnnotationElement(commentElement, id, 'annotationRef', styles);
    let anchor: AnnotationAnchor;
    if (parent) anchor = parent.anchor;
    else {
      if (!comment.anchoredParagraphId || comment.startTextOffset === undefined || !comment.endParagraphId || comment.endTextOffset === undefined) {
        throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Comment ${comment.id} has unresolved anchor geometry.`, { annotationId: id });
      }
      anchor = comment.anchoredParagraphId === comment.endParagraphId && comment.startTextOffset === comment.endTextOffset
        ? { kind: 'point', point: { paragraphId: comment.anchoredParagraphId, offset: comment.startTextOffset } }
        : { kind: 'range', start: { paragraphId: comment.anchoredParagraphId, offset: comment.startTextOffset }, end: { paragraphId: comment.endParagraphId, offset: comment.endTextOffset } };
    }
    const annotation: CanonicalAnnotation = {
      id,
      body: bodyFromParagraphs(comment.paragraphs, commentElement, id, 'annotationRef'),
      author: comment.author || undefined,
      initials: comment.initials || undefined,
      date: comment.date || undefined,
      ...(parent ? { replyParentId: parent.id } : {}),
      audience: 'unspecified', semanticRole: 'unspecified', sourcePresentation: 'comment', sourceAnchor: anchor, anchor,
    };
    annotations.push(annotation);
    for (const reply of comment.replies) addCommentTree(reply, annotation);
  };
  for (const comment of comments) addCommentTree(comment, undefined);
  const definedCommentIds = commentsXml
    ? Array.from(commentsXml.getElementsByTagNameNS(OOXML.W_NS, W.comment))
      .map((element) => Number((element as Element).getAttributeNS(OOXML.W_NS, 'id') ?? (element as Element).getAttribute('w:id')))
      .filter(Number.isInteger)
    : [];
  if (importedCommentIds.size !== definedCommentIds.length) {
    const missing = definedCommentIds.find((id) => !importedCommentIds.has(id));
    throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Comment reply topology is orphaned or cyclic at comment ${missing ?? 'unknown'}.`, {
      annotationId: missing === undefined ? 'comment:unknown' : `comment:${missing}`,
      topology: 'orphan-or-cycle',
    });
  }
  for (const footnote of await anchored.getFootnotes()) {
    const id = `footnote:${footnote.id}`;
    // Some Word templates retain an empty, unreferenced placeholder definition.
    // It carries no negotiation content or body anchor and is not a user note.
    if (footnote.referencePoints.length === 0 && footnote.text.length === 0) continue;
    const footnoteElement = elementByWordId(footnotesXml, W.footnote, footnote.id);
    if (!footnoteElement) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Footnote ${footnote.id} has no definition.`, { annotationId: id });
    assertAdmittedAnnotationElement(footnoteElement, id, 'footnoteRef', styles);
    if (footnote.referencePoints.length !== 1) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Footnote ${footnote.id} must have exactly one reference.`, { annotationId: id, referenceCount: footnote.referencePoints.length });
    const reference = footnote.referencePoints[0]!;
    const anchor: AnnotationAnchor = { kind: 'point', point: { paragraphId: reference.paragraphId, offset: reference.textOffset } };
    annotations.push({
      id, body: bodyFromParagraphs(footnote.paragraphs, footnoteElement, id, 'footnoteRef'), audience: 'unspecified', semanticRole: 'substantive-footnote',
      sourcePresentation: 'footnote', sourceAnchor: anchor, anchor,
    });
  }
  for (const annotation of annotations) lines.push(...annotationMarkdoc(annotation));
  return { anchoredSource, markdoc: `${lines.join('\n').trimEnd()}\n`, source: descriptor, annotations };
}
