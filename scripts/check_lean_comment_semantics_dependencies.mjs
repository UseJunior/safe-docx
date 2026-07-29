#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const leanDirectory = fileURLToPath(
  new URL('../verification/lean/', import.meta.url),
);
const semanticTargets = [
  'Tier2.CommentReferenceIntegrity.Typed.typedByteArrayEqCheck_true_iff',
  'Tier2.CommentReferenceIntegrity.Typed.typedXmlEventListEqCheck_true_iff',
  'Tier2.CommentReferenceIntegrity.Typed.typed_comment_selector_result_sound',
  'Tier2.CommentReferenceIntegrity.Typed.typed_comment_selection_to_realization_sound',
  'Tier2.CommentReferenceIntegrity.Typed.typed_admitted_comment_source_set_complete',
  'Tier2.CommentReferenceIntegrity.Typed.typed_parsed_comment_inventory_evidence_exact',
  'Tier2.CommentReferenceIntegrity.Typed.typed_package_comment_reference_integrity_sound',
  'Tier2.CommentReferenceIntegrity.Typed.typed_incomplete_comment_partition_zero_evidence_sound',
  'Tier2.CommentReferenceIntegrity.Typed.typed_comment_integrity_aggregate_pass_sound',
];
const executableBridgeTargets = [
  'executable_comment_selector_refines_typed',
  'executable_comment_realization_refines_typed',
  'executable_comment_source_set_refines_typed',
  'executable_comment_incomplete_refines_typed',
  'executable_protocol_utf8_json_refines_typed',
];
const productionTarget =
  'Tier2.NoteReferenceIntegrity.production_run_request_core_v6_refinement_sound';

const result = spawnSync(
  'lake',
  ['env', 'lean', 'CommentSemanticDependencyAudit.lean'],
  { cwd: leanDirectory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  process.exit(result.status ?? 1);
}

const output = `${result.stdout}\n${result.stderr}`;
const failures = [];
for (const target of semanticTargets) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(`'${escaped}' does not depend on any axioms`, 'u').test(output)) {
    failures.push(`${target} is missing or has a nonempty axiom set`);
  }
}
for (const target of [...executableBridgeTargets, productionTarget]) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const printed = output.match(new RegExp(
    `'${escaped}' depends on axioms:\\s*\\[([\\s\\S]*?)\\]`,
    'u',
  ));
  const observed = printed
    ? [...printed[1].matchAll(/[A-Za-z_][A-Za-z0-9_.]*/gu)]
      .map((match) => match[0]).sort()
    : [];
  const expected = ['Classical.choice', 'Quot.sound', 'propext'].sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    failures.push(`${target} foundation set drifted: ${observed.join(', ')}`);
  }
}
if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n${output}`);
  process.exit(1);
}

process.stdout.write(output);
console.log(
  `Lean comment audit passed: ${semanticTargets.length} empty semantic targets ` +
  `and ${executableBridgeTargets.length + 1} executable targets with the ` +
  'exact foundational axiom set',
);
