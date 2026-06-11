#!/usr/bin/env node
// Release-surface guard (OpenSpec change: add-odf-release-isolation, revised
// 2026-06-10: odf-core now publishes WITH the suite — see the change's
// proposal addendum and issue #372).
//
// Keeps the suite release surface deliberate. The original ODF-must-stay-
// private assertion was retired when @usejunior/odf-core joined the suite
// release train (docx-mcp depends on it at runtime, so the two are version-
// coupled de facto). Two assertions remain:
//
//   A. Workflow-snapshot: the hardcoded suite package lists in
//      .github/workflows/release.yml must equal a fixed expected set. Adding
//      or removing ANY package in a release `for` loop fails the guard until
//      EXPECTED_LOOPS is deliberately updated. This guards the actual release
//      mechanism (membership in a release list) so the surface can only change
//      on purpose.
//
//   B. Publish-list-publishable: every `packages/<dir>` on the npm publish
//      surface must NOT be `private: true` — a private package on the publish
//      list would fail the release at tag time; catch it at PR time instead.
//      (This is the inverse of the retired assertion, and is exactly the
//      bootstrap mistake folding a new package into the train can make.)
//
// Pure JSON/text inspection — no network, no build. Wired into the
// workspace-lint required check. Exits non-zero with an actionable message.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RELEASE_YML = path.join(REPO_ROOT, '.github', 'workflows', 'release.yml');

// ── Expected snapshot of release.yml's suite package loops ─────────────────
// Each entry is the set of package tokens (`@usejunior/*` and/or `packages/*`)
// that a `for pkg in ...` / `for entry in ...` loop in release.yml may contain.
// Update this ONLY when intentionally changing the suite release surface.
export const EXPECTED_LOOPS = [
  // "Verify tag matches package suite versions" (version-pin)
  [
    'packages/docx-core',
    'packages/odf-core',
    'packages/docx-mcp',
    'packages/google-docs-core',
    'packages/safe-docx',
    'packages/safe-docx-mcpb',
  ],
  // "Guard against duplicate publish"
  [
    '@usejunior/docx-core',
    '@usejunior/odf-core',
    '@usejunior/docx-mcp',
    '@usejunior/google-docs-core',
    '@usejunior/safe-docx',
  ],
  // "Verify package contents (dry-run)"
  [
    'packages/docx-core',
    'packages/odf-core',
    'packages/docx-mcp',
    'packages/google-docs-core',
    'packages/safe-docx',
  ],
  // "Isolated package runtime smoke test" — pack every publishable so
  // same-version workspace deps resolve from local tarballs (issue #395)
  [
    'packages/docx-core',
    'packages/odf-core',
    'packages/docx-mcp',
    'packages/google-docs-core',
    'packages/safe-docx',
  ],
  // "Publish to npm (trusted publishing)" — name:dir pairs
  [
    '@usejunior/docx-core',
    '@usejunior/odf-core',
    '@usejunior/docx-mcp',
    '@usejunior/google-docs-core',
    '@usejunior/safe-docx',
    'packages/docx-core',
    'packages/odf-core',
    'packages/docx-mcp',
    'packages/google-docs-core',
    'packages/safe-docx',
  ],
];

// Suite packages on the npm publish surface (the publish loop's `packages/*`
// dirs). These must be publishable: `private: true` here would fail the
// release at tag time.
export const PUBLISH_DIRS = [
  'packages/docx-core',
  'packages/odf-core',
  'packages/docx-mcp',
  'packages/google-docs-core',
  'packages/safe-docx',
];

const PKG_TOKEN_RE = /(?:@usejunior\/[a-z0-9.-]+|packages\/[a-z0-9.-]+)/g;

export function canonical(tokens) {
  return JSON.stringify([...new Set(tokens)].sort());
}

export function extractReleaseLoops(yml) {
  // Match the body of every `for pkg in ...; do` / `for entry in ...; do` loop.
  const loopRe = /for\s+(?:pkg|entry)\s+in\s+([\s\S]*?);\s*do/g;
  const loops = [];
  let m;
  while ((m = loopRe.exec(yml)) !== null) {
    const tokens = m[1].match(PKG_TOKEN_RE) ?? [];
    if (tokens.length > 0) loops.push(tokens);
  }
  return loops;
}

// Pure: compare extracted loops against an expected snapshot. Returns string[].
export function diffWorkflowSnapshot(found, expected = EXPECTED_LOOPS) {
  const errors = [];
  if (found.length !== expected.length) {
    errors.push(
      `release.yml has ${found.length} package loop(s); expected ${expected.length}. ` +
        `The release structure changed — re-verify the DOCX surface and update EXPECTED_LOOPS in this guard.`,
    );
  }

  const expectedSigs = expected.map(canonical).sort();
  const foundSigs = found.map(canonical).sort();
  if (JSON.stringify(expectedSigs) !== JSON.stringify(foundSigs)) {
    const expectedTokens = new Set(expected.flat());
    const foundTokens = new Set(found.flat());
    const unexpected = [...foundTokens].filter((t) => !expectedTokens.has(t)).sort();
    const missing = [...expectedTokens].filter((t) => !foundTokens.has(t)).sort();
    if (unexpected.length) {
      errors.push(
        `release.yml release loops contain unexpected package(s): ${unexpected.join(', ')}. ` +
          `Changing the suite release surface must be deliberate — update EXPECTED_LOOPS (and PUBLISH_DIRS) in this guard alongside release.yml.`,
      );
    }
    if (missing.length) {
      errors.push(
        `release.yml release loops are missing expected suite package(s): ${missing.join(', ')}. ` +
          `If this is an intentional change to the suite surface, update EXPECTED_LOOPS in this guard.`,
      );
    }
    if (!unexpected.length && !missing.length) {
      errors.push(
        `release.yml package-loop membership drifted from EXPECTED_LOOPS (a token moved between loops). ` +
          `Re-verify the suite release surface and update the guard.`,
      );
    }
  }
  return errors;
}

// fs wrapper around the pure snapshot diff.
function checkWorkflowSnapshot() {
  if (!fs.existsSync(RELEASE_YML)) {
    return [`release.yml not found at ${path.relative(REPO_ROOT, RELEASE_YML)}`];
  }
  const yml = fs.readFileSync(RELEASE_YML, 'utf8');
  return diffWorkflowSnapshot(extractReleaseLoops(yml));
}

// ── Assertion B: publish-list packages must be publishable ─────────────────
// Pure: given [{dir, private, rel}], return errors for private publish-list pkgs.
export function diffPublishListPrivate(packages) {
  const errors = [];
  for (const pkg of packages) {
    if (pkg.private === true) {
      errors.push(
        `${pkg.rel} is on the npm publish list but sets "private": true — npm will refuse to publish it ` +
          `and the release will fail at tag time. Drop "private" (and add publish metadata) or remove it from PUBLISH_DIRS + release.yml.`,
      );
    }
  }
  return errors;
}

function checkPublishListPrivate() {
  const packages = PUBLISH_DIRS.map((dir) => {
    const pkgJsonPath = path.join(REPO_ROOT, dir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    return { dir, private: pkg.private, rel: path.relative(REPO_ROOT, pkgJsonPath) };
  });
  return diffPublishListPrivate(packages);
}

// ── Run (only when invoked directly, not when imported by the test) ─────────
function main() {
  const errors = [...checkWorkflowSnapshot(), ...checkPublishListPrivate()];
  if (errors.length) {
    console.error('Release-surface guard FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('\nSee openspec/changes/add-odf-release-isolation (revised) for the rationale.');
    process.exit(1);
  }
  console.log('Release-surface guard passed: suite release lists match snapshot; all publish-list packages are publishable.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
