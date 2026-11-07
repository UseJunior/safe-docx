/**
 * Numbering Integration
 *
 * Gives every list paragraph a rendered numbering identity before comparison,
 * so tagged alignment tells a numbered paragraph from an unnumbered one with
 * the same text, and pairs paragraphs only within one list and level.
 *
 * Rendered labels remain virtual comparison identity and are never emitted as
 * document text. Tagged-tree alignment consumes this module.
 */

import type { WmlElement } from '@usejunior/docx-core';
import {
  computeParagraphListLabels,
  parseNumberingXml,
  parseStylesXml,
  parseXml,
} from '@usejunior/docx-core';

/**
 * Options for numbering integration.
 */
export interface NumberingIntegrationOptions {
  /** Enable numbering virtualization. Default: true */
  enabled: boolean;
}

/**
 * Default options for numbering integration.
 */
export const DEFAULT_NUMBERING_OPTIONS: NumberingIntegrationOptions = {
  enabled: true,
};

/** The package parts a story's list labels depend on. */
export interface NumberingIdentityParts {
  /** Raw `word/numbering.xml`. Without it no paragraph has an identity. */
  numberingXml?: string;
  /** Raw `word/styles.xml`, for numbering a paragraph inherits from its style. */
  stylesXml?: string;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Parse an optional part; a part that does not parse contributes nothing. */
function parsePart(xml: string | undefined, partName: string): Document | null {
  if (!xml) return null;
  try {
    return parseXml(xml, { partName });
  } catch (error) {
    console.warn(`Failed to parse ${partName}:`, error);
    return null;
  }
}

/**
 * Compute the rendered numbering identity (`numId:ilvl:label`) for every list
 * paragraph in story order. The identity is virtual comparison input only; it
 * is never serialized.
 *
 * Labels come from the read side's Word-faithful list model
 * (`computeParagraphListLabels`), so they match what Word and safe-docx's own
 * document view show: every `w:num` over one `w:abstractNum` continues one
 * sequence, a `w:startOverride` restarts it once, and a paragraph numbered
 * through its paragraph style chain is labelled and advances the shared
 * counters (style rules as Word applies them; see `resolveParagraphNumbering`).
 *
 * A paragraph gets an identity only when Word shows it a number: a level
 * whose format is `none`, or whose level text names a deeper level, renders
 * no label and the paragraph counts as unnumbered. Tagged alignment keys on
 * the list and level ({@link numberingListMembership}), not on the label, so
 * a clause renumbered by an inserted or deleted sibling stays paired.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.23
 * @see https://github.com/UseJunior/safe-docx/issues/1253
 */
export function computeNumberingIdentities(
  root: WmlElement,
  parts: NumberingIdentityParts,
  options: NumberingIntegrationOptions = DEFAULT_NUMBERING_OPTIONS,
): ReadonlyMap<WmlElement, string> {
  const identities = new Map<WmlElement, string>();
  if (!options.enabled) return identities;
  const numberingDocument = parsePart(parts.numberingXml, 'word/numbering.xml');
  if (!numberingDocument) return identities;
  const numbering = parseNumberingXml(numberingDocument);
  if (numbering.abstractNums.size === 0) return identities;
  const styles = parseStylesXml(parsePart(parts.stylesXml, 'word/styles.xml'));
  const paragraphs = Array.from(root.getElementsByTagNameNS(W_NS, 'p')) as WmlElement[];
  if (root.namespaceURI === W_NS && root.localName === 'p') paragraphs.unshift(root);
  for (const [paragraph, snapshot] of computeParagraphListLabels(paragraphs, numbering, styles)) {
    if (snapshot.label) identities.set(paragraph, `${snapshot.numId}:${snapshot.ilvl}:${snapshot.label}`);
  }
  return identities;
}

/**
 * The list and level part (`numId:ilvl`) of a numbering identity, without the
 * rendered label, or '' for a paragraph without one.
 */
export function numberingListMembership(identity: string | undefined): string {
  if (!identity) return '';
  const [numId, ilvl] = identity.split(':', 2);
  return `${numId}:${ilvl}`;
}
