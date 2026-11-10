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

const GRAPHIC_CARRIERS = ['drawing', 'pict', 'object'] as const;

/**
 * Whether a header/footer part shows nothing: no text, and no drawing, VML
 * picture or embedded object other than a text-box carrier (whose own story
 * text counts as text). A blank part reads the same as no binding, which is
 * how a lifecycle story whose content is entirely a tracked insertion
 * (rejected) or deletion (accepted) leaves its slot.
 *
 * Pass the part after the same Accept All / Reject All as the document.
 */
export function isBlankStoryPart(partXml: string): boolean {
  if (extractRoundTripComparisonText(partXml).trim() !== '') return false;
  const root = parseXml(partXml).documentElement;
  for (const localName of GRAPHIC_CARRIERS) {
    for (const carrier of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, localName))) {
      if (carrier.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').length === 0) return false;
    }
  }
  return true;
}
