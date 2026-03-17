import type {
  GDocsStructuralElement,
  GDocsParagraph,
  GDocsRequest,
  GDocsBatchUpdateResponse,
} from './google-api-types.js';
import type { GoogleApiClient } from './api-client.js';
import type {
  AnchorId,
  CachedParagraph,
  CachedTable,
  DocumentStructureCache,
  GoogleDocsCredentials,
  TabInfo,
} from './types.js';
import { createAnchorId } from './types.js';
import { resolveCredentials } from './auth.js';
import { extractTabs, getTabBody } from './tabs.js';
import {
  buildNamedRangeInjectionRequests,
  mapNamedRangeResponses,
  extractExistingAnchors,
} from './anchors.js';
import { buildWriteControl, extractRevisionId, isRevisionFresh, type ConcurrencyState } from './concurrency.js';
import { withRetry } from './errors.js';
import type { DocumentViewNodeGdocs } from './document-view.js';

/**
 * GoogleDocsDocument provides read/write access to a Google Docs document.
 * It caches the document structure for anchor resolution and performs
 * all writes through batchUpdate.
 *
 * Anchors use Named Ranges (not bookmarks — createBookmark does not exist
 * in the Google Docs API). Named ranges with the `_bk_` prefix serve as
 * stable paragraph anchors.
 */
export class GoogleDocsDocument {
  private client: GoogleApiClient;
  private docId: string;
  private cache: DocumentStructureCache | null = null;
  private concurrency: ConcurrencyState | null = null;
  /** Google namedRangeId -> _bk_ name */
  private anchorMapping: Map<string, string> = new Map();
  /** _bk_ name -> Google namedRangeId */
  private reverseAnchorMapping: Map<string, string> = new Map();
  private documentViewCache: { revisionId: string; nodes: DocumentViewNodeGdocs[] } | null = null;
  private editCount = 0;
  private editRevision = 0;

  private constructor(
    client: GoogleApiClient,
    docId: string,
  ) {
    this.client = client;
    this.docId = docId;
  }

  /** Static factory - load a Google Doc */
  static async load(
    docId: string,
    credentials?: GoogleDocsCredentials,
  ): Promise<GoogleDocsDocument> {
    const client = await resolveCredentials(credentials);
    const doc = new GoogleDocsDocument(client, docId);
    await doc.fetchDocument();
    return doc;
  }

  /** Fetch/refresh the document structure */
  async fetchDocument(): Promise<void> {
    const doc = await withRetry(() => this.client.getDocument(this.docId));

    const revisionId = extractRevisionId(doc);
    const tabs = extractTabs(doc);
    const paragraphs: CachedParagraph[] = [];
    const tables: CachedTable[] = [];

    for (const tabInfo of tabs) {
      const body = getTabBody(doc, tabInfo.tabId);
      if (!body?.content) continue;
      this.parseParagraphsFromContent(body.content, tabInfo.tabId, paragraphs, tables);
    }

    // Extract existing _bk_ named ranges
    const existingAnchors = extractExistingAnchors(doc);
    for (const [namedRangeId, info] of existingAnchors) {
      if (!this.anchorMapping.has(namedRangeId)) {
        this.anchorMapping.set(namedRangeId, info.name);
        this.reverseAnchorMapping.set(info.name, namedRangeId);
      }
    }

    // Match anchors to paragraphs by startIndex proximity
    for (const para of paragraphs) {
      const anchor = this.findAnchorForParagraph(para, existingAnchors);
      if (anchor) {
        para.anchorName = anchor.name;
        para.anchorId = createAnchorId(para.tabId, anchor.name);
      }
    }

    this.cache = {
      docId: this.docId,
      revisionId,
      tabs,
      paragraphs,
      tables,
      fetchedAt: new Date(),
    };

    this.concurrency = { revisionId, fetchedAt: new Date() };
    this.documentViewCache = null; // Invalidate view cache
  }

  /** Find the named range anchor for a paragraph by matching startIndex */
  private findAnchorForParagraph(
    para: CachedParagraph,
    existingAnchors: Map<string, { namedRangeId: string; name: string; startIndex: number; tabId: string }>,
  ): { namedRangeId: string; name: string } | null {
    for (const [, info] of existingAnchors) {
      // Anchor spans startIndex to startIndex+1, so it matches if it's
      // within the paragraph's range
      if (info.startIndex >= para.startIndex && info.startIndex < para.endIndex
        && info.tabId === para.tabId) {
        return { namedRangeId: info.namedRangeId, name: info.name };
      }
    }
    return null;
  }

  /** Inject named range anchors into all paragraphs that don't have one */
  async injectAnchors(tabId?: string): Promise<{ injectedCount: number }> {
    if (!this.cache) throw new Error('Document not loaded');

    const paragraphs = tabId
      ? this.cache.paragraphs.filter(p => p.tabId === tabId)
      : this.cache.paragraphs;

    const unanchored = paragraphs.filter(p => !p.anchorName);
    if (unanchored.length === 0) return { injectedCount: 0 };

    const requests = buildNamedRangeInjectionRequests(unanchored, this.anchorMapping.size);
    if (requests.length === 0) return { injectedCount: 0 };

    const response = await withRetry(() =>
      this.client.batchUpdate(this.docId, {
        requests,
        writeControl: this.concurrency
          ? buildWriteControl(this.concurrency.revisionId)
          : undefined,
      }),
    );

    // Map responses to _bk_ names
    const startCounter = this.anchorMapping.size;
    const newMappings = mapNamedRangeResponses(
      (response.replies ?? []) as Array<{ createNamedRange?: { namedRangeId?: string } }>,
      startCounter,
    );

    // Update our mappings
    let idx = 0;
    for (const [googleId, bkName] of newMappings) {
      this.anchorMapping.set(googleId, bkName);
      this.reverseAnchorMapping.set(bkName, googleId);
      if (idx < unanchored.length) {
        unanchored[idx]!.anchorName = bkName;
        unanchored[idx]!.anchorId = createAnchorId(unanchored[idx]!.tabId, bkName);
      }
      idx++;
    }

    // Update revision
    if (response.writeControl?.requiredRevisionId) {
      this.concurrency = {
        revisionId: response.writeControl.requiredRevisionId,
        fetchedAt: new Date(),
      };
    }

    // Re-fetch to get updated indices
    await this.fetchDocument();

    return { injectedCount: newMappings.size };
  }

  /**
   * Replace text in the paragraph identified by anchorId.
   * Finds `findText` within the paragraph and replaces it with `replaceWith`.
   */
  async replaceText(anchorId: AnchorId, findText: string, replaceWith: string): Promise<void> {
    const para = this.getParagraphByAnchorId(anchorId);
    if (!para) throw new Error(`ANCHOR_NOT_FOUND: No paragraph for anchor ${anchorId}`);

    const offset = para.text.indexOf(findText);
    if (offset === -1) throw new Error(`TEXT_NOT_FOUND: "${findText}" not found in paragraph`);

    const startIndex = para.startIndex + offset;
    const endIndex = startIndex + findText.length;

    const requests: GDocsRequest[] = [
      {
        deleteContentRange: {
          range: {
            startIndex,
            endIndex,
            ...(para.tabId ? { tabId: para.tabId } : {}),
          },
        },
      },
      {
        insertText: {
          location: {
            index: startIndex,
            ...(para.tabId ? { tabId: para.tabId } : {}),
          },
          text: replaceWith,
        },
      },
    ];

    await this.executeBatchUpdate(requests);
    this.markEdited();
    await this.fetchDocument();
  }

  /**
   * Insert a new paragraph before or after the anchor.
   */
  async insertParagraph(
    anchorId: AnchorId,
    position: 'BEFORE' | 'AFTER',
    text: string,
  ): Promise<{ newAnchorId: AnchorId }> {
    const para = this.getParagraphByAnchorId(anchorId);
    if (!para) throw new Error(`ANCHOR_NOT_FOUND: No paragraph for anchor ${anchorId}`);

    // BEFORE: insert text+\n at startIndex (pushes paragraph down)
    // AFTER: insert \n+text at endIndex-1 (before trailing \n, stays within paragraph bounds)
    const insertIndex = position === 'BEFORE' ? para.startIndex : para.endIndex - 1;
    const insertText = position === 'BEFORE' ? `${text}\n` : `\n${text}`;

    const requests: GDocsRequest[] = [
      {
        insertText: {
          location: {
            index: insertIndex,
            ...(para.tabId ? { tabId: para.tabId } : {}),
          },
          text: insertText,
        },
      },
    ];

    await this.executeBatchUpdate(requests);
    this.markEdited();
    await this.fetchDocument();

    // After re-fetch, inject anchor for the new paragraph
    await this.injectAnchors(para.tabId);

    // Find the newly created paragraph by text
    const newPara = this.cache?.paragraphs.find(
      p => p.text.trim() === text.trim() && p.tabId === para.tabId,
    );

    return { newAnchorId: newPara?.anchorId ?? '' };
  }

  /** Execute a raw batchUpdate with write control */
  async executeBatchUpdate(
    requests: GDocsRequest[],
  ): Promise<GDocsBatchUpdateResponse> {
    const response = await withRetry(() =>
      this.client.batchUpdate(this.docId, {
        requests,
        writeControl: this.concurrency
          ? buildWriteControl(this.concurrency.revisionId)
          : undefined,
      }),
    );

    // Update revision
    if (response.writeControl?.requiredRevisionId) {
      this.concurrency = {
        revisionId: response.writeControl.requiredRevisionId,
        fetchedAt: new Date(),
      };
    }

    return response;
  }

  /** Get cached paragraphs */
  getParagraphs(tabId?: string): CachedParagraph[] {
    if (!this.cache) return [];
    if (tabId) return this.cache.paragraphs.filter(p => p.tabId === tabId);
    return this.cache.paragraphs;
  }

  /** Get paragraph text by anchor ID */
  getParagraphTextById(anchorId: AnchorId): string | null {
    if (!this.cache) return null;
    const para = this.cache.paragraphs.find(
      p => p.anchorId === anchorId || p.anchorName === anchorId,
    );
    return para?.text ?? null;
  }

  /** Get paragraph by anchor ID */
  getParagraphByAnchorId(anchorId: AnchorId): CachedParagraph | null {
    if (!this.cache) return null;
    return this.cache.paragraphs.find(
      p => p.anchorId === anchorId || p.anchorName === anchorId,
    ) ?? null;
  }

  /** Get document ID */
  getDocId(): string { return this.docId; }

  /** Get current revision ID */
  getRevisionId(): string { return this.concurrency?.revisionId ?? ''; }

  /** Get edit count */
  getEditCount(): number { return this.editCount; }

  /** Get edit revision */
  getEditRevision(): number { return this.editRevision; }

  /** Get tabs */
  getTabs(): TabInfo[] { return this.cache?.tabs ?? []; }

  /** Get default tab ID */
  getDefaultTabId(): string {
    const tabs = this.cache?.tabs ?? [];
    return tabs[0]?.tabId ?? '';
  }

  /** Check if revision is still fresh */
  isRevisionFresh(): boolean {
    return this.concurrency ? isRevisionFresh(this.concurrency) : false;
  }

  /** Get the document structure cache */
  getCache(): DocumentStructureCache | null { return this.cache; }

  /** Get the document view cache */
  getDocumentViewCache(): { revisionId: string; nodes: DocumentViewNodeGdocs[] } | null {
    return this.documentViewCache;
  }

  /** Get the API client */
  getClient(): GoogleApiClient { return this.client; }

  /** Get the reverse anchor mapping (_bk_ name -> namedRangeId) */
  getReverseAnchorMapping(): Map<string, string> { return this.reverseAnchorMapping; }

  /** @deprecated Use getReverseAnchorMapping() */
  getReverseBookmarkMapping(): Map<string, string> { return this.reverseAnchorMapping; }

  /**
   * Export the document as a DOCX file via the Drive export API.
   *
   * **Note:** The Drive export API has a 10 MB limit for Google Workspace files.
   */
  async exportAsDocx(): Promise<Buffer> {
    return this.client.exportAsDocx(this.docId);
  }

  /** Mark the document as edited */
  markEdited(): void {
    this.editCount++;
    this.editRevision++;
    this.documentViewCache = null;
  }

  private parseParagraphsFromContent(
    content: GDocsStructuralElement[],
    tabId: string,
    paragraphs: CachedParagraph[],
    tables: CachedTable[],
    tableContext?: {
      tableIndex: number;
      tableId: string;
      tableStartIndex: number;
      rowIndex: number;
      colIndex: number;
      totalRows: number;
      totalCols: number;
      isHeaderRow: boolean;
      paraInCell: number;
      cellParaCount: number;
      colHeader: string;
    },
  ): void {
    let paraInCellCounter = 0;
    for (const element of content) {
      if (element.paragraph) {
        const para = element.paragraph;
        const text = this.extractParagraphText(para);
        const startIndex = element.startIndex ?? 0;
        const endIndex = element.endIndex ?? startIndex;

        paragraphs.push({
          paragraphId: para.paragraphStyle?.namedStyleType ?? '',
          anchorName: null, // Set later from anchor mapping
          anchorId: '', // Set later
          startIndex,
          endIndex,
          tabId,
          text,
          inTable: !!tableContext,
          tableMetadata: tableContext
            ? { ...tableContext, paraInCell: paraInCellCounter++ }
            : undefined,
        });
      }

      if (element.table) {
        const table = element.table;
        const tableIndex = tables.filter(t => t.tabId === tabId).length;
        const tableId = `_tbl_${tableIndex}`;
        const totalRows = table.rows ?? 0;
        const totalCols = table.columns ?? 0;

        tables.push({
          tableIndex,
          tableId,
          startIndex: element.startIndex ?? 0,
          endIndex: element.endIndex ?? 0,
          tabId,
          rows: totalRows,
          cols: totalCols,
        });

        // Extract column headers from first row
        const colHeaders: string[] = [];
        const firstRow = table.tableRows?.[0];
        if (firstRow) {
          for (const cell of firstRow.tableCells ?? []) {
            let headerText = '';
            for (const cellContent of cell.content ?? []) {
              if (cellContent.paragraph) {
                headerText += this.extractParagraphText(cellContent.paragraph);
              }
            }
            colHeaders.push(headerText.trim());
          }
        }

        // Process all rows
        for (let rowIdx = 0; rowIdx < (table.tableRows?.length ?? 0); rowIdx++) {
          const row = table.tableRows![rowIdx]!;
          for (let colIdx = 0; colIdx < (row.tableCells?.length ?? 0); colIdx++) {
            const cell = row.tableCells![colIdx]!;
            const cellContent = cell.content ?? [];
            const cellParaCount = cellContent.filter(c => c.paragraph).length;

            this.parseParagraphsFromContent(
              cellContent,
              tabId,
              paragraphs,
              tables,
              {
                tableIndex,
                tableId,
                tableStartIndex: element.startIndex ?? 0,
                rowIndex: rowIdx,
                colIndex: colIdx,
                totalRows,
                totalCols,
                isHeaderRow: rowIdx === 0,
                paraInCell: 0,
                cellParaCount,
                colHeader: colHeaders[colIdx] ?? '',
              },
            );
          }
        }
      }
    }
  }

  private extractParagraphText(para: GDocsParagraph): string {
    let text = '';
    for (const element of para.elements ?? []) {
      if (element.textRun?.content) {
        text += element.textRun.content;
      } else if (element.inlineObjectElement) {
        const altText = element.inlineObjectElement.textStyle?.link?.url ?? '';
        text += altText ? `[IMAGE: ${altText}]` : '[IMAGE]';
      } else if (element.autoText) {
        text += element.autoText.type ?? '';
      }
    }
    // Remove trailing newline (Google Docs adds \n to each paragraph)
    if (text.endsWith('\n')) {
      text = text.slice(0, -1);
    }
    return text;
  }
}
