/**
 * Drafting-note comment parts: word/comments.xml plus the Word-extension
 * ancillary parts word/commentsExtended.xml and word/people.xml.
 *
 * All three are always emitted together when notes are enabled. The
 * ancillary pair is deliberately on by default: plain comments.xml loads in
 * every reader we test, but Word 2013+ writes the trio and its own comment
 * UI degrades (no resolve state, no people presence) without them. Content
 * and relationship types match what Word itself writes — verified against
 * the Open XML SDK's WordprocessingCommentsExPart/WordprocessingPeoplePart
 * constants (the `application/vnd.ms-word.commentsExtended+xml` variant
 * found in some third-party packages is NOT what Word emits). They also
 * match the editing path in primitives/comments.ts, so a generated document
 * is indistinguishable from an edited one to the comment APIs.
 *
 * Determinism: comment ids are allocated in document order by the
 * DraftingNoteCollector; w14:paraId values derive from those ids; dates come
 * only from DraftingNoteSpec.dateIso (falling back to meta.createdIso);
 * authors fall back note.author → meta.author → 'safe-docx'. No clock, no
 * randomness — identical specs produce byte-identical comment parts.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.2
 */

import { createWmlElement, createWmlTextElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import type { DocumentSpec, DraftingNoteSpec } from '../types.js';
import type { DraftingNoteCollector } from './emit-context.js';

export const COMMENTS_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
export const COMMENTS_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
export const COMMENTS_EXTENDED_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
export const COMMENTS_EXTENDED_REL_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
export const PEOPLE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml';
export const PEOPLE_REL_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/people';

const COMMENTS_SKELETON = `<w:comments xmlns:w="${OOXML.W_NS}" xmlns:w14="${OOXML.W14_NS}"/>`;

const DEFAULT_AUTHOR = 'safe-docx';

/** Deterministic w14:paraId for a comment id: zero-padded uppercase hex. */
function paraIdFor(id: number): string {
  return id.toString(16).toUpperCase().padStart(8, '0');
}

function authorFor(spec: DocumentSpec, note: DraftingNoteSpec): string {
  return note.author ?? spec.meta?.author ?? DEFAULT_AUTHOR;
}

/** Up-to-three-letter initials from the author's words, deterministic. */
function initialsFor(author: string): string {
  const letters = author
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, '').charAt(0))
    .filter((c) => c.length > 0);
  const initials = letters.slice(0, 3).join('').toUpperCase();
  return initials.length > 0 ? initials : 'SD';
}

/** Emit the comment trio from the notes collected during body emission. */
export function emitCommentsPartsIfNeeded(
  spec: DocumentSpec,
  ctx: CompileContext,
  collector: DraftingNoteCollector,
): void {
  if (collector.collected.length === 0) return;

  ctx.registerPart('word/comments.xml', COMMENTS_CONTENT_TYPE, COMMENTS_REL_TYPE);
  ctx.registerPart('word/commentsExtended.xml', COMMENTS_EXTENDED_CONTENT_TYPE, COMMENTS_EXTENDED_REL_TYPE);
  ctx.registerPart('word/people.xml', PEOPLE_CONTENT_TYPE, PEOPLE_REL_TYPE);

  ctx.setFileContent('word/comments.xml', emitCommentsXml(spec, collector));
  ctx.setFileContent('word/commentsExtended.xml', emitCommentsExtendedXml(collector));
  ctx.setFileContent('word/people.xml', emitPeopleXml(spec, collector));
}

function emitCommentsXml(spec: DocumentSpec, collector: DraftingNoteCollector): string {
  const doc = parseXml(COMMENTS_SKELETON);
  const root = doc.documentElement!;
  for (const { id, note } of collector.collected) {
    const attrs: Record<string, string> = {
      'w:id': String(id),
      'w:author': authorFor(spec, note),
      'w:initials': initialsFor(authorFor(spec, note)),
    };
    const dateIso = note.dateIso ?? spec.meta?.createdIso;
    if (dateIso !== undefined) attrs['w:date'] = dateIso;
    const comment = createWmlElement(doc, W.comment, attrs);

    const p = createWmlElement(doc, W.p);
    p.setAttributeNS(OOXML.W14_NS, 'w14:paraId', paraIdFor(id));
    const run = createWmlElement(doc, W.r);
    run.appendChild(createWmlTextElement(doc, note.text));
    p.appendChild(run);
    comment.appendChild(p);
    root.appendChild(comment);
  }
  return XML_DECL + serializeXml(doc);
}

function emitCommentsExtendedXml(collector: DraftingNoteCollector): string {
  const doc = parseXml(`<w15:commentsEx xmlns:w15="${OOXML.W15_NS}"/>`);
  const root = doc.documentElement!;
  for (const { id } of collector.collected) {
    const commentEx = doc.createElementNS(OOXML.W15_NS, 'w15:commentEx');
    commentEx.setAttributeNS(OOXML.W15_NS, 'w15:paraId', paraIdFor(id));
    commentEx.setAttributeNS(OOXML.W15_NS, 'w15:done', '0');
    root.appendChild(commentEx);
  }
  return XML_DECL + serializeXml(doc);
}

function emitPeopleXml(spec: DocumentSpec, collector: DraftingNoteCollector): string {
  const doc = parseXml(`<w15:people xmlns:w15="${OOXML.W15_NS}"/>`);
  const root = doc.documentElement!;
  const seen = new Set<string>();
  for (const { note } of collector.collected) {
    const author = authorFor(spec, note);
    if (seen.has(author)) continue;
    seen.add(author);
    const person = doc.createElementNS(OOXML.W15_NS, 'w15:person');
    person.setAttributeNS(OOXML.W15_NS, 'w15:author', author);
    const presence = doc.createElementNS(OOXML.W15_NS, 'w15:presenceInfo');
    presence.setAttributeNS(OOXML.W15_NS, 'w15:providerId', 'None');
    presence.setAttributeNS(OOXML.W15_NS, 'w15:userId', author);
    person.appendChild(presence);
    root.appendChild(person);
  }
  return XML_DECL + serializeXml(doc);
}
