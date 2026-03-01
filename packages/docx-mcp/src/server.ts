import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { SessionManager } from './session/manager.js';
import { SAFE_DOCX_MCP_TOOLS } from './tool_catalog.js';
import { readFile } from './tools/read_file.js';
import { grep } from './tools/grep.js';
import { initPlan } from './tools/init_plan.js';
import { replaceText } from './tools/replace_text.js';
import { insertParagraph } from './tools/insert_paragraph.js';
import { mergePlans } from './tools/merge_plans.js';
import { applyPlan } from './tools/apply_plan.js';
import { save } from './tools/save.js';
import { getSessionStatus } from './tools/get_session_status.js';
import { hasTrackedChanges_tool } from './tools/has_tracked_changes.js';
import { clearSession } from './tools/clear_session.js';
import { formatLayout } from './tools/format_layout.js';
import { acceptChanges } from './tools/accept_changes.js';
import { addComment } from './tools/add_comment.js';
import { getComments } from './tools/get_comments.js';
import { deleteComment } from './tools/delete_comment.js';
import { getFootnotes } from './tools/get_footnotes.js';
import { addFootnote } from './tools/add_footnote.js';
import { updateFootnote } from './tools/update_footnote.js';
import { deleteFootnote } from './tools/delete_footnote.js';
import { compareDocuments_tool } from './tools/compare_documents.js';
import { extractRevisions_tool } from './tools/extract_revisions.js';

export const MCP_TRANSPORT = 'stdio' as const;

export const MCP_TOOLS = SAFE_DOCX_MCP_TOOLS;

export async function dispatchToolCall(
  sessions: SessionManager,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'read_file':
      return await readFile(sessions, args as Parameters<typeof readFile>[1]);
    case 'grep':
      return await grep(sessions, args as Parameters<typeof grep>[1]);
    case 'init_plan':
      return await initPlan(sessions, args as Parameters<typeof initPlan>[1]);
    case 'merge_plans':
      return await mergePlans(args as Parameters<typeof mergePlans>[0]);
    case 'apply_plan':
      return await applyPlan(sessions, args as Parameters<typeof applyPlan>[1]);
    case 'replace_text':
      return await replaceText(sessions, args as Parameters<typeof replaceText>[1]);
    case 'insert_paragraph':
      return await insertParagraph(sessions, args as Parameters<typeof insertParagraph>[1]);
    case 'save':
      return await save(sessions, args as Parameters<typeof save>[1]);
    case 'format_layout':
      return await formatLayout(sessions, args as Parameters<typeof formatLayout>[1]);
    case 'accept_changes':
      return await acceptChanges(sessions, args as Parameters<typeof acceptChanges>[1]);
    case 'has_tracked_changes':
      return await hasTrackedChanges_tool(sessions, args as Parameters<typeof hasTrackedChanges_tool>[1]);
    case 'get_session_status':
      return await getSessionStatus(sessions, args as Parameters<typeof getSessionStatus>[1]);
    case 'clear_session':
      return await clearSession(sessions, args as Parameters<typeof clearSession>[1]);
    case 'add_comment':
      return await addComment(sessions, args as Parameters<typeof addComment>[1]);
    case 'get_comments':
      return await getComments(sessions, args as Parameters<typeof getComments>[1]);
    case 'delete_comment':
      return await deleteComment(sessions, args as Parameters<typeof deleteComment>[1]);
    case 'compare_documents':
      return await compareDocuments_tool(sessions, args as Parameters<typeof compareDocuments_tool>[1]);
    case 'get_footnotes':
      return await getFootnotes(sessions, args as Parameters<typeof getFootnotes>[1]);
    case 'add_footnote':
      return await addFootnote(sessions, args as Parameters<typeof addFootnote>[1]);
    case 'update_footnote':
      return await updateFootnote(sessions, args as Parameters<typeof updateFootnote>[1]);
    case 'delete_footnote':
      return await deleteFootnote(sessions, args as Parameters<typeof deleteFootnote>[1]);
    case 'extract_revisions':
      return await extractRevisions_tool(sessions, args as Parameters<typeof extractRevisions_tool>[1]);
    default:
      return {
        success: false,
        error: {
          code: 'UNKNOWN_TOOL',
          message: `Unknown tool: ${name}`,
          hint: 'Use file-first tools: read_file, grep, replace_text, insert_paragraph, save, get_session_status.',
        },
      };
  }
}

export async function runServer(): Promise<void> {
  const server = new Server(
    { name: 'safe-docx', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const sessions = new SessionManager();

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
