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
 * Requires `gh auth login` locally. In CI, set GH_TOKEN env var.
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
  const PER_PAGE = 100;
  const allReleases = [];
  let page = 1;

  while (true) {
    const raw = execFileSync('gh', [
      'api',
      `repos/{owner}/{repo}/releases`,
      '--paginate',
      '--jq',
      '[.[] | select(.draft == false and .prerelease == false) | {tag: .tag_name, title: .name, published_at: .published_at, url: .html_url, body_md: .body, assets: [.assets[] | {name: .name, url: .browser_download_url, size: .size}]}]',
    ], { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' });

    const releases = JSON.parse(raw);
    allReleases.push(...releases);

    // --paginate handles all pages, so we break after the first call
    break;
  }

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

function main() {
  const { outputPath } = parseArgs();

  if (!ghAvailable()) {
    console.warn('Warning: gh CLI not available — skipping changelog generation.');
    console.warn('Existing changelog.json (if any) will be preserved.');
    process.exit(0);
  }

  let releases;
  try {
    releases = fetchReleases();
  } catch (err) {
    console.warn(`Warning: failed to fetch releases from GitHub API — ${err.message}`);
    console.warn('Existing changelog.json (if any) will be preserved.');
    process.exit(0);
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
