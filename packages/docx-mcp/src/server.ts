import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { SessionManager, type GDocsSession, type OdfSession } from './session/manager.js';
import { SAFE_DOCX_MCP_TOOLS } from './tool_catalog.js';
import { readFile } from './tools/read_file.js';
import { grep } from './tools/grep.js';
import { getDocumentOutline } from './tools/get_document_outline.js';
import { getSections } from './tools/get_sections.js';
import { replaceText } from './tools/replace_text.js';
import { insertParagraph } from './tools/insert_paragraph.js';
import { batchEdit } from './tools/batch_edit.js';
import { save } from './tools/save.js';
import { exportDocument } from './tools/export.js';
import { convertToOdt } from './tools/convert_to_odt.js';
import { getFileStatus } from './tools/get_file_status.js';
import { hasTrackedChanges_tool } from './tools/has_tracked_changes.js';
import { closeFile } from './tools/close_file.js';
import { formatLayout } from './tools/format_layout.js';
import { formatNumbering } from './tools/format_numbering.js';
import { formatSection } from './tools/format_section.js';
import { acceptChanges } from './tools/accept_changes.js';
import { acceptAiEdits } from './tools/accept_ai_edits.js';
import { rejectAiEdits } from './tools/reject_ai_edits.js';
import { addComment } from './tools/add_comment.js';
import { getComments } from './tools/get_comments.js';
import { deleteComment } from './tools/delete_comment.js';
import { getFootnotes } from './tools/get_footnotes.js';
import { addFootnote } from './tools/add_footnote.js';
import { updateFootnote } from './tools/update_footnote.js';
import { deleteFootnote } from './tools/delete_footnote.js';
import { compareDocuments_tool } from './tools/compare_documents.js';
import { extractRevisions_tool } from './tools/extract_revisions.js';
import { clearFormatting } from './tools/clear_formatting.js';
import { resolveGDocsSessionForTool, resolveOdfSessionForTool } from './tools/session_resolution.js';
import { checkGDocsSupport, checkOdfSupport } from './tools/provider_guard.js';
import type { ToolResponse } from './tools/types.js';

export const MCP_TRANSPORT = 'stdio' as const;

export const MCP_TOOLS = SAFE_DOCX_MCP_TOOLS;

function isGDocsRequest(args: Record<string, unknown>): boolean {
  return typeof args.google_doc_id === 'string' && args.google_doc_id.trim().length > 0;
}

function isOdfRequest(args: Record<string, unknown>): boolean {
  const filePath = typeof args.file_path === 'string' ? args.file_path.trim() : '';
  return path.extname(filePath).toLowerCase() === '.odt';
}

/**
 * True when any input-path field on the args points at a `.odt`. Used to guard tools
 * that take path fields other than `file_path` (e.g. `compare_documents`'s two-file
 * `original_file_path` / `revised_file_path`), which `isOdfRequest` does not cover.
 */
function hasOdfInputPath(args: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((f) => {
    const v = args[f];
    return typeof v === 'string' && path.extname(v.trim()).toLowerCase() === '.odt';
  });
}

// Lazy-loaded gdocs handler map (populated on first gdocs request)
let gdocsHandlers: Record<string, (m: SessionManager, s: GDocsSession, p: any, meta: Record<string, unknown>) => Promise<ToolResponse>> | null = null;
let odfHandlers: Record<string, (m: SessionManager, s: OdfSession, p: any, meta: Record<string, unknown>) => Promise<ToolResponse>> | null = null;

async function loadGDocsHandlers(): Promise<typeof gdocsHandlers> {
  if (gdocsHandlers) return gdocsHandlers;
  const [readFile, replaceText, insertParagraph, grep, save, formatLayout, getFileStatus, closeFile] = await Promise.all([
    import('./tools/gdocs/read_file.js'),
    import('./tools/gdocs/replace_text.js'),
    import('./tools/gdocs/insert_paragraph.js'),
    import('./tools/gdocs/grep.js'),
    import('./tools/gdocs/save.js'),
    import('./tools/gdocs/format_layout.js'),
    import('./tools/gdocs/get_file_status.js'),
    import('./tools/gdocs/close_file.js'),
  ]);
  gdocsHandlers = {
    read_file: readFile.gdocsReadFile,
    replace_text: replaceText.gdocsReplaceText,
    insert_paragraph: insertParagraph.gdocsInsertParagraph,
    grep: grep.gdocsGrep,
    save: save.gdocsSave,
    format_layout: formatLayout.gdocsFormatLayout,
    get_file_status: getFileStatus.gdocsGetFileStatus,
    close_file: closeFile.gdocsCloseFile,
  };
  return gdocsHandlers;
}

async function loadOdfHandlers(): Promise<typeof odfHandlers> {
  if (odfHandlers) return odfHandlers;
  const [readFile, replaceText, grep, insertParagraph, addComment, getComments, save, getFileStatus, closeFile, compareDocuments] = await Promise.all([
    import('./tools/odf/read_file.js'),
    import('./tools/odf/replace_text.js'),
    import('./tools/odf/grep.js'),
    import('./tools/odf/insert_paragraph.js'),
    import('./tools/odf/add_comment.js'),
    import('./tools/odf/get_comments.js'),
    import('./tools/odf/save.js'),
    import('./tools/odf/get_file_status.js'),
    import('./tools/odf/close_file.js'),
    import('./tools/odf/compare_documents.js'),
  ]);
  odfHandlers = {
    read_file: readFile.odfReadFile,
    replace_text: replaceText.odfReplaceText,
    grep: grep.odfGrep,
    insert_paragraph: insertParagraph.odfInsertParagraph,
    add_comment: addComment.odfAddComment,
    get_comments: getComments.odfGetComments,
    save: save.odfSave,
    get_file_status: getFileStatus.odfGetFileStatus,
    close_file: closeFile.odfCloseFile,
    compare_documents: compareDocuments.odfCompareDocumentsSession,
  };
  return odfHandlers;
}

async function dispatchGDocs(
  manager: SessionManager,
  args: Record<string, unknown>,
  toolName: string,
): Promise<ToolResponse> {
  const guard = checkGDocsSupport(toolName);
  if (guard) return guard;
  const resolved = await resolveGDocsSessionForTool(manager, args, { toolName });
  if (!resolved.ok) return resolved.response;
  const handlers = await loadGDocsHandlers();
  const handler = handlers![toolName];
  if (!handler) return { success: false, error: { code: 'UNKNOWN_TOOL', message: `No Google Docs handler for: ${toolName}` } };
  return handler(manager, resolved.session, args, resolved.metadata);
}

async function dispatchOdf(
  manager: SessionManager,
  args: Record<string, unknown>,
  toolName: string,
): Promise<ToolResponse> {
  const guard = checkOdfSupport(toolName);
  if (guard) return guard;
  const resolved = await resolveOdfSessionForTool(manager, args, { toolName });
  if (!resolved.ok) return resolved.response;
  const handlers = await loadOdfHandlers();
  const handler = handlers![toolName];
  if (!handler) return { success: false, error: { code: 'UNKNOWN_TOOL', message: `No ODF handler for: ${toolName}` } };
  return handler(manager, resolved.session, args, resolved.metadata);
}

export async function dispatchToolCall(
  sessions: SessionManager,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'read_file':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'read_file');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'read_file');
      return await readFile(sessions, args as Parameters<typeof readFile>[1]);
    case 'grep':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'grep');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'grep');
      return await grep(sessions, args as Parameters<typeof grep>[1]);
    case 'get_document_outline':
      return await getDocumentOutline(sessions, args as Parameters<typeof getDocumentOutline>[1]);
    case 'get_sections':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'get_sections');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'get_sections');
      return await getSections(sessions, args as Parameters<typeof getSections>[1]);
    case 'batch_edit':
      return await batchEdit(sessions, args as Parameters<typeof batchEdit>[1]);
    case 'replace_text':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'replace_text');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'replace_text');
      return await replaceText(sessions, args as Parameters<typeof replaceText>[1]);
    case 'insert_paragraph':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'insert_paragraph');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'insert_paragraph');
      return await insertParagraph(sessions, args as Parameters<typeof insertParagraph>[1]);
    case 'save':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'save');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'save');
      return await save(sessions, args as Parameters<typeof save>[1]);
    case 'export':
      return await exportDocument(sessions, args as Parameters<typeof exportDocument>[1]);
    case 'convert_to_odt':
      return await convertToOdt(sessions, args as Parameters<typeof convertToOdt>[1]);
    case 'format_layout':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'format_layout');
      return await formatLayout(sessions, args as Parameters<typeof formatLayout>[1]);
    case 'format_numbering':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'format_numbering');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'format_numbering');
      return await formatNumbering(sessions, args as Parameters<typeof formatNumbering>[1]);
    case 'format_section':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'format_section');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'format_section');
      return await formatSection(sessions, args as Parameters<typeof formatSection>[1]);
    case 'accept_changes':
      return await acceptChanges(sessions, args as Parameters<typeof acceptChanges>[1]);
    case 'accept_ai_edits':
      return await acceptAiEdits(sessions, args as Parameters<typeof acceptAiEdits>[1]);
    case 'reject_ai_edits':
      return await rejectAiEdits(sessions, args as Parameters<typeof rejectAiEdits>[1]);
    case 'has_tracked_changes':
      return await hasTrackedChanges_tool(sessions, args as Parameters<typeof hasTrackedChanges_tool>[1]);
    case 'get_file_status':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'get_file_status');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'get_file_status');
      return await getFileStatus(sessions, args as Parameters<typeof getFileStatus>[1]);
    case 'close_file':
      if (isGDocsRequest(args)) return await dispatchGDocs(sessions, args, 'close_file');
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'close_file');
      return await closeFile(sessions, args as Parameters<typeof closeFile>[1]);
    case 'add_comment':
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'add_comment');
      return await addComment(sessions, args as Parameters<typeof addComment>[1]);
    case 'get_comments':
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'get_comments');
      return await getComments(sessions, args as Parameters<typeof getComments>[1]);
    case 'delete_comment':
      return await deleteComment(sessions, args as Parameters<typeof deleteComment>[1]);
    case 'compare_documents': {
      // compare_documents has two modes. Two-file mode (original_file_path + revised_file_path)
      // takes precedence for ALL providers — mirroring the DOCX tool's own twoFileMode precedence —
      // so a stray file_path cannot preempt a two-file request (e.g. two `.docx` inputs plus a
      // `.odt` file_path must run the DOCX comparison, not open an ODF session). Within two-file
      // mode, `.odt` inputs route to the stateless ODF handler directly (it loads both files
      // itself; it CANNOT go through dispatchOdf, whose resolveOdfSessionForTool requires a
      // file_path). Session mode (file_path only) routes a `.odt` through the standard ODF session
      // lane; otherwise the DOCX tool.
      const hasOriginal = typeof args.original_file_path === 'string' && args.original_file_path.trim().length > 0;
      const hasRevised = typeof args.revised_file_path === 'string' && args.revised_file_path.trim().length > 0;
      if (hasOriginal && hasRevised) {
        if (hasOdfInputPath(args, ['original_file_path', 'revised_file_path'])) {
          const { odfCompareDocuments } = await import('./tools/odf/compare_documents.js');
          return await odfCompareDocuments(sessions, args as Parameters<typeof odfCompareDocuments>[1]);
        }
        return await compareDocuments_tool(sessions, args as Parameters<typeof compareDocuments_tool>[1]);
      }
      if (isOdfRequest(args)) return await dispatchOdf(sessions, args, 'compare_documents');
      return await compareDocuments_tool(sessions, args as Parameters<typeof compareDocuments_tool>[1]);
    }
    case 'get_footnotes':
      return await getFootnotes(sessions, args as Parameters<typeof getFootnotes>[1]);
    case 'add_footnote':
      return await addFootnote(sessions, args as Parameters<typeof addFootnote>[1]);
    case 'update_footnote':
      return await updateFootnote(sessions, args as Parameters<typeof updateFootnote>[1]);
    case 'delete_footnote':
      return await deleteFootnote(sessions, args as Parameters<typeof deleteFootnote>[1]);
    case 'clear_formatting':
      return await clearFormatting(sessions, args as Parameters<typeof clearFormatting>[1]);
    case 'extract_revisions':
      return await extractRevisions_tool(sessions, args as Parameters<typeof extractRevisions_tool>[1]);
    default:
      return {
        success: false,
        error: {
          code: 'UNKNOWN_TOOL',
          message: `Unknown tool: ${name}`,
          hint: 'Use file-first tools: read_file, grep, replace_text, insert_paragraph, save, get_file_status.',
        },
      };
  }
}

export async function runServer(): Promise<void> {
  const server = new Server(
    { name: 'safe-docx', version: '0.2.0' },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Default AI author for tracked-change emission at primitive write time.
  // Configurable via SAFE_DOCX_AI_AUTHOR env var; defaults to "SafeDocX".
  // Set to empty string explicitly to disable tracked emission and fall back
  // to legacy untracked behavior.
  const aiAuthorEnv = process.env.SAFE_DOCX_AI_AUTHOR;
  const defaultAiAuthor = aiAuthorEnv === '' ? null : (aiAuthorEnv ?? 'SafeDocX');
  const sessions = new SessionManager({ defaultAiAuthor });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: MCP_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const result = await dispatchToolCall(sessions, name, args);

    // MCP SDK expects tool results as content blocks.
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
