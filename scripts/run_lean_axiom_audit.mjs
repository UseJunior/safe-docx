#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runFreshLeanAudit } from './lean_audit_runner.mjs';

const leanDirectory = fileURLToPath(
  new URL('../verification/lean/', import.meta.url),
);
const outputPath = process.argv[2];

if (!outputPath) {
  console.error('usage: node scripts/run_lean_axiom_audit.mjs <raw-output>');
  process.exit(2);
}

const result = runFreshLeanAudit({
  leanDirectory,
  buildTargets: ['LeanDocxChecker'],
  auditFile: 'AxiomAudit.lean',
  maxBuffer: 16 * 1024 * 1024,
});
const output = `${result.stdout}\n${result.stderr}`;
writeFileSync(outputPath, output);

if (result.status !== 0) {
  process.stderr.write(output);
  process.exit(result.status ?? 1);
}

console.log(`Fresh Lean axiom audit wrote ${outputPath}`);
