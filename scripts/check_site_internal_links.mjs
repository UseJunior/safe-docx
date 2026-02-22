import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const siteRoot = path.join(repoRoot, 'site', '_site');
const HTML_FILE_PATTERN = /\.html?$/i;
const INTERNAL_ATTR_PATTERN = /\b(?:href|src)=["']([^"']+)["']/g;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(entryPath);
      return [entryPath];
    }),
  );
  return files.flat();
}

function isExternalTarget(target) {
  return /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(target);
}

function normalizeUrlTarget(rawTarget) {
  const [withoutHash] = rawTarget.split('#');
  const [withoutQuery] = withoutHash.split('?');
  return withoutQuery.trim();
}

function resolveCandidatePaths(fromFile, rawTarget) {
  const normalized = normalizeUrlTarget(rawTarget);
  if (!normalized || normalized === '/' || normalized === '.') {
    return [path.join(siteRoot, 'index.html')];
  }

  const resolved = normalized.startsWith('/')
    ? path.join(siteRoot, normalized.slice(1))
    : path.resolve(path.dirname(fromFile), normalized);

  const candidates = [resolved];
  if (normalized.endsWith('/')) candidates.push(path.join(resolved, 'index.html'));
  if (!path.extname(resolved)) {
    candidates.push(`${resolved}.html`);
    candidates.push(path.join(resolved, 'index.html'));
  }
  return [...new Set(candidates)];
}

async function existsAny(paths) {
  for (const candidate of paths) {
    const relative = path.relative(siteRoot, candidate);
    if (relative.startsWith('..')) return false;
    try {
      await fs.access(candidate);
      return true;
    } catch {
      // Continue checking remaining candidates.
    }
  }
  return false;
}

async function main() {
  const allFiles = await walk(siteRoot);
  const htmlFiles = allFiles.filter((file) => HTML_FILE_PATTERN.test(file));
  const missing = [];
  let checkedCount = 0;

  for (const file of htmlFiles) {
    const html = await fs.readFile(file, 'utf8');
    for (const match of html.matchAll(INTERNAL_ATTR_PATTERN)) {
      const rawTarget = match[1] ?? '';
      if (!rawTarget || rawTarget.startsWith('#') || isExternalTarget(rawTarget)) continue;
      const candidates = resolveCandidatePaths(file, rawTarget);
      checkedCount += 1;
      // eslint-disable-next-line no-await-in-loop
      const ok = await existsAny(candidates);
      if (!ok) {
        missing.push({
          file: path.relative(siteRoot, file),
          target: rawTarget,
        });
      }
    }
  }

  if (missing.length > 0) {
    console.error(`Found ${missing.length} broken internal link(s):`);
    for (const item of missing) {
      console.error(`- ${item.file} -> ${item.target}`);
    }
    process.exit(1);
  }

  console.log(`Internal link check passed (${checkedCount} references across ${htmlFiles.length} HTML files).`);
}

main().catch((error) => {
  console.error('Internal link check failed:', error);
  process.exit(1);
});
