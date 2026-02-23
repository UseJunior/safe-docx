#!/usr/bin/env node

/**
 * Generate trust metrics JSON from Allure results and traceability matrices.
 *
 * Reads all package allure-results directories and traceability matrices,
 * then writes a consolidated metrics.json to site/src/trust/metrics.json.
 *
 * Usage:
 *   node scripts/generate_trust_metrics.mjs
 *   node scripts/generate_trust_metrics.mjs --output site/src/trust/metrics.json
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMetricsObject } from './lib/trust-metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  let outputPath = resolve(REPO_ROOT, 'site', 'src', 'trust', 'metrics.json');

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

async function main() {
  const { outputPath } = parseArgs();

  const metrics = await buildMetricsObject();

  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(metrics, null, 2) + '\n', 'utf-8');

  const relative = outputPath.replace(REPO_ROOT + '/', '');
  console.log(`Generated trust metrics: ${relative}`);
}

await main();
