import { expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';

import { SessionManager } from '../session/manager.js';
import { openDocument } from '../tools/open_document.js';
import { readFile } from '../tools/read_file.js';
import {
  extractParaIdsFromToon,
  firstParaIdFromToon,
  makeMinimalDocx,
  makeDocxWithDocumentXml,
} from './docx_test_utils.js';
import { allureStep } from './allure-test.js';

// ---------------------------------------------------------------------------
// Tracked temp dirs with automatic cleanup
// ---------------------------------------------------------------------------

const trackedTempDirs: string[] = [];

export function registerCleanup(): void {
  afterEach(async () => {
    for (const dir of trackedTempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

export async function createTrackedTempDir(prefix = 'safe-docx-test-'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  trackedTempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Session manager factory
// ---------------------------------------------------------------------------

export function createTestSessionManager(opts?: { ttlMs?: number }): SessionManager {
  return new SessionManager({ ttlMs: opts?.ttlMs ?? 60 * 60 * 1000 });
}

// ---------------------------------------------------------------------------
// openSession — one-shot open+read helper
// ---------------------------------------------------------------------------

interface OpenSessionOptions {
  xml?: string;
  extraFiles?: Record<string, string>;
  format?: 'toon' | 'simple' | 'json';
  mgr?: SessionManager;
  prefix?: string;
}

interface OpenSessionResult {
  mgr: SessionManager;
  sessionId: string;
  content: string;
  paraIds: string[];
  firstParaId: string;
  tmpDir: string;
  inputPath: string;
}

export async function openSession(
  paragraphs: string[],
  opts?: OpenSessionOptions,
): Promise<OpenSessionResult> {
  return allureStep('Open test session', async () => {
    const mgr = opts?.mgr ?? createTestSessionManager();
    const tmpDir = await createTrackedTempDir(opts?.prefix);
    const inputPath = path.join(tmpDir, 'input.docx');

    const buf = opts?.xml
      ? await makeDocxWithDocumentXml(opts.xml, opts.extraFiles)
      : await makeMinimalDocx(paragraphs);
    await fs.writeFile(inputPath, new Uint8Array(buf));

    const opened = await openDocument(mgr, { file_path: inputPath });
    assertSuccess(opened, 'open');
    const sessionId = opened.session_id as string;

    const read = await readFile(mgr, { session_id: sessionId, format: opts?.format });
    assertSuccess(read, 'read');
    const content = String(read.content);
    const paraIds = extractParaIdsFromToon(content);
    const firstParaId = paraIds.length > 0 ? paraIds[0]! : firstParaIdFromToon(content);

    return { mgr, sessionId, content, paraIds, firstParaId, tmpDir, inputPath };
  });
}

// ---------------------------------------------------------------------------
// Result assertion helpers
// ---------------------------------------------------------------------------

export function assertSuccess<T extends { success: boolean }>(
  result: T,
  label = 'operation',
): asserts result is T & { success: true } {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(`${label} failed`);
}

export function assertFailure<T extends { success: boolean; error?: { code?: string } }>(
  result: T,
  expectedCode?: string,
  label = 'operation',
): asserts result is T & { success: false } {
  expect(result.success).toBe(false);
  if (result.success) throw new Error(`expected ${label} to fail`);
  if (expectedCode) {
    expect((result as any).error.code).toBe(expectedCode);
  }
}

// ---------------------------------------------------------------------------
// XML output parsing helper
// ---------------------------------------------------------------------------

interface ParsedOutputXml {
  dom: XmlDocument;
  runs: XmlElement[];
  runText: (r: XmlElement) => string;
  hasBold: (r: XmlElement) => boolean;
  hasItalic: (r: XmlElement) => boolean;
  hasUnderline: (r: XmlElement) => boolean;
  hasHighlight: (r: XmlElement) => boolean;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export async function parseOutputXml(outputPath: string): Promise<ParsedOutputXml> {
  const { readDocumentXmlFromPath } = await import('./docx_test_utils.js');
  const { DOMParser } = await import('@xmldom/xmldom');
  const outXml = await readDocumentXmlFromPath(outputPath);
  const dom = new DOMParser().parseFromString(outXml, 'text/xml');
  const runs = Array.from(dom.getElementsByTagNameNS(W_NS, 'r')) as XmlElement[];

  const runText = (r: XmlElement) =>
    Array.from(r.getElementsByTagNameNS(W_NS, 't'))
      .map((t) => t.textContent ?? '')
      .join('');

  const hasBold = (r: XmlElement) => !!r.getElementsByTagNameNS(W_NS, 'b').item(0);

  const hasItalic = (r: XmlElement) => !!r.getElementsByTagNameNS(W_NS, 'i').item(0);

  const hasUnderline = (r: XmlElement) => {
    const rPr = r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as XmlElement | null;
    if (!rPr) return false;
    const u = rPr.getElementsByTagNameNS(W_NS, 'u').item(0) as XmlElement | null;
    if (!u) return false;
    const val = u.getAttribute('w:val') ?? u.getAttribute('val');
    return val !== 'none';
  };

  const hasHighlight = (r: XmlElement) => {
    const rPr = r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as XmlElement | null;
    if (!rPr) return false;
    return !!rPr.getElementsByTagNameNS(W_NS, 'highlight').item(0);
  };

  return { dom, runs, runText, hasBold, hasItalic, hasUnderline, hasHighlight };
}
