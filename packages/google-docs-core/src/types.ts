/** Provider discriminant for typed sessions */
export type DocumentProvider = 'docx' | 'gdocs';

/** Anchor ID format: "tabId:bookmarkId" for multi-tab, or just "bookmarkId" for default tab */
export type AnchorId = string;

/** Parsed anchor ID */
export type ParsedAnchorId = {
  tabId: string | null;
  bookmarkId: string;
};

/** Google Docs credentials */
export type GoogleDocsCredentials = {
  type: 'service_account' | 'oauth2';
  serviceAccountKeyPath?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Email to impersonate via domain-wide delegation (SA only) */
  impersonateUser?: string;
};

/** Save mode for Google Docs */
export type GoogleDocsSaveMode = 'checkpoint' | 'pin' | 'snapshot';

/** Save result */
export type GoogleDocsSaveResult = {
  mode: GoogleDocsSaveMode;
  revisionId: string;
  newDocId?: string; // Only for snapshot mode
};

/** Cached paragraph info from Google Docs structure */
export type CachedParagraph = {
  paragraphId: string; // Google Docs namedStyleType (e.g. 'HEADING_1', 'NORMAL_TEXT'). Historically misnamed; consumed by document-view.ts to derive heading metadata.
  anchorName: string | null; // Our injected _bk_ name (named range)
  anchorId: AnchorId; // Full anchor ID (tabId:anchorName)
  startIndex: number; // UTF-16 code unit offset
  endIndex: number; // UTF-16 code unit offset
  tabId: string;
  text: string;
  inTable: boolean;
  tableMetadata?: {
    tableStartIndex: number;
    tableIndex: number;
    tableId: string;
    rowIndex: number;
    colIndex: number;
    totalRows: number;
    totalCols: number;
    isHeaderRow: boolean;
    paraInCell: number;
    cellParaCount: number;
    colHeader: string;
  };
  /** @deprecated Use anchorName instead */
  bookmarkId?: string | null;
};

/** Cached table info */
export type CachedTable = {
  tableIndex: number;
  tableId: string; // "_tbl_0", "_tbl_1"
  startIndex: number;
  endIndex: number;
  tabId: string;
  rows: number;
  cols: number;
};

/** Tab info */
export type TabInfo = {
  tabId: string;
  title: string;
  index: number;
};

/** Document structure cache */
export type DocumentStructureCache = {
  docId: string;
  revisionId: string;
  tabs: TabInfo[];
  paragraphs: CachedParagraph[];
  tables: CachedTable[];
  fetchedAt: Date;
};

/** Provider capabilities map */
export const PROVIDER_CAPABILITIES: Record<DocumentProvider, Set<string>> = {
  docx: new Set([
    'read_file', 'replace_text', 'insert_paragraph', 'grep', 'save',
    'format_layout', 'compare_documents', 'add_comment', 'get_comments',
    'delete_comment', 'accept_changes', 'has_tracked_changes',
    'get_file_status', 'close_file', 'init_plan', 'merge_plans',
    'apply_plan', 'get_footnotes', 'add_footnote', 'update_footnote',
    'delete_footnote', 'clear_formatting', 'extract_revisions',
  ]),
  gdocs: new Set([
    'read_file', 'replace_text', 'insert_paragraph', 'grep', 'save',
    'format_layout', 'get_file_status', 'close_file',
  ]),
};

/** Check if a tool is supported for a provider */
export function isToolSupported(provider: DocumentProvider, toolName: string): boolean {
  return PROVIDER_CAPABILITIES[provider]?.has(toolName) ?? false;
}

/** Parse an anchor ID into tabId and bookmarkId components */
export function parseAnchorId(anchorId: AnchorId): ParsedAnchorId {
  const colonIndex = anchorId.indexOf(':');
  if (colonIndex === -1) {
    return { tabId: null, bookmarkId: anchorId };
  }
  return {
    tabId: anchorId.substring(0, colonIndex),
    bookmarkId: anchorId.substring(colonIndex + 1),
  };
}

/** Create an anchor ID from tabId and bookmarkId */
export function createAnchorId(tabId: string | null, bookmarkId: string): AnchorId {
  if (tabId) {
    return `${tabId}:${bookmarkId}`;
  }
  return bookmarkId;
}

/** Rate limit constants */
export const RATE_LIMITS = {
  WRITES_PER_MINUTE_PER_USER: 60,
  WRITES_PER_MINUTE_PER_PROJECT: 600,
  READS_PER_MINUTE_PER_USER: 300,
} as const;

/** Required OAuth2 scopes */
export const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
] as const;
