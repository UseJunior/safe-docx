/**
 * Stdio protocol cleanliness — end-to-end regression for issue #809.
 *
 * The MCP server serves JSON-RPC over stdio, so any stray library write to
 * stdout corrupts the protocol stream. Issue #783 was exactly that (an
 * unconditional atomizer debug line), fixed at the source by PR #785. The
 * MCP tool layer used to contain the emit by swapping the process-global
 * console.log for a no-op around each comparison — a workaround that was
 * never concurrency-safe: with two overlapping compare_documents calls, the
 * second call captured the first call's no-op as its "original" and restored
 * it last, permanently silencing console.log for the whole process.
 *
 * These tests drive the REAL server binary over stdio — the same entry MCP
 * clients use — with real legal documents, and assert that every line the
 * server writes to stdout parses as a JSON-RPC message: once with two
 * back-to-back compare_documents tools/call requests, and once with
 * DOCX_COMPARISON_DEBUG=1 so opt-in comparison diagnostics are live (issue
 * #820: those diagnostics used to go through console.log and corrupt the
 * stream). No unit-level substitute can catch a reintroduced stdout emit
 * anywhere on the comparison path; this does.
 *
 * Scope note: the back-to-back requests exercise concurrent dispatch but do
 * NOT establish a deterministic overlap, and a clean protocol stream does not
 * prove console.log survived (responses are written with process.stdout.write).
 * The deterministic regression for the #809 console.log race is
 * src/tools/compare_documents_console_identity.test.ts.
 *
 * Standalone-run note: the spawned server resolves @usejunior/docx-compare and
 * @usejunior/docx-core to their built dist/ via workspace resolution. Standard
 * workspace scripts build first; if you run this file directly (e.g.
 * `node ../../node_modules/vitest/vitest.mjs run src/integration/...`), run
 * `npm run build` at the repo root first or you will exercise stale output.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, afterEach } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { DocxDocument, getParagraphText, OOXML, replaceParagraphTextRange } from '@usejunior/docx-core';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Stdio Protocol Cleanliness',
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_DIR = path.resolve(__dirname, '../..');
const CLI_ENTRY = path.resolve(PACKAGE_DIR, 'src/cli.ts');
const REAL_DOCUMENT = path.resolve(
  __dirname,
  '../../../../tests/test_documents/open-agreements/mutual-nda.docx',
);

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  method?: string;
}

/**
 * Minimal newline-delimited JSON-RPC client over a spawned server process.
 * Records EVERY raw stdout line so the test can assert protocol cleanliness
 * — not just that the responses it awaited happened to arrive.
 */
class StdioProbe {
  readonly child: ChildProcessWithoutNullStreams;
  readonly rawStdoutLines: string[] = [];
  readonly stderrChunks: string[] = [];
  private stdoutBuffer = '';
  private readonly responseWaiters = new Map<number, (msg: JsonRpcMessage) => void>();
  private readonly responses = new Map<number, JsonRpcMessage>();

  constructor(envOverrides: Record<string, string> = {}) {
    // Spawn the real CLI entry (`safedocx serve`) via tsx so the test runs the
    // same server MCP clients launch, without requiring a prebuilt docx-mcp
    // dist/ (workspace dependencies still resolve to their dist/ — see the
    // standalone-run note in the file header).
    this.child = spawn(process.execPath, ['--import', 'tsx', CLI_ENTRY, 'serve'], {
      cwd: PACKAGE_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...envOverrides },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrChunks.push(chunk);
    });
    this.child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      let newlineIndex = this.stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = this.stdoutBuffer.slice(0, newlineIndex);
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        if (line.trim().length > 0) {
          this.rawStdoutLines.push(line);
          this.dispatch(line);
        }
        newlineIndex = this.stdoutBuffer.indexOf('\n');
      }
    });
  }

  private dispatch(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      // Not JSON — protocol corruption. The cleanliness assertion at the end
      // of the test reports it; nothing to dispatch.
      return;
    }
    if (typeof message.id === 'number' && (message.result !== undefined || message.error !== undefined)) {
      this.responses.set(message.id, message);
      const waiter = this.responseWaiters.get(message.id);
      if (waiter) {
        this.responseWaiters.delete(message.id);
        waiter(message);
      }
    }
  }

  send(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  waitForResponse(id: number, timeoutMs: number): Promise<JsonRpcMessage> {
    const existing = this.responses.get(id);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.responseWaiters.delete(id);
        reject(new Error(
          `Timed out waiting for JSON-RPC response id=${id} after ${timeoutMs}ms. ` +
          `stdout lines so far: ${JSON.stringify(this.rawStdoutLines)}; ` +
          `stderr: ${this.stderrChunks.join('')}`,
        ));
      }, timeoutMs);
      this.responseWaiters.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async shutdown(): Promise<void> {
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGKILL');
        resolve();
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function parseToolResult(message: JsonRpcMessage): Record<string, unknown> {
  expect(message.error, `tools/call id=${String(message.id)} returned a JSON-RPC error`).toBeUndefined();
  const content = (message.result as { content?: Array<{ type: string; text: string }> }).content;
  expect(content).toBeDefined();
  expect(content![0]!.type).toBe('text');
  return JSON.parse(content![0]!.text) as Record<string, unknown>;
}

/** Write a minimally-revised copy of a real document so the comparison has a real diff. */
async function writeMinimallyRevisedCopy(sourcePath: string, targetPath: string): Promise<void> {
  const original = await fs.readFile(sourcePath);
  const revised = await DocxDocument.load(original);
  const paragraph = revised.getParagraphs().find((candidate) => {
    const text = getParagraphText(candidate);
    return text.length >= 20 && candidate.getElementsByTagNameNS(OOXML.W_NS, 'fldChar').length === 0;
  });
  if (!paragraph) throw new Error('real fixture has no editable body paragraph');
  const paragraphText = getParagraphText(paragraph);
  replaceParagraphTextRange(paragraph, 0, 1, paragraphText[0] === 'A' ? 'B' : 'A');
  await fs.writeFile(targetPath, (await revised.toBuffer({ cleanBookmarks: false })).buffer);
}

describe('MCP stdio protocol cleanliness under concurrent compare_documents', () => {
  registerCleanup();

  let probe: StdioProbe | undefined;
  afterEach(async () => {
    if (probe) {
      await probe.shutdown();
      probe = undefined;
    }
  });

  test(
    'overlapping tools/call comparisons of a real document leave every stdout line valid JSON-RPC',
    async ({ given, when, then }: AllureBddContext) => {
      const tmpDir = await createTrackedTempDir('safe-docx-stdio-cleanliness-');
      const revisedPath = path.join(tmpDir, 'mutual-nda-revised.docx');
      const outputA = path.join(tmpDir, 'redline-a.docx');
      const outputB = path.join(tmpDir, 'redline-b.docx');

      await given('the real MCP server running over stdio and a real NDA with a revised copy', async () => {
        await writeMinimallyRevisedCopy(REAL_DOCUMENT, revisedPath);
        probe = new StdioProbe();
        probe.send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'stdio-cleanliness-probe', version: '0.0.0' },
          },
        });
        const initResponse = await probe.waitForResponse(1, 60_000);
        expect(initResponse.error).toBeUndefined();
        probe.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      });

      let resultA: Record<string, unknown>;
      let resultB: Record<string, unknown>;
      await when('two compare_documents tools/call requests are issued back-to-back', async () => {
        const callParams = (savePath: string) => ({
          name: 'compare_documents',
          arguments: {
            original_file_path: REAL_DOCUMENT,
            revised_file_path: revisedPath,
            save_to_local_path: savePath,
          },
        });
        // Both requests are written before either response is awaited, giving
        // the server the OPPORTUNITY to run the two comparisons concurrently
        // in one process. This does not deterministically force the overlap
        // that broke issue #809 — that race is pinned by the injectable-
        // dependency test in compare_documents_console_identity.test.ts; this
        // test's job is catching real stdout emissions end-to-end.
        probe!.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: callParams(outputA) });
        probe!.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: callParams(outputB) });
        const [responseA, responseB] = await Promise.all([
          probe!.waitForResponse(2, 90_000),
          probe!.waitForResponse(3, 90_000),
        ]);
        resultA = parseToolResult(responseA);
        resultB = parseToolResult(responseB);
      });

      await then('both comparisons succeed and every stdout line parses as JSON-RPC', async () => {
        expect(resultA.success, JSON.stringify(resultA)).toBe(true);
        expect(resultB.success, JSON.stringify(resultB)).toBe(true);
        await fs.access(outputA);
        await fs.access(outputB);

        expect(probe!.rawStdoutLines.length).toBeGreaterThanOrEqual(3);
        for (const line of probe!.rawStdoutLines) {
          let parsed: JsonRpcMessage | undefined;
          expect(() => {
            parsed = JSON.parse(line) as JsonRpcMessage;
          }, `non-JSON line on the stdio protocol stream: ${line}`).not.toThrow();
          expect(parsed?.jsonrpc, `stdout line is JSON but not JSON-RPC: ${line}`).toBe('2.0');
        }
      });
    },
    120_000,
  );

  test(
    'DOCX_COMPARISON_DEBUG=1 keeps stdout pure JSON-RPC and routes diagnostics to stderr',
    async ({ given, when, then }: AllureBddContext) => {
      const tmpDir = await createTrackedTempDir('safe-docx-stdio-debug-');
      const revisedPath = path.join(tmpDir, 'mutual-nda-revised.docx');
      const outputPath = path.join(tmpDir, 'redline-debug.docx');

      await given('the real MCP server running over stdio with DOCX_COMPARISON_DEBUG enabled', async () => {
        await writeMinimallyRevisedCopy(REAL_DOCUMENT, revisedPath);
        probe = new StdioProbe({ DOCX_COMPARISON_DEBUG: '1' });
        probe.send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'stdio-debug-probe', version: '0.0.0' },
          },
        });
        const initResponse = await probe.waitForResponse(1, 60_000);
        expect(initResponse.error).toBeUndefined();
        probe.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      });

      let result: Record<string, unknown>;
      await when('a compare_documents tools/call request runs with debug diagnostics live', async () => {
        probe!.send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'compare_documents',
            arguments: {
              original_file_path: REAL_DOCUMENT,
              revised_file_path: revisedPath,
              save_to_local_path: outputPath,
            },
          },
        });
        result = parseToolResult(await probe!.waitForResponse(2, 90_000));
      });

      await then('the comparison succeeds and every stdout line parses as JSON-RPC', async () => {
        expect(result.success, JSON.stringify(result)).toBe(true);
        await fs.access(outputPath);

        for (const line of probe!.rawStdoutLines) {
          let parsed: JsonRpcMessage | undefined;
          expect(() => {
            parsed = JSON.parse(line) as JsonRpcMessage;
          }, `non-JSON line on the stdio protocol stream: ${line}`).not.toThrow();
          expect(parsed?.jsonrpc, `stdout line is JSON but not JSON-RPC: ${line}`).toBe('2.0');
        }
      });

      await then('the debug diagnostics appear on stderr instead of vanishing', () => {
        // Guards against "fixing" the corruption by deleting the diagnostics:
        // the enabled debug output must still exist, on the stderr channel.
        const stderrText = probe!.stderrChunks.join('');
        expect(stderrText, 'expected DOCX_COMPARISON_DEBUG diagnostics on stderr').toContain('[DEBUG] [');
      });
    },
    120_000,
  );
});
