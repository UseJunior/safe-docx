import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { SessionManager } from '../session/manager.js';
import { getPreviewHtml } from './preview-html.js';
import { getDocumentView } from './get_document_view.js';
import { GET_DOCUMENT_VIEW_TOOL } from './app_tools.js';

export const PREVIEW_RESOURCE_URI = 'ui://safe-docx/preview';
export const PREVIEW_MIME_TYPE = 'text/html;profile=mcp-app';

type DispatchFn = (
  sessions: SessionManager,
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export function registerPreviewApp(
  server: Server,
  sessions: SessionManager,
  coreTools: ReadonlyArray<Record<string, unknown>>,
  coreDispatch: DispatchFn,
): void {
  // Register resource capability (removed when this module is removed)
  server.registerCapabilities({ resources: {} });

  // Override ListTools to include the preview-only tool
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...coreTools, GET_DOCUMENT_VIEW_TOOL],
  }));

  // Override CallTool to handle get_document_view, delegating everything else
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    const result =
      name === 'get_document_view'
        ? await getDocumentView(sessions, args as Parameters<typeof getDocumentView>[1])
        : await coreDispatch(sessions, name, args);

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  // ListResources handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: PREVIEW_RESOURCE_URI,
        name: 'Document Preview',
        description: 'Interactive Word-like document preview with inline editing',
        mimeType: PREVIEW_MIME_TYPE,
      },
    ],
  }));

  // ReadResource handler
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;
    if (uri !== PREVIEW_RESOURCE_URI) {
      throw new Error(`Unknown resource: ${uri}`);
    }
    return {
      contents: [
        {
          uri: PREVIEW_RESOURCE_URI,
          mimeType: PREVIEW_MIME_TYPE,
          text: getPreviewHtml(),
        },
      ],
    };
  });
}
