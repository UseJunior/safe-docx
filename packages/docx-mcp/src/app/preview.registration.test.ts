import { describe, expect } from 'vitest';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { SessionManager } from '../session/manager.js';
import { SAFE_DOCX_MCP_TOOLS } from '../tool_catalog.js';
import { dispatchToolCall } from '../server.js';
import { registerPreviewApp, PREVIEW_RESOURCE_URI, PREVIEW_MIME_TYPE } from './mcp-app-resources.js';
import { testAllure, allureStep } from '../testing/allure-test.js';
import { registerCleanup, openSession } from '../testing/session-test-utils.js';

async function createConnectedPair(opts: { withPreview: boolean }) {
  const server = new Server(
    { name: 'test-preview', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  const sessions = new SessionManager();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: SAFE_DOCX_MCP_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const result = await dispatchToolCall(sessions, name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  if (opts.withPreview) {
    registerPreviewApp({
      server,
      sessions,
      coreTools: SAFE_DOCX_MCP_TOOLS,
      coreDispatch: dispatchToolCall,
    });
  }

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { server, client, sessions };
}

describe('registerPreviewApp integration', () => {
  const test = testAllure.epic('MCP Apps').withLabels({ feature: 'Preview Registration' });
  registerCleanup();

  test('tools/list includes get_document_view when preview is registered', async () => {
    const { client } = await createConnectedPair({ withPreview: true });

    const { tools } = await allureStep('When listing tools via client', () =>
      client.listTools(),
    );

    await allureStep('Then get_document_view is present with _meta.ui', () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain('get_document_view');

      const tool = tools.find((t) => t.name === 'get_document_view')!;
      expect(tool.annotations?.readOnlyHint).toBe(true);
    });
  });

  test('tools/list excludes get_document_view without preview', async () => {
    const { client } = await createConnectedPair({ withPreview: false });

    const { tools } = await allureStep('When listing tools via client', () =>
      client.listTools(),
    );

    await allureStep('Then get_document_view is absent', () => {
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('get_document_view');
    });
  });

  test('tools/call get_document_view succeeds for a real session', async () => {
    const { client, sessions } = await createConnectedPair({ withPreview: true });
    const { sessionId } = await openSession(['Hello integration'], { mgr: sessions });

    const result = await allureStep('When calling get_document_view via client', () =>
      client.callTool({ name: 'get_document_view', arguments: { session_id: sessionId } }),
    );

    await allureStep('Then result contains document nodes', () => {
      const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(true);
      expect(Array.isArray(parsed.nodes)).toBe(true);
      expect(parsed.nodes.length).toBe(1);
      expect(parsed.nodes[0].clean_text).toBe('Hello integration');
    });
  });

  test('resources/list includes preview resource', async () => {
    const { client } = await createConnectedPair({ withPreview: true });

    const { resources } = await allureStep('When listing resources via client', () =>
      client.listResources(),
    );

    await allureStep('Then preview resource is present', () => {
      expect(resources.length).toBe(1);
      expect(resources[0]!.uri).toBe(PREVIEW_RESOURCE_URI);
      expect(resources[0]!.mimeType).toBe(PREVIEW_MIME_TYPE);
    });
  });

  test('resources/read returns preview HTML', async () => {
    const { client } = await createConnectedPair({ withPreview: true });

    const result = await allureStep('When reading preview resource via client', () =>
      client.readResource({ uri: PREVIEW_RESOURCE_URI }),
    );

    await allureStep('Then HTML content is returned', () => {
      expect(result.contents.length).toBe(1);
      const content = result.contents[0]!;
      expect(content.uri).toBe(PREVIEW_RESOURCE_URI);
      expect(content.mimeType).toBe(PREVIEW_MIME_TYPE);
      expect(typeof content.text).toBe('string');
      expect((content.text as string)).toContain('<!DOCTYPE html>');
    });
  });
});
