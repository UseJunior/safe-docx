import fs from 'node:fs/promises';
import { errorCode, errorMessage } from "../error_utils.js";
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DocxZip, parseXml } from '@usejunior/docx-core';
import { SessionManager } from '../session/manager.js';
import { openDocument } from '../tools/open_document.js';
import { readFile } from '../tools/read_file.js';
import { replaceText } from '../tools/replace_text.js';
import { download } from '../tools/download.js';

export const CONFORMANCE_REPORT_SCHEMA_VERSION = 'safe-docx-conformance-report/v1';
export const FIXTURE_MANIFEST_SCHEMA_VERSION = 'safe-docx-fixture-manifest/v1';

export type ConformanceFailureCode =
  | 'ZIP_OPEN_FAILED'
  | 'OPC_PART_MISSING'
  | 'XML_PARSE_FAILED'
  | 'PLACEHOLDER_LEAK'
  | 'UNEXPECTED_TEXT_MUTATION'
  | 'TRACKED_CHANGES_OUTPUT_FAILED'
  | 'NON_DETERMINISTIC_RESULT'
  | 'TOOL_OPERATION_FAILED'
  | 'NOT_COVERED';

export type ConformanceCheckStatus = 'PASS' | 'FAIL' | 'NOT_COVERED';
export type ConformanceFixtureStatus = 'PASS' | 'FAIL' | 'NOT_COVERED';

export type FixtureSourceType = 'local_repo' | 'open_agreements_optional';

export type FixtureCheckId =
  | 'zip_open'
  | 'opc_part_document_xml'
  | 'xml_parse'
  | 'toon_roundtrip_equivalence'
  | 'deterministic_replace_text_toon'
  | 'tracked_changes_output'
  | 'placeholder_leak';

export type FixtureOperationId =
  | 'preflight'
  | 'toon_roundtrip'
  | 'deterministic_replace_text'
  | 'tracked_changes_output'
  | 'placeholder_leak_scan';

export type FixtureEditSpec = {
  old_string: string;
  new_string: string;
};

export type FixtureManifestEntry = {
  fixture_id: string;
  source_path: string;
  source_type: FixtureSourceType;
  category: string;
  operations_to_run: FixtureOperationId[];
  expected_checks: FixtureCheckId[];
  notes?: string;
  edit_spec?: FixtureEditSpec;
};

export type FixtureManifest = {
  schema_version: string;
  fixtures: FixtureManifestEntry[];
};

export type ConformanceCheckResult = {
  check_id: FixtureCheckId;
  status: ConformanceCheckStatus;
  failure_code?: ConformanceFailureCode;
  message: string;
};

export type FixtureConformanceResult = {
  fixture_id: string;
  source_path: string;
  source_type: FixtureSourceType;
  category: string;
  status: ConformanceFixtureStatus;
  checks: ConformanceCheckResult[];
};

export type ConformanceReport = {
  schema_version: string;
  generated_at: string;
  mode: 'full' | 'smoke';
  repo_root: string;
  options: {
    deterministic_runs: number;
    open_agreements_root?: string;
  };
  fixtures_total: number;
  fixtures_passed: number;
  fixtures_failed: number;
  checks_passed: number;
  checks_failed: number;
  not_covered_count: number;
  fixtures: FixtureConformanceResult[];
};

export type HarnessOptions = {
  manifestPath: string;
  repoRoot: string;
  mode?: 'full' | 'smoke';
  deterministicRuns?: number;
  openAgreementsRoot?: string;
};

type ResolvedFixturePath =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: string; code: ConformanceFailureCode };

function isToolSuccess(
  response: Awaited<ReturnType<typeof openDocument>>
): response is { success: true; [key: string]: unknown } {
  return response.success === true;
}

function canonicalizeToon(toon: string): string {
  const lines = toon
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const normalized: string[] = [];
  let paraCounter = 0;
  for (const line of lines) {
    if (!line.startsWith('_bk_')) {
      normalized.push(line);
      continue;
    }
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length <= 1) {
      normalized.push(`PARA_${paraCounter}`);
      paraCounter += 1;
      continue;
    }
    normalized.push([`PARA_${paraCounter}`, ...cols.slice(1)].join(' | '));
    paraCounter += 1;
  }
  return normalized.join('\n');
}

function containsPlaceholderLeak(text: string): boolean {
  return /\{[A-Za-z0-9_]+\}/.test(text);
}

async function sha256OfFile(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function withTempDir<T>(prefix: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function resolveFixturePath(
  fixture: FixtureManifestEntry,
  repoRoot: string,
  openAgreementsRoot?: string
): Promise<ResolvedFixturePath> {
  if (fixture.source_type === 'local_repo') {
    return { ok: true, absolutePath: path.resolve(repoRoot, fixture.source_path) };
  }
  if (!openAgreementsRoot) {
    return {
      ok: false,
      code: 'NOT_COVERED',
      reason: 'open_agreements_root_not_configured',
    };
  }
  return {
    ok: true,
    absolutePath: path.resolve(openAgreementsRoot, fixture.source_path),
  };
}

async function runPreflightChecks(absPath: string): Promise<ConformanceCheckResult[]> {
  const checks: ConformanceCheckResult[] = [];
  let zip: DocxZip;
  try {
    const buf = await fs.readFile(absPath);
    zip = await DocxZip.load(buf as Buffer);
    checks.push({
      check_id: 'zip_open',
      status: 'PASS',
      message: `ZIP opened (${buf.length} bytes).`,
    });
  } catch (err: unknown) {
    checks.push({
      check_id: 'zip_open',
      status: 'FAIL',
      failure_code: 'ZIP_OPEN_FAILED',
      message: `Failed to open ZIP: ${errorMessage(err)}`,
    });
    checks.push({
      check_id: 'opc_part_document_xml',
      status: 'NOT_COVERED',
      failure_code: 'NOT_COVERED',
      message: 'Skipped because ZIP open failed.',
    });
    checks.push({
      check_id: 'xml_parse',
      status: 'NOT_COVERED',
      failure_code: 'NOT_COVERED',
      message: 'Skipped because ZIP open failed.',
    });
    return checks;
  }

  const documentXml = await zip.readTextOrNull('word/document.xml');
  if (!documentXml) {
    checks.push({
      check_id: 'opc_part_document_xml',
      status: 'FAIL',
      failure_code: 'OPC_PART_MISSING',
      message: "Missing required OPC part 'word/document.xml'.",
    });
    checks.push({
      check_id: 'xml_parse',
      status: 'NOT_COVERED',
      failure_code: 'NOT_COVERED',
      message: 'Skipped because word/document.xml is missing.',
    });
    return checks;
  }

  checks.push({
    check_id: 'opc_part_document_xml',
    status: 'PASS',
    message: "Found OPC part 'word/document.xml'.",
  });

  try {
    parseXml(documentXml);
    checks.push({
      check_id: 'xml_parse',
      status: 'PASS',
      message: 'XML parse succeeded for word/document.xml.',
    });
  } catch (err: unknown) {
    checks.push({
      check_id: 'xml_parse',
      status: 'FAIL',
      failure_code: 'XML_PARSE_FAILED',
      message: `XML parse failed: ${errorMessage(err)}`,
    });
  }

  return checks;
}

async function readToonCanonicalFromPath(filePath: string): Promise<{
  ok: true;
  canonical: string;
} | {
  ok: false;
  code: ConformanceFailureCode;
  message: string;
}> {
  const mgr = new SessionManager();
  const opened = await openDocument(mgr, { file_path: filePath });
  if (!isToolSuccess(opened)) {
    return {
      ok: false,
      code: 'TOOL_OPERATION_FAILED',
      message: `open_document failed: ${opened.error.code} ${opened.error.message}`,
    };
  }
  const sessionId = String(opened.session_id);
  const read = await readFile(mgr, { session_id: sessionId, format: 'toon' });
  if (!isToolSuccess(read)) {
    return {
      ok: false,
      code: 'TOOL_OPERATION_FAILED',
      message: `read_file failed: ${read.error.code} ${read.error.message}`,
    };
  }
  return { ok: true, canonical: canonicalizeToon(String(read.content ?? '')) };
}

async function runToonRoundtripCheck(absPath: string): Promise<ConformanceCheckResult> {
  const before = await readToonCanonicalFromPath(absPath);
  if (!before.ok) {
    return {
      check_id: 'toon_roundtrip_equivalence',
      status: 'FAIL',
      failure_code: before.code,
      message: before.message,
    };
  }

  const mgr = new SessionManager();
  const opened = await openDocument(mgr, { file_path: absPath });
  if (!isToolSuccess(opened)) {
    return {
      check_id: 'toon_roundtrip_equivalence',
      status: 'FAIL',
      failure_code: 'TOOL_OPERATION_FAILED',
      message: `open_document failed: ${opened.error.code} ${opened.error.message}`,
    };
  }

  const after = await withTempDir('safe-docx-conformance-roundtrip-', async (outDir) => {
    const cleanPath = path.join(outDir, 'clean.docx');
    const saved = await download(mgr, {
      session_id: String(opened.session_id),
      save_to_local_path: cleanPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    if (!isToolSuccess(saved)) {
      return {
        ok: false as const,
        code: 'TOOL_OPERATION_FAILED' as const,
        message: `download(clean) failed: ${saved.error.code} ${saved.error.message}`,
      };
    }
    return readToonCanonicalFromPath(cleanPath);
  });

  if (!after.ok) {
    return {
      check_id: 'toon_roundtrip_equivalence',
      status: 'FAIL',
      failure_code: after.code,
      message: after.message,
    };
  }
  if (before.canonical !== after.canonical) {
    return {
      check_id: 'toon_roundtrip_equivalence',
      status: 'FAIL',
      failure_code: 'UNEXPECTED_TEXT_MUTATION',
      message: 'Canonical TOON changed after clean roundtrip.',
    };
  }
  return {
    check_id: 'toon_roundtrip_equivalence',
    status: 'PASS',
    message: 'Canonical TOON equivalence preserved across clean roundtrip.',
  };
}

async function runDeterministicReplaceTextOnce(
  absPath: string,
  edit: FixtureEditSpec
): Promise<{
  ok: true;
  canonical: string;
} | {
  ok: false;
  code: ConformanceFailureCode;
  message: string;
}> {
  const mgr = new SessionManager();
  const opened = await openDocument(mgr, { file_path: absPath });
  if (!isToolSuccess(opened)) {
    return {
      ok: false,
      code: 'TOOL_OPERATION_FAILED',
      message: `open_document failed: ${opened.error.code} ${opened.error.message}`,
    };
  }
  const sessionId = String(opened.session_id);

  const readJson = await readFile(mgr, { session_id: sessionId, format: 'json' });
  if (!isToolSuccess(readJson)) {
    return {
      ok: false,
      code: 'TOOL_OPERATION_FAILED',
      message: `read_file(json) failed: ${readJson.error.code} ${readJson.error.message}`,
    };
  }
  const nodes = JSON.parse(String(readJson.content ?? '')) as Array<{ id: string; clean_text: string }>;
  const target = nodes.find((n) => n.clean_text.includes(edit.old_string));
  if (!target) {
    return {
      ok: false,
      code: 'TOOL_OPERATION_FAILED',
      message: `No paragraph contains old_string '${edit.old_string}'.`,
    };
  }

  const edited = await replaceText(mgr, {
    session_id: sessionId,
    target_paragraph_id: target.id,
    old_string: edit.old_string,
    new_string: edit.new_string,
    instruction: 'safe-docx conformance deterministic edit',
  });
  if (!isToolSuccess(edited)) {
    return {
      ok: false,
      code: 'TOOL_OPERATION_FAILED',
      message: `replace_text failed: ${edited.error.code} ${edited.error.message}`,
    };
  }

  return withTempDir('safe-docx-conformance-edit-', async (outDir) => {
    const cleanPath = path.join(outDir, 'edited.docx');
    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: cleanPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    if (!isToolSuccess(saved)) {
      return {
        ok: false as const,
        code: 'TOOL_OPERATION_FAILED' as const,
        message: `download(clean) failed: ${saved.error.code} ${saved.error.message}`,
      };
    }
    return readToonCanonicalFromPath(cleanPath);
  });
}

async function runDeterministicReplaceTextCheck(
  absPath: string,
  edit: FixtureEditSpec | undefined,
  runs: number
): Promise<ConformanceCheckResult> {
  if (!edit) {
    return {
      check_id: 'deterministic_replace_text_toon',
      status: 'NOT_COVERED',
      failure_code: 'NOT_COVERED',
      message: 'No edit_spec provided for deterministic replace_text check.',
    };
  }
  const outputs: string[] = [];
  for (let i = 0; i < runs; i++) {
    const result = await runDeterministicReplaceTextOnce(absPath, edit);
    if (!result.ok) {
      return {
        check_id: 'deterministic_replace_text_toon',
        status: 'FAIL',
        failure_code: result.code,
        message: result.message,
      };
    }
    outputs.push(result.canonical);
  }
  const first = outputs[0]!;
  const mismatch = outputs.find((o) => o !== first);
  if (mismatch) {
    return {
      check_id: 'deterministic_replace_text_toon',
      status: 'FAIL',
      failure_code: 'NON_DETERMINISTIC_RESULT',
      message: `Canonical TOON differs across ${runs} runs.`,
    };
  }
  return {
    check_id: 'deterministic_replace_text_toon',
    status: 'PASS',
    message: `Canonical TOON matched across ${runs} deterministic replace_text runs.`,
  };
}

async function runTrackedChangesCheck(
  absPath: string,
  edit: FixtureEditSpec | undefined
): Promise<ConformanceCheckResult> {
  if (!edit) {
    return {
      check_id: 'tracked_changes_output',
      status: 'NOT_COVERED',
      failure_code: 'NOT_COVERED',
      message: 'No edit_spec provided for tracked changes check.',
    };
  }

  const mgr = new SessionManager();
  const opened = await openDocument(mgr, { file_path: absPath });
  if (!isToolSuccess(opened)) {
    return {
      check_id: 'tracked_changes_output',
      status: 'FAIL',
      failure_code: 'TOOL_OPERATION_FAILED',
      message: `open_document failed: ${opened.error.code} ${opened.error.message}`,
    };
  }
  const sessionId = String(opened.session_id);

  const readJson = await readFile(mgr, { session_id: sessionId, format: 'json' });
  if (!isToolSuccess(readJson)) {
    return {
      check_id: 'tracked_changes_output',
      status: 'FAIL',
      failure_code: 'TOOL_OPERATION_FAILED',
      message: `read_file(json) failed: ${readJson.error.code} ${readJson.error.message}`,
    };
  }
  const nodes = JSON.parse(String(readJson.content ?? '')) as Array<{ id: string; clean_text: string }>;
  const target = nodes.find((n) => n.clean_text.includes(edit.old_string));
  if (!target) {
    return {
      check_id: 'tracked_changes_output',
      status: 'FAIL',
      failure_code: 'TOOL_OPERATION_FAILED',
      message: `No paragraph contains old_string '${edit.old_string}'.`,
    };
  }

  const edited = await replaceText(mgr, {
    session_id: sessionId,
    target_paragraph_id: target.id,
    old_string: edit.old_string,
    new_string: edit.new_string,
    instruction: 'safe-docx conformance tracked output check',
  });
  if (!isToolSuccess(edited)) {
    return {
      check_id: 'tracked_changes_output',
      status: 'FAIL',
      failure_code: 'TOOL_OPERATION_FAILED',
      message: `replace_text failed: ${edited.error.code} ${edited.error.message}`,
    };
  }

  return withTempDir('safe-docx-conformance-tracked-', async (outDir) => {
    const trackedPath = path.join(outDir, 'tracked.docx');
    const tracked = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: trackedPath,
      download_format: 'tracked',
      clean_bookmarks: true,
      tracked_changes_engine: 'atomizer',
    });
    if (!isToolSuccess(tracked)) {
      return {
        check_id: 'tracked_changes_output',
        status: 'FAIL',
        failure_code: 'TRACKED_CHANGES_OUTPUT_FAILED',
        message: `download(tracked) failed: ${tracked.error.code} ${tracked.error.message}`,
      };
    }

    try {
      const trackedZip = await DocxZip.load((await fs.readFile(trackedPath)) as Buffer);
      const xml = await trackedZip.readTextOrNull('word/document.xml');
      if (!xml) {
        return {
          check_id: 'tracked_changes_output',
          status: 'FAIL',
          failure_code: 'OPC_PART_MISSING',
          message: "Tracked output missing 'word/document.xml'.",
        };
      }
      const hasMarkers = xml.includes('<w:ins') || xml.includes('<w:del');
      if (!hasMarkers) {
        return {
          check_id: 'tracked_changes_output',
          status: 'FAIL',
          failure_code: 'TRACKED_CHANGES_OUTPUT_FAILED',
          message: 'Tracked output missing w:ins/w:del revision markers.',
        };
      }
      return {
        check_id: 'tracked_changes_output',
        status: 'PASS',
        message: 'Tracked output contains revision markers.',
      };
    } catch (err: unknown) {
      return {
        check_id: 'tracked_changes_output',
        status: 'FAIL',
        failure_code: 'TRACKED_CHANGES_OUTPUT_FAILED',
        message: `Failed to inspect tracked output: ${errorMessage(err)}`,
      };
    }
  });
}

async function runPlaceholderLeakCheck(absPath: string): Promise<ConformanceCheckResult> {
  const res = await readToonCanonicalFromPath(absPath);
  if (!res.ok) {
    return {
      check_id: 'placeholder_leak',
      status: 'FAIL',
      failure_code: res.code,
      message: res.message,
    };
  }
  if (containsPlaceholderLeak(res.canonical)) {
    return {
      check_id: 'placeholder_leak',
      status: 'FAIL',
      failure_code: 'PLACEHOLDER_LEAK',
      message: 'Canonical TOON contains placeholder-like tokens.',
    };
  }
  return {
    check_id: 'placeholder_leak',
    status: 'PASS',
    message: 'No placeholder-like tokens detected.',
  };
}

function deriveFixtureStatus(checks: ConformanceCheckResult[]): ConformanceFixtureStatus {
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (checks.every((c) => c.status === 'NOT_COVERED')) return 'NOT_COVERED';
  return 'PASS';
}

function summarizeReport(
  fixtures: FixtureConformanceResult[],
  options: HarnessOptions
): ConformanceReport {
  const checks = fixtures.flatMap((f) => f.checks);
  return {
    schema_version: CONFORMANCE_REPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: options.mode ?? 'full',
    repo_root: options.repoRoot,
    options: {
      deterministic_runs: options.deterministicRuns ?? 2,
      open_agreements_root: options.openAgreementsRoot,
    },
    fixtures_total: fixtures.length,
    fixtures_passed: fixtures.filter((f) => f.status === 'PASS').length,
    fixtures_failed: fixtures.filter((f) => f.status === 'FAIL').length,
    checks_passed: checks.filter((c) => c.status === 'PASS').length,
    checks_failed: checks.filter((c) => c.status === 'FAIL').length,
    not_covered_count: checks.filter((c) => c.status === 'NOT_COVERED').length,
    fixtures,
  };
}

export function getExitCode(report: ConformanceReport): number {
  return report.checks_failed > 0 ? 1 : 0;
}

export async function loadFixtureManifest(manifestPath: string): Promise<FixtureManifest> {
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as FixtureManifest;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.fixtures)) {
    throw new Error(`Invalid fixture manifest: ${manifestPath}`);
  }
  if (raw.schema_version !== FIXTURE_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported fixture manifest schema_version '${raw.schema_version}'. Expected '${FIXTURE_MANIFEST_SCHEMA_VERSION}'.`
    );
  }
  return raw;
}

function buildNotCoveredFixtureResult(
  fixture: FixtureManifestEntry,
  reason: string
): FixtureConformanceResult {
  const checks: ConformanceCheckResult[] = fixture.expected_checks.map((checkId) => ({
    check_id: checkId,
    status: 'NOT_COVERED',
    failure_code: 'NOT_COVERED',
    message: reason,
  }));
  return {
    fixture_id: fixture.fixture_id,
    source_path: fixture.source_path,
    source_type: fixture.source_type,
    category: fixture.category,
    status: 'NOT_COVERED',
    checks,
  };
}

export async function runConformanceHarness(options: HarnessOptions): Promise<ConformanceReport> {
  const manifest = await loadFixtureManifest(options.manifestPath);
  const fixturesToRun =
    options.mode === 'smoke'
      ? manifest.fixtures.slice(0, Math.min(2, manifest.fixtures.length))
      : manifest.fixtures;

  const fixtureResults: FixtureConformanceResult[] = [];
  const deterministicRuns = options.deterministicRuns ?? 2;

  for (const fixture of fixturesToRun) {
    const resolved = await resolveFixturePath(
      fixture,
      options.repoRoot,
      options.openAgreementsRoot
    );
    if (!resolved.ok) {
      fixtureResults.push(
        buildNotCoveredFixtureResult(fixture, `Fixture not covered: ${resolved.reason}`)
      );
      continue;
    }

    const absPath = resolved.absolutePath;
    try {
      await fs.access(absPath);
    } catch {
      if (fixture.source_type === 'open_agreements_optional') {
        fixtureResults.push(
          buildNotCoveredFixtureResult(
            fixture,
            `Optional external fixture missing at resolved path: ${absPath}`
          )
        );
      } else {
        fixtureResults.push({
          fixture_id: fixture.fixture_id,
          source_path: fixture.source_path,
          source_type: fixture.source_type,
          category: fixture.category,
          status: 'FAIL',
          checks: fixture.expected_checks.map((checkId) => ({
            check_id: checkId,
            status: 'FAIL',
            failure_code: 'TOOL_OPERATION_FAILED',
            message: `Required fixture file missing: ${absPath}`,
          })),
        });
      }
      continue;
    }

    const checks: ConformanceCheckResult[] = [];
    const runOperations = new Set(fixture.operations_to_run);

    if (runOperations.has('preflight')) {
      checks.push(...(await runPreflightChecks(absPath)));
    }
    if (runOperations.has('toon_roundtrip')) {
      checks.push(await runToonRoundtripCheck(absPath));
    }
    if (runOperations.has('deterministic_replace_text')) {
      checks.push(
        await runDeterministicReplaceTextCheck(absPath, fixture.edit_spec, deterministicRuns)
      );
    }
    if (runOperations.has('tracked_changes_output')) {
      checks.push(await runTrackedChangesCheck(absPath, fixture.edit_spec));
    }
    if (runOperations.has('placeholder_leak_scan')) {
      checks.push(await runPlaceholderLeakCheck(absPath));
    }

    const producedCheckIds = new Set(checks.map((c) => c.check_id));
    for (const expectedCheck of fixture.expected_checks) {
      if (!producedCheckIds.has(expectedCheck)) {
        checks.push({
          check_id: expectedCheck,
          status: 'NOT_COVERED',
          failure_code: 'NOT_COVERED',
          message: `Expected check '${expectedCheck}' not produced by configured operations.`,
        });
      }
    }

    fixtureResults.push({
      fixture_id: fixture.fixture_id,
      source_path: fixture.source_path,
      source_type: fixture.source_type,
      category: fixture.category,
      status: deriveFixtureStatus(checks),
      checks,
    });
  }

  return summarizeReport(fixtureResults, options);
}

export async function computeManifestFixtureHashes(
  repoRoot: string,
  manifest: FixtureManifest,
  openAgreementsRoot?: string
): Promise<Array<{ fixture_id: string; sha256?: string; not_covered_reason?: string }>> {
  const out: Array<{ fixture_id: string; sha256?: string; not_covered_reason?: string }> = [];
  for (const fixture of manifest.fixtures) {
    const resolved = await resolveFixturePath(fixture, repoRoot, openAgreementsRoot);
    if (!resolved.ok) {
      out.push({ fixture_id: fixture.fixture_id, not_covered_reason: resolved.reason });
      continue;
    }
    try {
      out.push({
        fixture_id: fixture.fixture_id,
        sha256: await sha256OfFile(resolved.absolutePath),
      });
    } catch {
      out.push({
        fixture_id: fixture.fixture_id,
        not_covered_reason: 'file_missing_or_unreadable',
      });
    }
  }
  return out;
}
