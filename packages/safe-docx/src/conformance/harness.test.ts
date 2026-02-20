import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import {
  CONFORMANCE_REPORT_SCHEMA_VERSION,
  FIXTURE_MANIFEST_SCHEMA_VERSION,
  getExitCode,
  runConformanceHarness,
  type FixtureManifest,
} from './harness.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

async function withTempRepo<T>(run: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-docx-conformance-test-'));
  try {
    return await run(repoRoot);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

async function writeManifest(repoRoot: string, manifest: FixtureManifest): Promise<string> {
  const manifestPath = path.join(repoRoot, 'fixtures.manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

describe('safe-docx conformance harness', () => {
  test('emits a report with required summary fields for passing fixture checks', async () => {
    await withTempRepo(async (repoRoot) => {
      const fixturePath = path.join(repoRoot, 'fixture-pass.docx');
      await fs.writeFile(fixturePath, await makeMinimalDocx(['This paragraph should stay stable.']));

      const manifestPath = await writeManifest(repoRoot, {
        schema_version: FIXTURE_MANIFEST_SCHEMA_VERSION,
        fixtures: [
          {
            fixture_id: 'fixture_pass',
            source_path: 'fixture-pass.docx',
            source_type: 'local_repo',
            category: 'test_fixture',
            operations_to_run: ['preflight', 'toon_roundtrip', 'placeholder_leak_scan'],
            expected_checks: [
              'zip_open',
              'opc_part_document_xml',
              'xml_parse',
              'toon_roundtrip_equivalence',
              'placeholder_leak',
            ],
            notes: 'passing fixture for schema shape and summary assertions',
          },
        ],
      });

      const report = await runConformanceHarness({
        manifestPath,
        repoRoot,
        mode: 'full',
        deterministicRuns: 2,
      });

      expect(report.schema_version).toBe(CONFORMANCE_REPORT_SCHEMA_VERSION);
      expect(report.mode).toBe('full');
      expect(report.fixtures_total).toBe(1);
      expect(report.fixtures_passed).toBe(1);
      expect(report.fixtures_failed).toBe(0);
      expect(report.checks_failed).toBe(0);
      expect(report.not_covered_count).toBe(0);
      expect(report.fixtures[0]!.status).toBe('PASS');
      expect(getExitCode(report)).toBe(0);
    });
  });

  test('returns ZIP_OPEN_FAILED and non-zero exit code for invalid local fixture', async () => {
    await withTempRepo(async (repoRoot) => {
      const fixturePath = path.join(repoRoot, 'fixture-bad.docx');
      await fs.writeFile(fixturePath, 'not a zip file', 'utf8');

      const manifestPath = await writeManifest(repoRoot, {
        schema_version: FIXTURE_MANIFEST_SCHEMA_VERSION,
        fixtures: [
          {
            fixture_id: 'fixture_bad_zip',
            source_path: 'fixture-bad.docx',
            source_type: 'local_repo',
            category: 'test_fixture',
            operations_to_run: ['preflight'],
            expected_checks: ['zip_open', 'opc_part_document_xml', 'xml_parse'],
            notes: 'invalid zip should fail preflight',
          },
        ],
      });

      const report = await runConformanceHarness({
        manifestPath,
        repoRoot,
        mode: 'full',
      });

      const zipOpen = report.fixtures[0]!.checks.find((c) => c.check_id === 'zip_open');
      expect(zipOpen?.status).toBe('FAIL');
      expect(zipOpen?.failure_code).toBe('ZIP_OPEN_FAILED');
      expect(report.checks_failed).toBeGreaterThan(0);
      expect(getExitCode(report)).toBe(1);
    });
  });

  test('marks optional external fixture as NOT_COVERED without failing harness', async () => {
    await withTempRepo(async (repoRoot) => {
      const manifestPath = await writeManifest(repoRoot, {
        schema_version: FIXTURE_MANIFEST_SCHEMA_VERSION,
        fixtures: [
          {
            fixture_id: 'fixture_optional_external',
            source_path: 'templates/example/template.docx',
            source_type: 'open_agreements_optional',
            category: 'openagreements_template',
            operations_to_run: ['preflight'],
            expected_checks: ['zip_open', 'opc_part_document_xml', 'xml_parse'],
            notes: 'optional external fixture should be not covered when root is unset',
          },
        ],
      });

      const report = await runConformanceHarness({
        manifestPath,
        repoRoot,
      });

      expect(report.fixtures[0]!.status).toBe('NOT_COVERED');
      expect(report.fixtures[0]!.checks.every((check) => check.status === 'NOT_COVERED')).toBe(
        true
      );
      expect(report.fixtures[0]!.checks.every((check) => check.failure_code === 'NOT_COVERED')).toBe(
        true
      );
      expect(report.checks_failed).toBe(0);
      expect(report.not_covered_count).toBe(3);
      expect(getExitCode(report)).toBe(0);
    });
  });

  test('verifies deterministic smart-edit equivalence across two runs', async () => {
    await withTempRepo(async (repoRoot) => {
      const fixturePath = path.join(repoRoot, 'fixture-deterministic.docx');
      await fs.writeFile(fixturePath, await makeMinimalDocx(['The quick fox jumps over the fence.']));

      const manifestPath = await writeManifest(repoRoot, {
        schema_version: FIXTURE_MANIFEST_SCHEMA_VERSION,
        fixtures: [
          {
            fixture_id: 'fixture_deterministic',
            source_path: 'fixture-deterministic.docx',
            source_type: 'local_repo',
            category: 'test_fixture',
            operations_to_run: ['preflight', 'deterministic_smart_edit'],
            expected_checks: [
              'zip_open',
              'opc_part_document_xml',
              'xml_parse',
              'deterministic_smart_edit_toon',
            ],
            edit_spec: {
              old_string: 'quick fox',
              new_string: 'swift fox',
            },
            notes: 'deterministic smart-edit check should pass for repeated runs',
          },
        ],
      });

      const report = await runConformanceHarness({
        manifestPath,
        repoRoot,
        deterministicRuns: 2,
      });

      const deterministic = report.fixtures[0]!.checks.find(
        (check) => check.check_id === 'deterministic_smart_edit_toon'
      );
      expect(deterministic?.status).toBe('PASS');
      expect(deterministic?.message).toContain('matched across 2 deterministic smart-edit runs');
      expect(report.checks_failed).toBe(0);
    });
  });
});
