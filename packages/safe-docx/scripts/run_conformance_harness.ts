#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  runConformanceHarness,
  getExitCode,
  type HarnessOptions,
} from '../src/conformance/harness.js';

type CliArgs = {
  manifestPath: string;
  reportPath?: string;
  mode: 'full' | 'smoke';
  deterministicRuns: number;
  openAgreementsRoot?: string;
};

function parseArgs(argv: string[]): CliArgs {
  let manifestPath = '';
  let reportPath: string | undefined;
  let mode: 'full' | 'smoke' = 'full';
  let deterministicRuns = 2;
  let openAgreementsRoot = process.env.SAFE_DOCX_CONFORMANCE_OPEN_AGREEMENTS_ROOT;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === '--manifest' && next) {
      manifestPath = next;
      i += 1;
      continue;
    }
    if (arg === '--report' && next) {
      reportPath = next;
      i += 1;
      continue;
    }
    if (arg === '--mode' && next) {
      if (next === 'full' || next === 'smoke') mode = next;
      i += 1;
      continue;
    }
    if (arg === '--smoke') {
      mode = 'smoke';
      continue;
    }
    if (arg === '--deterministic-runs' && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed >= 2) deterministicRuns = parsed;
      i += 1;
      continue;
    }
    if (arg === '--open-agreements-root' && next) {
      openAgreementsRoot = next;
      i += 1;
      continue;
    }
  }

  if (!manifestPath) {
    throw new Error(
      'Missing required --manifest argument.\n' +
      'Example: tsx scripts/run_conformance_harness.ts --manifest conformance/fixtures.manifest.json --report /tmp/safe-docx-conformance.json'
    );
  }

  return {
    manifestPath,
    reportPath,
    mode,
    deterministicRuns,
    openAgreementsRoot,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const options: HarnessOptions = {
    manifestPath: path.resolve(packageRoot, args.manifestPath),
    repoRoot: path.resolve(packageRoot, '../..'),
    mode: args.mode,
    deterministicRuns: args.deterministicRuns,
    openAgreementsRoot: args.openAgreementsRoot,
  };

  const report = await runConformanceHarness(options);
  const serialized = JSON.stringify(report, null, 2);

  if (args.reportPath) {
    const out = path.resolve(args.reportPath);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, `${serialized}\n`, 'utf8');
  }

  process.stdout.write(`${serialized}\n`);
  process.exit(getExitCode(report));
}

main().catch((err) => {
  process.stderr.write(`safe-docx conformance harness failed: ${String(err?.message ?? err)}\n`);
  process.exit(1);
});
