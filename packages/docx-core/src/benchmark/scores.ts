/**
 * Quality benchmark scores.
 *
 * Q1: Diff minimality — count of ins/del runs
 * Q2: Compatibility — LibreOffice round-trip test
 * Q4: Extras — move detection, table cell diffs
 */

import { execFile } from 'child_process';
import { writeFile, unlink, access, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { parseXml } from '../primitives/xml.js';
import { findAllByTagName } from '../primitives/dom-helpers.js';

const execFileAsync = promisify(execFile);

// ── Q1: Diff minimality ────────────────────────────────────────────

export interface DiffMinimalityResult {
  engineRuns: number;
  oracleRuns: number | null;
  ratio: number | null;
}

export function scoreDiffMinimality(
  resultDocumentXml: string,
  oracleDocumentXml?: string | null,
): DiffMinimalityResult {
  const doc = parseXml(resultDocumentXml);
  const root = doc.documentElement!;
  const insCount = findAllByTagName(root, 'w:ins').length;
  const delCount = findAllByTagName(root, 'w:del').length;
  const engineRuns = insCount + delCount;

  let oracleRuns: number | null = null;
  let ratio: number | null = null;

  if (oracleDocumentXml) {
    const oracleDoc = parseXml(oracleDocumentXml);
    const oracleRoot = oracleDoc.documentElement!;
    const oracleIns = findAllByTagName(oracleRoot, 'w:ins').length;
    const oracleDel = findAllByTagName(oracleRoot, 'w:del').length;
    oracleRuns = oracleIns + oracleDel;
    ratio = oracleRuns > 0 ? engineRuns / oracleRuns : null;
  }

  return { engineRuns, oracleRuns, ratio };
}

// ── Q2: Compatibility (LibreOffice) ─────────────────────────────────

export interface CompatibilityResult {
  opensClean: boolean;
  skipReason?: string;
}

export async function scoreCompatibility(
  resultBuffer: Buffer,
  libreOfficePath?: string,
  timeout: number = 30_000,
): Promise<CompatibilityResult> {
  if (!libreOfficePath) {
    return { opensClean: false, skipReason: 'binary_missing' };
  }

  // Verify binary exists
  try {
    await access(libreOfficePath);
  } catch {
    return { opensClean: false, skipReason: 'binary_missing' };
  }

  let tempDir: string | undefined;
  let inputPath: string | undefined;

  try {
    tempDir = await mkdtemp(join(tmpdir(), 'benchmark-q2-'));
    inputPath = join(tempDir, 'input.docx');
    await writeFile(inputPath, resultBuffer);

    await execFileAsync(
      libreOfficePath,
      ['--headless', '--convert-to', 'docx', '--outdir', tempDir, inputPath],
      { timeout },
    );

    return { opensClean: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('TIMEOUT') || msg.includes('timed out')) {
      return { opensClean: false, skipReason: 'timeout' };
    }
    return { opensClean: false, skipReason: 'conversion_error' };
  } finally {
    // Cleanup temp files
    if (inputPath) {
      try { await unlink(inputPath); } catch { /* ignore */ }
    }
    if (tempDir) {
      const outputPath = join(tempDir, 'input.docx');
      try { await unlink(outputPath); } catch { /* ignore */ }
      try {
        const { rmdir } = await import('fs/promises');
        await rmdir(tempDir);
      } catch { /* ignore */ }
    }
  }
}

// ── Q4: Extras ──────────────────────────────────────────────────────

export interface ExtrasResult {
  moveDetection: boolean;
  tableCellDiff: boolean;
}

export function scoreExtras(resultDocumentXml: string): ExtrasResult {
  const doc = parseXml(resultDocumentXml);
  const root = doc.documentElement!;

  // Move detection: w:moveFrom or w:moveTo present
  const moveFrom = findAllByTagName(root, 'w:moveFrom');
  const moveTo = findAllByTagName(root, 'w:moveTo');
  const moveDetection = moveFrom.length > 0 || moveTo.length > 0;

  // Table cell diff: track changes inside w:tc elements
  const tableCells = findAllByTagName(root, 'w:tc');
  let tableCellDiff = false;
  for (const tc of tableCells) {
    const ins = findAllByTagName(tc as Element, 'w:ins');
    const del = findAllByTagName(tc as Element, 'w:del');
    if (ins.length > 0 || del.length > 0) {
      tableCellDiff = true;
      break;
    }
  }

  return { moveDetection, tableCellDiff };
}
