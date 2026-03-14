#!/usr/bin/env node
// bump_version.mjs — Bump all workspace versions in lockstep.
//
// Usage:
//   node scripts/bump_version.mjs <new-version>
//   node scripts/bump_version.mjs 0.4.0
//   node scripts/bump_version.mjs --check   # Verify all versions are in sync
//
// Updates: root + all workspace package.json files, mcpb manifest.json,
// cross-workspace dep ranges, and package-lock.json.
// After running, commit the changes and merge before tagging.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');

// ── Files to update ─────────────────────────────────────────────────────

const PACKAGE_JSONS = [
  'package.json',
  'packages/allure-test-factory/package.json',
  'packages/docx-core/package.json',
  'packages/docx-mcp/package.json',
  'packages/safe-docx-mcpb/package.json',
  'packages/safe-docx/package.json',
  'site/package.json',
];

const MANIFEST_JSON = 'packages/safe-docx-mcpb/manifest.json';

// Cross-workspace dependencies (package name → dep specifier pattern)
const WORKSPACE_DEPS = [
  '@usejunior/docx-core',
  '@usejunior/docx-mcp',
  '@usejunior/safe-docx',
];

// ── Helpers ─────────────────────────────────────────────────────────────

function readJson(relPath) {
  const abs = join(ROOT, relPath);
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function writeJson(relPath, data) {
  const abs = join(ROOT, relPath);
  writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v);
}

// ── Check mode ──────────────────────────────────────────────────────────

function checkVersionSync() {
  const versions = new Map();
  let ok = true;

  for (const rel of PACKAGE_JSONS) {
    const pkg = readJson(rel);
    versions.set(rel, pkg.version);
  }

  const manifest = readJson(MANIFEST_JSON);
  versions.set(MANIFEST_JSON, manifest.version);

  const serverJson = readJson('packages/safe-docx/server.json');
  versions.set('packages/safe-docx/server.json', serverJson.version);
  if (serverJson.packages?.[0]?.version !== serverJson.version) {
    console.error('  server.json packages[0].version mismatch');
    ok = false;
  }

  const uniqueVersions = new Set(versions.values());
  if (uniqueVersions.size === 1) {
    const v = [...uniqueVersions][0];
    console.log(`All ${versions.size} files are at version ${v}`);
  } else {
    console.error('Version mismatch detected:');
    for (const [file, v] of versions) {
      console.error(`  ${v}  ${file}`);
    }
    ok = false;
  }

  // Check cross-workspace deps
  for (const rel of PACKAGE_JSONS) {
    const pkg = readJson(rel);
    for (const depSection of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const deps = pkg[depSection];
      if (!deps) continue;
      for (const name of WORKSPACE_DEPS) {
        if (deps[name]) {
          const expected = `^${[...uniqueVersions][0]}`;
          if (deps[name] !== expected && uniqueVersions.size === 1) {
            console.error(`  ${rel}: ${name} is "${deps[name]}", expected "${expected}"`);
            ok = false;
          }
        }
      }
    }
  }

  return ok;
}

// ── Bump mode ───────────────────────────────────────────────────────────

function bumpVersion(newVersion) {
  if (!isValidSemver(newVersion)) {
    console.error(`Invalid semver: ${newVersion}`);
    process.exit(1);
  }

  const currentVersion = readJson('package.json').version;
  console.log(`Bumping ${currentVersion} → ${newVersion}\n`);

  // 1. Update all package.json version fields
  for (const rel of PACKAGE_JSONS) {
    const pkg = readJson(rel);
    pkg.version = newVersion;

    // 2. Update cross-workspace dependency ranges
    for (const depSection of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const deps = pkg[depSection];
      if (!deps) continue;
      for (const name of WORKSPACE_DEPS) {
        if (deps[name]) {
          deps[name] = `^${newVersion}`;
        }
      }
    }

    writeJson(rel, pkg);
    console.log(`  ✓ ${rel}`);
  }

  // 3. Update manifest.json
  const manifest = readJson(MANIFEST_JSON);
  manifest.version = newVersion;
  writeJson(MANIFEST_JSON, manifest);
  console.log(`  ✓ ${MANIFEST_JSON}`);

  // 3b. Update server.json
  const SERVER_JSON = 'packages/safe-docx/server.json';
  const serverJson = readJson(SERVER_JSON);
  serverJson.version = newVersion;
  if (serverJson.packages?.[0]) {
    serverJson.packages[0].version = newVersion;
  }
  writeJson(SERVER_JSON, serverJson);
  console.log(`  ✓ ${SERVER_JSON}`);

  // 4. Regenerate package-lock.json
  console.log('\nRegenerating package-lock.json...');
  try {
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
    console.log('  ✓ package-lock.json');
  } catch {
    console.error('  ✗ npm install failed — fix manually and re-run');
    process.exit(1);
  }

  // 5. Verify
  console.log('\nVerifying...');
  if (checkVersionSync()) {
    console.log(`\nDone! All files bumped to ${newVersion}.`);
    console.log('\nNext steps:');
    console.log(`  1. git add -A && git commit -m "chore(release): bump workspace versions to ${newVersion}"`);
    console.log('  2. Open PR, merge to main');
    console.log(`  3. git tag v${newVersion} && git push origin v${newVersion}`);
  } else {
    console.error('\nVersion sync check failed after bump — investigate manually.');
    process.exit(1);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (!arg) {
  console.error('Usage: node scripts/bump_version.mjs <new-version>');
  console.error('       node scripts/bump_version.mjs --check');
  process.exit(1);
}

if (arg === '--check') {
  process.exit(checkVersionSync() ? 0 : 1);
} else {
  bumpVersion(arg);
}
