#!/usr/bin/env node

/**
 * Generate changelog data JSON from GitHub Releases.
 *
 * Uses the `gh` CLI to read releases, then writes a structured JSON file
 * for the trust site to render.
 *
 * Usage:
 *   node scripts/generate_changelog_data.mjs
 *   node scripts/generate_changelog_data.mjs --output site/src/_data/changelog.json
 *
 * Requires `gh auth login` locally. In CI, set GH_TOKEN env var; without it
 * the script exits non-zero instead of preserving stale data.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  let outputPath = resolve(REPO_ROOT, 'site', 'src', '_raw', 'changelog.json');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output') {
      const value = args[i + 1];
      if (!value) throw new Error('--output requires a path value');
      outputPath = resolve(process.cwd(), value);
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${args[i]}`);
  }

  return { outputPath };
}

function ghAvailable() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function fetchReleases() {
  // --slurp wraps every page in one outer array, so the output stays a single
  // JSON document past 100 releases (--paginate with --jq emits one per page).
  const raw = execFileSync('gh', [
    'api',
    `repos/{owner}/{repo}/releases?per_page=100`,
    '--paginate',
    '--slurp',
  ], { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });

  const allReleases = JSON.parse(raw)
    .flat()
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({
      tag: r.tag_name,
      title: r.name,
      published_at: r.published_at,
      url: r.html_url,
      body_md: r.body,
      assets: (r.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    }));

  // Sort by published_at descending
  allReleases.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  return allReleases.map((r) => ({
    version: r.tag.replace(/^v/, ''),
    tag: r.tag,
    title: r.title || r.tag,
    published_at: r.published_at,
    url: r.url,
    body_md: r.body_md || '',
    assets: r.assets || [],
  }));
}

// In CI a skipped fetch would silently keep stale data behind a green job, so
// fail loudly there; locally, keep the existing file and just warn.
function skip(reason) {
  console.warn(`Warning: ${reason}`);
  if (process.env.CI) {
    console.error('Refusing to preserve stale changelog.json in CI.');
    process.exit(1);
  }
  console.warn('Existing changelog.json (if any) will be preserved.');
  process.exit(0);
}

function main() {
  const { outputPath } = parseArgs();

  if (!ghAvailable()) {
    skip('gh CLI not available — skipping changelog generation.');
  }

  let releases;
  try {
    releases = fetchReleases();
  } catch (err) {
    skip(`failed to fetch releases from GitHub API — ${err.message}`);
  }

  const data = {
    generated_at_utc: new Date().toISOString(),
    releases,
  };

  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  const relative = outputPath.replace(REPO_ROOT + '/', '');
  console.log(`Generated changelog data: ${relative} (${releases.length} release(s))`);
}

main();
