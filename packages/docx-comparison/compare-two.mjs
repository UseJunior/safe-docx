#!/usr/bin/env node
/**
 * Compare two DOCX files and write a redlined DOCX output.
 *
 * Usage:
 *   node packages/docx-comparison/compare-two.mjs <original.docx> <revised.docx> [output.docx]
 *
 * Options:
 *   --engine atomizer|diffmatch   (default: atomizer)
 *   --mode inplace|rebuild        (default: inplace)
 *   --author "Name"              (default: Comparison)
 *   --premerge-runs true|false    (default: false)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { compareDocuments } from './dist/index.js';

function usageAndExit(code) {
  // Keep it minimal; caller can inspect README/debug scripts for more.
  console.error(
    'Usage: compare-two.mjs <original.docx> <revised.docx> [output.docx] ' +
      '[--engine atomizer|diffmatch] [--mode inplace|rebuild] [--author "Name"] [--premerge-runs true|false]'
  );
  process.exit(code);
}

function parseArgs(argv) {
  const positional = [];
  const opts = {
    engine: 'atomizer',
    // Default to rebuild to satisfy the "Reject All -> original" expectation in Word.
    reconstructionMode: 'rebuild',
    author: 'Comparison',
    premergeRuns: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }

    const key = a.slice(2);
    const val = argv[i + 1];
    if (!val || val.startsWith('--')) usageAndExit(2);
    i++;

    if (key === 'engine') opts.engine = val;
    else if (key === 'mode') opts.reconstructionMode = val;
    else if (key === 'author') opts.author = val;
    else if (key === 'premerge-runs') opts.premergeRuns = val === 'true' || val === '1';
    else usageAndExit(2);
  }

  if (positional.length < 2 || positional.length > 3) usageAndExit(2);
  return { positional, opts };
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [originalPath, revisedPath, outputPathArg] = positional;

  const originalAbs = resolve(originalPath);
  const revisedAbs = resolve(revisedPath);
  const outputAbs = resolve(
    outputPathArg ||
      revisedAbs.replace(/\.docx$/i, '') + `.REDLINE.${opts.engine}.${opts.reconstructionMode}.docx`
  );

  const originalBuffer = await readFile(originalAbs);
  const revisedBuffer = await readFile(revisedAbs);

  const result = await compareDocuments(originalBuffer, revisedBuffer, {
    engine: opts.engine,
    author: opts.author,
    reconstructionMode: opts.reconstructionMode,
    premergeRuns: opts.premergeRuns,
  });

  await mkdir(dirname(outputAbs), { recursive: true });
  await writeFile(outputAbs, result.document);

  // Print a single JSON line so tooling can scrape if needed.
  console.log(
    JSON.stringify({
      output: outputAbs,
      engine: result.engine,
      stats: result.stats,
      bytes: result.document.length,
    })
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
