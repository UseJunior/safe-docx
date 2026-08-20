import { OOXML, W } from './namespaces.js';
import { SafeDocxError } from './errors.js';
import { getFirstChild } from './xml-helpers.js';
import {
  buildRPrChangeElement,
  createRevisionContainer,
  prepareElementForDeletion,
  type RevisionContext,
} from './track-changes-emitter.js';
import { buildParagraphIndex } from './paragraph-index.js';

export type TextRun = {
  r: Element; // w:r
  text: string; // visible text for this run (field-code aware)
  isFieldResult: boolean;
  fieldResultId?: number | null; // paragraph-local identity for one complex field
  fieldInstruction?: string | null;
};

/**
 * Return the paragraph's visible runs while retaining enough complex-field
 * provenance to distinguish a safe cached-result edit from a field-boundary
 * rewrite.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @see #651
 */
export function getParagraphRuns(p: Element): TextRun[] {
  return buildParagraphIndex(p).runs
    .filter((run) => run.visibleText.length > 0)
    .map((run) => ({
      r: run.element,
      text: run.visibleText,
      isFieldResult: run.isFieldResult,
      fieldResultId: run.fieldResultId,
      fieldInstruction: run.fieldInstruction,
    }));
}

export function getParagraphText(p: Element): string {
  return getParagraphRuns(p)
    .map((tr) => tr.text)
    .join('');
}

function findOffsetInRuns(runs: TextRun[], start: number, end: number): {
  startRunIdx: number;
  startOffset: number;
  endRunIdx: number;
  endOffset: number;
} {
  // Map [start, end) in concatenated string to run index + offset.
  let pos = 0;
  let startRunIdx = -1;
  let endRunIdx = -1;
  let startOffset = 0;
  let endOffset = 0;

  for (let i = 0; i < runs.length; i++) {
    const len = runs[i]!.text.length;
    const nextPos = pos + len;
    const startIsInRun = start === end
      ? start <= nextPos
      : start < nextPos;
    if (startRunIdx === -1 && start >= pos && startIsInRun) {
      startRunIdx = i;
      startOffset = start - pos;
    }
    if (endRunIdx === -1 && end > pos && end <= nextPos) {
      endRunIdx = i;
      endOffset = end - pos;
      break;
    }
    pos = nextPos;
  }

  if (start === end && startRunIdx !== -1) {
    endRunIdx = startRunIdx;
    endOffset = startOffset;
  }

  if (startRunIdx === -1 || endRunIdx === -1) {
    throw new Error('Offset mapping failed');
  }
  return { startRunIdx, startOffset, endRunIdx, endOffset };
}

function isW(el: Element | null, localName: string): boolean {
  return !!el && el.namespaceURI === OOXML.W_NS && el.localName === localName;
}

function setXmlSpacePreserveIfNeeded(t: Element, text: string): void {
  // OOXML needs xml:space="preserve" when leading/trailing spaces exist.
  if (!text) return;
  if (text.startsWith(' ') || text.endsWith(' ')) {
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  }
}

function cloneRunFormattingOnly(doc: Document, sourceRun: Element): Element {
  const r = doc.createElementNS(OOXML.W_NS, 'w:r');
  // Copy rPr if present (direct child).
  for (const child of Array.from(sourceRun.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (isW(el, W.rPr)) {
      r.appendChild(cloneRPrWithoutChangeRecords(doc, el));
      break;
    }
  }
  return r;
}

function cloneRPrWithoutChangeRecords(doc: Document, rPr: Element): Element {
  const clone = doc.createElementNS(OOXML.W_NS, `w:${W.rPr}`);
  for (const child of Array.from(rPr.childNodes)) {
    if (child.nodeType === 1 && isW(child as Element, 'rPrChange')) continue;
    clone.appendChild(child.cloneNode(true));
  }
  return clone;
}

function appendTextToRun(doc: Document, run: Element, text: string): void {
  // Convert \t and \n to OOXML equivalents where possible.
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const t = doc.createElementNS(OOXML.W_NS, 'w:t');
    setXmlSpacePreserveIfNeeded(t, buf);
    t.appendChild(doc.createTextNode(buf));
    run.appendChild(t);
    buf = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\t') {
      flush();
      run.appendChild(doc.createElementNS(OOXML.W_NS, 'w:tab'));
      continue;
    }
    if (ch === '\n') {
      flush();
      run.appendChild(doc.createElementNS(OOXML.W_NS, 'w:br'));
      continue;
    }
    buf += ch;
  }
  flush();
}


export function visibleLengthForEl(el: Element): number {
  if (el.namespaceURI !== OOXML.W_NS) return 0;
  if (el.localName === W.t) return (el.textContent ?? '').length;
  if (el.localName === W.tab) return 1;
  if (el.localName === W.br) return 1;
  return 0;
}

export function getDirectContentElements(run: Element): Element[] {
  // Direct children excluding rPr; preserves unknown nodes without duplicating them on splits.
  const out: Element[] = [];
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.namespaceURI !== OOXML.W_NS) continue;
    if (el.localName === W.rPr) continue;
    out.push(el);
  }
  return out;
}

export function splitRunAtVisibleOffset(run: Element, offset: number): { left: Element; right: Element } {
  const doc = run.ownerDocument;
  if (!doc) throw new Error('Run has no ownerDocument');

  const parent = run.parentNode;
  if (!parent) throw new Error('Run has no parent');

  const right = run.cloneNode(true) as Element;
  parent.insertBefore(right, run.nextSibling);

  const leftContent = getDirectContentElements(run);
  const rightContent = getDirectContentElements(right);

  let pos = 0;
  for (let i = 0; i < leftContent.length; i++) {
    const lEl = leftContent[i]!;
    const rEl = rightContent[i]!;
    const len = visibleLengthForEl(lEl);

    if (len === 0) {
      // Zero-length nodes (proofing, field markers, etc.) should not be duplicated. Keep them on the side
      // determined by the current visible position.
      if (pos < offset) rEl.parentNode?.removeChild(rEl);
      else lEl.parentNode?.removeChild(lEl);
      continue;
    }

    const start = pos;
    const end = pos + len;

    if (offset <= start) {
      // Entire element is to the right.
      lEl.parentNode?.removeChild(lEl);
      pos += len;
      continue;
    }
    if (offset >= end) {
      // Entire element is to the left.
      rEl.parentNode?.removeChild(rEl);
      pos += len;
      continue;
    }

    // Split inside this element.
    if (isW(lEl, W.t) && isW(rEl, W.t)) {
      const full = lEl.textContent ?? '';
      const leftText = full.slice(0, offset - start);
      const rightText = full.slice(offset - start);

      lEl.textContent = leftText;
      rEl.textContent = rightText;
      setXmlSpacePreserveIfNeeded(lEl, leftText);
      setXmlSpacePreserveIfNeeded(rEl, rightText);

      if (!leftText) lEl.parentNode?.removeChild(lEl);
      if (!rightText) rEl.parentNode?.removeChild(rEl);
    } else {
      // tab/br are length 1 and should not be split; move to the right by default.
      lEl.parentNode?.removeChild(lEl);
    }
    pos += len;
  }

  return { left: run, right };
}

function cleanupEmptyRuns(parent: Node): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (!isW(el, W.r)) continue;

    // Keep run if it has any non-rPr element children.
    let hasContent = false;
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType !== 1) continue;
      const cEl = c as Element;
      if (!isW(cEl, W.rPr)) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) el.parentNode?.removeChild(el);
  }
}

function getRunVisibleLength(run: Element): number {
  return getDirectContentElements(run).reduce((sum, child) => sum + visibleLengthForEl(child), 0);
}

// OOXML embedded run content that references package parts: DrawingML drawing
// (w:drawing), VML picture (w:pict), embedded OLE object (w:object), and
// imported content part (w:contentPart, a CT_Rel relationship reference).
// These carry no visible text length, so a caller-approved text match never
// covers them — a text replacement must not destroy them (issue #739).
const EMBEDDED_CONTENT_LOCALS: ReadonlySet<string> = new Set([
  W.drawing,
  W.pict,
  W.object,
  W.contentPart,
]);

function isEmbeddedContentElement(node: Node): boolean {
  return (
    node.nodeType === 1 &&
    (node as Element).namespaceURI === OOXML.W_NS &&
    EMBEDDED_CONTENT_LOCALS.has((node as Element).localName ?? '')
  );
}

function getEmbeddedContentElements(run: Element): Element[] {
  return getDirectContentElements(run).filter((el) => EMBEDDED_CONTENT_LOCALS.has(el.localName ?? ''));
}

export type AddRunProps = {
  // Additive or subtractive formatting.
  // Set to true to enable, false to explicitly disable/remove.
  bold?: boolean;
  italic?: boolean;
  underline?: boolean | string; // true => "single", false => remove, string => specific w:val
  highlight?: boolean | string; // true => "yellow", false => remove, string => specific w:val
  fontSize?: number; // Half-points (e.g., 24 for 12pt)
  fontName?: string;
  color?: string; // Hex color (e.g., "FF0000")
};

export type ReplacementPart = {
  text: string;
  templateRun?: Element | null;
  addRunProps?: AddRunProps;
  clearHighlight?: boolean;
};

function getDirectChild(parent: Element, localName: string): Element | null {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (isW(el, localName)) return el;
  }
  return null;
}

/**
 * Mark the paragraph mark as deleted when a tracked edit removes the
 * paragraph's entire visible payload. The marker belongs in w:pPr/w:rPr;
 * accepting it removes the paragraph break while the run-level w:del removes
 * the old contents.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/741
 */
function addParagraphMarkDeletion(p: Element, ctx: RevisionContext): void {
  const doc = p.ownerDocument;
  if (!doc) throw new Error('Paragraph has no ownerDocument');

  let pPr = getDirectChild(p, W.pPr);
  if (!pPr) {
    pPr = doc.createElementNS(OOXML.W_NS, `w:${W.pPr}`);
    p.insertBefore(pPr, p.firstChild);
  }

  let rPr = getDirectChild(pPr, W.rPr);
  if (!rPr) {
    rPr = doc.createElementNS(OOXML.W_NS, `w:${W.rPr}`);
    const sectPr = getDirectChild(pPr, 'sectPr');
    const pPrChange = getDirectChild(pPr, 'pPrChange');
    pPr.insertBefore(rPr, sectPr ?? pPrChange);
  }

  if (getDirectChild(rPr, 'del')) return;

  const marker = createRevisionContainer(doc, 'del', ctx);
  const insertionMarker = getDirectChild(rPr, 'ins');
  if (insertionMarker) {
    rPr.insertBefore(marker, insertionMarker.nextSibling);
  } else {
    rPr.insertBefore(marker, rPr.firstChild);
  }
}

// OOXML on/off toggle properties (ECMA-376 ST_OnOff). Absence of w:val means
// "1", and the values "1"/"true"/"on" are equivalent (likewise for the falsy
// triple). We normalize so semantically-identical inputs hash the same.
const W_BOOL_TOGGLES = new Set<string>([
  'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike',
  'outline', 'shadow', 'emboss', 'imprint', 'vanish', 'specVanish',
  'webHidden', 'noProof', 'snapToGrid', 'rtl', 'cs',
]);

function normalizedBoolValAttr(raw: string | null): string {
  const s = raw === null ? '' : raw.trim().toLowerCase();
  if (s === '' || s === '1' || s === 'true' || s === 'on') return '1';
  if (s === '0' || s === 'false' || s === 'off') return '0';
  return s;
}

function rPrComparableSignature(rPr: Element | null): string {
  if (!rPr) return '';

  const nodeSignature = (node: Node): string => {
    // Text nodes inside w:rPr are insignificant whitespace from pretty-printing;
    // the schema only permits element children, so dropping them matches
    // semantics and avoids false positives against re-emitted (whitespace-free)
    // run-property blocks.
    if (node.nodeType !== 1) return '';

    const el = node as Element;
    if (isW(el, 'rPrChange')) return '';

    const isWBoolToggle =
      el.namespaceURI === OOXML.W_NS && W_BOOL_TOGGLES.has(el.localName ?? '');

    const tuples = Array.from(el.attributes).map((attr) => {
      const attrNs = attr.namespaceURI ?? (attr.name.startsWith('w:') ? OOXML.W_NS : '');
      const attrName = attr.name.includes(':') ? attr.name.slice(attr.name.indexOf(':') + 1) : attr.localName;
      let value = attr.value;
      if (isWBoolToggle && attrNs === OOXML.W_NS && attrName === 'val') {
        value = normalizedBoolValAttr(value);
      }
      return [attrNs, attrName, value] as const;
    });

    if (isWBoolToggle && !tuples.some(([ns, name]) => ns === OOXML.W_NS && name === 'val')) {
      tuples.push([OOXML.W_NS, 'val', '1']);
    }

    const attrs = tuples
      .sort(([aNs, aName], [bNs, bName]) => aNs.localeCompare(bNs) || aName.localeCompare(bName))
      .map(([ns, name, value]) => `${ns}:${name}=${value}`)
      .join('|');
    const children = Array.from(el.childNodes).map(nodeSignature).join('');
    return `<${el.namespaceURI ?? ''}:${el.localName} ${attrs}>${children}</${el.namespaceURI ?? ''}:${el.localName}>`;
  };

  return Array.from(rPr.childNodes).map(nodeSignature).join('');
}

function getSnapshotRPr(doc: Document, sourceRPr: Element | null): Element {
  return sourceRPr ? cloneRPrWithoutChangeRecords(doc, sourceRPr) : doc.createElementNS(OOXML.W_NS, `w:${W.rPr}`);
}

function ensureRPr(doc: Document, run: Element): Element {
  const existing = getDirectChild(run, W.rPr);
  if (existing) return existing;
  const rPr = doc.createElementNS(OOXML.W_NS, `w:${W.rPr}`);
  run.insertBefore(rPr, run.firstChild);
  return rPr;
}

function ensureBoolProp(doc: Document, rPr: Element, localName: string, val: boolean): void {
  let el = getFirstChild(rPr, OOXML.W_NS, localName);
  if (val) {
    if (!el) {
      el = doc.createElementNS(OOXML.W_NS, `w:${localName}`);
      rPr.insertBefore(el, rPr.firstChild);
    }
    el.setAttribute('w:val', '1');
  } else if (el) {
    el.parentNode?.removeChild(el);
  }
}

function ensureUnderline(doc: Document, rPr: Element, val: boolean | string): void {
  let el = getFirstChild(rPr, OOXML.W_NS, W.u);
  if (val === false) {
    if (el) el.parentNode?.removeChild(el);
    return;
  }
  if (!el) {
    el = doc.createElementNS(OOXML.W_NS, `w:${W.u}`);
    rPr.insertBefore(el, rPr.firstChild);
  }
  const v = typeof val === 'string' ? val : 'single';
  el.setAttribute('w:val', v);
}

function clearHighlightProp(rPr: Element): void {
  const hs = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.highlight));
  for (const h of hs) h.parentNode?.removeChild(h);
}

function ensureHighlight(doc: Document, rPr: Element, val: boolean | string): void {
  if (val === false) {
    clearHighlightProp(rPr);
    return;
  }
  let el = getFirstChild(rPr, OOXML.W_NS, W.highlight);
  if (!el) {
    el = doc.createElementNS(OOXML.W_NS, `w:${W.highlight}`);
    rPr.insertBefore(el, rPr.firstChild);
  }
  el.setAttribute('w:val', typeof val === 'string' ? val : 'yellow');
}

function ensureSz(doc: Document, rPr: Element, halfPoints: number): void {
  for (const localName of [W.sz, W.szCs]) {
    let el = getFirstChild(rPr, OOXML.W_NS, localName);
    if (!el) {
      el = doc.createElementNS(OOXML.W_NS, `w:${localName}`);
      rPr.insertBefore(el, rPr.firstChild);
    }
    el.setAttributeNS(OOXML.W_NS, 'w:val', Math.round(halfPoints).toString());
  }
}

function ensureColor(doc: Document, rPr: Element, hex: string): void {
  let el = getFirstChild(rPr, OOXML.W_NS, W.color);
  if (!el) {
    el = doc.createElementNS(OOXML.W_NS, `w:${W.color}`);
    rPr.insertBefore(el, rPr.firstChild);
  }
  el.setAttributeNS(OOXML.W_NS, 'w:val', hex.replace('#', ''));
}

function ensureFont(doc: Document, rPr: Element, name: string): void {
  let el = getFirstChild(rPr, OOXML.W_NS, W.rFonts);
  if (!el) {
    el = doc.createElementNS(OOXML.W_NS, `w:${W.rFonts}`);
    rPr.insertBefore(el, rPr.firstChild);
  }
  el.setAttributeNS(OOXML.W_NS, 'w:ascii', name);
  el.setAttributeNS(OOXML.W_NS, 'w:hAnsi', name);
  el.setAttributeNS(OOXML.W_NS, 'w:cs', name);
}

function applyRunProps(doc: Document, run: Element, add: AddRunProps | undefined, clearHighlight: boolean | undefined): void {
  if (!add && !clearHighlight) return;
  const rPr = ensureRPr(doc, run);
  if (clearHighlight) clearHighlightProp(rPr);
  if (!add) return;
  
  if (add.bold !== undefined) ensureBoolProp(doc, rPr, W.b, add.bold);
  if (add.italic !== undefined) ensureBoolProp(doc, rPr, W.i, add.italic);
  if (add.underline !== undefined) ensureUnderline(doc, rPr, add.underline);
  if (add.highlight !== undefined) ensureHighlight(doc, rPr, add.highlight);
  if (add.fontSize !== undefined) ensureSz(doc, rPr, add.fontSize);
  if (add.color !== undefined) ensureColor(doc, rPr, add.color);
  if (add.fontName !== undefined) ensureFont(doc, rPr, add.fontName);
}

type ContainerSegment = {
  parent: Node;
  start: number;
  end: number;
};

function describeRunContainer(node: Node): string {
  if (node.nodeType !== 1) return node.nodeName;
  const el = node as Element;
  if (el.namespaceURI === OOXML.W_NS) return `w:${el.localName}`;
  return el.tagName;
}

function previewContainerText(text: string, start: number, end: number): string {
  const value = text.slice(start, end);
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}

function getContainerBoundaryError(
  runs: readonly TextRun[],
  startRunIdx: number,
  endRunIdx: number,
  start: number,
  end: number,
  fullText: string,
): SafeDocxError | null {
  const segments: ContainerSegment[] = [];
  let runStart = 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const runEnd = runStart + run.text.length;
    if (i >= startRunIdx && i <= endRunIdx) {
      const overlapStart = Math.max(start, runStart);
      const overlapEnd = Math.min(end, runEnd);
      if (overlapEnd > overlapStart) {
        const parent = run.r.parentNode;
        if (!parent) throw new Error('Run has no parent');
        const previous = segments.at(-1);
        if (previous?.parent === parent && previous.end === overlapStart) {
          previous.end = overlapEnd;
        } else {
          segments.push({ parent, start: overlapStart, end: overlapEnd });
        }
      }
    }
    runStart = runEnd;
  }

  if (segments.length <= 1) return null;

  const first = segments[0]!;
  const second = segments[1]!;
  const largest = segments.reduce((best, segment) =>
    segment.end - segment.start > best.end - best.start ? segment : best,
  );
  const boundaryOffset = first.end;
  const firstContainer = describeRunContainer(first.parent);
  const secondContainer = describeRunContainer(second.parent);
  const largestContainer = describeRunContainer(largest.parent);
  const preview = previewContainerText(fullText, largest.start, largest.end);

  return new SafeDocxError(
    'UNSAFE_CONTAINER_BOUNDARY',
    `Edit range [${start}, ${end}) crosses a container boundary at offset ${boundaryOffset} ` +
      `(${firstContainer} → ${secondContainer}). Largest contained sub-span: ` +
      `[${largest.start}, ${largest.end}) in ${largestContainer}, ${JSON.stringify(preview)}.`,
    `Retry with old_string limited to one container, such as the text in range ` +
      `[${largest.start}, ${largest.end}), or make separate edits on each side of offset ${boundaryOffset}.`,
  );
}

/**
 * Replace a visible paragraph range while keeping tracked runs inside their
 * existing run container. In particular, edits wholly inside `w:hyperlink`
 * remain nested there, while cross-container ranges are refused before the
 * DOM is changed.
 *
 * Embedded content (`w:drawing`, `w:pict`, `w:object`, `w:contentPart`)
 * inside the replaced range is preserved as live runs: it contributes no
 * visible text, so no text match ever covers it and no text edit may delete
 * it. Tracked deletions around preserved content are emitted as in-place
 * segments so rejectChanges() restores the original content order exactly.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @see #652
 * @see #741
 * @see #739
 */
export function replaceParagraphTextRange(
  p: Element,
  start: number,
  end: number,
  replacement: string | ReplacementPart[],
  ctx?: RevisionContext,
): void {
  // Replace visible text in [start, end) in paragraph by operating on w:t nodes.
  // Strategy:
  // 1. Build concatenated visible text from visible runs (field-code aware).
  // 2. Map offsets to run index + offset.
  // 3. Split boundary runs so the replace range aligns to run boundaries.
  // 4. Remove the runs in range and insert new run(s) that clone formatting from the
  //    predominant run in the replaced span.
  const doc = p.ownerDocument;
  if (!doc) throw new Error('Paragraph has no ownerDocument');

  const runs = getParagraphRuns(p);
  const fullText = runs.map((r) => r.text).join('');
  if (start < 0 || end < start || end > fullText.length) {
    throw new Error(`Invalid range [${start}, ${end}) for paragraph length ${fullText.length}`);
  }

  const { startRunIdx, startOffset, endRunIdx, endOffset } = findOffsetInRuns(runs, start, end);
  const startRun = runs[startRunIdx]!;
  const endRun = runs[endRunIdx]!;

  const containerBoundaryError = getContainerBoundaryError(
    runs,
    startRunIdx,
    endRunIdx,
    start,
    end,
    fullText,
  );
  if (containerBoundaryError) throw containerBoundaryError;

  // A cached result may span many runs, but every touched run must belong to
  // the same complex field. Moving ordinary text, a field marker, or another
  // field's result across a fldChar boundary would change document semantics.
  const spanRuns = runs.slice(startRunIdx, endRunIdx + 1);
  const fieldRuns = spanRuns.filter((run) => run.isFieldResult);
  if (fieldRuns.length > 0) {
    const fieldIds = new Set(fieldRuns.map((run) => run.fieldResultId));
    const containsInlineFieldMarker = fieldRuns.some((run) =>
      getDirectContentElements(run.r).some((el) => isW(el, W.fldChar)),
    );
    const isOneCompleteResultSpan =
      fieldRuns.length === spanRuns.length &&
      [...fieldIds].every((fieldId) => typeof fieldId === 'number') &&
      fieldIds.size === 1 &&
      !containsInlineFieldMarker;

    if (!isOneCompleteResultSpan) {
      const instructions = new Set(
        fieldRuns
          .map((run) => run.fieldInstruction?.split(/\s+/u)[0])
          .filter((instruction): instruction is string => !!instruction),
      );
      const fieldLabel = instructions.size === 1
        ? `${[...instructions][0]} field result`
        : 'complex field result';
      throw new SafeDocxError(
        'UNSUPPORTED_EDIT',
        `Edit crosses the boundary of a ${fieldLabel}; cached-result edits must stay inside one field.`,
        'Narrow old_string so the changed range is entirely inside one cached field result.',
      );
    }
  }

  // Pick a template run from the span: the run with the largest overlap by visible character count.
  let templateRun: Element = startRun.r;
  let best = -1;
  for (let i = startRunIdx; i <= endRunIdx; i++) {
    const r = runs[i]!;
    const runStart = i === startRunIdx ? startOffset : 0;
    const runEnd = i === endRunIdx ? endOffset : r.text.length;
    const overlap = Math.max(0, runEnd - runStart);
    if (overlap > best) {
      best = overlap;
      templateRun = r.r;
    }
  }

  const parts: ReplacementPart[] = typeof replacement === 'string' ? [{ text: replacement }] : replacement;

  // Split boundary runs so we can remove whole runs cleanly.
  let rangeStartRunEl: Element = startRun.r;
  let rangeEndRunEl: Element = endRun.r;

  if (startRunIdx === endRunIdx) {
    // Single-run replacement: split end first, then start.
    const runLen = startRun.text.length;
    if (endOffset < runLen) {
      const { left } = splitRunAtVisibleOffset(rangeStartRunEl, endOffset);
      rangeStartRunEl = left;
      rangeEndRunEl = left;
    }
    if (startOffset > 0) {
      const { right } = splitRunAtVisibleOffset(rangeStartRunEl, startOffset);
      rangeStartRunEl = right;
      rangeEndRunEl = right;
    }
  } else {
    // Multi-run replacement: split start then end.
    if (startOffset > 0) {
      const { right } = splitRunAtVisibleOffset(rangeStartRunEl, startOffset);
      rangeStartRunEl = right;
    }
    const endLen = endRun.text.length;
    if (endOffset < endLen) {
      const { left } = splitRunAtVisibleOffset(rangeEndRunEl, endOffset);
      rangeEndRunEl = left;
    }
  }

  const parent = rangeStartRunEl.parentNode;
  if (!parent) throw new Error('Run has no parent');
  if (rangeEndRunEl.parentNode !== parent) {
    throw new Error('Container boundary changed while splitting replacement runs');
  }

  const insertBeforeNode = rangeEndRunEl.nextSibling;

  // Remove runs in [rangeStartRunEl, rangeEndRunEl] inclusive (only w:r elements).
  //
  // Embedded content (w:drawing / w:pict / w:object / w:contentPart) has zero
  // visible text length, so the text match the caller approved never covered
  // it. It must survive the replacement as live content (issue #739): an
  // embedded-only run stays in place untouched, and embedded content
  // co-resident with replaced text is split into its own run at the same
  // relative position before the text is removed. Without this, an
  // embedded-only run would be detached here but never recorded
  // (getRunVisibleLength returns 0 for it), so neither the tracked nor the
  // clean branch could re-emit it.
  //
  // When embedded content is preserved, tracked deletions are emitted as
  // IN-PLACE SEGMENTS — one w:del per contiguous stretch of removed text,
  // inserted at that stretch's original position — instead of one terminal
  // w:del after the range. A single terminal w:del would make rejectChanges()
  // restore the removed text AFTER the preserved object, permanently
  // reordering content the user never touched. When no embedded content is
  // involved the historical single-deletion emission is kept unchanged.
  let rangeContainsEmbeddedContent = false;
  for (let node: Node | null = rangeStartRunEl; node; node = node.nextSibling) {
    if (
      node.nodeType === 1 &&
      isW(node as Element, W.r) &&
      getEmbeddedContentElements(node as Element).length > 0
    ) {
      rangeContainsEmbeddedContent = true;
    }
    if (node === rangeEndRunEl) break;
  }

  const removedRuns: Element[] = [];
  let preservedEmbeddedContent = false;

  if (!rangeContainsEmbeddedContent) {
    let cur: Node | null = rangeStartRunEl;
    while (cur) {
      const nextNode: Node | null = cur.nextSibling as Node | null;
      if (cur.nodeType === 1 && isW(cur as Element, W.r)) {
        const runEl = cur as Element;
        runEl.parentNode?.removeChild(runEl);
        if (getRunVisibleLength(runEl) > 0) {
          removedRuns.push(runEl);
        }
      }
      if (cur === rangeEndRunEl) break;
      cur = nextNode;
    }
  } else {
    // The open deletion segment; reset to null whenever preserved embedded
    // content interrupts the removed stretch so the next removed run starts
    // a new w:del at its own position.
    let currentDeletion: Element | null = null;

    const removeRunInPlace = (runEl: Element): void => {
      const parentNode = runEl.parentNode;
      if (!parentNode) return;
      if (ctx && getRunVisibleLength(runEl) > 0) {
        if (!currentDeletion) {
          currentDeletion = createRevisionContainer(doc, 'del', ctx);
          parentNode.insertBefore(currentDeletion, runEl);
        }
        parentNode.removeChild(runEl);
        currentDeletion.appendChild(prepareElementForDeletion(runEl));
      } else {
        parentNode.removeChild(runEl);
      }
    };

    // Split a run holding both text and embedded content into consecutive
    // homogeneous runs (formatting cloned), inserted at the run's position in
    // original child order, so both the preserved content and the removed
    // text keep their exact relative positions.
    const splitMixedRun = (runEl: Element): Array<{ el: Element; embedded: boolean }> => {
      const parentNode = runEl.parentNode;
      if (!parentNode) throw new Error('Run has no parent');
      const pieces: Array<{ el: Element; embedded: boolean }> = [];
      let currentPiece: { el: Element; embedded: boolean } | null = null;
      for (const child of Array.from(runEl.childNodes)) {
        if (child.nodeType === 1 && isW(child as Element, W.rPr)) continue;
        const embedded = isEmbeddedContentElement(child);
        if (!currentPiece || currentPiece.embedded !== embedded) {
          currentPiece = { el: cloneRunFormattingOnly(doc, runEl), embedded };
          pieces.push(currentPiece);
        }
        currentPiece.el.appendChild(child);
      }
      for (const piece of pieces) parentNode.insertBefore(piece.el, runEl);
      parentNode.removeChild(runEl);
      return pieces;
    };

    let cur: Node | null = rangeStartRunEl;
    while (cur) {
      const nextNode: Node | null = cur.nextSibling as Node | null;
      const atRangeEnd = cur === rangeEndRunEl;
      if (cur.nodeType === 1 && isW(cur as Element, W.r)) {
        const runEl = cur as Element;
        const embeddedContent = getEmbeddedContentElements(runEl);
        if (embeddedContent.length === 0) {
          removeRunInPlace(runEl);
        } else if (getRunVisibleLength(runEl) === 0) {
          // Embedded-only run: the replaced text lives entirely in sibling
          // runs. Leave it in the paragraph as-is.
          preservedEmbeddedContent = true;
          currentDeletion = null;
        } else {
          for (const piece of splitMixedRun(runEl)) {
            if (piece.embedded) {
              preservedEmbeddedContent = true;
              currentDeletion = null;
            } else {
              removeRunInPlace(piece.el);
            }
          }
        }
      }
      if (atRangeEnd) break;
      cur = nextNode;
    }
  }

  // Build replacement runs using the same formatting/template logic as the legacy path.
  const replacementRuns: Element[] = [];
  for (const part of parts) {
    const tmpl = part.templateRun ?? templateRun;
    const sourceRPr = getDirectChild(tmpl, W.rPr);
    const sourceRPrSignature = rPrComparableSignature(sourceRPr);
    const newRun = cloneRunFormattingOnly(doc, tmpl);
    applyRunProps(doc, newRun, part.addRunProps, part.clearHighlight);
    const newRPr = getDirectChild(newRun, W.rPr);
    const hasExplicitFormattingMutation = !!part.addRunProps || !!part.clearHighlight;
    if (ctx && hasExplicitFormattingMutation && rPrComparableSignature(newRPr) !== sourceRPrSignature) {
      ensureRPr(doc, newRun).appendChild(buildRPrChangeElement(getSnapshotRPr(doc, sourceRPr), ctx));
    }
    appendTextToRun(doc, newRun, part.text);
    if (getRunVisibleLength(newRun) > 0) {
      replacementRuns.push(newRun);
    }
  }

  if (ctx) {
    if (removedRuns.length > 0) {
      const deletion = createRevisionContainer(doc, 'del', ctx);
      for (const removedRun of removedRuns) {
        deletion.appendChild(prepareElementForDeletion(removedRun));
      }
      parent.insertBefore(deletion, insertBeforeNode);
    }

    if (replacementRuns.length > 0) {
      const insertion = createRevisionContainer(doc, 'ins', ctx);
      for (const replacementRun of replacementRuns) {
        insertion.appendChild(replacementRun);
      }
      parent.insertBefore(insertion, insertBeforeNode);
    }

    // Only delete the paragraph mark when the edit leaves nothing live behind.
    // Preserved embedded content keeps the paragraph meaningful, and merging
    // it into the following paragraph on accept would move the image the user
    // never touched (issue #739).
    if (start === 0 && end === fullText.length && replacementRuns.length === 0 && !preservedEmbeddedContent) {
      addParagraphMarkDeletion(p, ctx);
    }
  } else {
    for (const replacementRun of replacementRuns) {
      parent.insertBefore(replacementRun, insertBeforeNode);
    }
  }

  cleanupEmptyRuns(parent);
}
