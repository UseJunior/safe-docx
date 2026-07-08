import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  DocumentIntegrityCertificate,
  DocumentIntegrityCheckCertificate,
  LeanXmlVerifierOptions,
  ReconstructionMode,
} from '../../compare-types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_EXECUTABLE = 'verification/lean/.lake/build/bin/leanDocxChecker';

interface LeanVerifierInput {
  originalDocumentXml: string;
  revisedDocumentXml: string;
  comparedDocumentXml: string;
  reconstructionMode: ReconstructionMode;
  options: LeanXmlVerifierOptions;
}

interface LeanVerifierJson {
  protocolVersion: number;
  checker: string;
  parsedTokenCounts: {
    original: number;
    revised: number;
    combined: number;
  };
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function check(status: boolean, claim: string): DocumentIntegrityCheckCertificate {
  return { status: status ? 'passed' : 'failed', claim };
}

function notEvaluated(claim: string): DocumentIntegrityCheckCertificate {
  return { status: 'not_evaluated', claim };
}

function baseCertificate(input: LeanVerifierInput): Omit<DocumentIntegrityCertificate, 'status' | 'checks'> {
  return {
    verifier: 'Lean XML triple checker',
    protocolVersion: 1,
    scope: 'word/document.xml',
    reconstructionMode: input.reconstructionMode,
    inputSha256: {
      originalDocumentXml: sha256(input.originalDocumentXml),
      revisedDocumentXml: sha256(input.revisedDocumentXml),
      comparedDocumentXml: sha256(input.comparedDocumentXml),
    },
  };
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

function isLeanVerifierJson(value: unknown): value is LeanVerifierJson {
  if (typeof value !== 'object' || value === null) return false;
  const root = value as Record<string, unknown>;
  const parsedTokenCounts = root.parsedTokenCounts as Record<string, unknown> | undefined;
  const report = root.report as Record<string, unknown> | undefined;
  const checks = report?.checks as Record<string, unknown> | undefined;
  return (
    root.protocolVersion === 1 &&
    typeof root.checker === 'string' &&
    typeof parsedTokenCounts?.original === 'number' &&
    typeof parsedTokenCounts.revised === 'number' &&
    typeof parsedTokenCounts.combined === 'number' &&
    typeof report?.passed === 'boolean' &&
    typeof checks?.acceptPreservesFieldStructure === 'boolean' &&
    typeof checks.rejectPreservesFieldStructure === 'boolean' &&
    typeof checks.acceptTextMatchesRevised === 'boolean' &&
    typeof checks.rejectTextMatchesOriginal === 'boolean' &&
    typeof checks.combinedHasNoFldCharInsideDel === 'boolean'
  );
}

function runExecutable(
  executablePath: string,
  payload: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Lean XML triple checker timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Lean XML triple checker exited with code ${code}: ${stderr.trim()}`));
      }
    });
    child.stdin.end(payload);
  });
}

export async function runLeanXmlTripleVerifier(
  input: LeanVerifierInput
): Promise<DocumentIntegrityCertificate> {
  const base = baseCertificate(input);
  if (input.reconstructionMode !== 'inplace') {
    return {
      ...base,
      status: 'not_applicable',
      checks: unevaluatedChecks(),
      reason: 'Lean XML triple verification currently covers inplace comparison output only.',
    };
  }

  const executablePath =
    input.options.executablePath ??
    process.env.SAFE_DOCX_LEAN_XML_CHECKER ??
    DEFAULT_EXECUTABLE;
  const timeoutMs = input.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request = JSON.stringify({
    protocolVersion: 1,
    originalDocumentXml: input.originalDocumentXml,
    revisedDocumentXml: input.revisedDocumentXml,
    combinedDocumentXml: input.comparedDocumentXml,
  });

  try {
    const stdout = await runExecutable(executablePath, request, timeoutMs);
    const parsed: unknown = JSON.parse(stdout);
    if (!isLeanVerifierJson(parsed)) {
      throw new Error('Lean XML triple checker returned an unexpected JSON shape');
    }

    const checks = parsed.report.checks;
    return {
      ...base,
      status: parsed.report.passed ? 'passed' : 'failed',
      checks: {
        acceptingAllTrackedChangesMatchesRevisedText: check(
          checks.acceptTextMatchesRevised,
          'Accepting all tracked changes in the compared document yields the same normalized text as the revised document.'
        ),
        rejectingAllTrackedChangesMatchesOriginalText: check(
          checks.rejectTextMatchesOriginal,
          'Rejecting all tracked changes in the compared document yields the same normalized text as the original document.'
        ),
        acceptingAllTrackedChangesKeepsValidFieldStructure: check(
          checks.acceptPreservesFieldStructure,
          'After accepting all tracked changes, Word field markers remain structurally valid.'
        ),
        rejectingAllTrackedChangesKeepsValidFieldStructure: check(
          checks.rejectPreservesFieldStructure,
          'After rejecting all tracked changes, Word field markers remain structurally valid.'
        ),
        comparedDocumentHasNoFieldMarkersInsideDeletions: check(
          checks.combinedHasNoFldCharInsideDel,
          'The compared document does not place Word field markers inside deletion markup.'
        ),
      },
      parsedTokenCounts: {
        original: parsed.parsedTokenCounts.original,
        revised: parsed.parsedTokenCounts.revised,
        compared: parsed.parsedTokenCounts.combined,
      },
    };
  } catch (error) {
    return {
      ...base,
      status: 'not_run',
      checks: unevaluatedChecks(),
      reason: error instanceof Error ? error.message : 'Lean XML triple checker failed',
    };
  }
}
