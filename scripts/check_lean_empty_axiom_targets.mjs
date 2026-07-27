#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const targets = [
  'Tier2.ConventionalMainNoteSelector.selected_note_identity_sound',
  'Tier2.NoteReferenceIntegrity.admitted_source_partition_complete',
  'Tier2.NoteReferenceIntegrity.parsed_inventory_evidence_exact',
  'Tier2.NoteReferenceIntegrity.package_note_reference_integrity_sound',
  'Tier2.NoteReferenceIntegrity.incomplete_partition_zero_evidence_sound',
  'Tier2.NoteReferenceIntegrity.note_integrity_aggregate_pass_sound',
];

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/check_lean_empty_axiom_targets.mjs <raw-axiom-output>');
  process.exit(2);
}

const output = readFileSync(path, 'utf8');
const failures = [];
for (const target of targets) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`'${escaped}' does not depend on any axioms`).test(output)) continue;
  const depended = output.match(new RegExp(
    `'${escaped}' depends on axioms:\\s*\\[([\\s\\S]*?)\\]`,
  ));
  failures.push(depended
    ? `${target} unexpectedly depends on [${depended[1].replace(/\s+/g, ' ').trim()}]`
    : `${target} was not printed by AxiomAudit.lean`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Lean empty-axiom targets verified: ${targets.length}`);
