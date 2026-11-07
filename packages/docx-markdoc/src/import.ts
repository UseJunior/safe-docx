import {
  DocxDocument,
  OOXML,
  buildParagraphIndex,
  W,
  ZIP_EPOCH,
  computeContentFingerprint,
  parseRelationshipEntries,
  type StylesModel,
} from '@usejunior/docx-core';
import { sha256 } from './hash.js';
import { DocxMarkdocError } from './errors.js';
import { anchorSelectedStories, selectedStories } from './story-inventory.js';
import type { AnnotationAnchor, AnnotationParagraph, AnnotationRun, AnnotationRunStyle, CanonicalAnnotation, ImportResult } from './types.js';
import { crossReferenceAttributes, documentBookmarkTargets, paragraphCrossReferences, type BookmarkTarget, type ParagraphCrossReference } from './xref.js';
import type { ImportedCrossReferences } from './types.js';

function escapeText(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_~\[\]{}<>#!])/g, '\\$1')
    .replace(/^(\d+)([.)])/, '$1\\$2')
    .replace(/^([-+])(?=\s|$)/, '\\$1')
    // Escaping the first hyphen prevents a thematic break; no nested escaper.
    .replace(/^(-{3,})$/, '\\$1')
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

/**
 * A paragraph's text with each REF field's cached result wrapped in an
 * `{% xref %}` tag. The text projection of the result is the paragraph's
 * text unchanged, so its fingerprint and offsets stay those of the source.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1260
 */
function textWithCrossReferences(text: string, references: readonly ParagraphCrossReference[]): string {
  if (references.length === 0) return escapeText(text);
  const parts: string[] = [];
  let offset = 0;
  for (const reference of references) {
    if (reference.start > offset) parts.push(escapeText(text.slice(offset, reference.start)));
    parts.push(`{% xref ${crossReferenceAttributes(reference.reference)} %}${escapeText(reference.text)}{% /xref %}`);
    offset = reference.end;
  }
  if (offset < text.length) parts.push(escapeText(text.slice(offset)));
  return parts.join('');
}

/**
 * Escape a value for a double-quoted Markdoc string literal. Markdoc strings
 * are not HTML: entity references pass through verbatim, so `&`, `<`, and `>`
 * must stay raw and only the backslash and the delimiter are escaped.
 *
 * @see #956
 */
function escapeAttribute(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

/**
 * Mark the runs that make up each REF field's cached result, splitting a run
 * at a field boundary, so the note or comment body keeps its cross-references.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1260
 */
function withCrossReferences(runs: AnnotationRun[], references: readonly ParagraphCrossReference[]): AnnotationRun[] {
  if (references.length === 0) return runs;
  const result: AnnotationRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    const cuts = [...new Set([runStart, runEnd, ...references.flatMap((reference) => [reference.start, reference.end])
      .filter((cut) => cut > runStart && cut < runEnd)])].sort((left, right) => left - right);
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const start = cuts[index]!;
      const end = cuts[index + 1]!;
      const ordinal = references.findIndex((reference) => reference.start <= start && end <= reference.end);
      const reference = ordinal === -1 ? undefined : references[ordinal]!;
      result.push({
        ...run,
        text: run.text.slice(start - runStart, end - runStart),
        ...(reference ? { crossReference: { ...reference.reference, field: ordinal } } : {}),
      });
    }
    offset = runEnd;
  }
  return result;
}

function bodyFromParagraphs(
  paragraphs: Array<{ tagged_text: string }>,
  container: Element,
  annotationId: string,
  marker: 'annotationRef' | 'footnoteRef',
  hyperlinks: ReadonlyMap<Element, string>,
  bookmarks: ReadonlyMap<string, BookmarkTarget>,
  report: ImportedCrossReferences,
): AnnotationParagraph[] {
  if (paragraphs.length === 0) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} has no admitted paragraphs.`, { annotationId });
  const sourceParagraphs = Array.from(container.getElementsByTagNameNS(OOXML.W_NS, W.p)) as Element[];
  return paragraphs.map((paragraph, paragraphIndex) => {
    const parsed = parseTaggedRuns(paragraph.tagged_text, annotationId);
    const sourceParagraph = sourceParagraphs[paragraphIndex];
    if (!sourceParagraph) return { runs: parsed };
    const { references, unsupported } = paragraphCrossReferences(sourceParagraph, { bookmarks });
    for (const item of unsupported) report.keptAsText.push({ location: annotationId, instruction: item.instruction, reason: item.reason });
    const spans: Array<{ start: number; end: number; styleId?: string; fontSizeHalfPoints?: number; hyperlinkDestination?: string }> = [];
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
      const parent = run.parentNode as Element | null;
      const hyperlink = parent?.nodeType === 1 && parent.namespaceURI === OOXML.W_NS
        && parent.localName === W.hyperlink ? parent : undefined;
      const hyperlinkDestination = hyperlink ? hyperlinks.get(hyperlink) : undefined;
      spans.push({
        start: offset,
        end: offset + text.length,
        ...(styleId ? { styleId } : {}),
        ...(fontSizeHalfPoints ? { fontSizeHalfPoints } : {}),
        ...(hyperlinkDestination ? { hyperlinkDestination } : {}),
      });
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
        runs.push({
          text,
          ...(Object.keys(style).length ? { style } : {}),
          ...(span?.hyperlinkDestination ? { hyperlink: { destination: span.hyperlinkDestination } } : {}),
        });
        consumed += length;
      }
      parsedOffset += run.text.length;
    }
    if (references.length > 0 && runs.map((run) => run.text).join('') !== buildParagraphIndex(sourceParagraph).text) {
      // The note's text does not line up with its fields: keep them as text, which compile then refuses to rewrite.
      for (const reference of references) report.keptAsText.push({ location: annotationId, instruction: reference.instruction, reason: 'unaligned-text' });
      return { runs };
    }
    report.restored += references.length;
    return { runs: withCrossReferences(runs, references) };
  });
}

/**
 * Complex-script twins of admitted run properties (`w:szCs`, `w:bCs`,
 * `w:iCs`). They format only complex-script text, so on a run without any they
 * change nothing and are admitted; the generator writes `w:bCs`/`w:iCs` beside
 * every `w:b`/`w:i`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.2.39
 */
const COMPLEX_SCRIPT_TWINS: ReadonlySet<string> = new Set(['szCs', 'bCs', 'iCs']);

/**
 * Characters that may be laid out as complex script, where a complex-script
 * twin would apply: right-to-left scripts (Hebrew, Arabic, Syriac, Thaana, NKo
 * and the supplementary right-to-left blocks), the Indic scripts, and the
 * Southeast and Central Asian scripts (Thai, Lao, Tibetan, Myanmar, Khmer,
 * Mongolian, Tai, Balinese and their neighbours). Deliberately broad: a run
 * holding any of them keeps the twin unadmitted, so import fails closed rather
 * than dropping formatting that would show.
 */
const COMPLEX_SCRIPT_TEXT = /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0FFF\u1000-\u109F\u1780-\u18AF\u1900-\u1AAF\u1B00-\u1C4F\uA800-\uABFF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{11000}-\u{11FFF}\u{1E800}-\u{1EFFF}]/u;

/**
 * Drop the space run that Word, `add_footnote`, and generation put between a
 * note's number and its text. It is part of the note's presentation, not of
 * its body: compile writes it again when it re-emits the note, so keeping it
 * in the body would double it on every round trip. Only a run holding exactly
 * one space, the first text after the `w:footnoteRef` mark, is that separator.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.13
 */
function withoutMarkSeparatorSpace(body: AnnotationParagraph[], footnoteElement: Element): AnnotationParagraph[] {
  const firstParagraph = footnoteElement.getElementsByTagNameNS(OOXML.W_NS, W.p).item(0);
  if (!firstParagraph) return body;
  const runs = Array.from(firstParagraph.getElementsByTagNameNS(OOXML.W_NS, W.r)) as Element[];
  const markIndex = runs.findIndex((run) => run.getElementsByTagNameNS(OOXML.W_NS, W.footnoteRef).length > 0);
  const firstText = runs.slice(markIndex + 1).find((run) => run.getElementsByTagNameNS(OOXML.W_NS, W.t).length > 0);
  const separatorText = firstText ? Array.from(firstText.getElementsByTagNameNS(OOXML.W_NS, W.t)).map((t) => (t as Element).textContent ?? '').join('') : '';
  const leading = body[0]?.runs[0];
  if (markIndex === -1 || separatorText !== ' ' || !leading?.text.startsWith(' ')) return body;
  const rest = leading.text.slice(1);
  const runsAfter = rest ? [{ ...leading, text: rest }, ...body[0]!.runs.slice(1)] : body[0]!.runs.slice(1);
  return [{ ...body[0]!, runs: runsAfter }, ...body.slice(1)];
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

/**
 * The only complex fields an annotation body may hold are REF fields (a
 * generated cross-reference in a footnote); they import as `{% xref %}` tags
 * over their cached result text (#1260). Any other field, a nested field, a
 * second separator, instruction text in a result, or a field left open stays
 * unsupported.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 * @see https://github.com/UseJunior/safe-docx/issues/1236
 */
function assertOnlyReferenceFields(container: Element, annotationId: string): void {
  // The field's phase: its instruction (begin → separate), then its result (separate → end).
  let field: { instruction: string; phase: 'instruction' | 'result' } | null = null;
  const unsupported = (element: string, detail: string) => new DocxMarkdocError(
    'ANNOTATION_IMPORT_UNSUPPORTED',
    `Annotation ${annotationId} contains unsupported ${element} (${detail}).`,
    { annotationId, element, reason: 'unsupported-field' },
  );
  const assertReference = (instruction: string) => {
    if (instruction.trim().split(/\s+/u)[0] !== 'REF') throw unsupported('w:fldChar', `a field other than REF: ${instruction.trim()}`);
  };
  for (const node of Array.from(container.getElementsByTagNameNS(OOXML.W_NS, '*'))) {
    const element = node as Element;
    if (element.localName === 'instrText') {
      // Instruction text outside a field's instruction is ordinary text to Word (§ 17.16.23), which the
      // annotation reader would drop, so it is refused rather than lost.
      if (field?.phase !== 'instruction') throw unsupported('w:instrText', 'outside a field instruction');
      field.instruction += element.textContent ?? '';
    } else if (element.localName === 'fldChar') {
      const type = element.getAttributeNS(OOXML.W_NS, 'fldCharType') ?? element.getAttribute('w:fldCharType');
      if (type === 'begin' && field === null) {
        field = { instruction: '', phase: 'instruction' };
      } else if (type === 'separate' && field?.phase === 'instruction') {
        assertReference(field.instruction);
        field.phase = 'result';
      } else if (type === 'end' && field !== null) {
        if (field.phase === 'instruction') assertReference(field.instruction);
        field = null;
      } else {
        throw unsupported('w:fldChar', `an unbalanced field character ${type ?? ''}`.trim());
      }
    }
  }
  if (field !== null) throw unsupported('w:fldChar', 'a field without an end');
}

/**
 * Validate the admitted annotation-body subset and resolve each external link
 * against the relationship part owned by the annotation source part.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.2.3
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @see #956
 */
function assertAdmittedAnnotationElement(
  container: Element,
  annotationId: string,
  marker: 'annotationRef' | 'footnoteRef',
  styles: StylesModel,
  relationshipsDocument: Document | null,
): Map<Element, string> {
  const admitted = new Set(['p', 'pPr', 'pStyle', 'r', 'rPr', 't', marker, 'b', 'i', 'u', 'color', 'highlight', 'rStyle', 'vertAlign', 'sz', 'hyperlink', 'fldChar', 'instrText']);
  assertOnlyReferenceFields(container, annotationId);
  const relationships = parseRelationshipEntries(relationshipsDocument);
  const resolvedHyperlinks = new Map<Element, string>();
  for (const node of Array.from(container.getElementsByTagNameNS(OOXML.W_NS, '*'))) {
    const element = node as Element;
    let formattingOwner = element.parentNode as Element | null;
    while (formattingOwner && formattingOwner !== container && formattingOwner.localName !== W.r && formattingOwner.localName !== W.p) {
      formattingOwner = formattingOwner.parentNode as Element | null;
    }
    const harmlessComplexScriptFallback = COMPLEX_SCRIPT_TWINS.has(element.localName)
      && (formattingOwner?.localName === W.r || formattingOwner?.localName === W.p)
      && !COMPLEX_SCRIPT_TEXT.test(formattingOwner.textContent ?? '');
    if (!admitted.has(element.localName) && !harmlessComplexScriptFallback) {
      throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} contains unsupported w:${element.localName}.`, { annotationId, element: `w:${element.localName}` });
    }
    if (element.localName === W.hyperlink) {
      const anchor = element.getAttributeNS(OOXML.W_NS, 'anchor') ?? element.getAttribute('w:anchor');
      if (anchor) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} contains an unsupported internal hyperlink anchor.`, { annotationId, element: 'w:hyperlink', reason: 'internal-anchor', anchor });
      const unsupportedAttribute = Array.from(element.attributes).find((attribute) =>
        !(attribute.namespaceURI === OOXML.R_NS && attribute.localName === 'id')
        && !(attribute.namespaceURI === OOXML.W_NS && attribute.localName === 'history')
        && attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/',
      );
      if (unsupportedAttribute) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} hyperlink contains unsupported attribute ${unsupportedAttribute.name}.`, { annotationId, element: 'w:hyperlink', reason: 'unsupported-hyperlink-attribute', attribute: unsupportedAttribute.name });
      const directChildren = Array.from(element.childNodes).filter((child) => child.nodeType === 1) as Element[];
      const unsupportedChild = directChildren.find((child) => child.namespaceURI !== OOXML.W_NS || child.localName !== W.r);
      if (unsupportedChild) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} hyperlink contains unsupported ${unsupportedChild.nodeName}.`, { annotationId, element: unsupportedChild.nodeName, reason: 'unsupported-hyperlink-content' });
      if (directChildren.length === 0) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} contains an empty hyperlink wrapper.`, { annotationId, element: 'w:hyperlink', reason: 'empty-hyperlink' });
      const relationshipId = element.getAttributeNS(OOXML.R_NS, 'id') ?? element.getAttribute('r:id');
      if (!relationshipId) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} hyperlink has no relationship ID.`, { annotationId, element: 'w:hyperlink', reason: 'missing-hyperlink-id' });
      const relationship = relationships.get(relationshipId);
      if (!relationship) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} hyperlink relationship ${relationshipId} is dangling.`, { annotationId, element: 'w:hyperlink', reason: 'dangling-hyperlink-relationship', relationshipId });
      if (relationship.type !== OOXML.HYPERLINK_REL_TYPE) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} relationship ${relationshipId} is not a hyperlink relationship.`, { annotationId, element: 'w:hyperlink', reason: 'wrong-hyperlink-relationship-type', relationshipId, relationshipType: relationship.type });
      if (relationship.targetMode !== 'External') throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} hyperlink relationship ${relationshipId} is not external.`, { annotationId, element: 'w:hyperlink', reason: 'non-external-hyperlink', relationshipId, targetMode: relationship.targetMode ?? 'Internal' });
      if (!relationship.target) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Annotation ${annotationId} hyperlink relationship ${relationshipId} has no target.`, { annotationId, element: 'w:hyperlink', reason: 'missing-hyperlink-target', relationshipId });
      resolvedHyperlinks.set(element, relationship.target);
    }
    if (element.localName === W.rPr) {
      const run = element.parentNode as Element | null;
      const markerRun = Boolean(run?.getElementsByTagNameNS(OOXML.W_NS, marker).length);
      for (const property of Array.from(element.childNodes).filter((child) => child.nodeType === 1) as Element[]) {
        const allowed = ['b', 'i', 'u', 'color', 'highlight', 'sz'];
        const nonApplicableFallback = COMPLEX_SCRIPT_TWINS.has(property.localName)
          && !COMPLEX_SCRIPT_TEXT.test(run?.textContent ?? '');
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
  return resolvedHyperlinks;
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
    ...(annotation.operationId ? [`edit="${escapeAttribute(annotation.operationId)}"`] : []),
    ...(annotation.author ? [`author="${escapeAttribute(annotation.author)}"`] : []),
    ...(annotation.initials ? [`initials="${escapeAttribute(annotation.initials)}"`] : []),
    ...(annotation.date ? [`date="${escapeAttribute(annotation.date)}"`] : []),
    ...(annotation.replyParentId ? [`reply-parent="${escapeAttribute(annotation.replyParentId)}"`] : []),
    ...(annotation.presentation ? [`presentation="${annotation.presentation}"`] : []),
  ];
  const lines = [`{% annotation ${attributes.join(' ')} %}`];
  for (const paragraph of annotation.body) {
    const content: string[] = [];
    paragraph.runs.forEach((run, index) => {
      const reference = run.crossReference;
      const previous = paragraph.runs[index - 1]?.crossReference;
      const next = paragraph.runs[index + 1]?.crossReference;
      if (reference && previous?.field !== reference.field) content.push(`{% xref ${crossReferenceAttributes(reference)} %}`);
      const style = run.style ?? {};
      if (Object.keys(style).length === 0 && !run.hyperlink) content.push(escapeText(run.text));
      else {
        const styleAttributes = [
          ...(run.hyperlink ? [`href="${escapeAttribute(run.hyperlink.destination)}"`] : []),
          ...(style.styleId ? [`style="${escapeAttribute(style.styleId)}"`] : []),
          ...(style.fontSizeHalfPoints ? [`size=${style.fontSizeHalfPoints}`] : []),
          ...(style.bold ? ['bold=true'] : []), ...(style.italic ? ['italic=true'] : []), ...(style.underline ? ['underline=true'] : []),
          ...(style.color ? [`color="${style.color}"`] : []), ...(style.highlight ? [`highlight="${style.highlight}"`] : []),
        ];
        content.push(`{% annotation-run ${styleAttributes.join(' ')} %}${escapeText(run.text)}{% /annotation-run %}`);
      }
      if (reference && next?.field !== reference.field) content.push('{% /xref %}');
    });
    lines.push('{% annotation-p %}', content.join(''), '{% /annotation-p %}');
  }
  lines.push('{% /annotation %}', '');
  return lines;
}

export async function importDocxToMarkdoc(source: Buffer): Promise<ImportResult> {
  const document = await DocxDocument.load(source);
  const attachmentId = sha256(source).slice(0, 16);
  document.insertParagraphBookmarks(attachmentId);
  // The anchored package is what `source sha256` names and what compile later
  // hashes, so it must depend only on the input bytes: stamp every ZIP entry
  // with a fixed date rather than the wall clock (#1110).
  const bodyAnchored = (await document.toBuffer({ cleanBookmarks: false, fileDate: ZIP_EPOCH })).buffer;
  const anchoredSource = await anchorSelectedStories(bodyAnchored, { fileDate: ZIP_EPOCH });
  const anchored = await DocxDocument.load(anchoredSource);
  const { nodes } = anchored.buildDocumentView({ includeSemanticTags: false, showFormatting: false });
  const descriptor = { sha256: sha256(anchoredSource), paragraphs: nodes.length };
  const lines = [`{% source sha256="${descriptor.sha256}" paragraphs=${nodes.length} /%}`, ''];
  const bookmarks = documentBookmarkTargets(anchored.getDocumentXmlClone());
  const report: ImportedCrossReferences = { restored: 0, keptAsText: [] };
  for (const node of nodes) {
    const text = node.raw_text ?? node.text;
    const element = anchored.getParagraphElementById(node.id);
    const found = element ? paragraphCrossReferences(element, { bookmarks }) : undefined;
    for (const item of found?.unsupported ?? []) report.keptAsText.push({ location: node.id, instruction: item.instruction, reason: item.reason });
    let references = found?.references ?? [];
    if (references.length > 0 && found?.index.text !== text) {
      // Fields that do not line up with the view's text stay text; compile then refuses to edit the paragraph.
      for (const reference of references) report.keptAsText.push({ location: node.id, instruction: reference.instruction, reason: 'unaligned-text' });
      references = [];
    }
    report.restored += references.length;
    lines.push(
      `{% para id="${escapeAttribute(node.id)}" fingerprint="${computeContentFingerprint(text)}" style="${escapeAttribute(node.paragraph_style_id ?? node.style)}" %}`,
      textWithCrossReferences(text, references),
      '{% /para %}',
      '',
    );
  }
  for (const story of await selectedStories(anchoredSource)) {
    lines.push(
      `{% story id="${story.id}" kind="${story.kind}" bindings="${story.bindings.join(',')}" fingerprint="${story.fingerprint}" paragraphs=${story.paragraphs} readonly=${story.readOnlyParagraphs} /%}`,
      '',
    );
    for (const block of story.blocksInOrder) {
      if (block.kind === 'readonly') {
        const paragraph = block.paragraph;
        lines.push(
          `{% readonly story="${story.id}" ordinal=${paragraph.ordinal} fingerprint="${paragraph.fingerprint}" reason="${escapeAttribute(paragraph.reason)}" %}`,
          escapeText(paragraph.text),
          '{% /readonly %}',
          '',
        );
        continue;
      }
      const paragraph = block.paragraph;
      if (!paragraph.id) throw new DocxMarkdocError('STORY_ANCHOR_UNAVAILABLE', `Admitted story paragraph in ${story.id} has no operative anchor.`);
      lines.push(
        `{% para story="${story.id}" id="${escapeAttribute(paragraph.id)}" fingerprint="${computeContentFingerprint(paragraph.text)}" style="${escapeAttribute(paragraph.style)}" %}`,
        escapeText(paragraph.text),
        '{% /para %}',
        '',
      );
    }
  }
  const annotations: CanonicalAnnotation[] = [];
  const styles = anchored.getStylesModel();
  const [commentsXml, footnotesXml, commentsRelationships, footnotesRelationships] = await Promise.all([
    anchored.getCommentsXmlClone(),
    anchored.getFootnotesXmlClone(),
    anchored.getPartRelationshipsXmlClone('word/comments.xml'),
    anchored.getPartRelationshipsXmlClone('word/footnotes.xml'),
  ]);
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
    const hyperlinks = assertAdmittedAnnotationElement(commentElement, id, 'annotationRef', styles, commentsRelationships);
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
      body: bodyFromParagraphs(comment.paragraphs, commentElement, id, 'annotationRef', hyperlinks, bookmarks, report),
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
    const hyperlinks = assertAdmittedAnnotationElement(footnoteElement, id, 'footnoteRef', styles, footnotesRelationships);
    if (footnote.referencePoints.length !== 1) throw new DocxMarkdocError('ANNOTATION_IMPORT_UNSUPPORTED', `Footnote ${footnote.id} must have exactly one reference.`, { annotationId: id, referenceCount: footnote.referencePoints.length });
    const reference = footnote.referencePoints[0]!;
    const anchor: AnnotationAnchor = { kind: 'point', point: { paragraphId: reference.paragraphId, offset: reference.textOffset } };
    annotations.push({
      id, body: withoutMarkSeparatorSpace(bodyFromParagraphs(footnote.paragraphs, footnoteElement, id, 'footnoteRef', hyperlinks, bookmarks, report), footnoteElement), audience: 'unspecified', semanticRole: 'substantive-footnote',
      sourcePresentation: 'footnote', sourceAnchor: anchor, anchor,
    });
  }
  for (const annotation of annotations) lines.push(...annotationMarkdoc(annotation));
  return { anchoredSource, markdoc: `${lines.join('\n').trimEnd()}\n`, source: descriptor, annotations, crossReferences: report };
}
