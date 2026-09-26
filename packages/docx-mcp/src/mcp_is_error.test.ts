import { describe, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { createServer } from './server.js';
import { SessionManager } from './session/manager.js';
import { makeMinimalDocx } from './testing/docx_test_utils.js';

// #1085: the CallToolResult must carry `isError: true` whenever the tool JSON
// reports `success: false` (or the tool throws), while the JSON body itself
// stays unchanged. Exercised over a real MCP client/server pair.
const test = testAllure.epic('Document Editing').withLabels({ feature: 'MCP isError transport flag' });

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn().catch(() => {});
  }
});

async function connect(sessions: SessionManager): Promise<Client> {
  const server = createServer(sessions);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'is-error-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function bodyOf(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe('MCP CallToolResult isError', () => {
  test('a failing tool call sets isError and keeps the JSON envelope unchanged', async ({ given, when, then }: AllureBddContext) => {
    let client: Client;
    let result: CallToolResult;
    const missing = path.join(os.tmpdir(), `safe-docx-missing-${process.pid}-${Date.now()}.docx`);

    await given('an MCP client connected to the safe-docx server', async () => {
      client = await connect(new SessionManager());
    });
    await when('read_file is called on a path that does not exist', async () => {
      result = (await client.callTool({ name: 'read_file', arguments: { file_path: missing } })) as CallToolResult;
    });
    await then('the result has isError: true and the success:false JSON body', () => {
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const body = bodyOf(result);
      expect(body.success).toBe(false);
      const error = body.error as { code: string; message: string };
      expect(typeof error.code).toBe('string');
      expect(error.code.length).toBeGreaterThan(0);
      expect(typeof error.message).toBe('string');
    });
  });

  test('an unknown tool sets isError with the UNKNOWN_TOOL envelope', async ({ given, when, then }: AllureBddContext) => {
    let client: Client;
    let result: CallToolResult;

    await given('an MCP client connected to the safe-docx server', async () => {
      client = await connect(new SessionManager());
    });
    await when('a tool name the server does not know is called', async () => {
      result = (await client.callTool({ name: 'no_such_tool', arguments: {} })) as CallToolResult;
    });
    await then('the result has isError: true and code UNKNOWN_TOOL', () => {
      expect(result.isError).toBe(true);
      const body = bodyOf(result);
      expect(body.success).toBe(false);
      expect((body.error as { code: string }).code).toBe('UNKNOWN_TOOL');
    });
  });

  test('a succeeding tool call does not set isError', async ({ given, when, then }: AllureBddContext) => {
    let client: Client;
    let result: CallToolResult;
    let filePath: string;

    await given('an MCP client and a readable DOCX on disk', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'is-error-test-'));
      cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
      filePath = path.join(dir, 'ok.docx');
      await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(['Hello world'])));
      client = await connect(new SessionManager());
    });
    await when('read_file is called on it', async () => {
      result = (await client.callTool({ name: 'read_file', arguments: { file_path: filePath } })) as CallToolResult;
    });
    await then('the result has no isError flag and a success:true body', () => {
      expect(result.isError).toBeFalsy();
      expect('isError' in result && result.isError === true).toBe(false);
      const body = bodyOf(result);
      expect(body.success).toBe(true);
      expect(JSON.stringify(body)).toContain('Hello world');
    });
  });

  test('a tool that throws sets isError with an INTERNAL_ERROR envelope', async ({ given, when, then }: AllureBddContext) => {
    let client: Client;
    let result: CallToolResult;

    await given('an MCP client whose session manager throws on every access', async () => {
      const throwing = new Proxy(new SessionManager(), {
        get() {
          throw new Error('session store exploded');
        },
      });
      client = await connect(throwing);
    });
    await when('get_sections is called (it does not catch session errors itself)', async () => {
      result = (await client.callTool({
        name: 'get_sections',
        arguments: { file_path: path.join(os.tmpdir(), 'irrelevant.docx') },
      })) as CallToolResult;
    });
    await then('the thrown failure comes back as isError: true, not a JSON-RPC error', () => {
      expect(result.isError).toBe(true);
      const body = bodyOf(result);
      expect(body.success).toBe(false);
      const error = body.error as { code: string; message: string };
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.message).toContain('session store exploded');
    });
  });
});
