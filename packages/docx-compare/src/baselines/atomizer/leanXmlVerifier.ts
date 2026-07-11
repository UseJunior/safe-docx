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
  legacyDocumentXml: { original: string; revised: string; compared: string };
  reconstructionMode: ReconstructionMode;
  options: LeanXmlVerifierOptions;
}

interface LeanStoryJson {
  name: DocumentIntegrityStoryCertificate['name'];
  presence: { original: boolean; revised: boolean; combined: boolean };
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

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function notEvaluated(claim: string): DocumentIntegrityCheckCertificate {
  return { status: 'not_evaluated', claim };
}

function unevaluatedChecks(): DocumentIntegrityCertificate['checks'] {
  return {
    acceptingAllTrackedChangesMatchesRevisedText: notEvaluated(
      'Accepting all tracked changes in the compared document yields the same normalized text as the revised document.'
    ),
    rejectingAllTrackedChangesMatchesOriginalText: notEvaluated(
      'Rejecting all tracked changes in the compared document yields the same normalized text as the original document.'
    ),
    acceptingAllTrackedChangesKeepsValidFieldStructure: notEvaluated(
      'After accepting all tracked changes, Word field markers remain structurally valid.'
    ),
    rejectingAllTrackedChangesKeepsValidFieldStructure: notEvaluated(
      'After rejecting all tracked changes, Word field markers remain structurally valid.'
    ),
    comparedDocumentHasNoFieldMarkersInsideDeletions: notEvaluated(
      'The compared document does not place Word field markers inside deletion markup.'
    ),
  };
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
    presence: {
      original: story.presence.original,
      revised: story.presence.revised,
      compared: story.presence.combined,
    },
  };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBooleanRecord(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => typeof record[key] === 'boolean');
}

function isLeanStoryJson(value: unknown): value is LeanStoryJson {
  if (typeof value !== 'object' || value === null) return false;
  const story = value as Record<string, unknown>;
  const counts = story.parsedTokenCounts as Record<string, unknown> | undefined;
  const report = story.report as Record<string, unknown> | undefined;
  const checks = report?.checks as Record<string, unknown> | undefined;
  const presence = story.presence as Record<string, unknown> | undefined;
  const checkKeys = [
    'acceptPreservesFieldStructure',
    'rejectPreservesFieldStructure',
    'acceptTextMatchesRevised',
    'rejectTextMatchesOriginal',
    'combinedHasNoFldCharInsideDel',
  ] as const;
  return (
    hasExactKeys(story, ['name', 'presence', 'parsedTokenCounts', 'report']) &&
    ['main', 'footnotes', 'endnotes'].includes(story.name as string) &&
    !!presence &&
    hasExactKeys(presence, ['original', 'revised', 'combined']) &&
    isBooleanRecord(presence, ['original', 'revised', 'combined']) &&
    (story.name === 'main' ||
      presence.original === true ||
      presence.revised === true ||
      presence.combined === true) &&
    !!counts &&
    hasExactKeys(counts, ['original', 'revised', 'combined']) &&
    isNonnegativeInteger(counts.original) &&
    isNonnegativeInteger(counts.revised) &&
    isNonnegativeInteger(counts.combined) &&
    (presence.original || counts.original === 0) &&
    (presence.revised || counts.revised === 0) &&
    (presence.combined || counts.combined === 0) &&
    !!report &&
    hasExactKeys(report, ['passed', 'checks']) &&
    typeof report?.passed === 'boolean' &&
    !!checks &&
    hasExactKeys(checks, checkKeys) &&
    isBooleanRecord(checks, checkKeys) &&
    report.passed === checkKeys.every((key) => checks[key] === true)
  );
}

function isPresenceMismatch(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const mismatch = value as Record<string, unknown>;
  const presence = mismatch.presence as Record<string, unknown> | undefined;
  return (
    hasExactKeys(mismatch, ['name', 'packagePart', 'required', 'presence']) &&
    mismatch.name === 'main' &&
    mismatch.packagePart === 'word/document.xml' &&
    mismatch.required === true &&
    !!presence &&
    hasExactKeys(presence, ['original', 'revised', 'combined']) &&
    isBooleanRecord(presence, ['original', 'revised', 'combined'])
  );
}

function samePresence(
  left: { original: boolean; revised: boolean; combined: boolean },
  right: { original: boolean; revised: boolean; combined: boolean },
): boolean {
  return left.original === right.original && left.revised === right.revised && left.combined === right.combined;
}

function isLeanVerifierJson(value: unknown): value is LeanVerifierJson {
  if (typeof value !== 'object' || value === null) return false;
  const root = value as Record<string, unknown>;
  const stories = root.stories as LeanStoryJson[] | undefined;
  const mismatches = root.presenceMismatches as LeanVerifierJson['presenceMismatches'] | undefined;
  const names = stories?.map((story) => story.name) ?? [];
  const main = stories?.find((story) => story.name === 'main');
  const canonicalNames = ['main', 'footnotes', 'endnotes'].filter((name) => names.includes(name as LeanStoryJson['name']));
  return (
    hasExactKeys(root, ['protocolVersion', 'checker', 'passed', 'stories', 'presenceMismatches']) &&
    root.protocolVersion === 2 &&
    root.checker === 'safe-docx-lean-fixed-story-checker' &&
    typeof root.passed === 'boolean' &&
    Array.isArray(stories) &&
    stories.every(isLeanStoryJson) &&
    names[0] === 'main' &&
    names.every((name, index) => name === canonicalNames[index]) &&
    new Set(names).size === names.length &&
    names.every((name) => ['main', 'footnotes', 'endnotes'].includes(name)) &&
    Array.isArray(mismatches) &&
    mismatches.every(isPresenceMismatch) &&
    mismatches.length <= 1 &&
    !!main &&
    (mismatches.length === 0
      ? main.presence.original && main.presence.revised && main.presence.combined
      : samePresence(mismatches[0]!.presence, main.presence)) &&
    root.passed === (mismatches.length === 0 && stories.every((story) => story.report.passed))
  );
}

function runExecutable(executablePath: string, payload: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const child = spawn(executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const killTree = () => {
      if (child.pid && detached) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          // The process group may already have exited.
        }
      }
      if (child.pid && process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        return;
      }
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) killTree();
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 64 * 1024) killTree();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(timedOut ? new Error(`Lean fixed-story checker timed out after ${timeoutMs}ms`) : error);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (timedOut) {
        reject(new Error(`Lean fixed-story checker timed out after ${timeoutMs}ms`));
      } else if (stdout.length > 1024 * 1024 || stderr.length > 64 * 1024) {
        reject(new Error('Lean fixed-story checker exceeded protocol output limits'));
      } else if (code === 0) resolve(stdout);
      else reject(new Error(`Lean fixed-story checker exited with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(payload);
  });
}

function baseCertificate(input: LeanVerifierInput): Omit<
  DocumentIntegrityCertificate,
  'status' | 'stories' | 'checks'
> {
  return {
    verifier: 'Lean XML triple checker',
    protocolVersion: 1,
    scope: 'word/document.xml',
    reconstructionMode: input.reconstructionMode,
    inputSha256: {
      originalDocumentXml: sha256(input.legacyDocumentXml.original),
      revisedDocumentXml: sha256(input.legacyDocumentXml.revised),
      comparedDocumentXml: sha256(input.legacyDocumentXml.compared),
    },
    checkerProtocolVersion: 2,
    fixedStoryScope: ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'],
    inputPackageSha256: {
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
  const snapshot: LeanVerifierInput = {
    ...input,
    originalDocx: Buffer.from(input.originalDocx),
    revisedDocx: Buffer.from(input.revisedDocx),
    comparedDocx: Buffer.from(input.comparedDocx),
    legacyDocumentXml: { ...input.legacyDocumentXml },
    options: { ...input.options },
  };
  const base = baseCertificate(snapshot);
  if (snapshot.reconstructionMode !== 'inplace') {
    return {
      ...base,
      status: 'not_applicable',
      stories: [],
      checks: unevaluatedChecks(),
      reason: 'Lean fixed-story verification currently covers inplace comparison output only.',
    };
  }

  const executablePath = snapshot.options.executablePath ?? process.env.SAFE_DOCX_LEAN_XML_CHECKER ?? DEFAULT_EXECUTABLE;
  const timeoutMs = snapshot.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let scratch: string | undefined;
  try {
    scratch = await mkdtemp(join(tmpdir(), 'safe-docx-lean-verifier-'));
    const originalDocxPath = join(scratch, 'original.docx');
    const revisedDocxPath = join(scratch, 'revised.docx');
    const comparedDocxPath = join(scratch, 'compared.docx');
    await Promise.all([
      writeFile(originalDocxPath, snapshot.originalDocx),
      writeFile(revisedDocxPath, snapshot.revisedDocx),
      writeFile(comparedDocxPath, snapshot.comparedDocx),
    ]);
    const stdout = await runExecutable(executablePath, JSON.stringify({
      protocolVersion: 2, originalDocxPath, revisedDocxPath, comparedDocxPath,
    }), timeoutMs);
    const parsed: unknown = JSON.parse(stdout);
    if (!isLeanVerifierJson(parsed)) throw new Error('Lean fixed-story checker returned an unexpected JSON shape');
    const stories = parsed.stories.map(storyCertificate);
    const main = stories.find((story) => story.name === 'main');
    if (!main) throw new Error('Lean fixed-story checker omitted the required main story');
    return {
      ...base,
      status: parsed.passed ? 'passed' : 'failed',
      stories,
      checks: {
        acceptingAllTrackedChangesMatchesRevisedText:
          main.checks.acceptingAllTrackedChangesMatchesRevisedText,
        rejectingAllTrackedChangesMatchesOriginalText:
          main.checks.rejectingAllTrackedChangesMatchesOriginalText,
        acceptingAllTrackedChangesKeepsValidFieldStructure:
          main.checks.acceptingAllTrackedChangesKeepsValidFieldStructure,
        rejectingAllTrackedChangesKeepsValidFieldStructure:
          main.checks.rejectingAllTrackedChangesKeepsValidFieldStructure,
        comparedDocumentHasNoFieldMarkersInsideDeletions:
          main.checks.comparedStoryHasNoFieldMarkersInsideDeletions,
      },
      parsedTokenCounts: main.parsedTokenCounts,
      presenceMismatches: parsed.presenceMismatches,
      reason: parsed.presenceMismatches.length > 0 ? 'Required or optional fixed-story presence did not match across the DOCX triple.' : undefined,
    };
  } catch (error) {
    return {
      ...base,
      status: 'not_run',
      stories: [],
      checks: unevaluatedChecks(),
      reason: error instanceof Error ? error.message : 'Lean fixed-story checker failed',
    };
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
