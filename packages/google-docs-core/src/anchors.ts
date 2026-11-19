import type { GDocsDocument, GDocsRequest } from './google-api-types.js';
import type { CachedParagraph } from './types.js';
import type { DocumentWithTabs, NamedRangeSchema } from './google-api-types.js';

const ANCHOR_PREFIX = '_bk_';

/** Generate a named range name with the _bk_ prefix */
export function generateAnchorName(index: number): string {
  return `${ANCHOR_PREFIX}${index.toString(16).padStart(10, '0')}`;
}

function allocateAnchorNames(count: number, startCounter: number, occupiedNames: ReadonlySet<string>): string[] {
  const used = new Set(occupiedNames);
  const names: string[] = [];
  let counter = startCounter;
  while (names.length < count) {
    const candidate = generateAnchorName(counter++);
    if (used.has(candidate)) continue;
    used.add(candidate);
    names.push(candidate);
  }
  return names;
}

/** Check if a named range name is an internal safe-docx anchor */
export function isInternalAnchor(name: string): boolean {
  return name.startsWith(ANCHOR_PREFIX);
}

/**
 * Build createNamedRange requests for all paragraphs without anchors.
 * Each named range spans startIndex to startIndex+1 (first character of the paragraph).
 */
export function buildNamedRangeInjectionRequests(
  paragraphs: CachedParagraph[],
  existingCount: number,
  occupiedNames: ReadonlySet<string> = new Set(),
): GDocsRequest[] {
  const requests: GDocsRequest[] = [];
  const names = allocateAnchorNames(
    paragraphs.filter((paragraph) => !paragraph.anchorName).length,
    existingCount,
    occupiedNames,
  );
  let nameIndex = 0;

  for (const para of paragraphs) {
    if (para.anchorName) continue; // Already has an anchor
    const name = names[nameIndex++]!;
    requests.push({
      createNamedRange: {
        name,
        range: {
          startIndex: para.startIndex,
          endIndex: para.startIndex + 1,
          ...(para.tabId ? { tabId: para.tabId } : {}),
        },
      },
    });
  }
  return requests;
}

/**
 * Map createNamedRange responses to anchor names.
 * Returns a Map of Google namedRangeId -> _bk_ name.
 */
export function mapNamedRangeResponses(
  responses: Array<{ createNamedRange?: { namedRangeId?: string } }>,
  startCounter: number,
  occupiedNames: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const mapping = new Map<string, string>(); // namedRangeId -> _bk_ name
  const names = allocateAnchorNames(
    responses.filter((response) => response.createNamedRange?.namedRangeId).length,
    startCounter,
    occupiedNames,
  );
  let nameIndex = 0;

  for (const resp of responses) {
    if (resp.createNamedRange?.namedRangeId) {
      const name = names[nameIndex++]!;
      mapping.set(resp.createNamedRange.namedRangeId, name);
    }
  }
  return mapping;
}

/**
 * Extract existing _bk_ named ranges from document structure.
 *
 * With `includeTabsContent=true`, named ranges are found in
 * `tabs[].documentTab.namedRanges`, NOT in `doc.namedRanges`.
 * We also fall back to doc-level `namedRanges` for non-tab-aware reads.
 */
export function extractExistingAnchors(
  doc: GDocsDocument,
): Map<string, { namedRangeId: string; name: string; startIndex: number; tabId: string }> {
  const anchors = new Map<string, { namedRangeId: string; name: string; startIndex: number; tabId: string }>();
  const docWithTabs = doc as DocumentWithTabs;

  // Tab-level named ranges (primary path with includeTabsContent=true)
  for (const tab of docWithTabs.tabs ?? []) {
    const tabId = tab.tabProperties?.tabId ?? '';
    const namedRanges = tab.documentTab?.namedRanges ?? {};
    extractFromNamedRangesMap(namedRanges, tabId, anchors);
  }

  // Doc-level named ranges (fallback for non-tab-aware reads)
  if (anchors.size === 0) {
    const docNamedRanges = doc.namedRanges;
    if (docNamedRanges) {
      extractFromNamedRangesMap(docNamedRanges, '', anchors);
    }
  }

  return anchors;
}

function extractFromNamedRangesMap(
  namedRanges: Record<string, NamedRangeSchema>,
  tabId: string,
  anchors: Map<string, { namedRangeId: string; name: string; startIndex: number; tabId: string }>,
): void {
  for (const [name, rangeInfo] of Object.entries(namedRanges)) {
    if (!isInternalAnchor(name)) continue;
    // namedRanges is keyed by name; each has a namedRanges array with the actual range entries
    for (const entry of rangeInfo.namedRanges ?? []) {
      const namedRangeId = entry.namedRangeId ?? '';
      const startIndex = entry.ranges?.[0]?.startIndex ?? 0;
      anchors.set(namedRangeId, { namedRangeId, name, startIndex, tabId });
    }
  }
}

/**
 * Build deleteNamedRange requests for all _bk_ anchors (cleanup).
 */
export function buildAnchorCleanupRequests(
  anchorIds: string[],
): GDocsRequest[] {
  return anchorIds.map(namedRangeId => ({
    deleteNamedRange: { namedRangeId },
  }));
}

// Re-export old names for backward compatibility during transition
export { ANCHOR_PREFIX as BOOKMARK_PREFIX };
export { generateAnchorName as generateBookmarkName };
export { isInternalAnchor as isInternalBookmark };
