import { buildParagraphStyleRequest, type CachedParagraph } from '@usejunior/google-docs-core';
import { type GDocsSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';

export async function gdocsFormatLayout(
  manager: SessionManager,
  session: GDocsSession,
  params: {
    paragraph_spacing?: {
      paragraph_ids?: string[];
      before_twips?: number;
      after_twips?: number;
      line_twips?: number;
      line_rule?: string;
    };
    row_height?: unknown;
    cell_padding?: unknown;
  },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    if (params.row_height) {
      return err('UNSUPPORTED_FOR_PROVIDER', 'row_height is not supported for Google Docs.', 'This parameter is only available for DOCX files.');
    }
    if (params.cell_padding) {
      return err('UNSUPPORTED_FOR_PROVIDER', 'cell_padding is not supported for Google Docs.', 'This parameter is only available for DOCX files.');
    }

    const spacing = params.paragraph_spacing;
    if (!spacing) {
      return err('VALIDATION_ERROR', 'No layout operation was provided.', 'Provide paragraph_spacing.');
    }

    const paragraphIds = spacing.paragraph_ids;
    if (!paragraphIds || paragraphIds.length === 0) {
      return err('VALIDATION_ERROR', 'paragraph_spacing.paragraph_ids must be a non-empty array.', 'Pass one or more paragraph anchor IDs.');
    }

    // Build style updates for each paragraph
    const requests: any[] = [];
    const missing: string[] = [];

    for (const pid of paragraphIds) {
      const para = session.doc.getParagraphByAnchorId(pid) as CachedParagraph | null;
      if (!para) {
        missing.push(pid);
        continue;
      }

      // Google Docs paragraph style supports alignment and indent via updateParagraphStyle
      const style: { alignment?: string; indentFirstLine?: number; indentStart?: number } = {};

      // Convert twips to points for indent-related properties
      // Note: paragraph_spacing before/after/line are not directly supported via
      // updateParagraphStyle in the same way, but we can set spacing via the API
      if (spacing.before_twips !== undefined || spacing.after_twips !== undefined) {
        // Use raw updateParagraphStyle for spacing
        const fields: string[] = [];
        const paragraphStyle: Record<string, unknown> = {};

        if (spacing.before_twips !== undefined) {
          fields.push('spaceAbove');
          paragraphStyle.spaceAbove = { magnitude: spacing.before_twips / 20, unit: 'PT' };
        }
        if (spacing.after_twips !== undefined) {
          fields.push('spaceBelow');
          paragraphStyle.spaceBelow = { magnitude: spacing.after_twips / 20, unit: 'PT' };
        }
        if (spacing.line_twips !== undefined) {
          fields.push('lineSpacing');
          // Google Docs lineSpacing is in percentage of default (100 = single)
          // 240 twips = single space in OOXML, so convert:
          paragraphStyle.lineSpacing = (spacing.line_twips / 240) * 100;
        }

        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: para.startIndex,
              endIndex: para.endIndex,
              ...(para.tabId ? { tabId: para.tabId } : {}),
            },
            paragraphStyle,
            fields: fields.join(','),
          },
        });
        continue;
      }

      if (Object.keys(style).length > 0) {
        requests.push(buildParagraphStyleRequest(para.startIndex, para.endIndex, style, para.tabId));
      }
    }

    if (missing.length > 0) {
      return err('INVALID_SELECTOR', `paragraph_spacing references missing paragraph IDs: ${missing.join(', ')}`);
    }

    if (requests.length > 0) {
      await session.doc.executeBatchUpdate(requests);
      manager.markEdited(session);
    }

    manager.touch(session);

    return ok({
      google_doc_id: session.docId,
      affected_paragraphs: paragraphIds.length - missing.length,
      warnings: missing.length > 0 ? [`Skipped missing IDs: ${missing.join(', ')}`] : [],
      message: 'Layout formatting applied.',
      ...metadata,
    });
  } catch (e: unknown) {
    return err('FORMAT_LAYOUT_ERROR', `Failed to apply layout: ${e instanceof Error ? e.message : String(e)}`);
  }
}
