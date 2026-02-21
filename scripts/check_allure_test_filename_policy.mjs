#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DEFAULT_BASELINE = path.join(ROOT, 'coverage', 'allure-test-filename-baseline.json');

function parseArgs(argv) {
  let baseline = DEFAULT_BASELINE;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--baseline') {
      const value = argv[i + 1];
      if (!value) throw new Error('--baseline requires a value');
      baseline = path.resolve(ROOT, value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { baseline };
}

async function listFilesRecursively(rootDir, predicate) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (predicate(full)) out.push(full);
    }
  }
  await walk(rootDir);
  return out.sort();
}

function normalizeToRepoPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

async function loadBaseline(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const files = Array.isArray(parsed.allowed_allure_test_files)
    ? parsed.allowed_allure_test_files
    : [];
  return new Set(files.map((v) => String(v).trim()).filter(Boolean));
}

async function main() {
  const { baseline } = parseArgs(process.argv.slice(2));
  const allowed = await loadBaseline(baseline);

  const currentPaths = await listFilesRecursively(path.join(ROOT, 'packages'), (filePath) =>
    filePath.endsWith('.allure.test.ts'));
  const current = currentPaths.map(normalizeToRepoPath);

  const disallowed = current.filter((file) => !allowed.has(file));

  console.log(`Allure filename migration status: ${current.length} remaining *.allure.test.ts files.`);
  console.log(`Baseline allowlist size: ${allowed.size}`);

  if (disallowed.length > 0) {
    console.error('\nFAIL: New *.allure.test.ts files detected (rename to *.test.ts).');
    for (const file of disallowed) {
      console.error(`- ${file}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('PASS: No new *.allure.test.ts files introduced.');
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
