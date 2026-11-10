/**
 * Effective header/footer bindings: the part Word shows for each section,
 * header/footer kind and type once inheritance and the display switches are
 * applied.
 *
 * `auditSectPr` lists the literal `w:headerReference`/`w:footerReference`
 * elements of each section. A reader does not see those. It sees, per section:
 *
 * - for each type (`default`, `first`, `even`), the section's own reference,
 *   or else the part the previous section shows for that type; the first
 *   section with no reference of a type gets a blank story of that type
 *   (ECMA-376 Part 1 §17.10.5 for headers, §17.10.2 for footers);
 * - the `default` (odd page) story always;
 * - the `first` story only when the section sets `w:titlePg` (§17.10.6), and
 *   then never the `default` story in its place;
 * - the `even` story only when the settings part sets `w:evenAndOddHeaders`
 *   (§17.10.1), and then never the `default` story in its place.
 *
 * Inheritance follows references, not content: a section that inherits a
 * story shows the same part as the section it inherits from, even when its
 * own display switches differ.
 *
 * The resolver works on whatever document it is given, so apply Accept All
 * or Reject All first (`acceptAllChanges`/`rejectAllChanges`, which carry a
 * removed section's references forward as Word does, #1144) to get the
 * bindings Word shows after that action.
 *
 * Pagination (whether a section has a first, an even or only one page) is not
 * modelled: a slot is `displayed` when Word would use it for some page of the
 * section.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 * @see https://github.com/UseJunior/safe-docx/issues/1204
 */

import {
  auditSectPr,
  OOXML,
  parseXml,
  type SectPrAuditIssue,
  type SectPrBinding,
  type SectPrBindingKind,
  type SectPrBindingRole,
} from '@usejunior/docx-core';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';

export type StoryKind = SectPrBindingKind;
export type StoryRole = SectPrBindingRole;

export const STORY_KINDS: readonly StoryKind[] = ['header', 'footer'];
export const STORY_ROLES: readonly StoryRole[] = ['default', 'first', 'even'];

/** One section × kind × role, after inheritance. */
export interface EffectiveStorySlot {
  /** Position of the section's `w:sectPr` in document order (as in `auditSectPr`). */
  sectionOrdinal: number;
  kind: StoryKind;
  role: StoryRole;
  /**
   * The package part shown for this slot: the section's own reference, else
   * the one the previous section shows. `undefined` means a blank story: no
   * section so far binds this kind and role.
   */
  targetPath: string | undefined;
  /** Section whose reference supplies `targetPath`; `undefined` when blank. */
  sourceSectionOrdinal: number | undefined;
  /** True when `targetPath` comes from an earlier section's reference. */
  inherited: boolean;
  /**
   * Whether Word uses this role on any page of the section: `default` always,
   * `first` only under `w:titlePg`, `even` only under `w:evenAndOddHeaders`.
   * A slot that is not displayed still resolves, so a later section that
   * turns the switch on inherits through it.
   */
  displayed: boolean;
  /** The section's own reference for this kind and role, if it has one. */
  explicit: SectPrBinding | undefined;
}

export interface EffectiveStoryBindings {
  /** False when `auditSectPr` reported issues; `slots` then covers only the valid references. */
  ok: boolean;
  issues: SectPrAuditIssue[];
  sectionCount: number;
  /** `w:titlePg` per section ordinal. */
  titlePages: boolean[];
  /** `w:evenAndOddHeaders` from the settings part. */
  evenAndOddHeaders: boolean;
  /** Every slot, ordered by section ordinal, then kind (header, footer), then role (default, first, even). */
  slots: EffectiveStorySlot[];
}

export interface EffectiveStoryBindingInput {
  documentXml: string;
  /** `word/_rels/document.xml.rels`. */
  relationshipsXml?: string | null;
  /** `word/settings.xml`; omitted or null means `w:evenAndOddHeaders` is off. */
  settingsXml?: string | null;
  /** Bound parts by path, to have `auditSectPr` check their root elements too. */
  packageParts?: ReadonlyMap<string, string>;
}

function isW(node: Node | null | undefined, localName: string): node is Element {
  return !!node && node.nodeType === 1
    && (node as Element).namespaceURI === OOXML.W_NS
    && (node as Element).localName === localName;
}

/**
 * An on/off property (§17.17.4) is on when present with no `w:val`, or with
 * `true`, `1` or `on`.
 */
function onOffProperty(element: Element | undefined): boolean {
  if (!element) return false;
  const value = element.getAttributeNS(OOXML.W_NS, 'val') || element.getAttribute('w:val');
  return !value || value === 'true' || value === '1' || value === 'on';
}

function directChild(parent: Element, localName: string): Element | undefined {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (isW(node, localName)) return node;
  }
  return undefined;
}

/**
 * The live `w:sectPr` elements in the same order `auditSectPr` numbers them:
 * every `w:sectPr` except history snapshots under `w:sectPrChange`.
 */
function sectionPropertiesInAuditOrder(documentXml: string): Element[] {
  const document = parseXml(documentXml);
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'sectPr')).filter((sectPr) => {
    for (let ancestor = sectPr.parentNode; ancestor; ancestor = ancestor.parentNode) {
      if (isW(ancestor, 'sectPrChange')) return false;
    }
    return true;
  });
}

/** Whether the settings part turns on different even and odd page headers (§17.10.1). */
export function evenAndOddHeadersEnabled(settingsXml: string | null | undefined): boolean {
  if (!settingsXml) return false;
  const settings = parseXml(settingsXml).documentElement;
  return onOffProperty(directChild(settings, 'evenAndOddHeaders'));
}

/**
 * Resolve the header/footer part each section shows, per kind and role.
 */
export function resolveEffectiveStoryBindings(
  input: EffectiveStoryBindingInput,
): EffectiveStoryBindings {
  const audit = auditSectPr(input.documentXml, input.relationshipsXml, input.packageParts);
  const sections = sectionPropertiesInAuditOrder(input.documentXml);
  const titlePages = sections.map((sectPr) => onOffProperty(directChild(sectPr, 'titlePg')));
  const evenAndOddHeaders = evenAndOddHeadersEnabled(input.settingsXml);

  const explicitBySlot = new Map<string, SectPrBinding>();
  for (const binding of audit.bindings) {
    explicitBySlot.set(storySlotKey(binding), binding);
  }

  const slots: EffectiveStorySlot[] = [];
  const shown = new Map<string, { targetPath: string; sourceSectionOrdinal: number }>();
  for (let sectionOrdinal = 0; sectionOrdinal < sections.length; sectionOrdinal += 1) {
    for (const kind of STORY_KINDS) {
      for (const role of STORY_ROLES) {
        const lineage = `${kind}:${role}`;
        const explicit = explicitBySlot.get(storySlotKey({ sectionOrdinal, kind, role }));
        if (explicit) {
          shown.set(lineage, { targetPath: explicit.targetPath, sourceSectionOrdinal: sectionOrdinal });
        }
        const source = shown.get(lineage);
        slots.push({
          sectionOrdinal,
          kind,
          role,
          targetPath: source?.targetPath,
          sourceSectionOrdinal: source?.sourceSectionOrdinal,
          inherited: source !== undefined && explicit === undefined,
          displayed:
            role === 'default' ||
            (role === 'first' && titlePages[sectionOrdinal] === true) ||
            (role === 'even' && evenAndOddHeaders),
          explicit,
        });
      }
    }
  }

  return {
    ok: audit.ok,
    issues: audit.issues,
    sectionCount: sections.length,
    titlePages,
    evenAndOddHeaders,
    slots,
  };
}

/** The slots Word uses on some page of their section. */
export function displayedStorySlots(bindings: EffectiveStoryBindings): EffectiveStorySlot[] {
  return bindings.slots.filter((slot) => slot.displayed);
}

/** The slot for one section, kind and role, or `undefined` past the last section. */
export function effectiveStorySlot(
  bindings: EffectiveStoryBindings,
  slot: Pick<SectPrBinding, 'sectionOrdinal' | 'kind' | 'role'>,
): EffectiveStorySlot | undefined {
  if (slot.sectionOrdinal < 0 || slot.sectionOrdinal >= bindings.sectionCount) return undefined;
  return bindings.slots[
    slot.sectionOrdinal * STORY_KINDS.length * STORY_ROLES.length +
    STORY_KINDS.indexOf(slot.kind) * STORY_ROLES.length +
    STORY_ROLES.indexOf(slot.role)
  ];
}

/** `"<sectionOrdinal>:<kind>:<role>"`. */
export function storySlotKey(slot: Pick<SectPrBinding, 'sectionOrdinal' | 'kind' | 'role'>): string {
  return `${slot.sectionOrdinal}:${slot.kind}:${slot.role}`;
}

/** A kind of page a section's header or footer appears on. */
export type StoryPage = 'first' | 'odd' | 'even';
export const STORY_PAGES: readonly StoryPage[] = ['first', 'odd', 'even'];

/** The slot that supplies one kind of page of one section. */
export interface PageStorySlot {
  page: StoryPage;
  slot: EffectiveStorySlot;
}

/**
 * Which slot supplies each kind of page, per section and kind: the first page
 * shows the `first` story under `w:titlePg` and otherwise the `default` one;
 * odd pages always show the `default` story; even pages show the `even` story
 * under `w:evenAndOddHeaders` and otherwise the `default` one (§17.10.6,
 * §17.10.1). Unlike `displayedStorySlots`, a switch that changes which story a
 * page uses changes this list even when the story it now uses is blank.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 */
export function pageStorySlots(bindings: EffectiveStoryBindings): PageStorySlot[] {
  const pages: PageStorySlot[] = [];
  for (let sectionOrdinal = 0; sectionOrdinal < bindings.sectionCount; sectionOrdinal += 1) {
    for (const kind of STORY_KINDS) {
      const slot = (role: StoryRole): EffectiveStorySlot =>
        effectiveStorySlot(bindings, { sectionOrdinal, kind, role })!;
      pages.push(
        { page: 'first', slot: slot(bindings.titlePages[sectionOrdinal] ? 'first' : 'default') },
        { page: 'odd', slot: slot('default') },
        { page: 'even', slot: slot(bindings.evenAndOddHeaders ? 'even' : 'default') },
      );
    }
  }
  return pages;
}

const VML_NS = 'urn:schemas-microsoft-com:vml';
const WPS_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Elements that show nothing on their own in an otherwise empty story. */
const BLANK_STRUCTURE = new Set([
  'hdr', 'ftr', 'p', 'r', 't', 'tab', 'lastRenderedPageBreak',
  'sdt', 'sdtContent', 'customXml', 'smartTag', 'hyperlink',
  'bookmarkStart', 'bookmarkEnd', 'proofErr', 'permStart', 'permEnd',
  'tbl', 'tblGrid', 'gridCol', 'tr', 'tc', 'trPr',
]);
/** Property containers whose descendants are formatting, not content. */
const BLANK_PROPERTIES = new Set(['rPr', 'sdtPr', 'sdtEndPr', 'customXmlPr', 'smartTagPr']);
/**
 * Paragraph, table and cell properties that draw something even when the
 * paragraph or cell is empty. A table style can carry borders, so any
 * `w:tblStyle` counts too.
 */
const VISIBLE_PROPERTIES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['pPr', new Set(['pBdr', 'shd'])],
  ['tblPr', new Set(['tblBorders', 'shd', 'tblStyle'])],
  ['tblPrEx', new Set(['tblBorders', 'shd'])],
  ['tcPr', new Set(['tcBorders', 'shd'])],
]);
/** VML elements that draw a shape. */
const VML_SHAPES = new Set([
  'shape', 'rect', 'roundrect', 'oval', 'line', 'polyline', 'curve', 'arc', 'image', 'group',
]);
/** Graphics that are visible whatever else the carrier holds. */
const VISIBLE_GRAPHICS = new Set(['imagedata', 'blip', 'pic', 'chart', 'oleObject', 'OLEObject', 'binData']);

function childElements(element: Element): Element[] {
  const children: Element[] = [];
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) children.push(node as Element);
  }
  return children;
}

/**
 * The `w:txbxContent` stories of a graphic carrier (`w:pict`, `w:drawing` or
 * an `mc:AlternateContent` pair of them) that holds nothing but text boxes, or
 * `undefined` when the carrier holds anything else: a picture, chart or
 * object, a relationship-bound fill, or a shape without a text box.
 */
function pureTextBoxStories(carrier: Element): Element[] | undefined {
  const stories: Element[] = [];
  const visit = (element: Element): boolean => {
    if (element.namespaceURI === OOXML.W_NS && element.localName === 'txbxContent') {
      stories.push(element);
      return true;
    }
    if (VISIBLE_GRAPHICS.has(element.localName)) return false;
    for (let index = 0; index < element.attributes.length; index += 1) {
      if (element.attributes[index]!.namespaceURI === R_NS) return false;
    }
    if (element.namespaceURI === VML_NS && VML_SHAPES.has(element.localName) && element.localName !== 'group') {
      if (!childElements(element).some((child) => child.namespaceURI === VML_NS && child.localName === 'textbox')) {
        return false;
      }
    }
    if (element.namespaceURI === WPS_NS && element.localName === 'wsp') {
      if (!childElements(element).some((child) => child.namespaceURI === WPS_NS && child.localName === 'txbx')) {
        return false;
      }
    }
    return childElements(element).every(visit);
  };
  if (!visit(carrier) || stories.length === 0) return undefined;
  return stories;
}

/**
 * Whether a header/footer part shows nothing. It is blank when it has no text
 * and holds only empty paragraphs, formatting and bookmarks, plus at most the
 * shape of a text box whose own story is blank in the same sense. That shape
 * is what Accept All (Reject All) leaves of a lifecycle story whose content
 * is entirely a tracked deletion (insertion): the carrier run is not tracked,
 * so a blank part reads the same as no binding. A table counts only when it
 * draws something (borders, shading or a table style). Anything else counts
 * as content: a paragraph border or shading, a page number or other run
 * content, a field, a picture or a shape without a text box.
 *
 * Pass the part after the same Accept All / Reject All as the document.
 */
export function isBlankStoryPart(partXml: string): boolean {
  if (extractRoundTripComparisonText(partXml).trim() !== '') return false;
  const blank = (element: Element): boolean => {
    if (element.namespaceURI === OOXML.W_NS) {
      const visible = VISIBLE_PROPERTIES.get(element.localName);
      if (visible) {
        return childElements(element).every(
          (child) => !(child.namespaceURI === OOXML.W_NS && visible.has(child.localName)),
        );
      }
      if (BLANK_PROPERTIES.has(element.localName)) return true;
      if (element.localName === 'pict' || element.localName === 'drawing') {
        return pureTextBoxStories(element)?.every((story) => childElements(story).every(blank)) ?? false;
      }
      if (!BLANK_STRUCTURE.has(element.localName)) return false;
      return childElements(element).every(blank);
    }
    if (element.namespaceURI === MC_NS && element.localName === 'AlternateContent') {
      return pureTextBoxStories(element)?.every((story) => childElements(story).every(blank)) ?? false;
    }
    return false;
  };
  return blank(parseXml(partXml).documentElement);
}
