#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SOURCE = 'README.md';
const TARGETS = ['README.es.md', 'README.zh.md', 'README.de.md', 'README.pt-br.md'];
const BLOCKS = ['badges', 'lang-nav'];

const BEGIN = (name) => `<!-- SYNC:${name} BEGIN -->`;
const END = (name) => `<!-- SYNC:${name} END -->`;

function extractBlock(text, name, fileLabel) {
  const begin = BEGIN(name);
  const end = END(name);
  const beginIdx = text.indexOf(begin);
  const endIdx = text.indexOf(end);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(
      `${fileLabel}: missing or malformed marker pair for SYNC:${name} ` +
        `(begin=${beginIdx}, end=${endIdx}). Insert ${begin} and ${end} on their own lines.`,
    );
  }
  return { begin: beginIdx, end: endIdx, body: text.slice(beginIdx + begin.length, endIdx) };
}

function replaceBlock(text, name, newBody, fileLabel) {
  const { begin, end } = extractBlock(text, name, fileLabel);
  return text.slice(0, begin + BEGIN(name).length) + newBody + text.slice(end);
}

async function main() {
  const argv = new Set(process.argv.slice(2));
  const checkOnly = argv.has('--check');

  const sourcePath = path.join(repoRoot, SOURCE);
  const sourceText = await fs.readFile(sourcePath, 'utf8');
  const sourceBlocks = Object.fromEntries(
    BLOCKS.map((name) => [name, extractBlock(sourceText, name, SOURCE).body]),
  );

  let drifted = 0;
  const driftDetails = [];

  for (const rel of TARGETS) {
    const filePath = path.join(repoRoot, rel);
    const original = await fs.readFile(filePath, 'utf8');
    let updated = original;
    for (const name of BLOCKS) {
      updated = replaceBlock(updated, name, sourceBlocks[name], rel);
    }
    if (updated !== original) {
      drifted++;
      driftDetails.push(rel);
      if (!checkOnly) {
        await fs.writeFile(filePath, updated);
      }
    }
  }

  if (checkOnly) {
    if (drifted > 0) {
      console.error(
        `[sync-readme-blocks] DRIFT detected in ${drifted} file(s):\n` +
          driftDetails.map((f) => `  - ${f}`).join('\n') +
          `\n\nRun \`npm run sync:readme\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log('[sync-readme-blocks] all translations in sync with README.md');
    return;
  }

  if (drifted === 0) {
    console.log('[sync-readme-blocks] no changes — all translations already in sync');
    return;
  }
  console.log(
    `[sync-readme-blocks] synced ${drifted} file(s):\n` + driftDetails.map((f) => `  - ${f}`).join('\n'),
  );
}

main().catch((err) => {
  console.error(`[sync-readme-blocks] ${err.message}`);
  process.exit(1);
});
