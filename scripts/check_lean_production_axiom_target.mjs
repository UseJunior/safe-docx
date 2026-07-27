#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const target =
  'Tier2.NoteReferenceIntegrity.production_run_request_core_refinement_sound';
const expected = ['Classical.choice', 'Quot.sound', 'propext'].sort();
const path = process.argv[2];

if (!path) {
  console.error('usage: node scripts/check_lean_production_axiom_target.mjs <raw-axiom-output>');
  process.exit(2);
}

const output = readFileSync(path, 'utf8');
const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const depended = output.match(new RegExp(
  `'${escaped}' depends on axioms:\\s*\\[([\\s\\S]*?)\\]`,
));
if (!depended) {
  console.error(`${target} was not printed with an axiom dependency set`);
  process.exit(1);
}

const observed = [...depended[1].matchAll(/[A-Za-z_][A-Za-z0-9_.]*/gu)]
  .map((match) => match[0])
  .sort();
if (JSON.stringify(observed) !== JSON.stringify(expected)) {
  console.error(
    `${target} expected [${expected.join(', ')}], observed [${observed.join(', ')}]`,
  );
  process.exit(1);
}

console.log(`Lean production axiom target verified: [${expected.join(', ')}]`);
