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
import { download } from './tools/download.js';
import { getSessionStatus } from './tools/get_session_status.js';
import { hasTrackedChanges_tool } from './tools/has_tracked_changes.js';
import { clearSession } from './tools/clear_session.js';
import { duplicateDocument } from './tools/duplicate_document.js';
import { formatLayout } from './tools/format_layout.js';
import { acceptChanges } from './tools/accept_changes.js';
import { addComment } from './tools/add_comment.js';
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
  return name === 'read_file'
    ? await readFile(sessions, args as any)
    : name === 'grep'
      ? await grep(sessions, args as any)
      : name === 'init_plan'
        ? await initPlan(sessions, args as any)
        : name === 'merge_plans'
          ? await mergePlans(args as any)
          : name === 'replace_text'
            ? await replaceText(sessions, args as any)
            : name === 'insert_paragraph'
              ? await insertParagraph(sessions, args as any)
              : name === 'download'
                ? await download(sessions, args as any)
                : name === 'format_layout'
                  ? await formatLayout(sessions, args as any)
                  : name === 'accept_changes'
                    ? await acceptChanges(sessions, args as any)
                    : name === 'has_tracked_changes'
                      ? await hasTrackedChanges_tool(sessions, args as any)
                    : name === 'get_session_status'
                      ? await getSessionStatus(sessions, args as any)
                      : name === 'clear_session'
                        ? await clearSession(sessions, args as any)
                        : name === 'duplicate_document'
                          ? await duplicateDocument(sessions, args as any)
                          : name === 'add_comment'
                            ? await addComment(sessions, args as any)
                            : name === 'compare_documents'
                              ? await compareDocuments_tool(sessions, args as any)
                              : name === 'get_footnotes'
                                ? await getFootnotes(sessions, args as any)
                                : name === 'add_footnote'
                                  ? await addFootnote(sessions, args as any)
                                  : name === 'update_footnote'
                                    ? await updateFootnote(sessions, args as any)
                                    : name === 'delete_footnote'
                                      ? await deleteFootnote(sessions, args as any)
                                      : name === 'extract_revisions'
                                        ? await extractRevisions_tool(sessions, args as any)
                                        : {
                                            success: false,
                                            error: {
                                              code: 'UNKNOWN_TOOL',
                                              message: `Unknown tool: ${name}`,
                                              hint: 'Use file-first tools: read_file, grep, replace_text, insert_paragraph, download, get_session_status.',
                                            },
                                          };
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
    return { tools: MCP_TOOLS as any };
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
