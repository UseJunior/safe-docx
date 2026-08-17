/**
 * Format Change Detection Module
 *
 * Detects formatting changes (bold, italic, font size, etc.) between
 * documents after LCS comparison. Runs on atoms marked as Equal to
 * identify text that matches but has different formatting.
 *
 * Pipeline position:
 * LCS() → FlattenToAtomList() → detectMovesInAtomList() → detectFormatChangesInAtomList() → CoalesceRecurse()
 *
 * @see design.md Decision 10: Format Change Detection as Post-LCS Phase
 */

import {
  ComparisonUnitAtom,
  CorrelationStatus,
  DEFAULT_FORMAT_DETECTION_SETTINGS,
  FormatChangeInfo,
  FormatDetectionSettings,
} from '@usejunior/docx-core';
import { childElements } from '@usejunior/docx-core';
import { parseXml } from '@usejunior/docx-core';
import {
  areRunPropertiesEqual,
  getChangedPropertyNames,
  normalizeDirectProperties,
} from './propertyNaming.js';

export {
  areRunPropertiesEqual,
  areNormalizedRunPropertiesEqual,
  categorizePropertyChanges,
  getChangedPropertyNames,
  normalizeRunProperties,
} from './propertyNaming.js';

// =============================================================================
// Run Property Extraction
// =============================================================================

/**
 * Extract run properties (w:rPr) from an atom's ancestor elements.
 *
 * Finds the w:r (run) element in ancestors and extracts its w:rPr child.
 *
 * @param atom - The atom to extract properties from
 * @returns The w:rPr element, or null if not found
 *
 * @example
 * // For an atom inside <w:r><w:rPr><w:b/></w:rPr><w:t>text</w:t></w:r>
 * // Returns the <w:rPr><w:b/></w:rPr> element
 */
export function getRunPropertiesFromAtom(
  atom: ComparisonUnitAtom,
): Element | null {
  // Find the w:r ancestor element
  const runElement = atom.ancestorElements?.find((a) => a.tagName === 'w:r');
  if (!runElement) {
    return null;
  }

  // Get the rPr child element
  for (const child of childElements(runElement)) {
    if (child.tagName === 'w:rPr') return child;
  }
  return null;
}

// =============================================================================
// Main Algorithm
// =============================================================================

/**
 * Detect format changes in a flat list of atoms.
 *
 * Runs after LCS and move detection to identify Equal atoms where the text
 * matches but formatting differs. Updates atoms in place with format change status.
 *
 * @param atoms - The atom list to process (modified in place)
 * @param settings - Format detection settings (optional, uses defaults)
 */
export function detectFormatChangesInAtomList(
  atoms: ComparisonUnitAtom[],
  settings: FormatDetectionSettings = DEFAULT_FORMAT_DETECTION_SETTINGS,
): void {
  if (!settings.detectFormatChanges) {
    return;
  }

  for (const atom of atoms) {
    // Only check Equal atoms that have a "before" reference
    if (atom.correlationStatus !== CorrelationStatus.Equal) {
      continue;
    }

    if (!atom.comparisonUnitAtomBefore) {
      continue;
    }

    // Extract rPr from both documents
    const oldRPr = getRunPropertiesFromAtom(atom.comparisonUnitAtomBefore);
    const newRPr = getRunPropertiesFromAtom(atom);

    // Compare run properties
    if (!areRunPropertiesEqual(oldRPr, newRPr)) {
      atom.correlationStatus = CorrelationStatus.FormatChanged;
      atom.formatChange = {
        oldRunProperties: oldRPr,
        newRunProperties: newRPr,
        changedProperties: getChangedPropertyNames(oldRPr, newRPr),
      };
    }
  }
}

// =============================================================================
// Format Change Markup Generation
// =============================================================================

/**
 * Options for generating format change markup.
 */
export interface FormatChangeMarkupOptions {
  /** Author name for revision tracking */
  author: string;
  /** Timestamp for revisions */
  dateTime: Date;
  /** ID for the w:rPrChange element */
  id: number;
}

/**
 * Merge format change markup into a run's existing rPr element.
 *
 * Adds the w:rPrChange element as the last child of w:rPr.
 *
 * @param runElement - The w:r element to modify
 * @param rPrChange - The w:rPrChange element to insert
 */
export function mergeFormatChangeIntoRun(
  runElement: Element,
  rPrChange: Element,
): void {
  if (runElement.tagName !== 'w:r') {
    return;
  }

  // Find existing rPr
  let rPr: Element | null = null;
  for (const child of childElements(runElement)) {
    if (child.tagName === 'w:rPr') {
      rPr = child;
      break;
    }
  }

  if (!rPr) {
    // Create rPr as first child
    const doc = runElement.ownerDocument!;
    rPr = doc.createElementNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'w:rPr',
    );
    runElement.insertBefore(rPr, runElement.firstChild);
  }

  // Add rPrChange as last child of rPr
  rPr.appendChild(rPrChange);
}

// =============================================================================
// Paragraph Property Change Support (Future Enhancement)
// =============================================================================

/**
 * Extract paragraph properties (w:pPr) from an element.
 *
 * @param paragraphElement - The w:p element
 * @returns The w:pPr element, or null if not found
 */
export function getParagraphProperties(
  paragraphElement: Element,
): Element | null {
  if (paragraphElement.tagName !== 'w:p') {
    return null;
  }
  for (const child of childElements(paragraphElement)) {
    if (child.tagName === 'w:pPr') return child;
  }
  return null;
}

/**
 * Paragraph property friendly names.
 */
export const PARAGRAPH_PROPERTY_FRIENDLY_NAMES: Record<string, string> = {
  'w:jc': 'alignment',
  'w:ind': 'indentation',
  'w:spacing': 'spacing',
  'w:pStyle': 'style',
  'w:numPr': 'numbering',
  'w:pBdr': 'borders',
  'w:shd': 'shading',
  'w:tabs': 'tabs',
  'w:keepNext': 'keepWithNext',
  'w:keepLines': 'keepLinesTogether',
  'w:pageBreakBefore': 'pageBreakBefore',
  'w:widowControl': 'widowControl',
  'w:outlineLvl': 'outlineLevel',
};

// =============================================================================
// Legacy API — kept for backward compatibility during migration
// =============================================================================

/**
 * @deprecated Use areRunPropertiesEqual directly with Element params
 */
export function normalizeParagraphProperties(pPr: Element | null) {
  return normalizeDirectProperties(pPr);
}

/**
 * @deprecated Removed — use generateFormatChangeMarkup with DOM approach
 */
export function generateFormatChangeMarkup(
  formatChange: FormatChangeInfo,
  options: FormatChangeMarkupOptions,
): Element {
  const doc = parseXml('<root/>');
  const dateStr = options.dateTime.toISOString();
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  const rPrChange = doc.createElementNS(W_NS, 'w:rPrChange');
  rPrChange.setAttribute('w:id', options.id.toString());
  rPrChange.setAttribute('w:author', options.author);
  rPrChange.setAttribute('w:date', dateStr);

  const rPr = doc.createElementNS(W_NS, 'w:rPr');
  rPrChange.appendChild(rPr);

  if (formatChange.oldRunProperties) {
    for (const child of childElements(formatChange.oldRunProperties)) {
      if (child.tagName === 'w:rPrChange') continue;
      rPr.appendChild(child.cloneNode(true));
    }
  }

  return rPrChange;
}
