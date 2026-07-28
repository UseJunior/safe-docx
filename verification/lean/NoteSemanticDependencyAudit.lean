import Lean.Elab.Command
import LeanDocxChecker
import LeanSpike.Spec

open Lean Elab Command

namespace NoteSemanticDependencyAudit

def declarationConstants (info : ConstantInfo) : Array Name :=
  match info with
  | ConstantInfo.axiomInfo value => value.type.getUsedConstants
  | ConstantInfo.defnInfo value => value.type.getUsedConstants ++ value.value.getUsedConstants
  | ConstantInfo.thmInfo value => value.type.getUsedConstants ++ value.value.getUsedConstants
  | ConstantInfo.opaqueInfo value => value.type.getUsedConstants ++ value.value.getUsedConstants
  | ConstantInfo.ctorInfo value => value.type.getUsedConstants
  | ConstantInfo.recInfo value => value.type.getUsedConstants
  | ConstantInfo.inductInfo value => value.type.getUsedConstants ++ value.ctors
  | ConstantInfo.quotInfo _ => #[]

def declarationValueConstants (info : ConstantInfo) : Array Name :=
  match info with
  | ConstantInfo.defnInfo value => value.value.getUsedConstants
  | ConstantInfo.thmInfo value => value.value.getUsedConstants
  | ConstantInfo.opaqueInfo value => value.value.getUsedConstants
  | ConstantInfo.inductInfo value => value.ctors.toArray
  | _ => #[]

partial def dependencyClosure (environment : Environment)
    (pending : List Name) (visited : List Name := []) : List Name :=
  match pending with
  | [] => visited
  | name :: names =>
    if visited.contains name then dependencyClosure environment names visited
    else
      let visited := name :: visited
      let dependencies :=
        (environment.find? name).map declarationConstants |>.getD #[] |>.toList
      dependencyClosure environment (dependencies ++ names) visited

partial def valueDependencyClosure (environment : Environment)
    (pending : List Name) (stops : List Name := []) (visited : List Name := []) :
    List Name :=
  match pending with
  | [] => visited
  | name :: names =>
    if visited.contains name then valueDependencyClosure environment names stops visited
    else
      let visited := name :: visited
      let dependencies :=
        if stops.contains name then []
        else (environment.find? name).map declarationValueConstants |>.getD #[] |>.toList
      valueDependencyClosure environment (dependencies ++ names) stops visited

def requireDirectTypeConstants (environment : Environment) (target : Name)
    (required : List Name) : CommandElabM Unit := do
  let some info := environment.find? target |
    throwError "semantic dependency audit target is missing: {target}"
  let direct := info.type.getUsedConstants
  for name in required do
    unless direct.contains name do
      throwError "semantic theorem {target} signature does not mention required constant {name}"

def requireExactSignature (environment : Environment) (target signature : Name) :
    CommandElabM Unit := do
  let some targetInfo := environment.find? target |
    throwError "dependency audit target is missing: {target}"
  let some signatureInfo := environment.find? signature |
    throwError "dependency audit signature is missing: {signature}"
  let some signatureValue := signatureInfo.value? |
    throwError "dependency audit signature has no definition value: {signature}"
  unless targetInfo.type == signatureValue do
    throwError "theorem {target} does not have the exact pinned signature {signature}"

def firstForbidden? (closure forbidden : List Name) : Option Name :=
  closure.find? forbidden.contains

def rejectForbidden (target : Name) (closure forbidden : List Name) :
    CommandElabM Unit := do
  if let some dependency := firstForbidden? closure forbidden then
    throwError "semantic theorem {target} reaches forbidden constant {dependency}"

def injectedParserDependency (xml uri localName : String) :=
  Tier2.XmlTripleChecker.parseXmlEventsForRootBoundedTyped xml uri localName 1 1

def injectedZipIndexDependency (bytes : ByteArray) :=
  Tier2.RelationshipStorySelector.buildZipIndex bytes

run_cmd do
  let environment ← getEnv
  let semanticTargets : List Name := [
    ``Tier2.ConventionalMainNoteSelector.selected_note_identity_sound,
    ``Tier2.NoteReferenceIntegrity.admitted_source_partition_complete,
    ``Tier2.NoteReferenceIntegrity.parsed_inventory_evidence_exact,
    ``Tier2.NoteReferenceIntegrity.package_note_reference_integrity_sound,
    ``Tier2.NoteReferenceIntegrity.incomplete_partition_zero_evidence_sound,
    ``Tier2.NoteReferenceIntegrity.note_integrity_aggregate_pass_sound
  ]
  for target in semanticTargets do
    let closure := dependencyClosure environment [target]
    rejectForbidden target closure
      [``runRequestCore,
        ``Tier2.ConventionalMainNoteSelector.selectConventionalMainNoteRecords,
        ``LeanSpike.compareDocumentXml,
        ``LeanSpike.compareDocumentXml_output_preservation_friendly,
        ``LeanSpike.compareDocumentXml_output_text_roundtrip,
        ``LeanSpike.inv_field_001, ``LeanSpike.inv_rt_001]
  let productionTarget :=
    ``Tier2.NoteReferenceIntegrity.production_run_request_core_refinement_sound
  requireExactSignature environment productionTarget
    ``Tier2.NoteReferenceIntegrity.productionRunRequestCoreRefinementSignature
  requireDirectTypeConstants environment productionTarget
    [``runRequestCore, ``ProductionRunRequestRefinesSemanticOf]
  let productionClosure := dependencyClosure environment [productionTarget]
  rejectForbidden productionTarget productionClosure
    [``LeanSpike.compareDocumentXml,
      ``LeanSpike.compareDocumentXml_output_preservation_friendly,
      ``LeanSpike.compareDocumentXml_output_text_roundtrip,
      ``LeanSpike.inv_field_001, ``LeanSpike.inv_rt_001]
  for required in [
      ``runRequestCore, ``semanticRequestOfCore, ``packageViewOfRecord,
      ``semanticProtocolV6Projection, ``SemanticProtocolV6ProjectionOf,
      ``Tier2.ConventionalMainNoteSelector.selectConventionalMainNoteRecords,
      ``productionParseEvidenceCheck,
      ``Tier2.NoteReferenceIntegrity.productionNoteScanBounded,
      ``Tier2.NoteReferenceIntegrity.checkProductionNoteIntegrity,
      ``productionSemanticInventoriesPass,
      ``Tier2.NoteReferenceIntegrity.productionAggregatePass,
      ``SemanticProtocolSpec.fields,
      ``SemanticProtocolSpec.encode,
      ``finalizeProtocolV6Response] do
    unless productionClosure.contains required do
      throwError "production refinement theorem does not reach required executable constant {required}"
  let projectionClosure :=
    valueDependencyClosure environment [``semanticProtocolV6Projection]
  rejectForbidden ``semanticProtocolV6Projection projectionClosure
    [``buildRunRequestCoreJson, ``buildRunRequestCoreResponse, ``runRequestCore,
      ``protocolV5ResponseJson, ``storyReportJson,
      ``Tier2.XmlTripleChecker.storyReportToJson,
      ``Tier2.XmlTripleChecker.reportToJson,
      ``selectionIssueJson, ``identityJson, ``slotJson,
      ``physicalStoryJson, ``loadedNoteIdentityJson, ``definitionSourceJson,
      ``referenceSourceJson, ``partitionJson, ``inventoryJson, ``noteStoryJson,
      ``coalesceNoteIssues, ``noteIssueCoalesceKey, ``noteIssueSortKey,
      ``noteIssueLess, ``issueLess, ``jsonEvidenceStringBytes,
      ``selectionIssueStringBytes, ``slotStringBytes, ``physicalStoryStringBytes,
      ``evidenceStringBytes, ``firstAggregateIssueCrossingLoop,
      ``firstAggregateIssueCrossing, ``skippedNoteSideEvidence,
      ``zeroInventoryJson,
      ``Tier2.NoteReferenceIntegrity.protocolV5ResponseJson,
      ``LeanSpike.compareDocumentXml,
      ``LeanSpike.compareDocumentXml_output_preservation_friendly,
      ``LeanSpike.compareDocumentXml_output_text_roundtrip,
      ``LeanSpike.inv_field_001, ``LeanSpike.inv_rt_001]
  let retainedEvidenceChecks : List Name := [
    ``productionPackageParserEvidencePass,
    ``productionRecordIntegrityPass,
    ``coreSemanticAdmissionReady,
    ``runRequestCore
  ]
  for target in retainedEvidenceChecks do
    let closure := valueDependencyClosure environment [target]
    rejectForbidden target closure
      [``loadPackage, ``extractPart, ``runBounded, ``crc32,
        ``Tier2.RelationshipStorySelector.buildZipIndex,
        ``Tier2.XmlTripleChecker.parseXmlEventsForRootBoundedTyped,
        ``Tier2.NoteReferenceIntegrity.productionNoteScanBounded]
  let parserClosure := valueDependencyClosure environment [``injectedParserDependency]
  unless firstForbidden? parserClosure
      [``Tier2.XmlTripleChecker.parseXmlEventsForRootBoundedTyped] ==
        some ``Tier2.XmlTripleChecker.parseXmlEventsForRootBoundedTyped do
    throwError "qualified parser dependency self-test was not rejected"
  let zipClosure := valueDependencyClosure environment [``injectedZipIndexDependency]
  unless firstForbidden? zipClosure
      [``Tier2.RelationshipStorySelector.buildZipIndex] ==
        some ``Tier2.RelationshipStorySelector.buildZipIndex do
    throwError "qualified ZIP-index dependency self-test was not rejected"
  let runtimeClosure := valueDependencyClosure environment [``runRequest]
  for required in [
      ``loadPackage, ``createPrivateSnapshot, ``extractPart,
      ``parseProductionEvidence, ``retainProductionNoteScan,
      ``runRequestCore] do
    unless runtimeClosure.contains required do
      throwError "runRequest runtime closure is missing single-pass stage {required}"
  logInfo "recursive semantic constant-dependency audit and qualified-name self-tests passed"

end NoteSemanticDependencyAudit

#print axioms Tier2.ConventionalMainNoteSelector.selected_note_identity_sound
#print axioms Tier2.NoteReferenceIntegrity.admitted_source_partition_complete
#print axioms Tier2.NoteReferenceIntegrity.parsed_inventory_evidence_exact
#print axioms Tier2.NoteReferenceIntegrity.package_note_reference_integrity_sound
#print axioms Tier2.NoteReferenceIntegrity.incomplete_partition_zero_evidence_sound
#print axioms Tier2.NoteReferenceIntegrity.note_integrity_aggregate_pass_sound
#print axioms Tier2.NoteReferenceIntegrity.production_run_request_core_refinement_sound
#print axioms Tier2.ConventionalMainNoteSelector.production_note_selector_exact
#print axioms Tier2.NoteReferenceIntegrity.production_note_scan_exact
#print axioms Tier2.NoteReferenceIntegrity.production_note_integrity_sound
#print axioms Tier2.NoteReferenceIntegrity.production_aggregate_pass_exact
#print axioms Tier2.NoteReferenceIntegrity.production_protocol_v5_serialization_exact
