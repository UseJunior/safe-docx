/**
 * Numbering Integration
 *
 * Applies numbering resolution to atoms before comparison.
 * This allows detection of list renumbering changes.
 *
 * Rendered labels remain virtual comparison identity and are never emitted as
 * document text. Both atom and tagged-tree alignment consume this module.
 */

import type { ComparisonUnitAtom, WmlElement, ListLevelInfo } from '@usejunior/docx-core';
import {
  createNumberingState,
  getCounters,
  processNumberedParagraph,
  expandLevelTextWithLegal,
  parseLevelElement,
} from '@usejunior/docx-core';
import { findElement, parseDocumentXml } from './xmlToWmlElement.js';
import { childElements } from '@usejunior/docx-core';
import { appendIdentitySalt } from '../../atomizer.js';

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

/**
 * Parsed numbering definitions from numbering.xml.
 */
interface NumberingDefinitions {
  /** Abstract numbering definitions keyed by abstractNumId */
  abstractNums: Map<string, ListLevelInfo[]>;
  /** Num definitions mapping numId to abstractNumId */
  numToAbstractNum: Map<string, string>;
}

/**
 * Parse numbering.xml to extract numbering definitions.
 *
 * @param numberingXml - Raw numbering.xml content
 * @returns Parsed numbering definitions
 */
export function parseNumberingXml(
  numberingXml: string
): NumberingDefinitions {
  const definitions: NumberingDefinitions = {
    abstractNums: new Map(),
    numToAbstractNum: new Map(),
  };

  if (!numberingXml) {
    return definitions;
  }

  try {
    const root = parseDocumentXml(numberingXml);
    const numbering = findElement(root, 'w:numbering');

    if (!numbering) {
      return definitions;
    }

    // Parse abstract numbering definitions
    for (const child of childElements(numbering)) {
      if (child.tagName === 'w:abstractNum') {
        const abstractNumId = child.getAttribute('w:abstractNumId');
        if (abstractNumId) {
          const levels = parseAbstractNumLevels(child);
          definitions.abstractNums.set(abstractNumId, levels);
        }
      } else if (child.tagName === 'w:num') {
        const numId = child.getAttribute('w:numId');
        const abstractNumIdRef = findAbstractNumIdRef(child);
        if (numId && abstractNumIdRef) {
          definitions.numToAbstractNum.set(numId, abstractNumIdRef);
        }
      }
    }
  } catch (error) {
    // If parsing fails, return empty definitions
    console.warn('Failed to parse numbering.xml:', error);
  }

  return definitions;
}

/**
 * Parse level definitions from an abstractNum element.
 */
function parseAbstractNumLevels(abstractNum: WmlElement): ListLevelInfo[] {
  const levels: ListLevelInfo[] = [];

  for (const child of childElements(abstractNum)) {
    if (child.tagName === 'w:lvl') {
      levels.push(parseLevelElement(child));
    }
  }

  // Sort by ilvl
  levels.sort((a, b) => a.ilvl - b.ilvl);

  return levels;
}

/**
 * Find the abstractNumId reference in a num element.
 */
function findAbstractNumIdRef(numElement: WmlElement): string | null {
  for (const child of childElements(numElement)) {
    if (child.tagName === 'w:abstractNumId') {
      return child.getAttribute('w:val') || null;
    }
  }

  return null;
}

/**
 * Get the numId from a paragraph's numbering properties.
 */
function getNumIdFromParagraph(pAncestor: WmlElement): string | null {
  // Find w:pPr
  const pPr = childElements(pAncestor).find((c) => c.tagName === 'w:pPr');
  if (!pPr) {
    return null;
  }

  // Find w:numPr
  const numPr = childElements(pPr).find((c) => c.tagName === 'w:numPr');
  if (!numPr) {
    return null;
  }

  // Find w:numId
  const numId = childElements(numPr).find((c) => c.tagName === 'w:numId');
  return numId?.getAttribute('w:val') || null;
}

/**
 * Get the ilvl from a paragraph's numbering properties.
 */
function getIlvlFromParagraph(pAncestor: WmlElement): number {
  // Find w:pPr
  const pPr = childElements(pAncestor).find((c) => c.tagName === 'w:pPr');
  if (!pPr) {
    return 0;
  }

  // Find w:numPr
  const numPr = childElements(pPr).find((c) => c.tagName === 'w:numPr');
  if (!numPr) {
    return 0;
  }

  // Find w:ilvl
  const ilvl = childElements(numPr).find((c) => c.tagName === 'w:ilvl');
  const val = ilvl?.getAttribute('w:val');
  return val ? parseInt(val, 10) : 0;
}

function numberingIdentity(
  paragraph: WmlElement,
  definitions: NumberingDefinitions,
  numberingState: ReturnType<typeof createNumberingState>,
): string | undefined {
  const numId = getNumIdFromParagraph(paragraph);
  const ilvl = getIlvlFromParagraph(paragraph);
  if (!numId) return undefined;
  const numericNumId = Number.parseInt(numId, 10);
  if (!Number.isFinite(numericNumId)) return undefined;
  const abstractNumId = definitions.numToAbstractNum.get(numId);
  const levels = abstractNumId ? definitions.abstractNums.get(abstractNumId) : undefined;
  const levelInfo = levels?.[ilvl];
  if (!levels || !levelInfo) return undefined;
  const counter = processNumberedParagraph(numberingState, numericNumId, ilvl, levelInfo);
  const storedCounters = getCounters(numberingState, numericNumId);
  const counters = Array.from(
    { length: ilvl + 1 },
    (_, level) => storedCounters[level] ?? counter,
  );
  const label = expandLevelTextWithLegal(levelInfo.lvlText, counters, levels, ilvl);
  return label ? `${numId}:${ilvl}:${label}` : undefined;
}

/**
 * Compute the rendered numbering identity for every list paragraph in story order.
 * The identity is virtual comparison input only; it is never serialized.
 */
export function computeNumberingIdentities(
  root: WmlElement,
  numberingXml?: string,
  options: NumberingIntegrationOptions = DEFAULT_NUMBERING_OPTIONS,
): ReadonlyMap<WmlElement, string> {
  const identities = new Map<WmlElement, string>();
  if (!options.enabled || !numberingXml) return identities;
  const definitions = parseNumberingXml(numberingXml);
  if (definitions.abstractNums.size === 0) return identities;
  const paragraphs = Array.from(root.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'p',
  )) as WmlElement[];
  if (root.localName === 'p') paragraphs.unshift(root);
  const numberingState = createNumberingState();
  for (const paragraph of paragraphs) {
    const identity = numberingIdentity(paragraph, definitions, numberingState);
    if (identity) identities.set(paragraph, identity);
  }
  return identities;
}

/**
 * Apply numbering labels to atoms for comparison.
 *
 * The implementation:
 * 1. Parse numbering.xml
 * 2. Walk through paragraphs tracking numbering state
 * 3. Compute the rendered list label for each numbered paragraph
 * 4. Inject the label as a virtual atom or modify the hash
 *
 * @param atoms - Atoms to process
 * @param numberingXml - Raw numbering.xml content (optional)
 * @param options - Numbering integration options
 */
export function virtualizeNumberingLabels(
  atoms: ComparisonUnitAtom[],
  numberingXml?: string,
  options: NumberingIntegrationOptions = DEFAULT_NUMBERING_OPTIONS
): void {
  if (!options.enabled || !numberingXml) {
    return;
  }

  const definitions = parseNumberingXml(numberingXml);
  if (definitions.abstractNums.size === 0) {
    return;
  }

  const numberingState = createNumberingState();
  let lastParagraph: WmlElement | null = null;

  for (const atom of atoms) {
    // Find paragraph ancestor
    const pAncestor = atom.ancestorElements.find((a) => a.tagName === 'w:p');

    if (pAncestor && pAncestor !== lastParagraph) {
      lastParagraph = pAncestor;

      // Check if this paragraph has numbering
      const numId = getNumIdFromParagraph(pAncestor);
      const ilvl = getIlvlFromParagraph(pAncestor);

      if (numId) {
        const abstractNumId = definitions.numToAbstractNum.get(numId);
        if (abstractNumId) {
          const levels = definitions.abstractNums.get(abstractNumId);
          if (levels && levels[ilvl]) {
            const levelInfo = levels[ilvl]!;
            const counter = processNumberedParagraph(
              numberingState,
              parseInt(numId, 10),
              ilvl,
              levelInfo
            );

            // Build counter array for level text expansion
            const counters: number[] = [];
            const storedCounters = numberingState.counters.get(numId);
            for (let i = 0; i <= ilvl; i++) {
              counters.push(storedCounters?.[i] ?? counter);
            }

            // Compute the rendered label
            const label = expandLevelTextWithLegal(
              levelInfo.lvlText,
              counters,
              levels,
              ilvl
            );

            // Store the computed label on the atom for hash modification
            // This affects comparison by making atoms with different labels
            // have different hashes even if the text is the same
            if (label) {
              // Modify the atom's identity to include the numbering label so
              // atoms with different labels differ even when their text matches.
              appendIdentitySalt(atom, `:${numId}:${ilvl}:${label}`);
            }
          }
        }
      }
    }
  }
}

/**
 * Check if an atom is the first atom in its paragraph.
 * Used to determine when to process numbering.
 */
export function isFirstAtomInParagraph(
  atom: ComparisonUnitAtom,
  previousAtom: ComparisonUnitAtom | null
): boolean {
  if (!previousAtom) {
    return true;
  }

  const currentP = atom.ancestorElements.find((a) => a.tagName === 'w:p');
  const previousP = previousAtom.ancestorElements.find((a) => a.tagName === 'w:p');

  return currentP !== previousP;
}
