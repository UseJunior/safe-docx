import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DocumentIntegrityCertificate,
  DocumentIntegrityCheckCertificate,
  DocumentIntegrityStoryCertificate,
  LeanXmlVerifierOptions,
  ReconstructionMode,
} from '../../compare-types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_EXECUTABLE = 'verification/lean/.lake/build/bin/leanDocxChecker';

interface LeanVerifierInput {
  originalDocx: Buffer;
  revisedDocx: Buffer;
  comparedDocx: Buffer;
  reconstructionMode: ReconstructionMode;
  options: LeanXmlVerifierOptions;
}

interface LeanStoryJson {
  name: string;
  parsedTokenCounts: { original: number; revised: number; combined: number };
  report: {
    passed: boolean;
    checks: {
      acceptPreservesFieldStructure: boolean;
      rejectPreservesFieldStructure: boolean;
      acceptTextMatchesRevised: boolean;
      rejectTextMatchesOriginal: boolean;
      combinedHasNoFldCharInsideDel: boolean;
    };
  };
}

interface LeanVerifierJson {
  protocolVersion: 2;
  checker: string;
  passed: boolean;
  stories: LeanStoryJson[];
  presenceMismatches: Array<{
    name: string;
    packagePart: string;
    required: boolean;
    presence: { original: boolean; revised: boolean; combined: boolean };
  }>;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function check(status: boolean, claim: string): DocumentIntegrityCheckCertificate {
  return { status: status ? 'passed' : 'failed', claim };
}

function storyCertificate(story: LeanStoryJson): DocumentIntegrityStoryCertificate {
  const checks = story.report.checks;
  return {
    name: story.name as DocumentIntegrityStoryCertificate['name'],
    status: story.report.passed ? 'passed' : 'failed',
    checks: {
      acceptingAllTrackedChangesMatchesRevisedText: check(
        checks.acceptTextMatchesRevised,
        'Accepting all tracked changes in this story yields the same normalized text as the revised story.'
      ),
      rejectingAllTrackedChangesMatchesOriginalText: check(
        checks.rejectTextMatchesOriginal,
        'Rejecting all tracked changes in this story yields the same normalized text as the original story.'
      ),
      acceptingAllTrackedChangesKeepsValidFieldStructure: check(
        checks.acceptPreservesFieldStructure,
        'After accepting all tracked changes, Word field markers in this story remain structurally valid.'
      ),
      rejectingAllTrackedChangesKeepsValidFieldStructure: check(
        checks.rejectPreservesFieldStructure,
        'After rejecting all tracked changes, Word field markers in this story remain structurally valid.'
      ),
      comparedStoryHasNoFieldMarkersInsideDeletions: check(
        checks.combinedHasNoFldCharInsideDel,
        'The compared story does not place Word field markers inside deletion markup.'
      ),
    },
    parsedTokenCounts: {
      original: story.parsedTokenCounts.original,
      revised: story.parsedTokenCounts.revised,
      compared: story.parsedTokenCounts.combined,
    },
  };
}

function isBooleanRecord(value: unknown, keys: string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => typeof record[key] === 'boolean');
}

function isLeanStoryJson(value: unknown): value is LeanStoryJson {
  if (typeof value !== 'object' || value === null) return false;
  const story = value as Record<string, unknown>;
  const counts = story.parsedTokenCounts as Record<string, unknown> | undefined;
  const report = story.report as Record<string, unknown> | undefined;
  return (
    ['main', 'footnotes', 'endnotes'].includes(story.name as string) &&
    typeof counts?.original === 'number' &&
    typeof counts.revised === 'number' &&
    typeof counts.combined === 'number' &&
    typeof report?.passed === 'boolean' &&
    isBooleanRecord(report.checks, [
      'acceptPreservesFieldStructure',
      'rejectPreservesFieldStructure',
      'acceptTextMatchesRevised',
      'rejectTextMatchesOriginal',
      'combinedHasNoFldCharInsideDel',
    ])
  );
}

function isPresenceMismatch(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const mismatch = value as Record<string, unknown>;
  return (
    typeof mismatch.name === 'string' &&
    typeof mismatch.packagePart === 'string' &&
    typeof mismatch.required === 'boolean' &&
    isBooleanRecord(mismatch.presence, ['original', 'revised', 'combined'])
  );
}

function isLeanVerifierJson(value: unknown): value is LeanVerifierJson {
  if (typeof value !== 'object' || value === null) return false;
  const root = value as Record<string, unknown>;
  return (
    root.protocolVersion === 2 &&
    root.checker === 'safe-docx-lean-fixed-story-checker' &&
    typeof root.passed === 'boolean' &&
    Array.isArray(root.stories) &&
    root.stories.every(isLeanStoryJson) &&
    Array.isArray(root.presenceMismatches) &&
    root.presenceMismatches.every(isPresenceMismatch)
  );
}

function runExecutable(executablePath: string, payload: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Lean fixed-story checker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Lean fixed-story checker exited with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(payload);
  });
}

function baseCertificate(input: LeanVerifierInput): Omit<DocumentIntegrityCertificate, 'status' | 'stories'> {
  return {
    verifier: 'Lean fixed-story checker',
    protocolVersion: 2,
    scope: ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'],
    reconstructionMode: input.reconstructionMode,
    inputSha256: {
      originalDocx: sha256(input.originalDocx),
      revisedDocx: sha256(input.revisedDocx),
      comparedDocx: sha256(input.comparedDocx),
    },
    exclusions: [
      'relationships and note-reference integrity',
      'comments, headers, and footers',
      'rendering and full ECMA-376 validation',
    ],
  };
}

export async function runLeanXmlTripleVerifier(input: LeanVerifierInput): Promise<DocumentIntegrityCertificate> {
  const base = baseCertificate(input);
  if (input.reconstructionMode !== 'inplace') {
    return { ...base, status: 'not_applicable', stories: [], reason: 'Lean fixed-story verification currently covers inplace comparison output only.' };
  }

  const executablePath = input.options.executablePath ?? process.env.SAFE_DOCX_LEAN_XML_CHECKER ?? DEFAULT_EXECUTABLE;
  const timeoutMs = input.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scratch = await mkdtemp(join(tmpdir(), 'safe-docx-lean-verifier-'));
  try {
    const originalDocxPath = join(scratch, 'original.docx');
    const revisedDocxPath = join(scratch, 'revised.docx');
    const comparedDocxPath = join(scratch, 'compared.docx');
    await Promise.all([
      writeFile(originalDocxPath, input.originalDocx),
      writeFile(revisedDocxPath, input.revisedDocx),
      writeFile(comparedDocxPath, input.comparedDocx),
    ]);
    const stdout = await runExecutable(executablePath, JSON.stringify({
      protocolVersion: 2, originalDocxPath, revisedDocxPath, comparedDocxPath,
    }), timeoutMs);
    const parsed: unknown = JSON.parse(stdout);
    if (!isLeanVerifierJson(parsed)) throw new Error('Lean fixed-story checker returned an unexpected JSON shape');
    return {
      ...base,
      status: parsed.passed ? 'passed' : 'failed',
      stories: parsed.stories.map(storyCertificate),
      presenceMismatches: parsed.presenceMismatches,
      reason: parsed.presenceMismatches.length > 0 ? 'Required or optional fixed-story presence did not match across the DOCX triple.' : undefined,
    };
  } catch (error) {
    return { ...base, status: 'not_run', stories: [], reason: error instanceof Error ? error.message : 'Lean fixed-story checker failed' };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
