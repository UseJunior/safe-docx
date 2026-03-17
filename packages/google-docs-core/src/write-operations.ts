import type { GDocsRequest } from './google-api-types.js';
import { IndexTracker } from './index-tracker.js';

export type EditOperation = {
  type: 'delete' | 'insert' | 'replace';
  startIndex: number;
  endIndex?: number;
  text?: string;
  tabId?: string;
};

/**
 * Build batchUpdate requests from edit operations (reverse index order).
 *
 * Note: tabId on ranges/locations is a Google Docs API feature for multi-tab
 * documents.
 */
export function buildBatchUpdateRequests(
  edits: EditOperation[],
): GDocsRequest[] {
  // Sort in reverse index order to avoid index invalidation
  const sorted = IndexTracker.sortEditsReverseOrder(edits);
  const requests: GDocsRequest[] = [];

  for (const edit of sorted) {
    switch (edit.type) {
      case 'delete':
        requests.push({
          deleteContentRange: {
            range: {
              startIndex: edit.startIndex,
              endIndex: edit.endIndex!,
              ...(edit.tabId ? { tabId: edit.tabId } : {}),
            },
          },
        });
        break;
      case 'insert':
        requests.push({
          insertText: {
            location: {
              index: edit.startIndex,
              ...(edit.tabId ? { tabId: edit.tabId } : {}),
            },
            text: edit.text!,
          },
        });
        break;
      case 'replace':
        // Replace = delete + insert (delete first in the request, insert at same index)
        requests.push({
          deleteContentRange: {
            range: {
              startIndex: edit.startIndex,
              endIndex: edit.endIndex!,
              ...(edit.tabId ? { tabId: edit.tabId } : {}),
            },
          },
        });
        requests.push({
          insertText: {
            location: {
              index: edit.startIndex,
              ...(edit.tabId ? { tabId: edit.tabId } : {}),
            },
            text: edit.text!,
          },
        });
        break;
    }
  }

  return requests;
}

/** Build a paragraph style update request */
export function buildParagraphStyleRequest(
  startIndex: number,
  endIndex: number,
  style: {
    alignment?: string;
    indentFirstLine?: number;
    indentStart?: number;
  },
  tabId?: string,
): GDocsRequest {
  const fields: string[] = [];
  const paragraphStyle: Record<string, unknown> = {};

  if (style.alignment) {
    fields.push('alignment');
    paragraphStyle.alignment = style.alignment;
  }
  if (style.indentFirstLine !== undefined) {
    fields.push('indentFirstLine');
    paragraphStyle.indentFirstLine = { magnitude: style.indentFirstLine, unit: 'PT' };
  }
  if (style.indentStart !== undefined) {
    fields.push('indentStart');
    paragraphStyle.indentStart = { magnitude: style.indentStart, unit: 'PT' };
  }

  return {
    updateParagraphStyle: {
      range: {
        startIndex,
        endIndex,
        ...(tabId ? { tabId } : {}),
      },
      paragraphStyle,
      fields: fields.join(','),
    },
  };
}
