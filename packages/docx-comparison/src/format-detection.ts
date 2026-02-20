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
  RUN_PROPERTY_FRIENDLY_NAMES,
  WmlElement,
} from './core-types.js';

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
  atom: ComparisonUnitAtom
): WmlElement | null {
  // Find the w:r ancestor element
  const runElement = atom.ancestorElements?.find((a) => a.tagName === 'w:r');
  if (!runElement) {
    return null;
  }

  // Get the rPr child element
  return runElement.children?.find((c) => c.tagName === 'w:rPr') ?? null;
}

// =============================================================================
// Run Property Normalization
// =============================================================================

/**
 * Normalize run properties for comparison.
 *
 * Normalization ensures consistent comparison by:
 * 1. Treating null as equivalent to empty w:rPr
 * 2. Removing existing revision tracking elements (w:rPrChange)
 * 3. Sorting child elements by tag name
 * 4. Sorting attributes within each child
 *
 * @param rPr - The w:rPr element to normalize (can be null)
 * @returns Normalized w:rPr element
 */
export function normalizeRunProperties(rPr: WmlElement | null): WmlElement {
  if (!rPr) {
    return { tagName: 'w:rPr', attributes: {}, children: [] };
  }

  const normalizedChildren = (rPr.children ?? [])
    // Remove revision tracking elements
    .filter((e) => e.tagName !== 'w:rPrChange')
    // Sort by tag name for deterministic comparison
    .sort((a, b) => a.tagName.localeCompare(b.tagName))
    // Normalize each child
    .map((e) => ({
      tagName: e.tagName,
      attributes: Object.fromEntries(
        Object.entries(e.attributes).sort(([a], [b]) => a.localeCompare(b))
      ),
      // Include text content if present (for elements like w:u with text value)
      ...(e.textContent !== undefined ? { textContent: e.textContent } : {}),
    }));

  return {
    tagName: 'w:rPr',
    attributes: {},
    children: normalizedChildren,
  };
}

// =============================================================================
// Run Property Comparison
// =============================================================================

/**
 * Serialize a normalized w:rPr element to a string for comparison.
 *
 * @param rPr - The normalized w:rPr element
 * @returns Serialized string representation
 */
function serializeRunProperties(rPr: WmlElement): string {
  const parts: string[] = [];

  for (const child of rPr.children ?? []) {
    const attrs = Object.entries(child.attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    const textPart = child.textContent ? `|${child.textContent}` : '';
    parts.push(`<${child.tagName} ${attrs}${textPart}/>`);
  }

  return parts.join('');
}

/**
 * Check if two normalized run properties are equal.
 *
 * Uses string serialization for comparison to handle element ordering
 * and attribute differences consistently.
 *
 * @param rPr1 - First normalized w:rPr element
 * @param rPr2 - Second normalized w:rPr element
 * @returns True if properties are equal
 */
export function areRunPropertiesEqual(
  rPr1: WmlElement,
  rPr2: WmlElement
): boolean {
  const str1 = serializeRunProperties(rPr1);
  const str2 = serializeRunProperties(rPr2);
  return str1 === str2;
}

// =============================================================================
// Changed Property Detection
// =============================================================================

/**
 * Get the set of property tag names from a normalized w:rPr.
 */
function getPropertyTagNames(rPr: WmlElement): Set<string> {
  return new Set((rPr.children ?? []).map((c) => c.tagName));
}

/**
 * Find a property element by tag name in a normalized w:rPr.
 */
function findPropertyByTag(
  rPr: WmlElement,
  tagName: string
): WmlElement | undefined {
  return (rPr.children ?? []).find((c) => c.tagName === tagName);
}

/**
 * Check if two property elements have the same value.
 */
function arePropertiesValueEqual(
  prop1: WmlElement | undefined,
  prop2: WmlElement | undefined
): boolean {
  if (!prop1 && !prop2) return true;
  if (!prop1 || !prop2) return false;

  // Compare attributes
  const attrs1 = serializeRunProperties({ tagName: '', attributes: {}, children: [prop1] });
  const attrs2 = serializeRunProperties({ tagName: '', attributes: {}, children: [prop2] });
  return attrs1 === attrs2;
}

/**
 * Get the list of property names that changed between two run properties.
 *
 * Returns friendly names (e.g., "bold", "italic") when available,
 * otherwise returns the OOXML tag name.
 *
 * @param oldRPr - Normalized old run properties
 * @param newRPr - Normalized new run properties
 * @returns Array of changed property names
 */
export function getChangedPropertyNames(
  oldRPr: WmlElement,
  newRPr: WmlElement
): string[] {
  const changed: string[] = [];

  const oldTags = getPropertyTagNames(oldRPr);
  const newTags = getPropertyTagNames(newRPr);

  // All unique tags from both
  const allTags = new Set([...oldTags, ...newTags]);

  for (const tag of allTags) {
    const oldProp = findPropertyByTag(oldRPr, tag);
    const newProp = findPropertyByTag(newRPr, tag);

    if (!arePropertiesValueEqual(oldProp, newProp)) {
      // Use friendly name if available
      const friendlyName = RUN_PROPERTY_FRIENDLY_NAMES[tag] ?? tag;
      changed.push(friendlyName);
    }
  }

  return changed.sort();
}

/**
 * Categorize changed properties into added, removed, and modified.
 *
 * @param oldRPr - Normalized old run properties
 * @param newRPr - Normalized new run properties
 * @returns Object with added, removed, and changed arrays
 */
export function categorizePropertyChanges(
  oldRPr: WmlElement,
  newRPr: WmlElement
): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  const oldTags = getPropertyTagNames(oldRPr);
  const newTags = getPropertyTagNames(newRPr);

  // Check for added properties (in new but not old)
  for (const tag of newTags) {
    if (!oldTags.has(tag)) {
      const friendlyName = RUN_PROPERTY_FRIENDLY_NAMES[tag] ?? tag;
      added.push(friendlyName);
    }
  }

  // Check for removed properties (in old but not new)
  for (const tag of oldTags) {
    if (!newTags.has(tag)) {
      const friendlyName = RUN_PROPERTY_FRIENDLY_NAMES[tag] ?? tag;
      removed.push(friendlyName);
    }
  }

  // Check for changed properties (in both but different value)
  for (const tag of oldTags) {
    if (newTags.has(tag)) {
      const oldProp = findPropertyByTag(oldRPr, tag);
      const newProp = findPropertyByTag(newRPr, tag);
      if (!arePropertiesValueEqual(oldProp, newProp)) {
        const friendlyName = RUN_PROPERTY_FRIENDLY_NAMES[tag] ?? tag;
        changed.push(friendlyName);
      }
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
  };
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
 *
 * @example
 * const atoms = atomizeTree(document, [], part);
 * runLCSComparison(atoms);
 * detectMovesInAtomList(atoms);
 * detectFormatChangesInAtomList(atoms); // Updates atoms in place
 */
export function detectFormatChangesInAtomList(
  atoms: ComparisonUnitAtom[],
  settings: FormatDetectionSettings = DEFAULT_FORMAT_DETECTION_SETTINGS
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

    // Normalize for comparison
    const normalizedOld = normalizeRunProperties(oldRPr);
    const normalizedNew = normalizeRunProperties(newRPr);

    // Compare run properties
    if (!areRunPropertiesEqual(normalizedOld, normalizedNew)) {
      atom.correlationStatus = CorrelationStatus.FormatChanged;
      atom.formatChange = {
        oldRunProperties: oldRPr,
        newRunProperties: newRPr,
        changedProperties: getChangedPropertyNames(normalizedOld, normalizedNew),
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
 * Generate w:rPrChange markup for a format change.
 *
 * Creates the revision tracking element that records the old formatting.
 *
 * @param formatChange - The format change information
 * @param options - Markup generation options
 * @returns The w:rPrChange element to insert
 *
 * @example
 * Output structure:
 * <w:rPrChange w:id="1" w:author="Author" w:date="...">
 *   <w:rPr>
 *     <!-- old properties -->
 *   </w:rPr>
 * </w:rPrChange>
 */
export function generateFormatChangeMarkup(
  formatChange: FormatChangeInfo,
  options: FormatChangeMarkupOptions
): WmlElement {
  const dateStr = options.dateTime.toISOString();

  // Clone old properties or create empty rPr
  const oldRPrChildren: WmlElement[] = [];
  if (formatChange.oldRunProperties?.children) {
    for (const child of formatChange.oldRunProperties.children) {
      // Skip existing rPrChange elements
      if (child.tagName === 'w:rPrChange') continue;

      oldRPrChildren.push({
        tagName: child.tagName,
        attributes: { ...child.attributes },
        ...(child.textContent !== undefined
          ? { textContent: child.textContent }
          : {}),
      });
    }
  }

  return {
    tagName: 'w:rPrChange',
    attributes: {
      'w:id': options.id.toString(),
      'w:author': options.author,
      'w:date': dateStr,
    },
    children: [
      {
        tagName: 'w:rPr',
        attributes: {},
        children: oldRPrChildren,
      },
    ],
  };
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
  runElement: WmlElement,
  rPrChange: WmlElement
): void {
  if (runElement.tagName !== 'w:r') {
    return;
  }

  // Find existing rPr or create one
  let rPr = runElement.children?.find((c) => c.tagName === 'w:rPr');

  if (!rPr) {
    rPr = { tagName: 'w:rPr', attributes: {}, children: [] };
    runElement.children = [rPr, ...(runElement.children ?? [])];
  }

  // Add rPrChange as last child of rPr
  rPr.children = [...(rPr.children ?? []), rPrChange];
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
  paragraphElement: WmlElement
): WmlElement | null {
  if (paragraphElement.tagName !== 'w:p') {
    return null;
  }
  return paragraphElement.children?.find((c) => c.tagName === 'w:pPr') ?? null;
}

/**
 * Normalize paragraph properties for comparison.
 *
 * Similar to run property normalization but for w:pPr.
 *
 * @param pPr - The w:pPr element to normalize (can be null)
 * @returns Normalized w:pPr element
 */
export function normalizeParagraphProperties(
  pPr: WmlElement | null
): WmlElement {
  if (!pPr) {
    return { tagName: 'w:pPr', attributes: {}, children: [] };
  }

  const normalizedChildren = (pPr.children ?? [])
    // Remove revision tracking elements
    .filter((e) => e.tagName !== 'w:pPrChange')
    // Sort by tag name
    .sort((a, b) => a.tagName.localeCompare(b.tagName))
    // Normalize each child
    .map((e) => ({
      tagName: e.tagName,
      attributes: Object.fromEntries(
        Object.entries(e.attributes).sort(([a], [b]) => a.localeCompare(b))
      ),
      ...(e.textContent !== undefined ? { textContent: e.textContent } : {}),
    }));

  return {
    tagName: 'w:pPr',
    attributes: {},
    children: normalizedChildren,
  };
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
