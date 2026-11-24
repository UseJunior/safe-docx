import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'report_package_coverage.mjs');
const packages = ['docx-core', 'docx-compare', 'docx-markdoc', 'docx-mcp'];

function fixture(metrics = {}) {
  const root = mkdtempSync(join(tmpdir(), 'safe-docx-coverage-report-'));
  const defaults = { lines: 90, branches: 80, functions: 91, statements: 89 };
  const current = { ...defaults, ...metrics.current };
  const baseline = { ...defaults, ...metrics.baseline };

  for (const packageId of packages) {
    const summaryPath = join(root, 'packages', packageId, 'coverage', 'coverage-summary.json');
    mkdirSync(dirname(summaryPath), { recursive: true });
    writeFileSync(
      summaryPath,
      JSON.stringify({
        total: Object.fromEntries(
          Object.entries(current).map(([key, pct]) => [key, { total: 100, covered: pct, skipped: 0, pct }])
        ),
      })
    );
  }

  const baselinePath = join(root, 'coverage', 'package-coverage-baseline.json');
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(
    baselinePath,
    JSON.stringify({
      policy: {
        ratchet_tolerance_percentage_points: 0.1,
        max_positive_drift_percentage_points: { lines: 1, branches: 2 },
      },
      packages: Object.fromEntries(packages.map((packageId) => [packageId, baseline])),
    })
  );
  return { root, baselinePath };
}

function setupFixture(t, metrics) {
  const result = fixture(metrics);
  t.after(() => rmSync(result.root, { recursive: true, force: true }));
  return result;
}

// Pin the detected Node version so rebaseline tests do not depend on the runtime.
const node20Env = { ...process.env, SAFE_DOCX_COVERAGE_NODE_VERSION: '20.19.0' };

function run(root, ...args) {
  return runWithNode(root, node20Env.SAFE_DOCX_COVERAGE_NODE_VERSION, ...args);
}

function runWithNode(root, nodeVersion, ...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SAFE_DOCX_COVERAGE_NODE_VERSION: nodeVersion },
  });
}

test('enforcement accepts near-zero V8 drift', (t) => {
  const { root, baselinePath } = setupFixture(t, {
    current: { lines: 90.08, branches: 79.92 },
  });
  const result = run(root, '--baseline', baselinePath, '--enforce');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no regressions or stale line\/branch floors/);
});

test('enforcement rejects regressions beyond the V8 tolerance', (t) => {
  const { root, baselinePath } = setupFixture(t, {
    current: { lines: 89.8 },
  });
  const result = run(root, '--baseline', baselinePath, '--enforce');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lines regressed/);
});

test('enforcement rejects a floor more than one point behind current coverage', (t) => {
  const { root, baselinePath } = setupFixture(t, {
    current: { lines: 91.01 },
  });
  const result = run(root, '--baseline', baselinePath, '--enforce');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /line baseline is stale/);
});

test('enforcement gives noisy branch coverage a two-point stale-floor budget', (t) => {
  const { root, baselinePath } = setupFixture(t, {
    current: { branches: 81.99 },
  });
  const result = run(root, '--baseline', baselinePath, '--enforce');
  assert.equal(result.status, 0, result.stderr);
});

test('enforcement rejects non-numeric Istanbul percentages', (t) => {
  const { root, baselinePath } = setupFixture(t, {
    current: { lines: 'Unknown' },
  });
  const result = run(root, '--baseline', baselinePath, '--enforce');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lines\.pct must be a finite number/);
});

test('enforcement fails closed when a package floor is absent', (t) => {
  const { root, baselinePath } = setupFixture(t);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  delete baseline.packages['docx-compare'];
  writeFileSync(baselinePath, JSON.stringify(baseline));
  const result = run(root, '--baseline', baselinePath, '--enforce');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /has no committed coverage baseline/);
});

test('enforcement fails closed when the baseline file is invalid', (t) => {
  const { root, baselinePath } = setupFixture(t);
  writeFileSync(baselinePath, '{');
  const result = run(root, '--baseline', baselinePath, '--enforce');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Coverage baseline is missing or invalid/);
});

test('enforcement fails closed when policy metadata does not match code', (t) => {
  const { root, baselinePath } = setupFixture(t);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  baseline.policy.max_positive_drift_percentage_points.lines = 5;
  writeFileSync(baselinePath, JSON.stringify(baseline));
  const result = run(root, '--baseline', baselinePath, '--enforce');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /baseline policy is missing or stale/);
});

test('rebaseline refuses to lower a governed floor', (t) => {
  const { root, baselinePath } = setupFixture(t, {
    current: { lines: 89.8 },
  });
  const result = run(root, '--baseline', baselinePath, '--write-baseline');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to lower package coverage floors/);
});

test('rebaseline accepts sub-tolerance V8 noise without deadlocking stale-floor maintenance', (t) => {
  const { root, baselinePath } = setupFixture(t, {
    current: { lines: 89.98 },
  });
  const result = run(root, '--baseline', baselinePath, '--write-baseline');
  assert.equal(result.status, 0, result.stderr);
  const written = JSON.parse(readFileSync(baselinePath, 'utf8'));
  assert.equal(written.packages['docx-core'].lines, 89.98);
});

test('rebaseline writes current metrics with null deltas and policy metadata', (t) => {
  const { root, baselinePath } = setupFixture(t, {
    current: { lines: 91.25, branches: 82.5 },
  });
  execFileSync(process.execPath, [scriptPath, '--baseline', baselinePath, '--write-baseline'], {
    cwd: root,
    encoding: 'utf8',
    env: node20Env,
  });
  const written = JSON.parse(readFileSync(baselinePath, 'utf8'));
  assert.equal(written.packages['docx-core'].lines, 91.25);
  assert.equal(written.packages['docx-core'].branches, 82.5);
  assert.equal(written.packages['docx-core'].deltas.lines, null);
  assert.equal(written.policy.ratchet_tolerance_percentage_points, 0.1);
  assert.deepEqual(written.policy.max_positive_drift_percentage_points, { lines: 1, branches: 2 });
  const check = run(root, '--baseline', baselinePath, '--enforce');
  assert.equal(check.status, 0, check.stderr);
});

test('rebaseline refuses to run off Node 20 and names both safe options', (t) => {
  const { root, baselinePath } = setupFixture(t, { current: { lines: 90.5 } });
  const before = readFileSync(baselinePath, 'utf8');
  for (const version of ['22.11.0', '26.0.0', '18.20.4']) {
    const result = runWithNode(root, version, '--baseline', baselinePath, '--write-baseline');
    assert.equal(result.status, 1, `expected refusal on Node ${version}`);
    assert.match(result.stderr, new RegExp(`Refusing to write the package coverage baseline on Node ${version.replaceAll('.', '\\.')}`));
    assert.match(result.stderr, /rerun on Node 20/);
    assert.match(result.stderr, /CI coverage artifact/);
    assert.match(result.stderr, /--allow-non-node20/);
  }
  assert.equal(readFileSync(baselinePath, 'utf8'), before);
});

test('rebaseline off Node 20 succeeds with --allow-non-node20', (t) => {
  const { root, baselinePath } = setupFixture(t, { current: { lines: 90.5 } });
  const result = runWithNode(root, '22.11.0', '--baseline', baselinePath, '--write-baseline', '--allow-non-node20');
  assert.equal(result.status, 0, result.stderr);
  const written = JSON.parse(readFileSync(baselinePath, 'utf8'));
  assert.equal(written.packages['docx-core'].lines, 90.5);
});

test('Node version guard does not affect enforce-only runs', (t) => {
  const { root, baselinePath } = setupFixture(t);
  const result = runWithNode(root, '26.0.0', '--baseline', baselinePath, '--enforce');
  assert.equal(result.status, 0, result.stderr);
});
