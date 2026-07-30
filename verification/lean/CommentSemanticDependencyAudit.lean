import Lean.Elab.Command
import LeanDocxChecker

open Lean Elab Command

namespace CommentSemanticDependencyAudit

example : executableCommentSourceSetV7RefinementSignature :=
  executable_comment_source_set_v7_refines_typed

example : executableCommentMarkerScanV7RefinementSignature :=
  executable_comment_marker_scan_v7_refines_typed

example : executableCommentDefinitionRealizationV7RefinementSignature :=
  executable_comment_definition_realization_v7_refines_typed

example : executableCommentIncompleteV7RefinementSignature :=
  executable_comment_incomplete_v7_refines_typed

example : executableProtocolV7Utf8JsonRefinementSignature :=
  executable_protocol_v7_utf8_json_refines_typed

example : productionRunRequestCoreV7RefinementSignature :=
  Tier2.NoteReferenceIntegrity.production_run_request_core_v7_refinement_sound

def declarationConstants (info : ConstantInfo) : Array Name :=
  match info with
  | .axiomInfo value => value.type.getUsedConstants
  | .defnInfo value => value.type.getUsedConstants ++ value.value.getUsedConstants
  | .thmInfo value => value.type.getUsedConstants ++ value.value.getUsedConstants
  | .opaqueInfo value => value.type.getUsedConstants ++ value.value.getUsedConstants
  | .ctorInfo value => value.type.getUsedConstants
  | .recInfo value => value.type.getUsedConstants
  | .inductInfo value => value.type.getUsedConstants ++ value.ctors
  | .quotInfo _ => #[]

partial def dependencyClosure (environment : Environment)
    (pending : List Name) (visited : Std.HashSet Name := {}) :
    Std.HashSet Name :=
  match pending with
  | [] => visited
  | name :: rest =>
      if visited.contains name then dependencyClosure environment rest visited
      else
        let dependencies := (environment.find? name).map declarationConstants
          |>.getD #[] |>.toList
        dependencyClosure environment (dependencies ++ rest)
          (visited.insert name)

def targets : List Name := [
  ``Tier2.CommentReferenceIntegrity.Typed.typed_comment_selector_result_v7_sound,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_comment_selection_to_realization_v7_sound,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_admitted_comment_source_set_v7_complete,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_comment_marker_scan_evidence_exact,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_package_comment_range_integrity_sound,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_incomplete_comment_range_zero_evidence_sound,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_comment_range_aggregate_pass_sound,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_invalid_topology_witnesses_are_canonical,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_duplicate_reference_aggregate_witness_rejected,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_orphan_endpoint_aggregate_witness_rejected,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_reversed_range_aggregate_witness_rejected,
  ``Tier2.CommentReferenceIntegrity.Typed.typed_cross_story_range_aggregate_witness_rejected,
  ``executable_comment_source_set_v7_refines_typed,
  ``executable_comment_marker_scan_v7_refines_typed,
  ``executable_comment_definition_realization_v7_refines_typed,
  ``executable_comment_incomplete_v7_refines_typed,
  ``executable_protocol_v7_utf8_json_refines_typed,
  ``Tier2.NoteReferenceIntegrity.production_run_request_core_v7_refinement_sound]

run_cmd do
  let environment ← getEnv
  for target in targets do
    unless environment.contains target do
      throwError "missing required protocol-v7 theorem {target}"
    let closure := dependencyClosure environment [target]
    if closure.toList.any (fun name => name.toString.startsWith "LeanSpike") then
      throwError "protocol-v7 target {target} reaches forbidden LeanSpike"
  logInfo "protocol-v7 theorem provenance and recursive no-LeanSpike audit passed"

end CommentSemanticDependencyAudit

#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_comment_selector_result_v7_sound
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_comment_selection_to_realization_v7_sound
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_admitted_comment_source_set_v7_complete
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_comment_marker_scan_evidence_exact
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_package_comment_range_integrity_sound
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_incomplete_comment_range_zero_evidence_sound
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_comment_range_aggregate_pass_sound
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_invalid_topology_witnesses_are_canonical
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_duplicate_reference_aggregate_witness_rejected
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_orphan_endpoint_aggregate_witness_rejected
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_reversed_range_aggregate_witness_rejected
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_cross_story_range_aggregate_witness_rejected
#print axioms executable_comment_source_set_v7_refines_typed
#print axioms executable_comment_marker_scan_v7_refines_typed
#print axioms executable_comment_definition_realization_v7_refines_typed
#print axioms executable_comment_incomplete_v7_refines_typed
#print axioms executable_protocol_v7_utf8_json_refines_typed
#print axioms Tier2.NoteReferenceIntegrity.production_run_request_core_v7_refinement_sound
