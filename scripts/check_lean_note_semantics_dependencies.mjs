#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leanDirectory = fileURLToPath(
  new URL('../verification/lean/', import.meta.url),
);
const semanticsPath = fileURLToPath(
  new URL(
    '../verification/lean/Tier2/NoteReferenceIntegrity/Semantics.lean',
    import.meta.url,
  ),
);
const imports = [...readFileSync(semanticsPath, 'utf8').matchAll(/^import\s+(.+)$/gmu)]
  .map((match) => match[1]);
if (imports.length !== 1 || imports[0] !== 'Tier2.XmlTripleChecker') {
  throw new Error(`unexpected proof-semantics imports: ${imports.join(', ')}`);
}
const publicTargets = [
  'Tier2.ConventionalMainNoteSelector.selected_note_identity_sound',
  'Tier2.NoteReferenceIntegrity.admitted_source_partition_complete',
  'Tier2.NoteReferenceIntegrity.parsed_inventory_evidence_exact',
  'Tier2.NoteReferenceIntegrity.package_note_reference_integrity_sound',
  'Tier2.NoteReferenceIntegrity.incomplete_partition_zero_evidence_sound',
  'Tier2.NoteReferenceIntegrity.note_integrity_aggregate_pass_sound',
];
const productionRefinementTarget =
  'Tier2.NoteReferenceIntegrity.production_run_request_core_refinement_sound';
const productionBridgeTargets = [
  'Tier2.ConventionalMainNoteSelector.production_note_selector_exact',
  'Tier2.NoteReferenceIntegrity.production_note_scan_exact',
  'Tier2.NoteReferenceIntegrity.production_note_integrity_sound',
  'Tier2.NoteReferenceIntegrity.production_aggregate_pass_exact',
  'Tier2.NoteReferenceIntegrity.production_protocol_v5_serialization_exact',
];

const result = spawnSync(
  'lake',
  ['env', 'lean', 'NoteSemanticDependencyAudit.lean'],
  {
    cwd: leanDirectory,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  process.exit(result.status ?? 1);
}

const output = `${result.stdout}\n${result.stderr}`;
const failures = [];
for (const target of publicTargets) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`'${escaped}' does not depend on any axioms`).test(output)) {
    failures.push(`${target} is missing or has a nonempty axiom dependency set`);
  }
}
{
  const escaped = productionRefinementTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const printed = output.match(new RegExp(
    `'${escaped}' depends on axioms:\\s*\\[([\\s\\S]*?)\\]`,
  ));
  if (!printed) {
    failures.push(`${productionRefinementTarget} was not printed with its concrete foundation set`);
  } else {
    const observed = [...printed[1].matchAll(/[A-Za-z_][A-Za-z0-9_.]*/gu)]
      .map((match) => match[0]).sort();
    const expected = ['Classical.choice', 'Quot.sound', 'propext'].sort();
    if (JSON.stringify(observed) !== JSON.stringify(expected)) {
      failures.push(
        `${productionRefinementTarget} foundation set drifted: ${observed.join(', ')}`,
      );
    }
  }
}
for (const target of productionBridgeTargets) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const printed = output.match(new RegExp(
    `'${escaped}' (?:does not depend on any axioms|depends on axioms:\\s*\\[([\\s\\S]*?)\\])`,
  ));
  if (!printed) {
    failures.push(`${target} was not printed by the production bridge audit`);
  } else if (printed[1] &&
      /LeanSpike\.(?:compareDocumentXml|inv_|residual)/u.test(printed[1])) {
    failures.push(`${target} depends on a forbidden LeanSpike engine/residual axiom`);
  }
}
if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n${output}`);
  process.exit(1);
}

process.stdout.write(output);
console.log(
  `Lean semantic audit passed: ${publicTargets.length} empty semantic targets, ` +
  '1 production refinement target with exact Lean foundations, ' +
  `${productionBridgeTargets.length} production bridge targets without residual axioms`,
);
