#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runFreshLeanAudit } from './lean_audit_runner.mjs';

const leanDirectory = fileURLToPath(
  new URL('../verification/lean/', import.meta.url),
);
const semanticTargets = [
  'Tier2.CommentReferenceIntegrity.Typed.typed_comment_selector_result_v7_sound',
  'Tier2.CommentReferenceIntegrity.Typed.typed_comment_selection_to_realization_v7_sound',
  'Tier2.CommentReferenceIntegrity.Typed.typed_admitted_comment_source_set_v7_complete',
  'Tier2.CommentReferenceIntegrity.Typed.typed_comment_marker_scan_evidence_exact',
  'Tier2.CommentReferenceIntegrity.Typed.typed_package_comment_range_integrity_sound',
  'Tier2.CommentReferenceIntegrity.Typed.typed_incomplete_comment_range_zero_evidence_sound',
  'Tier2.CommentReferenceIntegrity.Typed.typed_comment_range_aggregate_pass_sound',
  'Tier2.CommentReferenceIntegrity.Typed.typed_invalid_topology_witnesses_are_canonical',
  'Tier2.CommentReferenceIntegrity.Typed.typed_duplicate_reference_aggregate_witness_rejected',
  'Tier2.CommentReferenceIntegrity.Typed.typed_orphan_endpoint_aggregate_witness_rejected',
  'Tier2.CommentReferenceIntegrity.Typed.typed_reversed_range_aggregate_witness_rejected',
  'Tier2.CommentReferenceIntegrity.Typed.typed_cross_story_range_aggregate_witness_rejected',
];
const executableBridgeTargets = [
  'executable_comment_source_set_v7_refines_typed',
  'executable_comment_marker_scan_v7_refines_typed',
  'executable_comment_definition_realization_v7_refines_typed',
  'executable_comment_incomplete_v7_refines_typed',
  'executable_protocol_v7_utf8_json_refines_typed',
];
const productionTarget =
  'Tier2.NoteReferenceIntegrity.production_run_request_core_v7_refinement_sound';

const result = runFreshLeanAudit({
  leanDirectory,
  buildTargets: ['LeanDocxChecker'],
  auditFile: 'CommentSemanticDependencyAudit.lean',
});
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
