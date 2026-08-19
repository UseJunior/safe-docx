import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_LOOPS,
  PUBLISH_DIRS,
  canonical,
  diffPublishListPrivate,
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

test('snapshot flags an unexpected package added to a release loop', () => {
  const found = EXPECTED_LOOPS.map((l) => [...l]);
  found[1] = [...found[1], '@usejunior/allure-test-factory'];
  const errors = diffWorkflowSnapshot(found);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unexpected package\(s\): @usejunior\/allure-test-factory/);
});

test('snapshot flags a missing suite package', () => {
  const found = EXPECTED_LOOPS.map((l) => [...l]);
  found[0] = found[0].filter((t) => t !== 'packages/safe-docx-mcpb');
  const errors = diffWorkflowSnapshot(found);
  assert.ok(errors.some((e) => /missing expected suite package\(s\): packages\/safe-docx-mcpb/.test(e)));
});

test('split runtime packages are on every release loop and the publish surface', () => {
  // The 2026-06 revision folded odf-core into the suite train; #128 split
  // docx-compare out of docx-core while keeping the suite version-locked.
  // docx-markdoc joined the public train in v0.20.0 and depends on both.
  for (const loop of EXPECTED_LOOPS) {
    assert.ok(
      loop.includes('packages/odf-core') || loop.includes('@usejunior/odf-core'),
      `expected odf-core in loop: ${loop.join(', ')}`,
    );
    assert.ok(
      loop.includes('packages/docx-compare') || loop.includes('@usejunior/docx-compare'),
      `expected docx-compare in loop: ${loop.join(', ')}`,
    );
    assert.ok(
      loop.includes('packages/docx-markdoc') || loop.includes('@usejunior/docx-markdoc'),
      `expected docx-markdoc in loop: ${loop.join(', ')}`,
    );
  }
  assert.ok(PUBLISH_DIRS.includes('packages/odf-core'));
  assert.ok(PUBLISH_DIRS.includes('packages/docx-compare'));
  assert.ok(PUBLISH_DIRS.includes('packages/docx-markdoc'));
});

test('snapshot flags a wrong loop count', () => {
  const errors = diffWorkflowSnapshot(EXPECTED_LOOPS.slice(0, 3));
  assert.ok(errors.some((e) => /package loop\(s\); expected 5/.test(e)));
});

// ── diffPublishListPrivate ──────────────────────────────────────────────────
test('publish-list check passes when all packages are publishable', () => {
  const errors = diffPublishListPrivate([
    { dir: 'packages/odf-core', private: undefined, rel: 'packages/odf-core/package.json' },
    { dir: 'packages/docx-core', private: false, rel: 'packages/docx-core/package.json' },
  ]);
  assert.deepEqual(errors, []);
});

test('publish-list check flags a private package on the publish surface', () => {
  const errors = diffPublishListPrivate([
    { dir: 'packages/odf-core', private: true, rel: 'packages/odf-core/package.json' },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /odf-core.*"private": true.*release will fail at tag time/);
});

// ── canonical ───────────────────────────────────────────────────────────────
test('canonical dedupes and sorts', () => {
  assert.equal(canonical(['b', 'a', 'b']), JSON.stringify(['a', 'b']));
});
