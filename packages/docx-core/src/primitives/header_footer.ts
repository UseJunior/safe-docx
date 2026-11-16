import { childElements, createWmlElement, getDirectChildrenByName, isW } from './dom-helpers.js';
import { OOXML, W } from './namespaces.js';
import { normalizeOpcRelationshipTarget } from './opc-target.js';
import { parseRelationshipEntries } from './relationships.js';
import { buildSectPrChangeElement, type RevisionContext } from './track-changes-emitter.js';
import { parseXml, serializeXml } from './xml.js';
import type { DocxZip } from './zip.js';

export type HeaderFooterKind = 'header' | 'footer';
export type HeaderFooterType = 'default' | 'first' | 'even';

export const HEADER_FOOTER_TYPES: readonly HeaderFooterType[] = ['default', 'first', 'even'];

const DOCUMENT_PART = 'word/document.xml';
const DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels';
const CONTENT_TYPES_PART = '[Content_Types].xml';
const SETTINGS_PART = 'word/settings.xml';

const REL_TYPE: Record<HeaderFooterKind, string> = {
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
};
const CONTENT_TYPE: Record<HeaderFooterKind, string> = {
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
};
const ROOT_NAME: Record<HeaderFooterKind, string> = { header: 'hdr', footer: 'ftr' };
const REFERENCE_NAME: Record<HeaderFooterKind, string> = {
  header: W.headerReference,
  footer: W.footerReference,
};
const STYLE_ID: Record<HeaderFooterKind, string> = { header: 'Header', footer: 'Footer' };

/** One header or footer type as it applies to one section. */
export type ResolvedHeaderFooterReference = {
  kind: HeaderFooterKind;
  type: HeaderFooterType;
  /** Relationship id in effect for the section (own or inherited); null when none. */
  relationshipId: string | null;
  /** Package part the relationship selects, e.g. `word/footer1.xml`; null when none or unresolvable. */
  partName: string | null;
  /** Index of the section whose reference is in effect; equals the section when it has its own reference. */
  sourceSectionIndex: number | null;
  /** True when the section has no reference of this type and takes the previous section's. */
  inherited: boolean;
};

export type SectionHeaderFooters = {
  sectionIndex: number;
  /** `w:titlePg`: the first-page header/footer is used on the section's first page. */
  titlePage: boolean;
  headers: ResolvedHeaderFooterReference[];
  footers: ResolvedHeaderFooterReference[];
};

export type HeaderFooterRun = { text: string } | { field: 'PAGE' | 'NUMPAGES' };

export type HeaderFooterParagraphContent = {
  alignment?: 'left' | 'center' | 'right' | 'both';
  runs: HeaderFooterRun[];
};

export type SetHeaderFooterSource =
  | { kind: 'content'; paragraphs: HeaderFooterParagraphContent[] }
  | { kind: 'existing'; relationshipId: string }
  | { kind: 'link_to_previous' };

export type SetHeaderFooterMutation = {
  kind: HeaderFooterKind;
  sectionIndex: number;
  type: HeaderFooterType;
  source: SetHeaderFooterSource;
};

export type PinnedFollowingSection = {
  sectionIndex: number;
  relationshipId: string;
  partName: string | null;
  partCreated: boolean;
};

export type SetHeaderFooterResult = {
  changed: boolean;
  sectionIndex: number;
  kind: HeaderFooterKind;
  type: HeaderFooterType;
  /** Reference in effect for the section after the change. */
  relationshipId: string | null;
  partName: string | null;
  partsCreated: string[];
  /** Relationship ids of the parts created by this call. */
  createdRelationshipIds: string[];
  /** Package parts other than document.xml that were written (new parts, relationships, content types). */
  packagePartsChanged: string[];
  /** Following sections given an explicit reference so their header/footer stays as it was. */
  pinnedSections: PinnedFollowingSection[];
  titlePageSet: boolean;
  evenAndOddHeaders: boolean;
};

export type HeaderFooterErrorCode =
  | 'SECTION_NOT_FOUND'
  | 'INVALID_HEADER_FOOTER_REQUEST'
  | 'RELATIONSHIP_NOT_FOUND';

export class HeaderFooterError extends Error {
  constructor(public readonly code: HeaderFooterErrorCode, message: string) {
    super(message);
    this.name = 'HeaderFooterError';
  }
}

function wAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) || el.getAttribute(`w:${localName}`) || null;
}

function rId(el: Element): string | null {
  return el.getAttributeNS(OOXML.R_NS, 'id') || el.getAttribute('r:id') || null;
}

/** An on/off property element is on unless its val is false/0/off. */
function onOffElementIsOn(el: Element | undefined): boolean {
  if (!el) return false;
  const val = wAttr(el, W.val);
  return val === null || !['false', '0', 'off'].includes(val);
}

/** Live main-document sectPr elements in document order (paragraph-level first, then body-level). */
function liveSectPrs(doc: Document): Element[] {
  const body = doc.getElementsByTagNameNS(OOXML.W_NS, W.body).item(0);
  if (!body) return [];
  const out: Element[] = [];
  const paragraphs = body.getElementsByTagNameNS(OOXML.W_NS, W.p);
  for (let i = 0; i < paragraphs.length; i++) {
    const pPr = getDirectChildrenByName(paragraphs.item(i) as Element, W.pPr)[0];
    const sectPr = pPr ? getDirectChildrenByName(pPr, W.sectPr)[0] : undefined;
    if (sectPr) out.push(sectPr);
  }
  const final = childElements(body).find((child) => isW(child, W.sectPr));
  if (final) out.push(final);
  return out;
}

function ownReferences(sectPr: Element, kind: HeaderFooterKind, type: HeaderFooterType): Element[] {
  return getDirectChildrenByName(sectPr, REFERENCE_NAME[kind])
    .filter((ref) => (wAttr(ref, W.type) ?? 'default') === type);
}

type RelationshipTargets = Map<string, { type: string | null; partName: string | null }>;

function relationshipTargets(relsDoc: Document | null): RelationshipTargets {
  const out: RelationshipTargets = new Map();
  for (const entry of parseRelationshipEntries(relsDoc).values()) {
    let partName: string | null = null;
    if (entry.target && entry.targetMode !== 'External') {
      try {
        partName = normalizeOpcRelationshipTarget({ ownerPart: DOCUMENT_PART, target: entry.target, targetMode: entry.targetMode }).target;
      } catch {
        partName = null;
      }
    }
    out.set(entry.id, { type: entry.type, partName });
  }
  return out;
}

/**
 * The relationship id in effect for each section for one kind and type. A
 * section without its own reference of a type takes the previous section's
 * (ECMA-376 Part 1 § 17.10.5); the first section without one has none.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 */
function effectiveReferences(sectPrs: Element[], kind: HeaderFooterKind, type: HeaderFooterType): Array<{ id: string | null; source: number | null; inherited: boolean }> {
  const out: Array<{ id: string | null; source: number | null; inherited: boolean }> = [];
  let current: { id: string | null; source: number | null } = { id: null, source: null };
  sectPrs.forEach((sectPr, index) => {
    const own = ownReferences(sectPr, kind, type)[0];
    if (own) {
      current = { id: rId(own), source: index };
      out.push({ ...current, inherited: false });
    } else {
      out.push({ ...current, inherited: current.id !== null });
    }
  });
  return out;
}

/**
 * Resolve every section's default, first-page and even-page header and footer,
 * following inheritance from earlier sections.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/1050
 */
export function resolveSectionHeaderFooters(doc: Document, relsDoc: Document | null): SectionHeaderFooters[] {
  const sectPrs = liveSectPrs(doc);
  const targets = relationshipTargets(relsDoc);
  const resolved = new Map<string, ReturnType<typeof effectiveReferences>>();
  for (const kind of ['header', 'footer'] as const) {
    for (const type of HEADER_FOOTER_TYPES) resolved.set(`${kind}:${type}`, effectiveReferences(sectPrs, kind, type));
  }
  return sectPrs.map((sectPr, sectionIndex) => {
    const project = (kind: HeaderFooterKind): ResolvedHeaderFooterReference[] => HEADER_FOOTER_TYPES.map((type) => {
      const entry = resolved.get(`${kind}:${type}`)![sectionIndex]!;
      return {
        kind,
        type,
        relationshipId: entry.id,
        partName: entry.id ? targets.get(entry.id)?.partName ?? null : null,
        sourceSectionIndex: entry.source,
        inherited: entry.inherited,
      };
    });
    return {
      sectionIndex,
      titlePage: onOffElementIsOn(getDirectChildrenByName(sectPr, W.titlePg)[0]),
      headers: project('header'),
      footers: project('footer'),
    };
  });
}

/**
 * Whether `w:evenAndOddHeaders` is on in the settings part.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 */
export function readEvenAndOddHeaders(settingsXml: string | null): boolean {
  if (!settingsXml) return false;
  const settings = parseXml(settingsXml);
  const el = settings.getElementsByTagNameNS(OOXML.W_NS, 'evenAndOddHeaders').item(0) as Element | null;
  return onOffElementIsOn(el ?? undefined);
}

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function runXml(inner: string): string {
  return `<w:r>${inner}</w:r>`;
}

function textRunXml(text: string): string {
  return runXml(`<w:t xml:space="preserve">${escapeXmlText(text)}</w:t>`);
}

/**
 * A complex field with a placeholder result Word and LibreOffice refresh on layout.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 */
function fieldRunsXml(field: 'PAGE' | 'NUMPAGES'): string {
  return [
    runXml('<w:fldChar w:fldCharType="begin"/>'),
    runXml(`<w:instrText xml:space="preserve"> ${field} </w:instrText>`),
    runXml('<w:fldChar w:fldCharType="separate"/>'),
    runXml('<w:t>1</w:t>'),
    runXml('<w:fldChar w:fldCharType="end"/>'),
  ].join('');
}

function paragraphXml(content: HeaderFooterParagraphContent | null, styleId: string | null): string {
  const pPrParts: string[] = [];
  if (styleId) pPrParts.push(`<w:pStyle w:val="${styleId}"/>`);
  if (content?.alignment) pPrParts.push(`<w:jc w:val="${content.alignment}"/>`);
  const pPr = pPrParts.length > 0 ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';
  const runs = (content?.runs ?? []).map((run) => ('field' in run ? fieldRunsXml(run.field) : textRunXml(run.text))).join('');
  return `<w:p>${pPr}${runs}</w:p>`;
}

/** Serialize a new header or footer part (Part 1 § 17.10.4 / § 17.10.3). */
export function buildHeaderFooterPartXml(
  kind: HeaderFooterKind,
  paragraphs: HeaderFooterParagraphContent[],
  styleId: string | null,
): string {
  const body = paragraphs.length > 0
    ? paragraphs.map((p) => paragraphXml(p, styleId)).join('')
    : paragraphXml(null, styleId);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<w:${ROOT_NAME[kind]} xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}">${body}</w:${ROOT_NAME[kind]}>`;
}

function validateContent(paragraphs: unknown): asserts paragraphs is HeaderFooterParagraphContent[] {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', 'Content must have at least one paragraph.');
  }
  for (const [i, p] of paragraphs.entries()) {
    if (!p || typeof p !== 'object' || !Array.isArray((p as HeaderFooterParagraphContent).runs)) {
      throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', `Paragraph ${i} must have a runs array.`);
    }
    const alignment = (p as HeaderFooterParagraphContent).alignment;
    if (alignment !== undefined && !['left', 'center', 'right', 'both'].includes(alignment)) {
      throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', `Paragraph ${i} alignment must be left, center, right or both.`);
    }
    for (const [j, run] of (p as HeaderFooterParagraphContent).runs.entries()) {
      const ok = run && typeof run === 'object' && (
        ('text' in run && typeof run.text === 'string' && !('field' in run))
        || ('field' in run && (run.field === 'PAGE' || run.field === 'NUMPAGES') && !('text' in run))
      );
      if (!ok) {
        throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', `Paragraph ${i} run ${j} must be {text} or {field: "PAGE" | "NUMPAGES"}.`);
      }
      if ('text' in run && /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(run.text)) {
        throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', `Paragraph ${i} run ${j} contains a control character XML cannot carry.`);
      }
    }
  }
}

function freeHeaderFooterPartPath(zip: DocxZip, kind: HeaderFooterKind, reserved: Set<string>): string {
  const taken = new Set(zip.listFiles().map((f) => f.toLowerCase()));
  for (let n = 1; ; n++) {
    const candidate = `word/${kind}${n}.xml`;
    if (!taken.has(candidate) && !reserved.has(candidate)) return candidate;
  }
}

function addRelationship(relsDoc: Document, type: string, target: string): string {
  const root = relsDoc.documentElement!;
  const ids = new Set(Array.from(relsDoc.getElementsByTagNameNS(OOXML.REL_NS, 'Relationship')).map((rel) => rel.getAttribute('Id')));
  let n = 1;
  while (ids.has(`rId${n}`)) n++;
  const prefix = root.prefix;
  const relationship = relsDoc.createElementNS(OOXML.REL_NS, prefix ? `${prefix}:Relationship` : 'Relationship');
  relationship.setAttribute('Id', `rId${n}`);
  relationship.setAttribute('Type', type);
  relationship.setAttribute('Target', target);
  root.appendChild(relationship);
  return `rId${n}`;
}

function ensureOverride(ctDoc: Document, partPath: string, contentType: string): void {
  const root = ctDoc.documentElement!;
  const partName = `/${partPath}`;
  const existing = Array.from(ctDoc.getElementsByTagNameNS(OOXML.CT_NS, 'Override'))
    .find((override) => (override.getAttribute('PartName') ?? '').toLowerCase() === partName.toLowerCase());
  if (existing) {
    existing.setAttribute('ContentType', contentType);
    return;
  }
  const prefix = root.prefix;
  const override = ctDoc.createElementNS(OOXML.CT_NS, prefix ? `${prefix}:Override` : 'Override');
  override.setAttribute('PartName', partName);
  override.setAttribute('ContentType', contentType);
  root.appendChild(override);
}

/** Header/footer references open CT_SectPr (Part 1 § 17.6.17), so a new one goes after the last existing one. */
function insertReference(doc: Document, sectPr: Element, kind: HeaderFooterKind, type: HeaderFooterType, id: string): void {
  const own = ownReferences(sectPr, kind, type);
  if (own[0]) {
    own[0].setAttributeNS(OOXML.R_NS, 'r:id', id);
    for (const duplicate of own.slice(1)) sectPr.removeChild(duplicate);
    return;
  }
  const ref = createWmlElement(doc, REFERENCE_NAME[kind], { 'w:type': type });
  ref.setAttributeNS(OOXML.R_NS, 'r:id', id);
  const refs = childElements(sectPr).filter((c) => isW(c, W.headerReference) || isW(c, W.footerReference));
  const last = refs[refs.length - 1];
  if (last) sectPr.insertBefore(ref, last.nextSibling);
  else sectPr.insertBefore(ref, sectPr.firstChild);
}

const AFTER_TITLE_PG = new Set(['textDirection', 'bidi', 'rtlGutter', 'docGrid', 'printerSettings', 'sectPrChange']);

function ensureTitlePage(doc: Document, sectPr: Element): boolean {
  const existing = getDirectChildrenByName(sectPr, W.titlePg)[0];
  if (existing && onOffElementIsOn(existing)) return false;
  if (existing) {
    existing.removeAttributeNS(OOXML.W_NS, W.val);
    existing.removeAttribute('w:val');
    return true;
  }
  const titlePg = createWmlElement(doc, W.titlePg);
  const before = childElements(sectPr).find((c) => c.namespaceURI === OOXML.W_NS && AFTER_TITLE_PG.has(c.localName));
  sectPr.insertBefore(titlePg, before ?? null);
  return true;
}

function stylesHaveStyle(stylesXml: string | null, styleId: string): boolean {
  if (!stylesXml) return false;
  const styles = parseXml(stylesXml);
  return Array.from(styles.getElementsByTagNameNS(OOXML.W_NS, 'style'))
    .some((style) => wAttr(style, 'styleId') === styleId);
}

/**
 * Create or reuse a header/footer part and set one section's reference to it,
 * or remove the section's own reference so it inherits from the previous
 * section. The following sections keep the header/footer they had: when the
 * change would alter what the next section inherits, the next section gets an
 * explicit reference to its previous part (or a new empty part when it had
 * none). Writes the part, its document relationship and its content-type
 * override; in tracked mode the section's previous properties are recorded
 * in `w:sectPrChange`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see https://github.com/UseJunior/safe-docx/issues/1052
 * @see https://github.com/UseJunior/safe-docx/issues/1200
 */
export async function setHeaderFooter(
  zip: DocxZip,
  doc: Document,
  mutation: SetHeaderFooterMutation,
  ctx?: RevisionContext,
  /**
   * Relationship ids of parts an earlier call created in this editing session.
   * New content for a section whose own reference is such a part, used by no
   * other section, rewrites that part instead of leaving it orphaned.
   */
  reusableRelationshipIds: ReadonlySet<string> = new Set(),
): Promise<SetHeaderFooterResult> {
  const { kind, type, sectionIndex, source } = mutation;
  if (kind !== 'header' && kind !== 'footer') {
    throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', 'kind must be "header" or "footer".');
  }
  if (!HEADER_FOOTER_TYPES.includes(type)) {
    throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', 'type must be "default", "first" or "even".');
  }
  const sectPrs = liveSectPrs(doc);
  const target = sectPrs[sectionIndex];
  if (!Number.isSafeInteger(sectionIndex) || !target) {
    throw new HeaderFooterError('SECTION_NOT_FOUND', `Section index ${sectionIndex} was not found.`);
  }
  if (source.kind === 'content') validateContent(source.paragraphs);
  if (source.kind === 'link_to_previous' && sectionIndex === 0) {
    throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', 'Section 0 has no previous section to link to.');
  }

  const relsText = await zip.readTextOrNull(DOCUMENT_RELS_PART);
  if (!relsText) throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', `The package has no ${DOCUMENT_RELS_PART}.`);
  const relsDoc = parseXml(relsText);
  const targets = relationshipTargets(relsDoc);
  if (source.kind === 'existing') {
    const rel = targets.get(source.relationshipId);
    if (!rel || rel.type !== REL_TYPE[kind] || !rel.partName || !zip.hasFile(rel.partName)) {
      throw new HeaderFooterError(
        'RELATIONSHIP_NOT_FOUND',
        `Relationship ${source.relationshipId} is not a ${kind} relationship of word/document.xml with an existing part.`,
      );
    }
  }

  const ctText = await zip.readTextOrNull(CONTENT_TYPES_PART);
  if (!ctText) throw new HeaderFooterError('INVALID_HEADER_FOOTER_REQUEST', 'The package has no [Content_Types].xml.');
  const ctDoc = parseXml(ctText);
  const styleId = stylesHaveStyle(await zip.readTextOrNull('word/styles.xml'), STYLE_ID[kind]) ? STYLE_ID[kind] : null;
  const evenAndOddHeaders = readEvenAndOddHeaders(await zip.readTextOrNull(SETTINGS_PART));

  const before = effectiveReferences(sectPrs, kind, type);
  const snapshots = new Map<Element, Element>();
  const snapshot = (sectPr: Element) => {
    if (!snapshots.has(sectPr)) snapshots.set(sectPr, sectPr.cloneNode(true) as Element);
  };
  const newParts: Array<{ path: string; xml: string }> = [];
  const rewrittenParts: Array<{ path: string; xml: string }> = [];
  const reserved = new Set<string>();
  const createdIds: string[] = [];
  const createPart = (paragraphs: HeaderFooterParagraphContent[]): { id: string; path: string } => {
    const path = freeHeaderFooterPartPath(zip, kind, reserved);
    reserved.add(path);
    newParts.push({ path, xml: buildHeaderFooterPartXml(kind, paragraphs, styleId) });
    ensureOverride(ctDoc, path, CONTENT_TYPE[kind]);
    const id = addRelationship(relsDoc, REL_TYPE[kind], path.slice('word/'.length));
    createdIds.push(id);
    return { id, path };
  };

  let titlePageSet = false;
  let targetId: string | null;
  if (source.kind === 'link_to_previous') {
    const own = ownReferences(target, kind, type);
    if (own.length > 0) {
      snapshot(target);
      for (const ref of own) target.removeChild(ref);
    }
  } else {
    const currentOwn = ownReferences(target, kind, type);
    const currentId = currentOwn.length === 1 ? rId(currentOwn[0]!) : null;
    // Rewrite a session-created part only when this section and type is its
    // sole consumer: no other reference of either kind, and no section showing
    // it by inheritance under any type.
    const soleConsumer = (id: string): boolean => {
      const explicit = sectPrs.flatMap((sectPr) => [
        ...getDirectChildrenByName(sectPr, W.headerReference),
        ...getDirectChildrenByName(sectPr, W.footerReference),
      ]).filter((ref) => rId(ref) === id);
      if (explicit.length !== 1) return false;
      for (const k of ['header', 'footer'] as const) {
        for (const t of HEADER_FOOTER_TYPES) {
          const effective = effectiveReferences(sectPrs, k, t);
          for (let i = 0; i < effective.length; i++) {
            if (effective[i]!.id === id && !(i === sectionIndex && k === kind && t === type)) return false;
          }
        }
      }
      return true;
    };
    const reusablePath = source.kind === 'content' && currentId && reusableRelationshipIds.has(currentId) && soleConsumer(currentId)
      ? targets.get(currentId)?.partName ?? null
      : null;
    let id: string;
    if (source.kind === 'existing') {
      id = source.relationshipId;
    } else if (reusablePath && currentId) {
      id = currentId;
      rewrittenParts.push({ path: reusablePath, xml: buildHeaderFooterPartXml(kind, source.paragraphs, styleId) });
    } else {
      id = createPart(source.paragraphs).id;
    }
    const current = ownReferences(target, kind, type);
    if (current.length !== 1 || rId(current[0]!) !== id) {
      snapshot(target);
      insertReference(doc, target, kind, type, id);
    }
    if (type === 'first') {
      const clone = target.cloneNode(true) as Element;
      if (ensureTitlePage(doc, target)) {
        if (!snapshots.has(target)) snapshots.set(target, clone);
        titlePageSet = true;
      }
    }
  }

  // Keep every following section's header/footer: the first following section
  // whose inherited reference changed gets its previous reference explicitly;
  // later sections then inherit as before.
  const pinnedSections: PinnedFollowingSection[] = [];
  for (let j = sectionIndex + 1; j < sectPrs.length; j++) {
    const after = effectiveReferences(sectPrs, kind, type);
    if (after[j]!.id === before[j]!.id) continue;
    const sectPr = sectPrs[j]!;
    if (ownReferences(sectPr, kind, type).length > 0) continue;
    snapshot(sectPr);
    let pinId = before[j]!.id;
    let partCreated = false;
    if (pinId === null) {
      pinId = createPart([]).id;
      partCreated = true;
    }
    insertReference(doc, sectPr, kind, type, pinId);
    const pinnedPath = partCreated ? newParts[newParts.length - 1]!.path : targets.get(pinId)?.partName ?? null;
    pinnedSections.push({ sectionIndex: j, relationshipId: pinId, partName: pinnedPath, partCreated });
  }

  const changed = snapshots.size > 0 || rewrittenParts.length > 0;
  if (ctx) {
    for (const [sectPr, old] of snapshots) {
      // An existing w:sectPrChange already holds the properties before the
      // earlier revision; keep it rather than overwrite that baseline.
      if (getDirectChildrenByName(sectPr, 'sectPrChange').length > 0) continue;
      sectPr.appendChild(buildSectPrChangeElement(old, ctx));
    }
  }

  const packagePartsChanged: string[] = [];
  for (const part of rewrittenParts) {
    zip.writeText(part.path, part.xml);
    packagePartsChanged.push(part.path);
  }
  if (newParts.length > 0) {
    for (const part of newParts) {
      zip.writeText(part.path, part.xml);
      packagePartsChanged.push(part.path);
    }
    zip.writeText(DOCUMENT_RELS_PART, serializeXml(relsDoc));
    zip.writeText(CONTENT_TYPES_PART, serializeXml(ctDoc));
    packagePartsChanged.push(DOCUMENT_RELS_PART, CONTENT_TYPES_PART);
  }

  const resultRefs = effectiveReferences(sectPrs, kind, type)[sectionIndex]!;
  const resultTargets = newParts.length > 0 ? relationshipTargets(relsDoc) : targets;
  targetId = resultRefs.id;
  return {
    changed,
    sectionIndex,
    kind,
    type,
    relationshipId: targetId,
    partName: targetId ? resultTargets.get(targetId)?.partName ?? null : null,
    partsCreated: newParts.map((p) => p.path),
    createdRelationshipIds: [...createdIds],
    packagePartsChanged,
    pinnedSections,
    titlePageSet,
    evenAndOddHeaders,
  };
}
