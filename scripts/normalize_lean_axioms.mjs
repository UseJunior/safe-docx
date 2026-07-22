#!/usr/bin/env node
// Normalize Lean `#print axioms` output into a sorted union of axiom names.

import fs from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: node scripts/normalize_lean_axioms.mjs <raw-axiom-output>');
  process.exit(2);
}

const raw = fs.readFileSync(inputPath, 'utf8');
const names = new Set();
const blockPattern = /depends on axioms:\s*\[([\s\S]*?)\]/g;
let match;

while ((match = blockPattern.exec(raw)) !== null) {
  const block = match[1];
  for (const token of block.match(/[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_'.]*)*/g) ?? []) {
    names.add(token);
  }
}

if (names.size === 0 && raw.includes('depends on axioms:')) {
  console.error('normalize_lean_axioms: found axiom headers but parsed no axiom names');
  process.exit(1);
}

process.stdout.write([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('\n'));
if (names.size > 0) process.stdout.write('\n');
