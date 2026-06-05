#!/usr/bin/env node
// Release-isolation guard (OpenSpec change: add-odf-release-isolation).
//
// Keeps ODF (and any future non-DOCX) packages from being coupled to — or
// churning — the stable DOCX suite release. Two assertions:
//
//   A. Workflow-snapshot: the hardcoded DOCX package lists in
//      .github/workflows/release.yml must equal a fixed expected set. Adding
//      ANY package (ODF or otherwise) to a release `for` loop fails the guard.
//      This guards the actual coupling mechanism (membership in a release list)
//      rather than inferring it from a package's `private` flag, so it is robust
//      to packages that are non-private yet on no release list (e.g.
//      allure-test-factory).
//
//   B. ODF-private: every workspace package whose name matches /odf/ must be
//      `private: true`. ODF packages stay private until the independent ODF
//      release track (release-odf.yml) exists and passes its own preflight;
//      only that future change may flip an ODF package to `private: false`.
//
// Pure JSON/text inspection — no network, no build. Wired into the
// workspace-lint required check. Exits non-zero with an actionable message.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RELEASE_YML = path.join(REPO_ROOT, '.github', 'workflows', 'release.yml');

// ── Expected snapshot of release.yml's DOCX package loops ──────────────────
// Each entry is the set of package tokens (`@usejunior/*` and/or `packages/*`)
// that a `for pkg in ...` / `for entry in ...` loop in release.yml may contain.
// Update this ONLY when intentionally changing the DOCX release surface — never
// to admit an ODF package (ODF publishes on its own track, not these loops).
export const EXPECTED_LOOPS = [
  // "Verify tag matches package suite versions" (version-pin)
  [
    'packages/docx-core',
    'packages/docx-mcp',
    'packages/google-docs-core',
    'packages/safe-docx',
    'packages/safe-docx-mcpb',
  ],
  // "Guard against duplicate publish"
  [
    '@usejunior/docx-core',
    '@usejunior/docx-mcp',
    '@usejunior/google-docs-core',
    '@usejunior/safe-docx',
  ],
  // "Verify package contents (dry-run)"
  [
    'packages/docx-core',
    'packages/docx-mcp',
    'packages/google-docs-core',
    'packages/safe-docx',
  ],
  // "Publish to npm (trusted publishing)" — name:dir pairs
  [
    '@usejunior/docx-core',
    '@usejunior/docx-mcp',
    '@usejunior/google-docs-core',
    '@usejunior/safe-docx',
    'packages/docx-core',
    'packages/docx-mcp',
    'packages/google-docs-core',
    'packages/safe-docx',
  ],
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
          `ODF and other non-DOCX packages must NOT be added to the DOCX release lists — they publish on their own track.`,
      );
    }
    if (missing.length) {
      errors.push(
        `release.yml release loops are missing expected DOCX package(s): ${missing.join(', ')}. ` +
          `If this is an intentional change to the DOCX surface, update EXPECTED_LOOPS in this guard.`,
      );
    }
    if (!unexpected.length && !missing.length) {
      errors.push(
        `release.yml package-loop membership drifted from EXPECTED_LOOPS (a token moved between loops). ` +
          `Re-verify the DOCX release surface and update the guard.`,
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

// ── Assertion B: ODF packages must be private ─────────────────────────────
function readWorkspaceGlobs() {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const ws = rootPkg.workspaces;
  if (Array.isArray(ws)) return ws;
  if (ws && Array.isArray(ws.packages)) return ws.packages;
  return [];
}

function expandWorkspacePackages() {
  const dirs = [];
  for (const glob of readWorkspaceGlobs()) {
    if (glob.endsWith('/*')) {
      const base = path.join(REPO_ROOT, glob.slice(0, -2));
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pkgJson = path.join(base, entry.name, 'package.json');
        if (fs.existsSync(pkgJson)) dirs.push(pkgJson);
      }
    } else {
      const pkgJson = path.join(REPO_ROOT, glob, 'package.json');
      if (fs.existsSync(pkgJson)) dirs.push(pkgJson);
    }
  }
  return dirs;
}

// Pure: given [{name, private, rel}], return errors for non-private ODF pkgs.
export function diffOdfPrivate(packages) {
  const errors = [];
  for (const pkg of packages) {
    const name = pkg.name ?? '';
    if (/odf/i.test(name) && pkg.private !== true) {
      errors.push(
        `${pkg.rel} (${name}) must set "private": true. ` +
          `ODF packages stay private until release-odf.yml exists and passes its own preflight.`,
      );
    }
  }
  return errors;
}

function checkOdfPrivate() {
  const packages = expandWorkspacePackages().map((pkgJsonPath) => {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    return { name: pkg.name, private: pkg.private, rel: path.relative(REPO_ROOT, pkgJsonPath) };
  });
  return diffOdfPrivate(packages);
}

// ── Run (only when invoked directly, not when imported by the test) ─────────
function main() {
  const errors = [...checkWorkflowSnapshot(), ...checkOdfPrivate()];
  if (errors.length) {
    console.error('Release-isolation guard FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('\nSee openspec/changes/add-odf-release-isolation for the rationale.');
    process.exit(1);
  }
  console.log('Release-isolation guard passed: DOCX release lists match snapshot; no non-private ODF package.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
