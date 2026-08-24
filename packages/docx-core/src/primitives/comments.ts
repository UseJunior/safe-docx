/**
 * comments — OOXML comment insertion, threaded replies, and part bootstrapping.
 *
 * Creates comment XML parts when missing, inserts comment range markers,
 * and supports threaded replies via commentsExtended.xml.
 */

import { createHash } from 'node:crypto';
import { OOXML, W } from './namespaces.js';
import { parseXml, serializeXml } from './xml.js';
import { DocxZip } from './zip.js';
import { getParagraphRuns, getParagraphText, splitRunAtVisibleOffset, type TextRun } from './text.js';
import { getParagraphBookmarkId } from './bookmarks.js';
import { isW } from './dom-helpers.js';
import { buildParagraphIndex, type IndexedParagraphNode, type ParagraphIndex } from './paragraph-index.js';
import { getAttributeSafe } from './xml-helpers.js';
import { getFirstChild } from './xml-helpers.js';
import { extractEffectiveRunFormatting, parseStylesXml, parseThemeXml, type StylesModel, type ThemeModel } from './styles.js';
import { emitFormattingTags, mergeAdjacentTags, type AnnotatedRun } from './formatting_tags.js';
import {
  createRevisionContainer,
  prepareElementForDeletion,
  type RevisionContext,
} from './track-changes-emitter.js';

// ── Relationship types ──────────────────────────────────────────────────

const REL_TYPE_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const REL_TYPE_COMMENTS_EXTENDED = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const REL_TYPE_PEOPLE = 'http://schemas.microsoft.com/office/2011/relationships/people';

// ── Content types ───────────────────────────────────────────────────────

const CT_COMMENTS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const CT_COMMENTS_EXTENDED = 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
const CT_PEOPLE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml';

// XML Namespaces namespace — used when binding/declaring prefixes via setAttributeNS.
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

// ── Minimal XML templates ───────────────────────────────────────────────

const COMMENTS_XML_TEMPLATE =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
  ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
  ` xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>`;

const COMMENTS_EXTENDED_XML_TEMPLATE =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"` +
  ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"/>`;

const PEOPLE_XML_TEMPLATE =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>`;

// ── Helpers ─────────────────────────────────────────────────────────────

function generateParaId(): string {
  // 8-hex-digit random ID used for w14:paraId / w15:paraId
  const val = Math.floor(Math.random() * 0xFFFFFFFF);
  return val.toString(16).toUpperCase().padStart(8, '0');
}

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ── Part bootstrapping ──────────────────────────────────────────────────

export type BootstrapResult = {
  partsCreated: string[];
};

/**
 * Create missing comment XML parts when a DOCX has no comment infrastructure.
 * Idempotent — skips parts that already exist.
 */
export async function bootstrapCommentParts(zip: DocxZip): Promise<BootstrapResult> {
  const created: string[] = [];

  // 1. Ensure comment parts exist
  if (!zip.hasFile('word/comments.xml')) {
    zip.writeText('word/comments.xml', COMMENTS_XML_TEMPLATE);
    created.push('word/comments.xml');
  }
  if (!zip.hasFile('word/commentsExtended.xml')) {
    zip.writeText('word/commentsExtended.xml', COMMENTS_EXTENDED_XML_TEMPLATE);
    created.push('word/commentsExtended.xml');
  }
  if (!zip.hasFile('word/people.xml')) {
    zip.writeText('word/people.xml', PEOPLE_XML_TEMPLATE);
    created.push('word/people.xml');
  }

  if (created.length === 0) return { partsCreated: [] };

  // 2. Update [Content_Types].xml
  await ensureContentTypes(zip, created);

  // 3. Update word/_rels/document.xml.rels
  await ensureRelationships(zip, created);

  return { partsCreated: created };
}

async function ensureContentTypes(zip: DocxZip, newParts: string[]): Promise<void> {
  const ctPath = '[Content_Types].xml';
  let ctXml: string;
  try {
    ctXml = await zip.readText(ctPath);
  } catch {
    // Minimal [Content_Types].xml if missing
    ctXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
  }
  const ctDoc = parseXml(ctXml);
  const typesEl = ctDoc.documentElement;
  const ctNs = 'http://schemas.openxmlformats.org/package/2006/content-types';

  const partToCt: Record<string, string> = {
    'word/comments.xml': CT_COMMENTS,
    'word/commentsExtended.xml': CT_COMMENTS_EXTENDED,
    'word/people.xml': CT_PEOPLE,
  };

  // Check existing overrides
  const overrides = Array.from(typesEl.getElementsByTagNameNS(ctNs, 'Override')) as Element[];
  const existingPartNames = new Set(overrides.map((o) => o.getAttribute('PartName')));

  for (const part of newParts) {
    const partName = `/${part}`;
    const contentType = partToCt[part];
    if (!contentType || existingPartNames.has(partName)) continue;

    const override = ctDoc.createElementNS(ctNs, 'Override');
    override.setAttribute('PartName', partName);
    override.setAttribute('ContentType', contentType);
    typesEl.appendChild(override);
  }

  zip.writeText(ctPath, serializeXml(ctDoc));
}

async function ensureRelationships(zip: DocxZip, newParts: string[]): Promise<void> {
  const relsPath = 'word/_rels/document.xml.rels';
  let relsXml: string;
  try {
    relsXml = await zip.readText(relsPath);
  } catch {
    relsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
  }
  const relsDoc = parseXml(relsXml);
  const relsEl = relsDoc.documentElement;
  const relNs = OOXML.REL_NS;

  const partToRelType: Record<string, string> = {
    'word/comments.xml': REL_TYPE_COMMENTS,
    'word/commentsExtended.xml': REL_TYPE_COMMENTS_EXTENDED,
    'word/people.xml': REL_TYPE_PEOPLE,
  };

  // Check existing relationships
  const existingRels = Array.from(relsEl.getElementsByTagNameNS(relNs, 'Relationship')) as Element[];
  const existingTypes = new Set(existingRels.map((r) => r.getAttribute('Type')));

  // Allocate next rId
  let maxId = 0;
  for (const rel of existingRels) {
    const id = rel.getAttribute('Id') ?? '';
    const match = /^rId(\d+)$/.exec(id);
    if (match) maxId = Math.max(maxId, parseInt(match[1]!, 10));
  }

  for (const part of newParts) {
    const relType = partToRelType[part];
    if (!relType || existingTypes.has(relType)) continue;

    maxId++;
    const rel = relsDoc.createElementNS(relNs, 'Relationship');
    rel.setAttribute('Id', `rId${maxId}`);
    rel.setAttribute('Type', relType);
    // Target is relative to word/
    rel.setAttribute('Target', part.replace('word/', ''));
    relsEl.appendChild(rel);
  }

  zip.writeText(relsPath, serializeXml(relsDoc));
}

// ── Comment insertion ───────────────────────────────────────────────────

export type AddCommentParams = {
  paragraphEl: Element;
  start?: number;
  end?: number;
  author: string;
  text: string;
  initials?: string;
  body?: CommentBodyParagraph[];
};

export type CommentBodyRun = { text: string; style?: { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; highlight?: string } };
export type CommentBodyParagraph = { runs: CommentBodyRun[] };

export type AddCommentResult = {
  commentId: number;
};

export type AddTrackedRangeCommentParams = {
  startRevision: TrackedRevisionLocator;
  endRevision: TrackedRevisionLocator;
  author: string;
  initials: string;
  date: string;
  text: string;
};

export type TrackedRevisionType = 'ins' | 'del' | 'moveFrom' | 'moveTo';

export type TrackedRevisionLocator = {
  type: TrackedRevisionType;
  id: string;
};

function deterministicParaId(params: AddTrackedRangeCommentParams, commentId: number): string {
  return createHash('sha256')
    .update(`${commentId}\0${params.author}\0${params.initials}\0${params.date}\0${params.text}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
}

function findUniqueRevision(documentXml: Document, locator: TrackedRevisionLocator): Element {
  const matches = Array.from(documentXml.getElementsByTagNameNS(OOXML.W_NS, locator.type))
    .filter((element) => getAttributeSafe(element, OOXML.W_NS, 'id', 'w', { bareFallback: false }) === locator.id);
  if (matches.length !== 1) {
    throw new Error(`Tracked revision ${locator.type}#${locator.id} must occur exactly once; found ${matches.length}.`);
  }
  return matches[0]!;
}

function createCommentReference(documentXml: Document, commentId: number): Element {
  const refRun = documentXml.createElementNS(OOXML.W_NS, 'w:r');
  const rPr = documentXml.createElementNS(OOXML.W_NS, 'w:rPr');
  const rStyle = documentXml.createElementNS(OOXML.W_NS, 'w:rStyle');
  rStyle.setAttribute('w:val', 'CommentReference');
  rPr.appendChild(rStyle);
  refRun.appendChild(rPr);
  const reference = documentXml.createElementNS(OOXML.W_NS, 'w:commentReference');
  reference.setAttribute('w:id', String(commentId));
  refRun.appendChild(reference);
  return refRun;
}

/**
 * Materialize root comments around an OOXML tracked-revision range. Markers
 * are placed immediately outside the identified revision containers so
 * accept/reject keeps a balanced annotation and naturally collapses it when
 * that revision's text is removed.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.2
 * @see https://github.com/UseJunior/safe-docx/issues/860
 */
export async function addTrackedRangeComments(
  buffer: Buffer,
  comments: AddTrackedRangeCommentParams[],
): Promise<Buffer> {
  if (comments.length === 0) return buffer;
  const zip = await DocxZip.load(buffer);
  await bootstrapCommentParts(zip);
  const documentXml = parseXml(await zip.readText('word/document.xml'));
  const commentsDoc = parseXml(await zip.readText('word/comments.xml'));

  for (const params of comments) {
    const startRevision = findUniqueRevision(documentXml, params.startRevision);
    const endRevision = findUniqueRevision(documentXml, params.endRevision);
    const startParent = startRevision.parentNode;
    const endParent = endRevision.parentNode;
    if (!startParent || !endParent) throw new Error('Attributed revision container has no parent.');

    const commentId = allocateNextCommentId(commentsDoc);
    const rangeStart = documentXml.createElementNS(OOXML.W_NS, 'w:commentRangeStart');
    rangeStart.setAttribute('w:id', String(commentId));
    const rangeEnd = documentXml.createElementNS(OOXML.W_NS, 'w:commentRangeEnd');
    rangeEnd.setAttribute('w:id', String(commentId));
    startParent.insertBefore(rangeStart, startRevision);
    endParent.insertBefore(rangeEnd, endRevision.nextSibling);
    endParent.insertBefore(createCommentReference(documentXml, commentId), rangeEnd.nextSibling);

    addCommentElement(commentsDoc, {
      id: commentId,
      author: params.author,
      initials: params.initials,
      text: params.text,
      paraId: deterministicParaId(params, commentId),
      date: params.date,
    });
    await ensureAuthorInPeople(zip, params.author);
  }

  zip.writeText('word/document.xml', serializeXml(documentXml));
  zip.writeText('word/comments.xml', serializeXml(commentsDoc));
  return zip.toBuffer();
}

/**
 * Insert a root comment anchored to a text range within a paragraph.
 *
 * - Allocates next comment ID from existing comments.xml
 * - Inserts commentRangeStart/commentRangeEnd markers in document body
 * - Inserts commentReference run after range end
 * - Adds comment entry to comments.xml
 * - Adds author to people.xml if not present
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.5
 */
export async function addComment(
  documentXml: Document,
  zip: DocxZip,
  params: AddCommentParams,
  ctx?: RevisionContext,
): Promise<AddCommentResult> {
  const { paragraphEl, author, text, initials } = params;
  const visibleLen = getParagraphText(paragraphEl).length;
  const start = params.start ?? 0;
  const end = params.end ?? visibleLen;
  if (start > end) {
    throw new Error(`Invalid comment range: start (${start}) must be <= end (${end})`);
  }
  if (start < 0 || end > visibleLen) {
    throw new Error(
      `Invalid comment range: [${start}, ${end}) is outside paragraph visible text [0, ${visibleLen})`,
    );
  }

  // Load comments.xml
  const commentsXml = await zip.readText('word/comments.xml');
  const commentsDoc = parseXml(commentsXml);

  // Allocate next comment ID
  const commentId = allocateNextCommentId(commentsDoc);

  // Insert range markers and reference in document body
  insertCommentMarkers(documentXml, paragraphEl, commentId, start, end, ctx);

  // Add comment element to comments.xml
  const paraId = generateParaId();
  addCommentElement(commentsDoc, {
    id: commentId,
    author,
    initials: initials ?? author.charAt(0).toUpperCase(),
    text,
    paraId,
    date: ctx?.date,
    body: params.body,
  });
  zip.writeText('word/comments.xml', serializeXml(commentsDoc));

  // Add author to people.xml
  await ensureAuthorInPeople(zip, author);

  return { commentId };
}

// ── Threaded replies ────────────────────────────────────────────────────

export type AddCommentReplyParams = {
  parentCommentId: number;
  author: string;
  text: string;
  initials?: string;
  body?: CommentBodyParagraph[];
};

export type AddCommentReplyResult = {
  commentId: number;
  parentCommentId: number;
};

/**
 * Add a threaded reply to an existing comment.
 *
 * Replies don't have range markers in the document body.
 * Thread linkage is stored in commentsExtended.xml via paraIdParent.
 * Replies emit no body revision markup (there is nothing to anchor), but the
 * reply's comment definition still claims creation metadata — so a
 * caller-supplied `ctx.date` stamps `w:date` exactly as it does for root
 * comments, keeping reply timestamps deterministic alongside the rest of the
 * operation. Author and initials intentionally stay sourced from `params`.
 */
export async function addCommentReply(
  _documentXml: Document,
  zip: DocxZip,
  params: AddCommentReplyParams,
  ctx?: RevisionContext,
): Promise<AddCommentReplyResult> {
  const { parentCommentId, author, text, initials } = params;

  // Load comments.xml
  const commentsXml = await zip.readText('word/comments.xml');
  const commentsDoc = parseXml(commentsXml);

  // Find parent comment's paraId
  const parentParaId = findCommentParaId(commentsDoc, parentCommentId);
  if (!parentParaId) {
    throw new Error(`Parent comment ID ${parentCommentId} not found in comments.xml`);
  }

  // Allocate ID and add reply comment
  const commentId = allocateNextCommentId(commentsDoc);
  const replyParaId = generateParaId();
  addCommentElement(commentsDoc, {
    id: commentId,
    author,
    initials: initials ?? author.charAt(0).toUpperCase(),
    text,
    paraId: replyParaId,
    date: ctx?.date,
    body: params.body,
  });
  zip.writeText('word/comments.xml', serializeXml(commentsDoc));

  // Link reply in commentsExtended.xml
  await linkReplyInCommentsExtended(zip, replyParaId, parentParaId);

  // Ensure parent also has an entry in commentsExtended.xml
  await ensureCommentExEntry(zip, parentParaId);

  // Add author to people.xml
  await ensureAuthorInPeople(zip, author);

  return { commentId, parentCommentId };
}

// ── Internal helpers ────────────────────────────────────────────────────

function allocateNextCommentId(commentsDoc: Document): number {
  const commentEls = commentsDoc.getElementsByTagNameNS(OOXML.W_NS, W.comment);
  let maxId = -1;
  for (let i = 0; i < commentEls.length; i++) {
    const el = commentEls.item(i) as Element;
    const idStr = getAttributeSafe(el, OOXML.W_NS, 'id', 'w', { bareFallback: false });
    if (idStr) {
      const id = parseInt(idStr, 10);
      if (id > maxId) maxId = id;
    }
  }
  return maxId + 1;
}

function findCommentParaId(commentsDoc: Document, commentId: number): string | null {
  const commentEls = commentsDoc.getElementsByTagNameNS(OOXML.W_NS, W.comment);
  for (let i = 0; i < commentEls.length; i++) {
    const el = commentEls.item(i) as Element;
    const idStr = getAttributeSafe(el, OOXML.W_NS, 'id', 'w', { bareFallback: false });
    if (idStr && parseInt(idStr, 10) === commentId) {
      // paraId is on the w:p child inside the comment
      const paras = el.getElementsByTagNameNS(OOXML.W_NS, W.p);
      if (paras.length > 0) {
        const p = paras.item(0) as Element;
        return getAttributeSafe(p, OOXML.W14_NS, 'paraId', 'w14', { bareFallback: false });
      }
    }
  }
  return null;
}

/**
 * Ensure a comment-related document root binds the w14 and w15 prefixes before any
 * w14:* / w15:* attribute is written into it. Real-world docx files often ship a
 * pre-existing comments.xml (or commentsExtended.xml / people.xml) that omits one or
 * both declarations; without a real namespace binding, xmldom would reject the
 * round-tripped XML with `NamespaceError: prefix is non-null and namespace is null`.
 *
 * Uses `setAttributeNS(XMLNS_NS, …)` so the prefix is actually bound on the live DOM
 * (not just serialized as a literal attribute) — that means subsequent `createElementNS`
 * / `setAttributeNS` / `lookupNamespaceURI` calls on the same Document resolve correctly
 * without depending on a serialize/reparse round trip. Idempotent — guards on the real
 * binding via `lookupNamespaceURI`, not on a same-named plain attribute.
 */
function ensureCommentPartNamespaceAliases(commentsDoc: Document): void {
  const root = commentsDoc.documentElement;
  if (root.lookupNamespaceURI('w14') !== OOXML.W14_NS) {
    root.setAttributeNS(XMLNS_NS, 'xmlns:w14', OOXML.W14_NS);
  }
  if (root.lookupNamespaceURI('w15') !== OOXML.W15_NS) {
    root.setAttributeNS(XMLNS_NS, 'xmlns:w15', OOXML.W15_NS);
  }
}

/**
 * Append a `w:comment` definition to the comments part.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.2
 * The `w:date` creation stamp uses the caller-supplied revision date when one
 * is provided, so the comment definition and the body revision markup emitted
 * for the same operation agree on the calendar date Word displays — even
 * across a UTC/local day boundary. Only when the caller supplies no date does
 * the process clock remain the default. Author and initials always come from
 * `AddCommentParams` / `AddCommentReplyParams`, never from `RevisionContext`:
 * the comment's attribution is the commenting author, which is allowed to
 * differ from the tracked-change author wrapping the reference run.
 * @see #859
 */
function addCommentElement(
  commentsDoc: Document,
  params: { id: number; author: string; initials: string; text: string; paraId: string; date?: string; body?: CommentBodyParagraph[] },
): void {
  ensureCommentPartNamespaceAliases(commentsDoc);
  const root = commentsDoc.documentElement;

  const commentEl = commentsDoc.createElementNS(OOXML.W_NS, 'w:comment');
  commentEl.setAttribute('w:id', String(params.id));
  commentEl.setAttribute('w:author', params.author);
  commentEl.setAttribute('w:date', params.date ?? isoNow());
  commentEl.setAttribute('w:initials', params.initials);

  // Comment body: <w:p w14:paraId="..."><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:annotationRef/></w:r><w:r><w:t>text</w:t></w:r></w:p>
  const p = commentsDoc.createElementNS(OOXML.W_NS, 'w:p');
  // Use setAttributeNS so the attribute carries a real namespace URI — otherwise xmldom
  // serializes a prefix it cannot resolve and reparse throws NamespaceError (#154).
  p.setAttributeNS(OOXML.W14_NS, 'w14:paraId', params.paraId);

  // Annotation reference run
  const refRun = commentsDoc.createElementNS(OOXML.W_NS, 'w:r');
  const annotRef = commentsDoc.createElementNS(OOXML.W_NS, 'w:annotationRef');
  refRun.appendChild(annotRef);
  p.appendChild(refRun);

  const body = params.body ?? [{ runs: [{ text: params.text }] }];
  for (const run of body[0]?.runs ?? []) p.appendChild(buildCommentBodyRun(commentsDoc, run));

  commentEl.appendChild(p);
  for (const paragraph of body.slice(1)) {
    const bodyParagraph = commentsDoc.createElementNS(OOXML.W_NS, 'w:p');
    for (const run of paragraph.runs) bodyParagraph.appendChild(buildCommentBodyRun(commentsDoc, run));
    commentEl.appendChild(bodyParagraph);
  }
  root.appendChild(commentEl);
}

function buildCommentBodyRun(doc: Document, bodyRun: CommentBodyRun): Element {
  const run = doc.createElementNS(OOXML.W_NS, 'w:r');
  const style = bodyRun.style;
  if (style && Object.values(style).some((value) => value !== undefined && value !== false)) {
    const rPr = doc.createElementNS(OOXML.W_NS, 'w:rPr');
    if (style.bold) rPr.appendChild(doc.createElementNS(OOXML.W_NS, 'w:b'));
    if (style.italic) rPr.appendChild(doc.createElementNS(OOXML.W_NS, 'w:i'));
    if (style.underline) {
      const underline = doc.createElementNS(OOXML.W_NS, 'w:u');
      underline.setAttributeNS(OOXML.W_NS, 'w:val', 'single');
      rPr.appendChild(underline);
    }
    if (style.color) {
      const color = doc.createElementNS(OOXML.W_NS, 'w:color');
      color.setAttributeNS(OOXML.W_NS, 'w:val', style.color);
      rPr.appendChild(color);
    }
    if (style.highlight && style.highlight !== 'none') {
      const highlight = doc.createElementNS(OOXML.W_NS, 'w:highlight');
      highlight.setAttributeNS(OOXML.W_NS, 'w:val', style.highlight);
      rPr.appendChild(highlight);
    }
    run.appendChild(rPr);
  }
  const text = doc.createElementNS(OOXML.W_NS, 'w:t');
  if (bodyRun.text.startsWith(' ') || bodyRun.text.endsWith(' ')) text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  text.appendChild(doc.createTextNode(bodyRun.text));
  run.appendChild(text);
  return run;
}

function insertCommentMarkers(
  documentXml: Document,
  paragraphEl: Element,
  commentId: number,
  start: number,
  end: number,
  ctx?: RevisionContext,
): void {
  const runs = getParagraphRuns(paragraphEl);

  const rangeStart = documentXml.createElementNS(OOXML.W_NS, 'w:commentRangeStart');
  rangeStart.setAttribute('w:id', String(commentId));

  const rangeEnd = documentXml.createElementNS(OOXML.W_NS, 'w:commentRangeEnd');
  rangeEnd.setAttribute('w:id', String(commentId));

  const refRun = documentXml.createElementNS(OOXML.W_NS, 'w:r');
  const rPr = documentXml.createElementNS(OOXML.W_NS, 'w:rPr');
  const rStyle = documentXml.createElementNS(OOXML.W_NS, 'w:rStyle');
  rStyle.setAttribute('w:val', 'CommentReference');
  rPr.appendChild(rStyle);
  refRun.appendChild(rPr);
  const commentRef = documentXml.createElementNS(OOXML.W_NS, 'w:commentReference');
  commentRef.setAttribute('w:id', String(commentId));
  refRun.appendChild(commentRef);
  const refAnchor = ctx ? createRevisionContainer(documentXml, 'ins', ctx) : refRun;
  if (ctx) {
    refAnchor.appendChild(refRun);
  }

  if (runs.length === 0) {
    paragraphEl.appendChild(rangeStart);
    paragraphEl.appendChild(rangeEnd);
    paragraphEl.appendChild(refAnchor);
    return;
  }

  const mapping = mapOffsetsToRuns(runs, start, end);
  const { startRunIdx, startOffset, endRunIdx, endOffset } = mapping;

  // Collapsed range (start === end): insert both markers at the same boundary.
  // Splitting again here would create an empty <w:r> inside the marker pair —
  // replaceParagraphTextRange() avoids this by deleting the temporary run, which
  // we can't do for comments. Handle the boundary directly.
  if (startRunIdx === endRunIdx && startOffset === endOffset) {
    insertCollapsedRangeMarkers(
      runs[startRunIdx]!,
      startOffset,
      rangeStart,
      rangeEnd,
      refAnchor,
    );
    return;
  }

  // Split boundary runs at the exact visible-text offsets so the markers can sit
  // on true sub-paragraph boundaries instead of being snapped to whole-run edges.
  // Choreography mirrors replaceParagraphTextRange() in text.ts:404.
  let startRunEl: Element = runs[startRunIdx]!.r;
  let endRunEl: Element = runs[endRunIdx]!.r;

  if (startRunIdx === endRunIdx) {
    const runLen = runs[startRunIdx]!.text.length;
    if (endOffset < runLen) {
      const { left } = splitRunAtVisibleOffset(startRunEl, endOffset);
      startRunEl = left;
      endRunEl = left;
    }
    if (startOffset > 0) {
      const { right } = splitRunAtVisibleOffset(startRunEl, startOffset);
      startRunEl = right;
      endRunEl = right;
    }
  } else {
    if (startOffset > 0) {
      const { right } = splitRunAtVisibleOffset(startRunEl, startOffset);
      startRunEl = right;
    }
    const endLen = runs[endRunIdx]!.text.length;
    if (endOffset < endLen) {
      const { left } = splitRunAtVisibleOffset(endRunEl, endOffset);
      endRunEl = left;
    }
  }

  // Insert relative to each run's parent so anchors inside w:hyperlink, w:ins,
  // w:del, w:sdtContent, etc. keep the markers inside the wrapper.
  const startParent = startRunEl.parentNode;
  const endParent = endRunEl.parentNode;
  if (!startParent || !endParent) {
    throw new Error('Split run has no parent');
  }

  startParent.insertBefore(rangeStart, startRunEl);
  endParent.insertBefore(rangeEnd, endRunEl.nextSibling);
  endParent.insertBefore(refAnchor, rangeEnd.nextSibling);
}

function mapOffsetsToRuns(
  runs: TextRun[],
  start: number,
  end: number,
): { startRunIdx: number; startOffset: number; endRunIdx: number; endOffset: number } {
  // Map visible-text offsets to (runIndex, offsetInRun). Caller validates that
  // 0 <= start <= end <= sum(runs[i].text.length).
  let pos = 0;
  let startRunIdx = -1;
  let endRunIdx = -1;
  let startOffset = 0;
  let endOffset = 0;
  for (let i = 0; i < runs.length; i++) {
    const len = runs[i]!.text.length;
    if (startRunIdx === -1 && start >= pos && start <= pos + len) {
      startRunIdx = i;
      startOffset = start - pos;
    }
    if (endRunIdx === -1 && end >= pos && end <= pos + len) {
      endRunIdx = i;
      endOffset = end - pos;
      break;
    }
    pos += len;
  }
  if (startRunIdx === -1 || endRunIdx === -1) {
    throw new Error(`Could not map offsets [${start}, ${end}) to runs`);
  }
  return { startRunIdx, startOffset, endRunIdx, endOffset };
}

function insertCollapsedRangeMarkers(
  run: TextRun,
  offsetInRun: number,
  rangeStart: Element,
  rangeEnd: Element,
  refAnchor: Element,
): void {
  const runEl = run.r;
  const parent = runEl.parentNode;
  if (!parent) throw new Error('Run has no parent');
  const runLen = run.text.length;

  if (offsetInRun === 0) {
    // Insert before the run.
    parent.insertBefore(rangeStart, runEl);
    parent.insertBefore(rangeEnd, runEl);
    parent.insertBefore(refAnchor, runEl);
    return;
  }
  if (offsetInRun === runLen) {
    // Insert after the run. Capture nextSibling once because insertBefore
    // shifts it (rangeStart would otherwise land last instead of first).
    const ref = runEl.nextSibling;
    parent.insertBefore(rangeStart, ref);
    parent.insertBefore(rangeEnd, ref);
    parent.insertBefore(refAnchor, ref);
    return;
  }
  // Mid-run: split once so the markers sit between the two halves.
  const { right } = splitRunAtVisibleOffset(runEl, offsetInRun);
  parent.insertBefore(rangeStart, right);
  parent.insertBefore(rangeEnd, right);
  parent.insertBefore(refAnchor, right);
}

async function linkReplyInCommentsExtended(
  zip: DocxZip,
  replyParaId: string,
  parentParaId: string,
): Promise<void> {
  const extXml = await zip.readText('word/commentsExtended.xml');
  const extDoc = parseXml(extXml);
  ensureCommentPartNamespaceAliases(extDoc);
  const root = extDoc.documentElement;

  const exEl = extDoc.createElementNS(OOXML.W15_NS, 'w15:commentEx');
  exEl.setAttributeNS(OOXML.W15_NS, 'w15:paraId', replyParaId);
  exEl.setAttributeNS(OOXML.W15_NS, 'w15:paraIdParent', parentParaId);
  exEl.setAttributeNS(OOXML.W15_NS, 'w15:done', '0');
  root.appendChild(exEl);

  zip.writeText('word/commentsExtended.xml', serializeXml(extDoc));
}

async function ensureCommentExEntry(
  zip: DocxZip,
  paraId: string,
): Promise<void> {
  const extXml = await zip.readText('word/commentsExtended.xml');
  const extDoc = parseXml(extXml);
  ensureCommentPartNamespaceAliases(extDoc);
  const root = extDoc.documentElement;

  // Check if entry already exists
  const existing = root.getElementsByTagNameNS(OOXML.W15_NS, 'commentEx');
  for (let i = 0; i < existing.length; i++) {
    const el = existing.item(i) as Element;
    const pid = getAttributeSafe(el, OOXML.W15_NS, 'paraId', 'w15', { bareFallback: false });
    if (pid === paraId) return; // Already present
  }

  const exEl = extDoc.createElementNS(OOXML.W15_NS, 'w15:commentEx');
  exEl.setAttributeNS(OOXML.W15_NS, 'w15:paraId', paraId);
  exEl.setAttributeNS(OOXML.W15_NS, 'w15:done', '0');
  root.appendChild(exEl);

  zip.writeText('word/commentsExtended.xml', serializeXml(extDoc));
}

async function ensureAuthorInPeople(zip: DocxZip, author: string): Promise<void> {
  const peopleXml = await zip.readText('word/people.xml');
  const peopleDoc = parseXml(peopleXml);
  ensureCommentPartNamespaceAliases(peopleDoc);
  const root = peopleDoc.documentElement;

  // Check if author already exists
  const persons = root.getElementsByTagNameNS(OOXML.W15_NS, 'person');
  for (let i = 0; i < persons.length; i++) {
    const el = persons.item(i) as Element;
    const name = getAttributeSafe(el, OOXML.W15_NS, 'author', 'w15', { bareFallback: false });
    if (name === author) return; // Already present
  }

  const personEl = peopleDoc.createElementNS(OOXML.W15_NS, 'w15:person');
  personEl.setAttributeNS(OOXML.W15_NS, 'w15:author', author);

  // Add a presenceInfo child (required by Word)
  const presenceInfo = peopleDoc.createElementNS(OOXML.W15_NS, 'w15:presenceInfo');
  presenceInfo.setAttributeNS(OOXML.W15_NS, 'w15:providerId', 'None');
  presenceInfo.setAttributeNS(OOXML.W15_NS, 'w15:userId', author);
  personEl.appendChild(presenceInfo);

  root.appendChild(personEl);
  zip.writeText('word/people.xml', serializeXml(peopleDoc));
}

// ── Comment reading ─────────────────────────────────────────────────────

export type Comment = {
  id: number;
  author: string;
  date: string;
  initials: string;
  text: string;
  paragraphs: CommentParagraph[];
  paragraphId: string | null;
  anchoredParagraphId: string | null;
  endParagraphId?: string | null;
  startRunIndex?: number;
  startCharOffset?: number;
  endRunIndex?: number;
  endCharOffset?: number;
  startTextOffset?: number;
  endTextOffset?: number;
  replies: Comment[];
};

export type CommentParagraph = {
  text: string;
  tagged_text: string;
  style: string | null;
};

type CommentRangePoint = {
  paragraphId: string | null;
  runIndex?: number;
  charOffset?: number;
  textOffset?: number;
};

/**
 * Read all comments from a document, building a threaded tree.
 *
 * Root comments are returned at the top level; replies are nested under
 * their parent's `replies` array. Thread linkage is resolved via
 * commentsExtended.xml paraIdParent relationships.
 */
export async function getComments(
  zip: DocxZip,
  documentXml: Document,
  styles: StylesModel = parseStylesXml(null),
  theme: ThemeModel = parseThemeXml(null),
): Promise<Comment[]> {
  const commentsText = await zip.readTextOrNull('word/comments.xml');
  if (!commentsText) return [];

  const commentsDoc = parseXml(commentsText);
  const commentEls = commentsDoc.getElementsByTagNameNS(OOXML.W_NS, W.comment);
  if (commentEls.length === 0) return [];
  const rangeMetadata = resolveCommentRangeMetadata(documentXml);

  // Build a map of commentId → { paraId, Comment }
  const byParaId = new Map<string, Comment>();
  const byId = new Map<number, Comment>();

  for (let i = 0; i < commentEls.length; i++) {
    const el = commentEls.item(i) as Element;
    const idStr = getAttributeSafe(el, OOXML.W_NS, 'id', 'w', { bareFallback: false });
    const id = idStr ? parseInt(idStr, 10) : -1;
    if (id < 0) continue;

    const author = getAttributeSafe(el, OOXML.W_NS, 'author', 'w', { bareFallback: false }) ?? '';
    const date = getAttributeSafe(el, OOXML.W_NS, 'date', 'w', { bareFallback: false }) ?? '';
    const initials = getAttributeSafe(el, OOXML.W_NS, 'initials', 'w', { bareFallback: false }) ?? '';

    // Extract text from <w:t> elements, skipping annotationRef runs
    const paragraphs = extractCommentParagraphs(el, styles, theme);
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');

    // Get paraId from first <w:p> child (namespace-aware to handle non-`w` prefixes)
    const paras = el.getElementsByTagNameNS(OOXML.W_NS, W.p);
    let paragraphId: string | null = null;
    if (paras.length > 0) {
      const p = paras.item(0) as Element;
      paragraphId = getAttributeSafe(p, OOXML.W14_NS, 'paraId', 'w14', { bareFallback: false });
    }

    const startPoint = rangeMetadata.startById.get(id);
    const endPoint = rangeMetadata.endById.get(id);

    const comment: Comment = {
      id,
      author,
      date,
      initials,
      text,
      paragraphs,
      paragraphId,
      anchoredParagraphId: startPoint?.paragraphId ?? null,
      endParagraphId: endPoint?.paragraphId ?? startPoint?.paragraphId ?? null,
      startRunIndex: startPoint?.runIndex,
      startCharOffset: startPoint?.charOffset,
      endRunIndex: endPoint?.runIndex,
      endCharOffset: endPoint?.charOffset,
      startTextOffset: startPoint?.textOffset,
      endTextOffset: endPoint?.textOffset,
      replies: [],
    };

    byId.set(id, comment);
    if (paragraphId) byParaId.set(paragraphId, comment);
  }

  // Build thread tree from commentsExtended.xml
  const extText = await zip.readTextOrNull('word/commentsExtended.xml');
  if (extText) {
    const extDoc = parseXml(extText);
    const exEls = extDoc.getElementsByTagNameNS(OOXML.W15_NS, 'commentEx');
    for (let i = 0; i < exEls.length; i++) {
      const ex = exEls.item(i) as Element;
      const childParaId = getAttributeSafe(ex, OOXML.W15_NS, 'paraId', 'w15', { bareFallback: false });
      const parentParaId = getAttributeSafe(ex, OOXML.W15_NS, 'paraIdParent', 'w15', { bareFallback: false });
      if (!childParaId || !parentParaId) continue;

      const child = byParaId.get(childParaId);
      const parentComment = byParaId.get(parentParaId);
      if (child && parentComment) {
        parentComment.replies.push(child);
      }
    }
  }

  // Collect root-level comments (those not appearing as anyone's reply)
  const replyParaIds = new Set<string>();
  if (extText) {
    const extDoc = parseXml(extText);
    const exEls = extDoc.getElementsByTagNameNS(OOXML.W15_NS, 'commentEx');
    for (let i = 0; i < exEls.length; i++) {
      const ex = exEls.item(i) as Element;
      const childParaId = getAttributeSafe(ex, OOXML.W15_NS, 'paraId', 'w15', { bareFallback: false });
      const parentParaId = getAttributeSafe(ex, OOXML.W15_NS, 'paraIdParent', 'w15', { bareFallback: false });
      if (childParaId && parentParaId) {
        replyParaIds.add(childParaId);
      }
    }
  }

  const roots: Comment[] = [];
  for (const comment of byId.values()) {
    if (!comment.paragraphId || !replyParaIds.has(comment.paragraphId)) {
      roots.push(comment);
    }
  }

  return roots;
}

function resolveCommentRangeMetadata(documentXml: Document): {
  startById: Map<number, CommentRangePoint>;
  endById: Map<number, CommentRangePoint>;
} {
  const startById = new Map<number, CommentRangePoint>();
  const endById = new Map<number, CommentRangePoint>();
  const root = documentXml.documentElement;
  if (!root) return { startById, endById };

  const paragraphList = root.getElementsByTagNameNS(OOXML.W_NS, W.p);
  for (let i = 0; i < paragraphList.length; i++) {
    resolveCommentRangeMetadataInParagraph(paragraphList.item(i) as Element, startById, endById);
  }

  return { startById, endById };
}

function resolveCommentRangeMetadataInParagraph(
  paragraph: Element,
  startById: Map<number, CommentRangePoint>,
  endById: Map<number, CommentRangePoint>,
): void {
  const index = buildParagraphIndex(paragraph);
  const paragraphId = getParagraphBookmarkId(paragraph);
  for (const marker of index.nodes.filter((node) => node.kind === 'comment-range-start')) {
    const id = getCommentMarkerId(marker.element);
    if (id == null || startById.has(id)) continue;
    startById.set(id, {
      paragraphId,
      textOffset: marker.visibleStart,
      ...resolveIndexedMarkerBoundary(index, marker, 'start'),
    });
  }
  for (const marker of index.nodes.filter((node) => node.kind === 'comment-range-end')) {
    const id = getCommentMarkerId(marker.element);
    if (id == null || endById.has(id)) continue;
    endById.set(id, {
      paragraphId,
      textOffset: marker.visibleStart,
      ...resolveIndexedMarkerBoundary(index, marker, 'end'),
    });
  }
}

function getCommentMarkerId(markerEl: Element): number | null {
  const idStr = getAttributeSafe(markerEl, OOXML.W_NS, 'id', 'w', { bareFallback: false });
  if (!idStr) return null;
  const id = parseInt(idStr, 10);
  return Number.isNaN(id) ? null : id;
}

function resolveIndexedMarkerBoundary(
  index: ParagraphIndex,
  marker: IndexedParagraphNode,
  boundary: 'start' | 'end',
): Pick<CommentRangePoint, 'runIndex' | 'charOffset'> {
  if (marker.runIndex !== null) return { runIndex: marker.runIndex, charOffset: marker.runVisibleOffset };
  if (index.runs.length === 0) return {};
  const before = [...index.runs].reverse().find((run) => run.structuralIndex < marker.structuralIndex);
  const after = index.runs.find((run) => run.structuralIndex > marker.structuralIndex);
  if (boundary === 'start' && after) return { runIndex: after.runIndex!, charOffset: 0 };
  if (before) return { runIndex: before.runIndex!, charOffset: before.visibleText.length };
  // At least one run exists, and a marker with no preceding run must sort
  // before the first run, so `after` is necessarily defined here.
  return { runIndex: after!.runIndex!, charOffset: 0 };
}

/**
 * Get a single comment by ID, searching the full tree including replies.
 */
export async function getComment(zip: DocxZip, documentXml: Document, commentId: number): Promise<Comment | null> {
  const all = await getComments(zip, documentXml);
  return findCommentById(all, commentId);
}

function findCommentById(comments: Comment[], id: number): Comment | null {
  for (const c of comments) {
    if (c.id === id) return c;
    const found = findCommentById(c.replies, id);
    if (found) return found;
  }
  return null;
}

// ── Comment deletion ─────────────────────────────────────────────────

/**
 * Delete a comment and all its descendants from the document.
 *
 * - Removes comment elements from comments.xml
 * - Removes commentEx entries from commentsExtended.xml (if present)
 * - For root comments: removes commentRangeStart, commentRangeEnd, and
 *   commentReference from document.xml (element-level; run removed only if empty)
 * - Transitive cascade: deleting any node also deletes all descendants
 */
export async function deleteComment(
  documentXml: Document,
  zip: DocxZip,
  params: { commentId: number },
  ctx?: RevisionContext,
): Promise<void> {
  const { commentId } = params;

  const commentsText = await zip.readTextOrNull('word/comments.xml');
  if (!commentsText) throw new Error(`Comment ID ${commentId} not found`);

  const commentsDoc = parseXml(commentsText);

  // Find the target comment element and its paraId
  const targetEl = findCommentElementById(commentsDoc, commentId);
  if (!targetEl) throw new Error(`Comment ID ${commentId} not found`);

  const targetParaId = getCommentElParaId(targetEl);

  // Collect all IDs to delete: the target + all transitive descendants
  const idsToDelete = new Set<number>([commentId]);
  const paraIdsToDelete = new Set<string>();
  if (targetParaId) paraIdsToDelete.add(targetParaId);

  // Build paraId→commentId and paraId→commentEl maps for all comments
  const paraIdToId = new Map<string, number>();
  const allCommentEls = commentsDoc.getElementsByTagNameNS(OOXML.W_NS, W.comment);
  for (let i = 0; i < allCommentEls.length; i++) {
    const el = allCommentEls.item(i) as Element;
    const idStr = getAttributeSafe(el, OOXML.W_NS, 'id', 'w', { bareFallback: false });
    const id = idStr ? parseInt(idStr, 10) : -1;
    if (id < 0) continue;
    const pid = getCommentElParaId(el);
    if (pid) paraIdToId.set(pid, id);
  }

  // Read commentsExtended.xml to find descendants via paraIdParent graph
  const extText = await zip.readTextOrNull('word/commentsExtended.xml');
  if (extText) {
    const extDoc = parseXml(extText);
    const exEls = extDoc.getElementsByTagNameNS(OOXML.W15_NS, 'commentEx');

    // Build parent→children map
    const childrenOf = new Map<string, string[]>();
    for (let i = 0; i < exEls.length; i++) {
      const ex = exEls.item(i) as Element;
      const childPid = getAttributeSafe(ex, OOXML.W15_NS, 'paraId', 'w15', { bareFallback: false });
      const parentPid = getAttributeSafe(ex, OOXML.W15_NS, 'paraIdParent', 'w15', { bareFallback: false });
      if (childPid && parentPid) {
        const arr = childrenOf.get(parentPid);
        if (arr) arr.push(childPid);
        else childrenOf.set(parentPid, [childPid]);
      }
    }

    // BFS from target paraId to collect all descendant paraIds
    const queue = targetParaId ? [targetParaId] : [];
    while (queue.length > 0) {
      const pid = queue.shift()!;
      const children = childrenOf.get(pid);
      if (!children) continue;
      for (const childPid of children) {
        if (!paraIdsToDelete.has(childPid)) {
          paraIdsToDelete.add(childPid);
          const childId = paraIdToId.get(childPid);
          if (childId != null) idsToDelete.add(childId);
          queue.push(childPid);
        }
      }
    }
  }

  // 1. Remove comment elements from comments.xml
  const elsToRemove: Element[] = [];
  for (let i = 0; i < allCommentEls.length; i++) {
    const el = allCommentEls.item(i) as Element;
    const idStr = getAttributeSafe(el, OOXML.W_NS, 'id', 'w', { bareFallback: false });
    const id = idStr ? parseInt(idStr, 10) : -1;
    if (idsToDelete.has(id)) elsToRemove.push(el);
  }
  for (const el of elsToRemove) {
    el.parentNode?.removeChild(el);
  }
  zip.writeText('word/comments.xml', serializeXml(commentsDoc));

  // 2. Remove commentEx entries from commentsExtended.xml (if present)
  if (extText) {
    const extDoc = parseXml(extText);
    const exEls = extDoc.getElementsByTagNameNS(OOXML.W15_NS, 'commentEx');
    const exToRemove: Element[] = [];
    for (let i = 0; i < exEls.length; i++) {
      const ex = exEls.item(i) as Element;
      const pid = getAttributeSafe(ex, OOXML.W15_NS, 'paraId', 'w15', { bareFallback: false });
      if (pid && paraIdsToDelete.has(pid)) exToRemove.push(ex);
    }
    for (const ex of exToRemove) {
      ex.parentNode?.removeChild(ex);
    }
    zip.writeText('word/commentsExtended.xml', serializeXml(extDoc));
  }

  // 3. Remove range markers and commentReference from document.xml (for root comments)
  for (const cid of idsToDelete) {
    removeCommentMarkersFromDocument(documentXml, cid, ctx);
  }
}

function findCommentElementById(commentsDoc: Document, commentId: number): Element | null {
  const commentEls = commentsDoc.getElementsByTagNameNS(OOXML.W_NS, W.comment);
  for (let i = 0; i < commentEls.length; i++) {
    const el = commentEls.item(i) as Element;
    const idStr = getAttributeSafe(el, OOXML.W_NS, 'id', 'w', { bareFallback: false });
    if (idStr && parseInt(idStr, 10) === commentId) return el;
  }
  return null;
}

function getCommentElParaId(commentEl: Element): string | null {
  const paras = commentEl.getElementsByTagNameNS(OOXML.W_NS, W.p);
  if (paras.length === 0) return null;
  const p = paras.item(0) as Element;
  return getAttributeSafe(p, OOXML.W14_NS, 'paraId', 'w14', { bareFallback: false });
}

function removeCommentMarkersFromDocument(
  documentXml: Document,
  commentId: number,
  ctx?: RevisionContext,
): void {
  const cidStr = String(commentId);

  // Remove commentRangeStart elements
  const rangeStarts = documentXml.getElementsByTagNameNS(OOXML.W_NS, W.commentRangeStart);
  const startsToRemove: Element[] = [];
  for (let i = 0; i < rangeStarts.length; i++) {
    const el = rangeStarts.item(i) as Element;
    const id = getAttributeSafe(el, OOXML.W_NS, 'id', 'w', { bareFallback: false });
    if (id === cidStr) startsToRemove.push(el);
  }
  for (const el of startsToRemove) el.parentNode?.removeChild(el);

  // Remove commentRangeEnd elements
  const rangeEnds = documentXml.getElementsByTagNameNS(OOXML.W_NS, W.commentRangeEnd);
  const endsToRemove: Element[] = [];
  for (let i = 0; i < rangeEnds.length; i++) {
    const el = rangeEnds.item(i) as Element;
    const id = getAttributeSafe(el, OOXML.W_NS, 'id', 'w', { bareFallback: false });
    if (id === cidStr) endsToRemove.push(el);
  }
  for (const el of endsToRemove) el.parentNode?.removeChild(el);

  // Remove commentReference elements, or preserve their containing run under
  // a deletion wrapper when tracked changes are requested.
  const refs = documentXml.getElementsByTagNameNS(OOXML.W_NS, W.commentReference);
  const refsToRemove: Element[] = [];
  for (let i = 0; i < refs.length; i++) {
    const el = refs.item(i) as Element;
    const id = getAttributeSafe(el, OOXML.W_NS, 'id', 'w', { bareFallback: false });
    if (id === cidStr) refsToRemove.push(el);
  }
  for (const ref of refsToRemove) {
    const run = ref.parentNode as Element | null;
    if (!run) continue;
    if (ctx) {
      const parent = run.parentNode;
      if (!parent) continue;

      const deletion = createRevisionContainer(documentXml, 'del', ctx);
      parent.replaceChild(deletion, run);
      deletion.appendChild(prepareElementForDeletion(run));
      continue;
    }
    run.removeChild(ref);
    // Remove run only if it has no visible content after removing the reference
    if (!hasVisibleRunContent(run)) {
      const runParent = run.parentNode as Element | null;
      runParent?.removeChild(run);
      // If the run lived inside a tracked-change wrapper (e.g., the comment
      // was added with ctx earlier and is now being deleted without ctx),
      // the wrapper is left orphaned with no content. Clean it up.
      if (runParent && isW(runParent, 'ins') && !hasElementChildren(runParent)) {
        runParent.parentNode?.removeChild(runParent);
      } else if (runParent && isW(runParent, 'del') && !hasElementChildren(runParent)) {
        runParent.parentNode?.removeChild(runParent);
      }
    }
  }
}

function hasVisibleRunContent(run: Element): boolean {
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.namespaceURI !== OOXML.W_NS) continue;
    if (el.localName === W.rPr) continue;
    return true;
  }
  return false;
}

function hasElementChildren(element: Element): boolean {
  return Array.from(element.childNodes).some((child) => child.nodeType === 1);
}

function extractCommentParagraphs(commentEl: Element, styles: StylesModel, theme: ThemeModel): CommentParagraph[] {
  const paragraphs = commentEl.getElementsByTagNameNS(OOXML.W_NS, W.p);
  const result: CommentParagraph[] = [];
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const paragraph = paragraphs.item(pi) as Element;
    const pPr = getFirstChild(paragraph, OOXML.W_NS, W.pPr);
    const pStyle = pPr ? getFirstChild(pPr, OOXML.W_NS, W.pStyle) : null;
    const style = pStyle ? getAttributeSafe(pStyle, OOXML.W_NS, 'val', 'w') : null;
    const annotated: AnnotatedRun[] = [];
    const runs = paragraph.getElementsByTagNameNS(OOXML.W_NS, W.r);
    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs.item(ri) as Element;
      if (run.getElementsByTagNameNS(OOXML.W_NS, W.annotationRef).length > 0) continue;
      let text = '';
      const ts = run.getElementsByTagNameNS(OOXML.W_NS, W.t);
      for (let ti = 0; ti < ts.length; ti++) text += (ts.item(ti) as Element).textContent ?? '';
      if (!text) continue;
      const formatting = extractEffectiveRunFormatting({
        run,
        paragraphPPr: pPr,
        paragraphStyleId: style,
        styles,
        theme,
      });
      annotated.push({ text, formatting, hyperlinkUrl: null, charCount: text.length, isHeaderRun: false });
    }
    const tagged_text = mergeAdjacentTags(emitFormattingTags({
      runs: annotated,
      baseline: { bold: false, italic: false, underline: false, suppressed: false },
      fontBaseline: { modalColor: null, colorSuppressed: false, modalFontSizePt: 0, fontSizeSuppressed: true, modalFontName: '', fontNameSuppressed: true },
      formattingMode: 'full',
    }));
    result.push({ text: annotated.map((run) => run.text).join(''), tagged_text, style });
  }
  return result;
}
