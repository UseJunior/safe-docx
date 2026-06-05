import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_LOOPS,
  canonical,
  diffOdfPrivate,
  diffWorkflowSnapshot,
  extractReleaseLoops,
} from './check-release-isolation.mjs';

// ── extractReleaseLoops ─────────────────────────────────────────────────────
test('extractReleaseLoops pulls package tokens from for-loops', () => {
  const yml = [
    '          for pkg in packages/docx-core packages/safe-docx; do',
    '          for entry in "@usejunior/docx-core:packages/docx-core"; do',
    '          for attempt in 1 2 3; do', // not a package loop — yields no tokens
  ].join('\n');
  const loops = extractReleaseLoops(yml);
  assert.deepEqual(loops, [
    ['packages/docx-core', 'packages/safe-docx'],
    ['@usejunior/docx-core', 'packages/docx-core'],
  ]);
});

// ── diffWorkflowSnapshot ────────────────────────────────────────────────────
test('snapshot passes when found loops equal expected (order-independent)', () => {
  const found = [...EXPECTED_LOOPS].reverse().map((l) => [...l].reverse());
  assert.deepEqual(diffWorkflowSnapshot(found), []);
});

test('snapshot flags an unexpected ODF package added to a release loop', () => {
  const found = EXPECTED_LOOPS.map((l) => [...l]);
  found[1] = [...found[1], '@usejunior/odf-core'];
  const errors = diffWorkflowSnapshot(found);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unexpected package\(s\): @usejunior\/odf-core/);
});

test('snapshot flags a missing DOCX package', () => {
  const found = EXPECTED_LOOPS.map((l) => [...l]);
  found[0] = found[0].filter((t) => t !== 'packages/safe-docx-mcpb');
  const errors = diffWorkflowSnapshot(found);
  assert.ok(errors.some((e) => /missing expected DOCX package\(s\): packages\/safe-docx-mcpb/.test(e)));
});

test('snapshot flags a wrong loop count', () => {
  const errors = diffWorkflowSnapshot(EXPECTED_LOOPS.slice(0, 3));
  assert.ok(errors.some((e) => /package loop\(s\); expected 4/.test(e)));
});

// ── diffOdfPrivate ──────────────────────────────────────────────────────────
test('odf-private passes for a private ODF package and ignores non-ODF', () => {
  const errors = diffOdfPrivate([
    { name: '@usejunior/odf-core', private: true, rel: 'packages/odf-core/package.json' },
    { name: '@usejunior/allure-test-factory', private: false, rel: 'packages/allure-test-factory/package.json' },
  ]);
  assert.deepEqual(errors, []);
});

test('odf-private flags a non-private ODF package', () => {
  const errors = diffOdfPrivate([
    { name: '@usejunior/odf-mcp', private: false, rel: 'packages/odf-mcp/package.json' },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /odf-mcp.*must set "private": true/);
});

test('odf-private treats missing private flag as non-private', () => {
  const errors = diffOdfPrivate([
    { name: '@usejunior/odf-core', rel: 'packages/odf-core/package.json' },
  ]);
  assert.equal(errors.length, 1);
});

// ── canonical ───────────────────────────────────────────────────────────────
test('canonical dedupes and sorts', () => {
  assert.equal(canonical(['b', 'a', 'b']), JSON.stringify(['a', 'b']));
});
