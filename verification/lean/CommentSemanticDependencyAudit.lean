import Lean.Elab.Command
import LeanDocxChecker

open Lean Elab Command

namespace CommentSemanticDependencyAudit

def productionAmbiguousStructuralEocdRejected : Bool :=
  match Tier2.RelationshipStorySelector.findEocd
      Tier2.CommentReferenceIntegrity.Typed.typedAmbiguousEocdBytes with
  | .error message => message == "ambiguous classic EOCD"
  | .ok _ => false

theorem production_rejects_ambiguous_structural_eocd_archive :
    productionAmbiguousStructuralEocdRejected = true := by
  native_decide

def declarationConstants (info : ConstantInfo) : Array Name :=
  match info with
  | .axiomInfo value => value.type.getUsedConstants
  | .defnInfo value =>
      value.type.getUsedConstants ++ value.value.getUsedConstants
  | .thmInfo value =>
      value.type.getUsedConstants ++ value.value.getUsedConstants
  | .opaqueInfo value =>
      value.type.getUsedConstants ++ value.value.getUsedConstants
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
      if visited.contains name then
        dependencyClosure environment rest visited
      else
        let dependencies :=
          (environment.find? name).map declarationConstants |>.getD #[]
            |>.toList
        dependencyClosure environment (dependencies ++ rest)
          (visited.insert name)

partial def dependencyPath? (environment : Environment) (target : Name)
    (pending : List (Name × List Name)) (visited : Std.HashSet Name := {}) :
    Option (List Name) :=
  match pending with
  | [] => none
  | (name, path) :: rest =>
      if name == target then some path
      else if visited.contains name then
        dependencyPath? environment target rest visited
      else
        let dependencies :=
          (environment.find? name).map declarationConstants |>.getD #[]
            |>.toList
        let next := dependencies.map fun dependency =>
          (dependency, path ++ [dependency])
        dependencyPath? environment target (rest ++ next)
          (visited.insert name)

def declarationModule? (environment : Environment) (name : Name) :
    Option Name := do
  let index ← environment.getModuleIdxFor? name
  let moduleData ← environment.header.modules[index]?
  return moduleData.module

def projectDeclaration (environment : Environment) (name : Name) : Bool :=
  match declarationModule? environment name with
  | none => false
  | some moduleName =>
      let text := moduleName.toString
      text == "LeanDocxChecker" ||
        text.startsWith "Tier2." ||
        text.startsWith "LeanSpike."

def executableProjectDeclaration
    (environment : Environment) (name : Name) : Bool :=
  projectDeclaration environment name &&
    match environment.find? name with
    | some (.defnInfo _) => true
    | _ => false

def projectExecutableClosure (environment : Environment)
    (roots : List Name) : List Name :=
  (dependencyClosure environment roots).toList
    |>.filter (executableProjectDeclaration environment)
    |>.mergeSort Name.quickLt

def projectClosure (environment : Environment)
    (roots : List Name) : List Name :=
  (dependencyClosure environment roots).toList
    |>.filter (projectDeclaration environment)
    |>.mergeSort Name.quickLt

def completeClosure (environment : Environment)
    (roots : List Name) : List Name :=
  (dependencyClosure environment roots).toList |>.mergeSort Name.quickLt

def startsWithNamespace (name namespacePrefix : Name) : Bool :=
  name.toString == namespacePrefix.toString ||
    name.toString.startsWith (namespacePrefix.toString ++ ".")

def requireNoNamespace (target : Name) (closure : List Name)
    (forbidden : List Name) : CommandElabM Unit := do
  if let some dependency := closure.find? fun name =>
      forbidden.any (startsWithNamespace name) then
    let environment ← getEnv
    let path := dependencyPath? environment dependency [(target, [target])]
    throwError "{target} reaches forbidden namespace declaration {dependency}; path={path}"

def requireExactClosure (environment : Environment) (target : Name)
    (allowedRoots : List Name) : CommandElabM Unit := do
  let observed := projectExecutableClosure environment [target]
  let expected := projectExecutableClosure environment allowedRoots
  let missing := expected.filter fun name => !observed.contains name
  let unexpected := observed.filter fun name => !expected.contains name
  unless missing.isEmpty && unexpected.isEmpty do
    throwError "{target} executable closure mismatch;\nmissing={missing}\nunexpected={unexpected}"

def closureMismatch (observed expected : List Name) : Bool :=
  expected.any fun name => !observed.contains name ||
    observed.any fun name => !expected.contains name

def requireAuditSelfTests (environment : Environment) (target : Name)
    (allowedRoots : List Name) : CommandElabM Unit := do
  let observed := projectExecutableClosure environment [target]
  let expected := projectExecutableClosure environment allowedRoots
  let some required := expected.head? |
    throwError "{target} has no executable dependency for missing-dependency self-test"
  unless closureMismatch observed (expected.erase required) do
    throwError "{target} missing-dependency self-test did not fail"
  let forbiddenExtra := `LeanSpike.compareDocumentXml
  unless closureMismatch (forbiddenExtra :: observed) expected do
    throwError "{target} forbidden-extra self-test did not fail"

def requireExactSignature (environment : Environment)
    (target signature : Name) : CommandElabM Unit := do
  let some targetInfo := environment.find? target |
    throwError "missing dependency-audit target {target}"
  let some signatureInfo := environment.find? signature |
    throwError "missing dependency-audit signature {signature}"
  let some signatureValue := signatureInfo.value? |
    throwError "signature declaration has no value {signature}"
  unless targetInfo.type == signatureValue do
    throwError "{target} does not have exact signature {signature}"

def typedPrefix : Name := `Tier2.CommentReferenceIntegrity.Typed

def nameFromSegments : List String → Name
  | [] => .anonymous
  | segment :: rest =>
      rest.foldl (fun name next => .str name next) (.str .anonymous segment)

def incompleteProofSplitters : List Name :=
  let privateModule :=
    nameFromSegments
      ["_private", "Tier2", "CommentReferenceIntegrity", "TypedSemantics"]
  let base := Name.num privateModule 0
  [1, 3, 5].map fun index =>
    ["Tier2", "CommentReferenceIntegrity", "Typed",
      "evaluateTypedCommentSideSpec", s!"match_{index}", "splitter"].foldl
        (fun name segment => .str name segment) base

def typedSideEvaluatorSplitters : List Name :=
  let privateModule :=
    nameFromSegments
      ["_private", "Tier2", "CommentReferenceIntegrity", "TypedSemantics"]
  let base := Name.num privateModule 0
  [1, 3, 5, 7].map fun index =>
    ["Tier2", "CommentReferenceIntegrity", "Typed",
      "evaluateTypedCommentSideSpec", s!"match_{index}", "splitter"].foldl
        (fun name segment => .str name segment) base

def protocolProjectionProofSplitter : Name :=
  let base := Name.num (nameFromSegments ["_private", "LeanDocxChecker"]) 0
  ["protocolV6JsonProjectionCheck", "match_1", "splitter"].foldl
    (fun name segment => .str name segment) base

def semanticPrivateName (segments : List String) : Name :=
  let base := Name.num
    (nameFromSegments
      ["_private", "Tier2", "CommentReferenceIntegrity", "Semantics"]) 0
  segments.foldl (fun name segment => .str name segment) base

def typedSemanticPrivateName (segments : List String) : Name :=
  let base := Name.num
    (nameFromSegments
      ["_private", "Tier2", "CommentReferenceIntegrity", "TypedSemantics"]) 0
  segments.foldl (fun name segment => .str name segment) base

def productionProofOnlyRoots : List Name := [
  semanticPrivateName
    ["Tier2", "CommentReferenceIntegrity", "scanCommentSourceEvent",
      "match_1", "splitter"],
  semanticPrivateName
    ["Tier2", "CommentReferenceIntegrity", "scanCommentSourceEvent",
      "match_3", "splitter"],
  semanticPrivateName
    ["Tier2", "CommentReferenceIntegrity", "canonicalCommentRealizationFailure",
      "match_1", "splitter"],
  semanticPrivateName
    ["Tier2", "CommentReferenceIntegrity", "evaluateCommentSideV6",
      "match_1", "splitter"],
  ``Tier2.CommentReferenceIntegrity.PassingCommentEvaluationShape,
  ``Tier2.CommentReferenceIntegrity.ParsedCommentEvidence.crossing,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.unsafeTarget.elim,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.unsafeTarget.noConfusion,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.invalidTargetMode.elim,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.invalidTargetMode.noConfusion,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.targetLimit.elim,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.targetLimit.noConfusion,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.ambiguous.elim,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.ambiguous.noConfusion,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.external.elim,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.external.noConfusion,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.ctorElim,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.ctorElimType,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.noConfusion,
  ``Tier2.CommentReferenceIntegrity.CommentSelectionFailure.noConfusionType
]

def semanticTargets : List (Name × Name × List Name) := [
  ( ``Tier2.CommentReferenceIntegrity.Typed.typed_comment_selector_result_sound
  , ``Tier2.CommentReferenceIntegrity.Typed.typedCommentSelectorResultSoundSignature
  , [ ``Tier2.CommentReferenceIntegrity.Typed.TypedCommentSelectionResultOf
    , ``Tier2.CommentReferenceIntegrity.Typed.selectTypedComment ])
,
  ( ``Tier2.CommentReferenceIntegrity.Typed.typed_comment_selection_to_realization_sound
  , ``Tier2.CommentReferenceIntegrity.Typed.typedCommentSelectionToRealizationSoundSignature
  , [ ``Tier2.CommentReferenceIntegrity.Typed.TypedSelectionToRealizationOf
    , ``Tier2.CommentReferenceIntegrity.Typed.evaluateTypedCommentSide
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
        "match_1_1"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
        "match_1_3"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_rejected_implies_true
        "match_1_1" ] ++
      typedSideEvaluatorSplitters)
,
  ( ``Tier2.CommentReferenceIntegrity.Typed.typed_admitted_comment_source_set_complete
  , ``Tier2.CommentReferenceIntegrity.Typed.typedAdmittedCommentSourceSetCompleteSignature
  , [ ``Tier2.CommentReferenceIntegrity.Typed.TypedCompleteSourceSetOf
    , ``Tier2.CommentReferenceIntegrity.Typed.evaluateTypedCommentSide
    , ``Tier2.CommentReferenceIntegrity.Typed.TypedSelectionToRealizationOf.casesOn
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
        "match_1_1"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
        "match_1_3"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_rejected_implies_true
        "match_1_1"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_and_eq_true_parts
        "match_1_1"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_and_eq_true_parts
        "match_1_3"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_and_eq_true_parts
        "match_1_5"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_and_eq_true_parts
        "match_1_7" ] ++
      typedSideEvaluatorSplitters)
,
  ( ``Tier2.CommentReferenceIntegrity.Typed.typed_parsed_comment_inventory_evidence_exact
  , ``Tier2.CommentReferenceIntegrity.Typed.typedParsedCommentInventoryEvidenceExactSignature
  , [ ``Tier2.CommentReferenceIntegrity.Typed.TypedParsedCommentEvidenceOf
    , ``Tier2.CommentReferenceIntegrity.Typed.scanTypedCommentEvidence ])
,
  ( ``Tier2.CommentReferenceIntegrity.Typed.typed_package_comment_reference_integrity_sound
  , ``Tier2.CommentReferenceIntegrity.Typed.typedPackageCommentReferenceIntegritySoundSignature
  , [ ``Tier2.CommentReferenceIntegrity.Typed.TypedPackageCommentIntegrity
    , ``Tier2.CommentReferenceIntegrity.Typed.checkTypedPackageCommentIntegrity ])
,
  ( ``Tier2.CommentReferenceIntegrity.Typed.typed_incomplete_comment_partition_zero_evidence_sound
  , ``Tier2.CommentReferenceIntegrity.Typed.typedIncompleteCommentPartitionZeroEvidenceSoundSignature
  , [ ``Tier2.CommentReferenceIntegrity.Typed.TypedIncompleteZeroOf
    , ``Tier2.CommentReferenceIntegrity.Typed.evaluateTypedCommentSide
    , ``Tier2.CommentReferenceIntegrity.Typed.TypedEvaluationStatus.casesOn
    , ``Tier2.CommentReferenceIntegrity.Typed.TypedEvaluationStatus.ctorIdx
    , ``Tier2.CommentReferenceIntegrity.Typed.TypedSelectionToRealizationOf.casesOn
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
        "match_1_1"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
        "match_1_3"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_rejected_implies_true
        "match_1_1" ] ++ typedSideEvaluatorSplitters)
,
  ( ``Tier2.CommentReferenceIntegrity.Typed.typed_comment_integrity_aggregate_pass_sound
  , ``Tier2.CommentReferenceIntegrity.Typed.typedCommentIntegrityAggregatePassSoundSignature
  , [ ``Tier2.CommentReferenceIntegrity.Typed.TypedCommentAggregatePassOf
    , ``Tier2.CommentReferenceIntegrity.Typed.TypedSerializedResponseV6Of
    , ``Tier2.CommentReferenceIntegrity.Typed.canonicalTypedResponseV6
    , ``Tier2.CommentReferenceIntegrity.Typed.independentProtocolV6Projection
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
        "match_1_1"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
        "match_1_3"
    , Name.str
        ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_rejected_implies_true
        "match_1_1"
    , typedSemanticPrivateName
        ["Tier2", "CommentReferenceIntegrity", "Typed",
          "evaluateTypedCommentSideSpec", "match_1", "splitter"]
    , typedSemanticPrivateName
        ["Tier2", "CommentReferenceIntegrity", "Typed",
          "evaluateTypedCommentSideSpec", "match_5", "splitter"]
    , typedSemanticPrivateName
        ["Tier2", "CommentReferenceIntegrity", "Typed",
          "evaluateTypedCommentSideSpec", "match_7", "splitter"]
    , typedSemanticPrivateName
        ["Tier2", "CommentReferenceIntegrity", "Typed",
          "canonicalTypedResponseV6Candidate", "match_1", "splitter"] ])
]

def bridgeTargets : List (Name × Name × List Name) := [
  ( ``executable_comment_selector_refines_typed
  , ``executableCommentSelectorRefinesTypedSignature
  , [ ``ExecutableSelectorRefinesTyped
    , ``executableSelectorRefinementCheck ])
,
  ( ``executable_comment_realization_refines_typed
  , ``executableCommentRealizationRefinesTypedSignature
  , [ ``ExecutableRealizationRefinesTyped
    , ``executableRealizationRefinementCheck
    , ``Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
    , ``Tier2.CommentReferenceIntegrity.evaluateCommentSideV6 ])
,
  ( ``executable_comment_source_set_refines_typed
  , ``executableCommentSourceSetRefinesTypedSignature
  , [ ``ExecutableSourceSetRefinesTyped
    , ``executableSourceSetRefinementCheck
    , ``Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
    , ``Tier2.CommentReferenceIntegrity.evaluateCommentSideV6 ])
,
  ( ``executable_comment_incomplete_refines_typed
  , ``executableCommentIncompleteRefinesTypedSignature
  , [ ``ExecutableIncompleteRefinesTyped
    , ``executableIncompleteRefinementCheck
    , ``Tier2.CommentReferenceIntegrity.evaluateCommentSideV6 ])
,
  ( ``executable_protocol_utf8_json_refines_typed
  , ``executableProtocolUtf8JsonRefinesTypedSignature
  , [ ``ProtocolV6JsonProjectionOf
    , ``protocolV6JsonProjectionCheck
    , protocolProjectionProofSplitter ])
]

def productionAllowedRoots : List Name := [
  ``Tier2.NoteReferenceIntegrity.runRequestCoreV6,
  ``runRequestCore,
  ``Tier2.NoteReferenceIntegrity.productionTypedCommentChecks,
  ``Tier2.NoteReferenceIntegrity.productionTypedCommentScanCheck,
  ``Tier2.NoteReferenceIntegrity.production_typed_comment_scan_check_sound,
  ``Tier2.NoteReferenceIntegrity.typedScanInputOfRecord,
  ``Tier2.NoteReferenceIntegrity.typedCommentScanOfProduction,
  ``Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord,
  ``Tier2.NoteReferenceIntegrity.typedRequestOfProduction,
  ``Tier2.NoteReferenceIntegrity.TypedRequestOfProduction,
  ``Tier2.NoteReferenceIntegrity.ProductionRunRequestV6RefinesSemanticOf,
  ``Tier2.NoteReferenceIntegrity.production_run_request_core_refinement_sound,
  ``Tier2.NoteReferenceIntegrity.semanticRequestOfCoreV6,
  ``Tier2.NoteReferenceIntegrity.protocolV6Projection,
  ``semanticProtocolV6Projection,
  ``SemanticProtocolV6ProjectionOf,
  ``FinalizedProtocolV6ResponseOf,
  ``Tier2.CommentReferenceIntegrity.evaluateAllCommentSidesV6,
  ``Tier2.CommentReferenceIntegrity.canonicalVerifierResponseV6,
  ``Tier2.CommentReferenceIntegrity.CommentAggregatePassOf,
  ``Tier2.CommentReferenceIntegrity.SelectionToCommentRealizationOf,
  ``Tier2.CommentReferenceIntegrity.ResponseRetainedCommentEvidenceOf,
  ``Tier2.CommentReferenceIntegrity.Typed.scanTypedCommentEvidence,
  ``Tier2.CommentReferenceIntegrity.Typed.TypedCommentAggregatePassOf,
  ``Tier2.CommentReferenceIntegrity.Typed.TypedSerializedResponseV6Of,
  ``Tier2.CommentReferenceIntegrity.Typed.canonicalTypedResponseV6,
  ``Tier2.CommentReferenceIntegrity.Typed.independentProtocolV6Projection,
  Name.str
    ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
    "match_1_1",
  Name.str
    ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_implies_false
    "match_1_3",
  Name.str
    ``Tier2.CommentReferenceIntegrity.Typed.bool_not_true_rejected_implies_true
    "match_1_1",
  typedSemanticPrivateName
    ["Tier2", "CommentReferenceIntegrity", "Typed",
      "evaluateTypedCommentSideSpec", "match_1", "splitter"],
  typedSemanticPrivateName
    ["Tier2", "CommentReferenceIntegrity", "Typed",
      "evaluateTypedCommentSideSpec", "match_5", "splitter"],
  typedSemanticPrivateName
    ["Tier2", "CommentReferenceIntegrity", "Typed",
      "evaluateTypedCommentSideSpec", "match_7", "splitter"],
  typedSemanticPrivateName
    ["Tier2", "CommentReferenceIntegrity", "Typed",
      "canonicalTypedResponseV6Candidate", "match_1", "splitter"],
  ``ProtocolV6JsonProjectionOf,
  ``protocolV6JsonProjectionCheck
] ++ productionProofOnlyRoots

run_cmd do
  let environment ← getEnv
  for (target, roots) in [
      ( ``Tier2.CommentReferenceIntegrity.Typed.typedByteArrayEqCheck_true_iff
      , [ ``Tier2.CommentReferenceIntegrity.Typed.typedByteArrayEqCheck
        , ``Tier2.CommentReferenceIntegrity.Typed.typedByteArrayEqCheck_sound
        , ``Tier2.CommentReferenceIntegrity.Typed.typedByteArrayEqCheck_refl ])
    , ( ``Tier2.CommentReferenceIntegrity.Typed.typedXmlEventListEqCheck_true_iff
      , [ ``Tier2.CommentReferenceIntegrity.Typed.typedXmlEventListEqCheck
        , ``Tier2.CommentReferenceIntegrity.Typed.typedXmlEventListEqCheck_sound
        , ``Tier2.CommentReferenceIntegrity.Typed.typedXmlEventListEqCheck_complete ])
    ] do
    requireNoNamespace target (completeClosure environment [target])
      [`String, `Lean.Json, `IO, `propext, `Quot.sound,
       `Classical.choice]
    requireExactClosure environment target roots
    requireAuditSelfTests environment target roots

  for (target, signature, roots) in semanticTargets do
    requireExactSignature environment target signature
    requireNoNamespace target (completeClosure environment [target])
      [`String, `Lean.Json, `IO, `propext, `Quot.sound,
       `Classical.choice]
    let closure := projectClosure environment [target]
    requireNoNamespace target closure
      [`LeanSpike, `Tier2.CommentReferenceIntegrity.Semantics,
       `LeanDocxChecker]
    requireExactClosure environment target roots
    requireAuditSelfTests environment target roots

  for (target, signature, roots) in bridgeTargets do
    requireExactSignature environment target signature
    requireNoNamespace target (projectClosure environment [target])
      [`LeanSpike]
    requireExactClosure environment target roots
    requireAuditSelfTests environment target roots

  let production :=
    ``Tier2.NoteReferenceIntegrity.production_run_request_core_v6_refinement_sound
  requireExactSignature environment production
    ``Tier2.NoteReferenceIntegrity.productionRunRequestCoreV6RefinementSignature
  requireNoNamespace production (projectClosure environment [production])
    [`LeanSpike]
  requireExactClosure environment production productionAllowedRoots
  requireAuditSelfTests environment production productionAllowedRoots

  for required in [
      ``Tier2.CommentReferenceIntegrity.Typed.evaluateTypedCommentSide,
      ``Tier2.CommentReferenceIntegrity.Typed.scanTypedCommentEvidence,
      ``Tier2.CommentReferenceIntegrity.Typed.independentProtocolV6Projection,
      ``Tier2.CommentReferenceIntegrity.Typed.typedBinaryIndexCheck,
      ``Tier2.CommentReferenceIntegrity.Typed.typedStructuralEocdCandidates,
      ``Tier2.CommentReferenceIntegrity.Typed.typedStructuralEocdAt?,
      ``Tier2.CommentReferenceIntegrity.Typed.typedEocdCandidateListBindsIndexCheck,
      ``Tier2.CommentReferenceIntegrity.Typed.typedSoleEocdBindsIndexCheck,
      ``Tier2.CommentReferenceIntegrity.Typed.typedCentralEntriesCheck,
      ``Tier2.CommentReferenceIntegrity.Typed.typedEntryLocalHeaderCheck,
      ``Tier2.CommentReferenceIntegrity.Typed.canonicalTypedCommentSources,
      ``Tier2.CommentReferenceIntegrity.Typed.typedHeaderFooterDerivationCheck,
      ``Tier2.NoteReferenceIntegrity.typedEntryOfProduction,
      ``Tier2.NoteReferenceIntegrity.typedIndexOfProduction,
      ``typedXmlEventOfProduction,
      ``Tier2.NoteReferenceIntegrity.typedScanInputOfRecord,
      ``Tier2.NoteReferenceIntegrity.productionTypedCommentScanCheck,
      ``semanticProtocolV6Projection,
      ``ProtocolV6JsonProjectionOf,
      ``FinalizedProtocolV6ResponseOf] do
    unless (projectExecutableClosure environment [production]).contains required do
      throwError "production closure omits required typed refinement constant {required}"

  logInfo "exact recursive byte-native comment dependency audit passed"

end CommentSemanticDependencyAudit

#print axioms Tier2.CommentReferenceIntegrity.Typed.typedByteArrayEqCheck_true_iff
#print axioms Tier2.CommentReferenceIntegrity.Typed.typedXmlEventListEqCheck_true_iff
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_comment_selector_result_sound
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_comment_selection_to_realization_sound
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_admitted_comment_source_set_complete
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_parsed_comment_inventory_evidence_exact
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_package_comment_reference_integrity_sound
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_incomplete_comment_partition_zero_evidence_sound
#print axioms Tier2.CommentReferenceIntegrity.Typed.typed_comment_integrity_aggregate_pass_sound
#print axioms executable_comment_selector_refines_typed
#print axioms executable_comment_realization_refines_typed
#print axioms executable_comment_source_set_refines_typed
#print axioms executable_comment_incomplete_refines_typed
#print axioms executable_protocol_utf8_json_refines_typed
#print axioms Tier2.NoteReferenceIntegrity.production_run_request_core_v6_refinement_sound
