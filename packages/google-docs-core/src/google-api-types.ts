/**
 * Local TypeScript type definitions for Google API types actually used.
 * Replaces all `docs_v1.Schema$*` and `drive_v3.*` imports from googleapis.
 *
 * Also includes type extensions for features (tabs, tabId on ranges/locations)
 * that exist at runtime but may not be reflected in all googleapis versions.
 */

// ── Document structure ───────────────────────────────────────────────

export type GDocsTextRun = {
  content?: string;
  textStyle?: {
    link?: { url?: string };
    [key: string]: unknown;
  };
};

export type GDocsElement = {
  textRun?: GDocsTextRun;
  inlineObjectElement?: {
    textStyle?: {
      link?: { url?: string };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  autoText?: {
    type?: string;
    [key: string]: unknown;
  };
  startIndex?: number;
  endIndex?: number;
};

export type GDocsParagraphStyle = {
  namedStyleType?: string;
  alignment?: string;
  indentFirstLine?: { magnitude?: number; unit?: string };
  indentStart?: { magnitude?: number; unit?: string };
  [key: string]: unknown;
};

export type GDocsParagraph = {
  elements?: GDocsElement[];
  paragraphStyle?: GDocsParagraphStyle;
};

export type GDocsTableCell = {
  content?: GDocsStructuralElement[];
  [key: string]: unknown;
};

export type GDocsTableRow = {
  tableCells?: GDocsTableCell[];
  [key: string]: unknown;
};

export type GDocsTable = {
  rows?: number;
  columns?: number;
  tableRows?: GDocsTableRow[];
};

export type GDocsStructuralElement = {
  paragraph?: GDocsParagraph;
  table?: GDocsTable;
  startIndex?: number;
  endIndex?: number;
};

export type GDocsBody = {
  content?: GDocsStructuralElement[];
};

export type GDocsDocument = {
  revisionId?: string;
  title?: string;
  documentId?: string;
  body?: GDocsBody;
  namedRanges?: Record<string, NamedRangeSchema>;
  [key: string]: unknown;
};

// ── Ranges & locations ───────────────────────────────────────────────

export type GDocsRange = {
  startIndex?: number;
  endIndex?: number;
  segmentId?: string;
  tabId?: string;
};

export type GDocsLocation = {
  index?: number;
  segmentId?: string;
  tabId?: string;
};

// ── Requests & responses ─────────────────────────────────────────────

export type GDocsRequest = {
  createNamedRange?: {
    name?: string;
    range?: GDocsRange;
  };
  deleteNamedRange?: {
    namedRangeId?: string;
  };
  deleteContentRange?: {
    range?: GDocsRange;
  };
  insertText?: {
    location?: GDocsLocation;
    text?: string;
  };
  updateParagraphStyle?: {
    range?: GDocsRange;
    paragraphStyle?: Record<string, unknown>;
    fields?: string;
  };
  insertTable?: {
    rows?: number;
    columns?: number;
    endOfSegmentLocation?: Record<string, unknown>;
    location?: GDocsLocation;
  };
  [key: string]: unknown;
};

export type GDocsBatchUpdateResponse = {
  replies?: Array<{ createNamedRange?: { namedRangeId?: string }; [key: string]: unknown }>;
  writeControl?: { requiredRevisionId?: string };
};

// ── Tabs & named ranges (multi-tab documents) ────────────────────────

/** Named Range schema — keyed by name in the namedRanges map */
export type NamedRangeSchema = {
  /** The name of the named range (e.g. '_bk_000000000001') */
  name?: string;
  /** Array of named range entries sharing this name */
  namedRanges?: Array<{
    namedRangeId?: string;
    name?: string;
    ranges?: Array<{
      startIndex?: number;
      endIndex?: number;
      segmentId?: string;
      tabId?: string;
    }>;
  }>;
};

/** Tab schema for multi-tab documents */
export type TabSchema = {
  tabProperties?: {
    tabId?: string;
    title?: string;
    index?: number;
  };
  documentTab?: {
    body?: GDocsBody;
    /** Named ranges at the tab level (populated when includeTabsContent=true) */
    namedRanges?: Record<string, NamedRangeSchema>;
  };
};

/** Extended Document type with tabs support */
export type DocumentWithTabs = GDocsDocument & {
  tabs?: TabSchema[];
};

/**
 * Cast a GDocsDocument to our extended type with tabs.
 * Safe because we only add optional fields.
 */
export function asDocumentWithTabs(doc: GDocsDocument): DocumentWithTabs {
  return doc as DocumentWithTabs;
}
