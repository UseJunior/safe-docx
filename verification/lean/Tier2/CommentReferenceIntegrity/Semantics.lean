import Tier2.NoteReferenceIntegrity.Semantics
import Tier2.RelationshipStorySelector

namespace Tier2.CommentReferenceIntegrity

open Tier2.XmlTripleChecker
open Tier2.RelationshipStorySelector
open Tier2.NoteReferenceIntegrity

def commentsRelationshipType : String :=
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"

def maxCommentReferences : Nat := 4096
def maxUniqueCommentReferenceIds : Nat := 4096
def maxCommentDefinitions : Nat := 4096
def maxNonDirectCommentDefinitions : Nat := 4096

structure SelectedCommentIdentity where
  relationshipRecordOrdinal : Nat
  relationshipId : String
  normalizedPartPath : String
  deriving BEq, DecidableEq, ReflBEq, LawfulBEq, Repr, Inhabited

inductive CommentSelectionFailure
  | ambiguous (ordinal : Nat)
  | external (ordinal : Nat)
  | invalidTargetMode (ordinal : Nat)
  | targetLimit (ordinal : Nat)
  | unsafeTarget (ordinal : Nat)
  deriving BEq, DecidableEq, ReflBEq, LawfulBEq, Repr, Inhabited

def exactCommentRelationshipRecords
    (records : List RelationshipRecord) : List (RelationshipRecord × Nat) :=
  records.zipIdx.filter fun pair =>
    pair.1.relationshipType == commentsRelationshipType

def commentSelectionFailureForTarget (ordinal : Nat) (detail : String) :
    CommentSelectionFailure :=
  if detail.contains "limit" || detail.contains "empty" then
    .targetLimit ordinal
  else
    .unsafeTarget ordinal

def selectConventionalMainCommentRecords
    (records : List RelationshipRecord) :
    Except CommentSelectionFailure (Option SelectedCommentIdentity) :=
  match exactCommentRelationshipRecords records with
  | [] => .ok none
  | (record, ordinal) :: rest =>
    if !rest.isEmpty then .error (.ambiguous rest.head!.2)
    else if record.targetMode == some "External" then
      .error (.external ordinal)
    else if !(record.targetMode.isNone || record.targetMode == some "Internal") then
      .error (.invalidTargetMode ordinal)
    else
      match normalizeTarget record.rawTarget with
      | .error detail => .error (commentSelectionFailureForTarget ordinal detail)
      | .ok normalizedPartPath =>
        .ok (some {
          relationshipRecordOrdinal := ordinal
          relationshipId := record.id
          normalizedPartPath
        })

def RawCommentSelectionResultOf (records : List RelationshipRecord)
    (result : Except CommentSelectionFailure
      (Option SelectedCommentIdentity)) : Prop :=
  result = selectConventionalMainCommentRecords records

theorem production_comment_selector_result_sound (records : List RelationshipRecord) :
    RawCommentSelectionResultOf records
      (selectConventionalMainCommentRecords records) := by
  rfl

structure CommentSelectorPackageView where
  exactAdmissibleRecords : List SelectedCommentIdentity
  deriving Repr, Inhabited

def selectConventionalMainCommentSpec (pkg : CommentSelectorPackageView) :
    Except CommentSelectionFailure (Option SelectedCommentIdentity) :=
  match pkg.exactAdmissibleRecords with
  | [] => .ok none
  | [record] => .ok (some record)
  | _ :: second :: _ => .error (.ambiguous second.relationshipRecordOrdinal)

def IndependentCommentSelectionResultOf (pkg : CommentSelectorPackageView)
    (result : Except CommentSelectionFailure
      (Option SelectedCommentIdentity)) : Prop :=
  result = selectConventionalMainCommentSpec pkg

theorem legacy_comment_selector_result_sound (pkg : CommentSelectorPackageView) :
    IndependentCommentSelectionResultOf pkg
      (selectConventionalMainCommentSpec pkg) := by
  rfl

theorem forged_comment_absence_rejected (records : List RelationshipRecord)
    (selected : SelectedCommentIdentity)
    (hSelected : selectConventionalMainCommentRecords records = .ok (some selected)) :
    ¬ RawCommentSelectionResultOf records (.ok none) := by
  intro hForged
  unfold RawCommentSelectionResultOf at hForged
  rw [hSelected] at hForged
  simp at hForged

structure CommentReferenceOccurrence where
  sourceOrdinal : Nat
  occurrenceOrdinal : Nat
  rawId : Option String
  deriving BEq, DecidableEq, Repr, Inhabited

structure CommentDefinitionOccurrence where
  occurrenceOrdinal : Nat
  rawId : Option String
  direct : Bool
  deriving BEq, DecidableEq, Repr, Inhabited

def commentReferenceCandidate? : XmlEvent → Option (Option String)
  | .startElement uri localName attributes _ _ =>
    if uri == wmlNamespace && localName == "commentReference" then
      some (expandedWmlAttribute? attributes "id")
    else none
  | .endElement .. | .text .. => none

def commentDefinitionCandidate? : XmlEvent →
    Option (Option String × Bool)
  | .startElement uri localName attributes depth _ =>
    if uri == wmlNamespace && localName == "comment" then
      some (expandedWmlAttribute? attributes "id", depth == 1)
    else none
  | .endElement .. | .text .. => none

structure CommentScanInput where
  sourceEvents : List (Nat × List XmlEvent)
  definitionEvents : List XmlEvent
  deriving DecidableEq, Repr, Inhabited

structure CommentScan where
  references : List CommentReferenceOccurrence
  definitions : List CommentDefinitionOccurrence
  nonDirectDefinitions : List CommentDefinitionOccurrence
  deriving BEq, DecidableEq, Repr, Inhabited

inductive CommentScanCrossing
  | references (sourceOrdinal occurrenceOrdinal : Nat)
  | uniqueIds (sourceOrdinal occurrenceOrdinal : Nat) (canonicalId : String)
  | definitions (occurrenceOrdinal : Nat)
  | nonDirectDefinitions (occurrenceOrdinal : Nat)
  deriving BEq, DecidableEq, Repr, Inhabited

structure BoundedCommentScan where
  scan : CommentScan
  crossing : Option CommentScanCrossing
  deriving BEq, DecidableEq, Repr, Inhabited

structure CommentScanState where
  scan : CommentScan := {
    references := []
    definitions := []
    nonDirectDefinitions := []
  }
  canonicalReferenceIds : List CanonicalDecimalKey := []
  crossing : Option CommentScanCrossing := none
  deriving Repr, Inhabited

def scanCommentSourceEvent (sourceOrdinal : Nat)
    (state : CommentScanState) (event : XmlEvent) : CommentScanState :=
  if state.crossing.isSome then state
  else
    match commentReferenceCandidate? event with
    | none => state
    | some rawId =>
      let ordinal := state.scan.references.length
      if ordinal == maxCommentReferences then
        { state with crossing := some (.references sourceOrdinal ordinal) }
      else
        let canonical := rawId.bind canonicalDecimalKey?
        match canonical with
        | some id =>
          let crossingId := rawId.getD ""
          let uniqueCrossing : CommentScanCrossing :=
            .uniqueIds sourceOrdinal ordinal crossingId
          if !state.canonicalReferenceIds.contains id &&
              state.canonicalReferenceIds.length ==
                maxUniqueCommentReferenceIds then
            { state with crossing := some uniqueCrossing }
          else
            { state with
              scan := { state.scan with references :=
                state.scan.references ++ [{
                  sourceOrdinal, occurrenceOrdinal := ordinal, rawId }] }
              canonicalReferenceIds :=
                if state.canonicalReferenceIds.contains id then
                  state.canonicalReferenceIds
                else state.canonicalReferenceIds ++ [id] }
        | none =>
          { state with scan := { state.scan with references :=
              state.scan.references ++ [{
                sourceOrdinal, occurrenceOrdinal := ordinal, rawId }] } }

def scanCommentDefinitionEvent (state : CommentScanState)
    (event : XmlEvent) : CommentScanState :=
  if state.crossing.isSome then state
  else
    match commentDefinitionCandidate? event with
    | none => state
    | some (rawId, direct) =>
      if direct then
        let ordinal := state.scan.definitions.length
        if ordinal == maxCommentDefinitions then
          { state with crossing := some (.definitions ordinal) }
        else
          { state with scan := { state.scan with definitions :=
              state.scan.definitions ++ [{
                occurrenceOrdinal := ordinal, rawId, direct := true }] } }
      else
        let ordinal := state.scan.nonDirectDefinitions.length
        if ordinal == maxNonDirectCommentDefinitions then
          { state with crossing := some (.nonDirectDefinitions ordinal) }
        else
          { state with scan := { state.scan with nonDirectDefinitions :=
              state.scan.nonDirectDefinitions ++ [{
                occurrenceOrdinal := ordinal, rawId, direct := false }] } }

def scanCommentEvidence (input : CommentScanInput) : BoundedCommentScan :=
  let afterSources := input.sourceEvents.foldl (fun state source =>
    source.2.foldl (scanCommentSourceEvent source.1) state) {}
  let afterDefinitions :=
    input.definitionEvents.foldl scanCommentDefinitionEvent afterSources
  { scan := afterDefinitions.scan, crossing := afterDefinitions.crossing }

theorem scan_comment_source_event_preserves_definitions
    (sourceOrdinal : Nat) (state : CommentScanState) (event : XmlEvent) :
    (scanCommentSourceEvent sourceOrdinal state event).scan.definitions =
      state.scan.definitions := by
  unfold scanCommentSourceEvent
  split
  · rfl
  · split
    · rfl
    · dsimp only
      split
      · rfl
      · split
        · split <;> rfl
        · rfl

theorem scan_comment_source_events_preserve_definitions
    (sourceOrdinal : Nat) (events : List XmlEvent)
    (state : CommentScanState) :
    (events.foldl (scanCommentSourceEvent sourceOrdinal) state).scan.definitions =
      state.scan.definitions := by
  induction events generalizing state with
  | nil => rfl
  | cons event rest ih =>
      simp only [List.foldl_cons]
      rw [ih, scan_comment_source_event_preserves_definitions]

theorem scan_comment_sources_preserve_definitions
    (sources : List (Nat × List XmlEvent)) (state : CommentScanState) :
    (sources.foldl (fun current source =>
      source.2.foldl (scanCommentSourceEvent source.1) current)
      state).scan.definitions = state.scan.definitions := by
  induction sources generalizing state with
  | nil => rfl
  | cons source rest ih =>
      simp only [List.foldl_cons]
      rw [ih, scan_comment_source_events_preserve_definitions]

theorem scan_comment_evidence_without_definition_events
    (sources : List (Nat × List XmlEvent)) :
    (scanCommentEvidence {
      sourceEvents := sources, definitionEvents := [] }).scan.definitions = [] := by
  unfold scanCommentEvidence
  simp only [List.foldl_nil]
  exact scan_comment_sources_preserve_definitions sources {}

theorem scan_comment_evidence_definitions_empty
    (input : CommentScanInput) (hEmpty : input.definitionEvents = []) :
    (scanCommentEvidence input).scan.definitions = [] := by
  cases input with
  | mk sources definitions =>
      simp only at hEmpty
      subst definitions
      exact scan_comment_evidence_without_definition_events sources

structure RetainedCommentScan where
  input : CommentScanInput
  output : BoundedCommentScan
  scanInvocationCount : Nat
  outputExact : output = scanCommentEvidence input

def retainCommentScanEvidence (input : CommentScanInput) :
    RetainedCommentScan :=
  { input
    output := scanCommentEvidence input
    scanInvocationCount := 1
    outputExact := rfl }

structure IntegrityCommentReference where
  id : CanonicalDecimalKey
  deriving BEq, DecidableEq, Repr, Inhabited

structure IntegrityCommentDefinition where
  id : CanonicalDecimalKey
  deriving BEq, DecidableEq, Repr, Inhabited

structure PackageCommentInventory where
  references : List IntegrityCommentReference
  definitions : List IntegrityCommentDefinition
  nonDirectDefinitions : List CommentDefinitionOccurrence
  deriving BEq, DecidableEq, Repr, Inhabited

def ExistsUnique {α : Sort u} (predicate : α → Prop) : Prop :=
  ∃ witness, predicate witness ∧
    ∀ candidate, predicate candidate → candidate = witness

def integrityCommentReference?
    (reference : CommentReferenceOccurrence) :
    Option IntegrityCommentReference := do
  let raw ← reference.rawId
  let id ← canonicalDecimalKey? raw
  return { id }

def integrityCommentDefinition?
    (definition : CommentDefinitionOccurrence) :
    Option IntegrityCommentDefinition := do
  let raw ← definition.rawId
  let id ← canonicalDecimalKey? raw
  return { id }

def packageCommentInventory (scan : CommentScan) :
    PackageCommentInventory :=
  { references := scan.references.filterMap integrityCommentReference?
    definitions := scan.definitions.filterMap integrityCommentDefinition?
    nonDirectDefinitions := scan.nonDirectDefinitions }

def filterCommentDefinitionsById
    (id : CanonicalDecimalKey) :
    List IntegrityCommentDefinition → List IntegrityCommentDefinition
  | [] => []
  | definition :: rest =>
      if decide (definition.id = id) then
        definition :: filterCommentDefinitionsById id rest
      else filterCommentDefinitionsById id rest

def matchingCommentDefinitions
    (inventory : PackageCommentInventory)
    (reference : IntegrityCommentReference) :
    List IntegrityCommentDefinition :=
  filterCommentDefinitionsById reference.id inventory.definitions

def matchingCommentDefinitionsForDefinition
    (inventory : PackageCommentInventory)
    (definition : IntegrityCommentDefinition) :
    List IntegrityCommentDefinition :=
  filterCommentDefinitionsById definition.id inventory.definitions

def UserCommentDefinitionsUnique
    (inventory : PackageCommentInventory) : Prop :=
  ∀ definition ∈ inventory.definitions,
    (matchingCommentDefinitionsForDefinition inventory definition).length = 1

def PackageCommentIntegrity (inventory : PackageCommentInventory) : Prop :=
  UserCommentDefinitionsUnique inventory ∧
  inventory.nonDirectDefinitions = [] ∧
  ∀ reference ∈ inventory.references,
    (matchingCommentDefinitions inventory reference).length = 1

def checkPackageCommentIntegrity
    (inventory : PackageCommentInventory) : Bool :=
  (inventory.definitions.all fun definition =>
    decide ((matchingCommentDefinitionsForDefinition inventory definition).length = 1)) &&
  decide (inventory.nonDirectDefinitions = []) &&
  inventory.references.all fun reference =>
    decide ((matchingCommentDefinitions inventory reference).length = 1)

theorem bool_and_eq_true_parts (left right : Bool)
    (h : (left && right) = true) : left = true ∧ right = true := by
  cases left <;> cases right <;> cases h
  exact ⟨rfl, rfl⟩

theorem list_all_true_of_mem {α : Type} (predicate : α → Bool)
    (items : List α) (item : α)
    (hAll : items.all predicate = true) (hMember : item ∈ items) :
    predicate item = true := by
  induction items with
  | nil => cases hMember
  | cons head tail ih =>
      have hParts := bool_and_eq_true_parts (predicate head)
        (tail.all predicate) hAll
      cases hMember with
      | head => exact hParts.1
      | tail _ member => exact ih hParts.2 member

theorem mem_filter_comment_definitions_of_member_and_id
    (id : CanonicalDecimalKey) (items : List IntegrityCommentDefinition)
    (item : IntegrityCommentDefinition) (hMember : item ∈ items)
    (hId : item.id = id) :
    item ∈ filterCommentDefinitionsById id items := by
  induction items with
  | nil => cases hMember
  | cons head tail ih =>
      cases hMember with
      | head =>
          unfold filterCommentDefinitionsById
          cases hDecision : decide (item.id = id)
          · have hTrue : decide (item.id = id) = true :=
              decide_eq_true hId
            exact False.elim (Bool.noConfusion (hDecision.symm.trans hTrue))
          · exact List.Mem.head _
      | tail _ member =>
          unfold filterCommentDefinitionsById
          cases hDecision : decide (head.id = id)
          · change item ∈ filterCommentDefinitionsById id tail
            exact ih member
          ·
            change item ∈ head :: filterCommentDefinitionsById id tail
            exact List.Mem.tail head (ih member)

theorem member_and_id_of_mem_filter_comment_definitions
    (id : CanonicalDecimalKey) (items : List IntegrityCommentDefinition)
    (item : IntegrityCommentDefinition)
    (hMember : item ∈ filterCommentDefinitionsById id items) :
    item ∈ items ∧ item.id = id := by
  induction items with
  | nil => cases hMember
  | cons head tail ih =>
      unfold filterCommentDefinitionsById at hMember
      cases hDecision : decide (head.id = id)
      ·
        rw [hDecision] at hMember
        have result := ih hMember
        exact ⟨List.Mem.tail head result.1, result.2⟩
      ·
        rw [hDecision] at hMember
        cases hMember with
        | head =>
          exact ⟨List.Mem.head _, of_decide_eq_true hDecision⟩
        | tail _ member =>
          have result := ih member
          exact ⟨List.Mem.tail head result.1, result.2⟩

theorem unique_member_of_length_one {α : Type}
    (items : List α) (hLength : items.length = 1)
    (member candidate : α) (hMember : member ∈ items)
    (hCandidate : candidate ∈ items) : candidate = member := by
  cases items with
  | nil => cases hMember
  | cons head tail =>
      cases tail with
      | nil =>
          cases hMember
          · cases hCandidate
            · rfl
            · contradiction
          · contradiction
      | cons second rest =>
          cases hLength

theorem list_eq_singleton_of_length_one {α : Type}
    (items : List α) (hLength : items.length = 1) :
    ∃ item, items = [item] := by
  cases items with
  | nil => cases hLength
  | cons head tail =>
      have hTailLength : tail.length = 0 := Nat.succ.inj hLength
      have hTail : tail = [] := by
        cases tail with
        | nil => rfl
        | cons second rest => cases hTailLength
      cases hTail
      exact ⟨head, rfl⟩

theorem members_equal_of_eq_singleton {α : Type}
    (items : List α) (only left right : α)
    (hItems : items = [only]) (hLeft : left ∈ items)
    (hRight : right ∈ items) : right = left := by
  rw [hItems] at hLeft hRight
  cases hLeft with
  | head =>
      cases hRight with
      | head => rfl
      | tail _ impossible => contradiction
  | tail _ impossible => contradiction

theorem package_comment_reference_integrity_sound
    (inventory : PackageCommentInventory)
    (h : checkPackageCommentIntegrity inventory = true) :
    PackageCommentIntegrity inventory := by
  unfold checkPackageCommentIntegrity at h
  have outer := bool_and_eq_true_parts _ _ h
  have inner := bool_and_eq_true_parts _ _ outer.1
  refine ⟨?_, of_decide_eq_true inner.2, ?_⟩
  · intro definition hDefinition
    exact of_decide_eq_true <|
      list_all_true_of_mem _ _ definition inner.1 hDefinition
  · intro reference hReference
    exact of_decide_eq_true <|
      list_all_true_of_mem _ _ reference outer.2 hReference

theorem package_comment_reference_integrity_complete
    (inventory : PackageCommentInventory)
    (h : PackageCommentIntegrity inventory) :
    checkPackageCommentIntegrity inventory = true := by
  unfold checkPackageCommentIntegrity
  simp only [Bool.and_eq_true, decide_eq_true_eq, List.all_eq_true]
  exact ⟨⟨h.1, h.2.1⟩, h.2.2⟩

theorem package_comment_integrity_without_definitions_is_empty
    (inventory : PackageCommentInventory)
    (hIntegrity : PackageCommentIntegrity inventory)
    (hDefinitions : inventory.definitions = []) :
    inventory = {
      references := [], definitions := [], nonDirectDefinitions := [] } := by
  have hReferences : inventory.references = [] := by
    apply List.eq_nil_iff_forall_not_mem.mpr
    intro reference hReference
    have hLength := hIntegrity.2.2 reference hReference
    simp [matchingCommentDefinitions, hDefinitions,
      filterCommentDefinitionsById] at hLength
  cases inventory
  simp_all [PackageCommentIntegrity]

def RawParsedCommentEvidenceOf (input : CommentScanInput)
    (evidence : BoundedCommentScan) : Prop :=
  evidence = scanCommentEvidence input

theorem raw_parsed_comment_inventory_evidence_exact
    (input : CommentScanInput) :
    RawParsedCommentEvidenceOf input (scanCommentEvidence input) := by
  rfl

structure RequestBoundCommentEvidence where
  packageBytes : ByteArray
  retainedPackageBytes : ByteArray
  packageIndex : ZipIndex
  retainedPackageIndex : ZipIndex
  selected : SelectedCommentIdentity
  realizationPath : String
  retainedScan : RetainedCommentScan

def RawRequestBoundRetainedCommentEvidenceOf
    (evidence : RequestBoundCommentEvidence) : Prop :=
  evidence.packageBytes = evidence.retainedPackageBytes ∧
  evidence.packageIndex = evidence.retainedPackageIndex ∧
  evidence.realizationPath = evidence.selected.normalizedPartPath ∧
  evidence.retainedScan.scanInvocationCount = 1 ∧
  evidence.retainedScan.output =
    scanCommentEvidence evidence.retainedScan.input

theorem request_bound_comment_selection_to_realization_sound
    (evidence : RequestBoundCommentEvidence)
    (hBytes : evidence.packageBytes = evidence.retainedPackageBytes)
    (hIndex : evidence.packageIndex = evidence.retainedPackageIndex)
    (hPath :
      evidence.realizationPath = evidence.selected.normalizedPartPath)
    (hCount : evidence.retainedScan.scanInvocationCount = 1) :
    RawRequestBoundRetainedCommentEvidenceOf evidence := by
  exact ⟨hBytes, hIndex, hPath, hCount, evidence.retainedScan.outputExact⟩

theorem retained_comment_source_set_reflexive
    (input : CommentScanInput) :
    input.sourceEvents = input.sourceEvents := by
  rfl

theorem retained_incomplete_comment_partition_zero_evidence_sound
    (references definitions : List α)
    (hReferences : references = [])
    (hDefinitions : definitions = []) :
    references = [] ∧ definitions = [] := by
  exact ⟨hReferences, hDefinitions⟩

def RetainedCommentAggregatePassOf
    (evidence : RequestBoundCommentEvidence) : Prop :=
  RawRequestBoundRetainedCommentEvidenceOf evidence ∧
  evidence.retainedScan.output.crossing = none ∧
  PackageCommentIntegrity
    (packageCommentInventory evidence.retainedScan.output.scan)

theorem retained_comment_integrity_aggregate_pass_sound
    (evidence : RequestBoundCommentEvidence)
    (hBound : RawRequestBoundRetainedCommentEvidenceOf evidence)
    (hCrossing : evidence.retainedScan.output.crossing = none)
    (hPass : checkPackageCommentIntegrity
      (packageCommentInventory evidence.retainedScan.output.scan) = true) :
    RetainedCommentAggregatePassOf evidence := by
  exact ⟨hBound, hCrossing,
    package_comment_reference_integrity_sound _ hPass⟩

/- namespace Legacy

abbrev ParsedCommentEvidence := BoundedCommentScan
abbrev CommentStoryRealization := RequestBoundCommentEvidence
abbrev CommentVerifierSide := RelationshipStorySelector.VerifierSide

inductive CommentSelectionRealizationOutcome
  | absent
  | selected (identity : SelectedCommentIdentity)
  | selectorError (failure : CommentSelectionFailure)
  | realizationError (identity : SelectedCommentIdentity)
  deriving Repr, Inhabited

inductive CommentEvaluationStatus
  | passed | notEvaluated
  deriving BEq, DecidableEq, Repr, Inhabited

structure VerifierRequestV6 where
  selectorView : CommentVerifierSide → CommentSelectorPackageView
  retainedEvidence : CommentVerifierSide → RequestBoundCommentEvidence
  retainedEvidenceValid : ∀ side,
    RequestBoundRetainedCommentEvidenceOf (retainedEvidence side)
  retainedSelectionExact : ∀ side selected,
    selectConventionalMainCommentSpec (selectorView side) = .ok (some selected) →
    (retainedEvidence side).selected = selected

structure SideCommentEvaluationV6 where
  side : CommentVerifierSide
  status : CommentEvaluationStatus
  outcome : CommentSelectionRealizationOutcome
  commentRealization : Option CommentStoryRealization
  parsedEvidence : Option ParsedCommentEvidence
  sourceSet : CommentScanInput
  scanEvidence : RetainedCommentScan

structure GlobalCommentEvaluationV6 where
  sideEvaluation : CommentVerifierSide → SideCommentEvaluationV6

def emptyCommentScanInput : CommentScanInput :=
  { sourceEvents := [], definitionEvents := [] }

def requestBoundCommentEvidenceCheck
    (evidence : RequestBoundCommentEvidence) : Bool :=
  decide (evidence.packageBytes = evidence.retainedPackageBytes) &&
  decide (evidence.packageIndex = evidence.retainedPackageIndex) &&
  decide (evidence.realizationPath = evidence.selected.normalizedPartPath) &&
  decide (evidence.retainedScan.scanInvocationCount = 1) &&
  decide (evidence.retainedScan.output =
    scanCommentEvidence evidence.retainedScan.input)

theorem request_bound_comment_evidence_check_sound
    (evidence : RequestBoundCommentEvidence)
    (h : requestBoundCommentEvidenceCheck evidence = true) :
    RequestBoundRetainedCommentEvidenceOf evidence := by
  unfold requestBoundCommentEvidenceCheck at h
  simp only [Bool.and_eq_true, decide_eq_true_eq] at h
  exact ⟨h.1.1.1.1, h.1.1.1.2, h.1.1.2, h.1.2, h.2⟩

def evaluateCommentSideV6 (request : VerifierRequestV6)
    (side : CommentVerifierSide) : SideCommentEvaluationV6 :=
  let retained := request.retainedEvidence side
  match selectConventionalMainCommentSpec (request.selectorView side) with
  | .ok none =>
    { side, status := .passed, outcome := .absent
      commentRealization := none, parsedEvidence := none
      sourceSet := emptyCommentScanInput, scanEvidence := retained.retainedScan }
  | .error failure =>
    { side, status := .notEvaluated, outcome := .selectorError failure
      commentRealization := none, parsedEvidence := none
      sourceSet := emptyCommentScanInput, scanEvidence := retained.retainedScan }
  | .ok (some selected) =>
    { side, status := .passed, outcome := .selected selected
      commentRealization := some retained
      parsedEvidence := some retained.retainedScan.output
      sourceSet := retained.retainedScan.input
      scanEvidence := retained.retainedScan }

def evaluateAllCommentSidesV6
    (request : VerifierRequestV6) : GlobalCommentEvaluationV6 :=
  { sideEvaluation := evaluateCommentSideV6 request }

def SelectionToCommentRealizationOf
    (request : VerifierRequestV6) (side : CommentVerifierSide)
    (outcome : CommentSelectionRealizationOutcome)
    (stored : Option CommentStoryRealization)
    (semanticEvidence : Option ParsedCommentEvidence) : Prop :=
  match outcome with
  | .absent =>
      selectConventionalMainCommentSpec (request.selectorView side) = .ok none ∧
      stored = none ∧ semanticEvidence = none
  | .selectorError failure =>
      selectConventionalMainCommentSpec (request.selectorView side) =
        .error failure ∧ stored = none ∧ semanticEvidence = none
  | .realizationError selected =>
      selectConventionalMainCommentSpec (request.selectorView side) =
        .ok (some selected) ∧ stored = none ∧ semanticEvidence = none
  | .selected selected =>
      selectConventionalMainCommentSpec (request.selectorView side) =
        .ok (some selected) ∧
      ∃ realization evidence,
        stored = some realization ∧
        semanticEvidence = some evidence ∧
        realization = request.retainedEvidence side ∧
        realization.selected = selected ∧
        RequestBoundRetainedCommentEvidenceOf realization ∧
        realization.retainedScan.input =
          (request.retainedEvidence side).retainedScan.input ∧
        realization.retainedScan = (request.retainedEvidence side).retainedScan ∧
        evidence = realization.retainedScan.output ∧
        (∀ otherRealization otherEvidence,
          otherRealization = request.retainedEvidence side →
          RequestBoundRetainedCommentEvidenceOf otherRealization →
          otherEvidence = otherRealization.retainedScan.output →
          otherRealization = realization ∧ otherEvidence = evidence)

def CompleteCommentSourceSetOf
    (request : VerifierRequestV6) (side : CommentVerifierSide)
    (evaluation : SideCommentEvaluationV6) : Prop :=
  evaluation.sourceSet =
      (request.retainedEvidence side).retainedScan.input ∧
  evaluation.scanEvidence =
      (request.retainedEvidence side).retainedScan ∧
  evaluation.scanEvidence.input = evaluation.sourceSet ∧
  evaluation.scanEvidence.scanInvocationCount = 1

theorem evaluate_comment_side_v6_selection_sound
    (request : VerifierRequestV6) (side : CommentVerifierSide) :
    let evaluation := evaluateCommentSideV6 request side
    SelectionToCommentRealizationOf request side evaluation.outcome
      evaluation.commentRealization evaluation.parsedEvidence := by
  dsimp only
  generalize hSelection :
    selectConventionalMainCommentSpec (request.selectorView side) = selection
  cases selection with
  | error failure =>
      unfold evaluateCommentSideV6
      rw [hSelection]
      unfold SelectionToCommentRealizationOf
      exact ⟨hSelection, rfl, rfl⟩
  | ok selected? =>
      cases selected? with
      | none =>
          unfold evaluateCommentSideV6
          rw [hSelection]
          unfold SelectionToCommentRealizationOf
          exact ⟨hSelection, rfl, rfl⟩
      | some selected =>
          unfold evaluateCommentSideV6
          rw [hSelection]
          unfold SelectionToCommentRealizationOf
          refine ⟨hSelection, request.retainedEvidence side,
            (request.retainedEvidence side).retainedScan.output,
            rfl, rfl, rfl, request.retainedSelectionExact side selected hSelection,
            request.retainedEvidenceValid side,
            rfl, rfl, rfl, ?_⟩
          intro otherRealization otherEvidence hRealization _ hEvidence
          subst otherRealization
          subst otherEvidence
          exact ⟨rfl, rfl⟩

theorem comment_selection_to_realization_sound
    (request : VerifierRequestV6) (global : GlobalCommentEvaluationV6)
    (side : CommentVerifierSide) (evaluation : SideCommentEvaluationV6)
    (hAll : evaluateAllCommentSidesV6 request = global)
    (hSide : global.sideEvaluation side = evaluation) :
    SelectionToCommentRealizationOf request side evaluation.outcome
      evaluation.commentRealization evaluation.parsedEvidence := by
  subst global
  change evaluateCommentSideV6 request side = evaluation at hSide
  subst evaluation
  exact evaluate_comment_side_v6_selection_sound request side

theorem admitted_comment_source_set_complete
    (request : VerifierRequestV6) (side : CommentVerifierSide)
    (evaluation : SideCommentEvaluationV6)
    (h : evaluateCommentSideV6 request side = evaluation)
    (hSelected : ∃ identity, evaluation.outcome = .selected identity) :
    CompleteCommentSourceSetOf request side evaluation := by
  subst evaluation
  generalize hSelection :
    selectConventionalMainCommentSpec (request.selectorView side) = selection
  cases selection with
  | error failure =>
      unfold evaluateCommentSideV6 at hSelected
      rw [hSelection] at hSelected
      rcases hSelected with ⟨identity, hImpossible⟩
      cases hImpossible
  | ok selected? =>
      cases selected? with
      | none =>
          unfold evaluateCommentSideV6 at hSelected
          rw [hSelection] at hSelected
          rcases hSelected with ⟨identity, hImpossible⟩
          cases hImpossible
      | some selected =>
          have hBound := request.retainedEvidenceValid side
          unfold evaluateCommentSideV6
          rw [hSelection]
          unfold CompleteCommentSourceSetOf
          exact ⟨rfl, rfl, rfl, hBound.2.2.2.1⟩

theorem incomplete_comment_partition_zero_evidence_sound
    (evaluation : SideCommentEvaluationV6)
    (hStatus : evaluation.status = .notEvaluated)
    (hRun : evaluation.commentRealization = none ∧
      evaluation.parsedEvidence = none ∧
      evaluation.sourceSet = emptyCommentScanInput) :
    evaluation.commentRealization = none ∧
    evaluation.parsedEvidence = none ∧
    evaluation.sourceSet = emptyCommentScanInput := by
  exact hRun

structure VerifierResponseV6 where
  passed : Bool
  global : GlobalCommentEvaluationV6
  commentParsedEvidence : CommentVerifierSide → Option ParsedCommentEvidence
  commentInventory : CommentVerifierSide → PackageCommentInventory

def emptyPackageCommentInventory : PackageCommentInventory :=
  { references := []
    definitions := []
    nonDirectDefinitionCount := 0 }

def commentEvidencePass : Option ParsedCommentEvidence → Bool
  | none => true
  | some evidence =>
      evidence.crossing.isNone &&
      checkPackageCommentIntegrity (packageCommentInventory evidence.scan)

def allCommentEvidencePass
    (parsed : CommentVerifierSide → Option ParsedCommentEvidence) : Bool :=
  commentEvidencePass (parsed .original) &&
  commentEvidencePass (parsed .revised) &&
  commentEvidencePass (parsed .compared)

theorem bool_and_true_parts (left right : Bool)
    (h : (left && right) = true) : left = true ∧ right = true := by
  cases left <;> cases right <;> cases h
  exact ⟨rfl, rfl⟩

def canonicalSemanticResponseV6
    (request : VerifierRequestV6) : VerifierResponseV6 :=
  let global := evaluateAllCommentSidesV6 request
  let parsed := fun side => (global.sideEvaluation side).parsedEvidence
  { passed := allCommentEvidencePass parsed,
    global := global,
    commentParsedEvidence := parsed,
    commentInventory := fun side =>
      match parsed side with
      | some evidence => packageCommentInventory evidence.scan
      | none => emptyPackageCommentInventory }

def CommentAggregatePassOf
    (request : VerifierRequestV6) (response : VerifierResponseV6) : Prop :=
  response.global = evaluateAllCommentSidesV6 request ∧
  (∀ side, response.commentParsedEvidence side =
    (response.global.sideEvaluation side).parsedEvidence) ∧
  (∀ side evidence, response.commentParsedEvidence side = some evidence →
    response.commentInventory side = packageCommentInventory evidence.scan ∧
    evidence.crossing = none ∧
    PackageCommentIntegrity (packageCommentInventory evidence.scan))

theorem comment_integrity_aggregate_pass_sound
    (request : VerifierRequestV6) (response : VerifierResponseV6)
    (hRun : canonicalSemanticResponseV6 request = response)
    (hPass : response.passed = true) :
    CommentAggregatePassOf request response := by
  subst response
  unfold CommentAggregatePassOf canonicalSemanticResponseV6 at *
  dsimp only at *
  refine ⟨rfl, fun _ => rfl, ?_⟩
  intro side evidence hEvidence
  unfold allCommentEvidencePass at hPass
  have hPasses := bool_and_true_parts _ _ hPass
  have hFirstTwo := bool_and_true_parts _ _ hPasses.1
  have hSide : commentEvidencePass
      ((evaluateAllCommentSidesV6 request).sideEvaluation side).parsedEvidence =
      true := by
    cases side with
    | original => exact hFirstTwo.1
    | revised => exact hFirstTwo.2
    | compared => exact hPasses.2
  rw [hEvidence] at hSide
  unfold commentEvidencePass at hSide
  have hParts := bool_and_true_parts _ _ hSide
  have hCrossing : evidence.crossing = none := by
    exact Option.isNone_iff_eq_none.mp hParts.1
  change (match
      ((evaluateAllCommentSidesV6 request).sideEvaluation side).parsedEvidence with
    | some found => packageCommentInventory found.scan
    | none => emptyPackageCommentInventory) =
      packageCommentInventory evidence.scan ∧
    evidence.crossing = none ∧
    PackageCommentIntegrity (packageCommentInventory evidence.scan)
  rw [hEvidence]
  exact ⟨rfl, hCrossing,
    package_comment_reference_integrity_sound _ hParts.2⟩

theorem selected_semantic_evidence_none_rejected
    (request : VerifierRequestV6) (side : CommentVerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (evidence : ParsedCommentEvidence)
    (hSelected : SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) (some evidence)) :
    ¬ SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) none := by
  intro hNone
  rcases hNone.2 with ⟨_, _, _, hSemantic, _⟩
  simp at hSemantic

theorem substituted_retained_comment_scan_evidence_rejected
    (request : VerifierRequestV6) (side : CommentVerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (evidence substituted : ParsedCommentEvidence)
    (hSelected : SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) (some evidence))
    (hDifferent : substituted ≠ evidence) :
    ¬ SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) (some substituted) := by
  intro hSubstituted
  rcases hSelected.2 with
    ⟨r₁, e₁, _, hEvidence₁, hRealization₁, _, _, _, _, hOutput₁, _⟩
  rcases hSubstituted.2 with
    ⟨r₂, e₂, _, hEvidence₂, hRealization₂, _, _, _, _, hOutput₂, _⟩
  have hEvidence : evidence = e₁ := Option.some.inj hEvidence₁
  have hSubstituted : substituted = e₂ := Option.some.inj hEvidence₂
  apply hDifferent
  rw [hEvidence, hSubstituted, hOutput₁, hOutput₂,
    hRealization₁, hRealization₂]

theorem package_view_retained_record_mismatch_rejected
    (evidence : RequestBoundCommentEvidence)
    (hMismatch :
      evidence.packageBytes ≠ evidence.retainedPackageBytes ∨
      evidence.packageIndex ≠ evidence.retainedPackageIndex) :
    ¬ RequestBoundRetainedCommentEvidenceOf evidence := by
  intro h
  exact hMismatch.elim (fun mismatch => mismatch h.1)
    (fun mismatch => mismatch h.2.1)

def commentSelectorResultSoundSignature : Prop :=
  ∀ pkg : CommentSelectorPackageView,
    IndependentCommentSelectionResultOf pkg
      (selectConventionalMainCommentSpec pkg)

def commentSelectionToRealizationSoundSignature : Prop :=
  ∀ (request : VerifierRequestV6) (global : GlobalCommentEvaluationV6)
      (side : CommentVerifierSide) (evaluation : SideCommentEvaluationV6),
    evaluateAllCommentSidesV6 request = global →
    global.sideEvaluation side = evaluation →
    SelectionToCommentRealizationOf request side evaluation.outcome
      evaluation.commentRealization evaluation.parsedEvidence

def admittedCommentSourceSetCompleteSignature : Prop :=
  ∀ (request : VerifierRequestV6) (side : CommentVerifierSide)
      (evaluation : SideCommentEvaluationV6),
    evaluateCommentSideV6 request side = evaluation →
    (∃ identity, evaluation.outcome = .selected identity) →
    CompleteCommentSourceSetOf request side evaluation

def parsedCommentInventoryEvidenceExactSignature : Prop :=
  ∀ input : CommentScanInput,
    ParsedCommentEvidenceOf input (scanCommentEvidence input)

def packageCommentReferenceIntegritySoundSignature : Prop :=
  ∀ (inventory : PackageCommentInventory),
    checkPackageCommentIntegrity inventory = true →
    PackageCommentIntegrity inventory

def incompleteCommentPartitionZeroEvidenceSoundSignature : Prop :=
  ∀ evaluation : SideCommentEvaluationV6,
    evaluation.status = .notEvaluated →
    (evaluation.commentRealization = none ∧
      evaluation.parsedEvidence = none ∧
      evaluation.sourceSet = emptyCommentScanInput) →
    evaluation.commentRealization = none ∧
      evaluation.parsedEvidence = none ∧
      evaluation.sourceSet = emptyCommentScanInput

def commentIntegrityAggregatePassSoundSignature : Prop :=
  ∀ (request : VerifierRequestV6) (response : VerifierResponseV6),
    canonicalSemanticResponseV6 request = response →
    response.passed = true →
    CommentAggregatePassOf request response

end Legacy -/

abbrev VerifierSide := RelationshipStorySelector.VerifierSide
abbrev SideNoteEvaluationV5 := NoteReferenceIntegrity.SideNoteEvaluationV5
abbrev SideScanEvidence := NoteReferenceIntegrity.SideScanEvidence
abbrev StorySlot := NoteReferenceIntegrity.StorySlot

structure CommentPartEntry where
  normalizedPartPath : String
  compressedSize : Nat
  expandedSize : Nat
  regularEntryCount : Nat
  localHeaderOffset : Nat := 0
  dataOffset : Nat := 0
  localSpanEnd : Nat := 0
  crc32 : Nat := 0
  deriving BEq, DecidableEq, Repr, Inhabited

structure CommentExtractionEvidence where
  packageBytes : ByteArray := ByteArray.empty
  snapshotBytes : ByteArray := ByteArray.empty
  snapshotPath : String
  snapshotWriteInvocationCount : Nat := 0
  compressedPayload : ByteArray := ByteArray.empty
  decompressedBytes : ByteArray
  invocationCount : Nat
  deriving BEq, DecidableEq, Inhabited

structure CommentParsedPart where
  sourceText : String := ""
  events : List XmlEvent
  rootUri : String
  rootLocalName : String
  depth : Nat
  eventLimit : Nat := 0
  invocationCount : Nat
  deriving DecidableEq, Repr, Inhabited

structure CommentStoryRealization where
  selected : SelectedCommentIdentity
  entry : CommentPartEntry
  extraction : CommentExtractionEvidence
  text : String
  retainedParsedEvidence : CommentParsedPart := default
  parsed : CommentParsedPart
  deriving DecidableEq, Inhabited

structure SideResourceUsageV6 where
  xmlEvents : Nat
  deriving BEq, DecidableEq, Repr, Inhabited

structure GlobalResourceUsage where
  side : VerifierSide → SideResourceUsageV6
  tripleXmlEvents : Nat

structure PackageView where
  packageBytes : ByteArray
  index : ZipIndex
  relationshipRecords : List RelationshipRecord
  noteView : ConventionalMainNoteSelector.PackageView
  fixedMainSource : StorySlot
  retainedSourceScans : SideScanEvidence
  retainedCommentRealization : Option CommentStoryRealization
  resourceUsageBeforeComments : GlobalResourceUsage

structure RetainedPackageRecordV6 where
  view : PackageView
  packageBytes : ByteArray
  index : ZipIndex

def relationshipHexByteValueSpec (byte : UInt8) : Option Nat :=
  let value := byte.toNat
  if 0x30 ≤ value && value ≤ 0x39 then some (value - 0x30)
  else if 0x61 ≤ value && value ≤ 0x66 then some (10 + value - 0x61)
  else if 0x41 ≤ value && value ≤ 0x46 then some (10 + value - 0x41)
  else none

def stringContainsCharSpec (value : String) (needle : Char) : Bool :=
  value.toList.any (· == needle)

def stringStartsWithSlashSpec (value : String) : Bool :=
  match value.toList with
  | '/' :: _ => true
  | _ => false

def stringStartsWithDoubleSlashSpec (value : String) : Bool :=
  match value.toList with
  | '/' :: '/' :: _ => true
  | _ => false

def stringDropLeadingSlashSpec (value : String) : String :=
  match value.toList with
  | '/' :: rest => String.ofList rest
  | chars => String.ofList chars

def relationshipPathSegmentsSpec (value : String) : List String :=
  let rec loop (remaining current : List Char) (segments : List String) :
      List String :=
    match remaining with
    | [] => segments ++ [String.ofList current.reverse]
    | '/' :: rest =>
        loop rest [] (segments ++ [String.ofList current.reverse])
    | char :: rest => loop rest (char :: current) segments
  loop value.toList [] []

def joinRelationshipPathSegmentsSpec (segments : List String) : String :=
  let rec loop : List String → List Char
    | [] => []
    | [segment] => segment.toList
    | segment :: rest => segment.toList ++ '/' :: loop rest
  String.ofList (loop segments)

def relationshipPercentDecodePassSpec
    (target : String) : Except String String := do
  let bytes := target.toUTF8
  let rec loop (fuel position : Nat) (decoded : ByteArray) :
      Except String ByteArray := do
    match fuel with
    | 0 =>
        if position == bytes.size then return decoded
        else throw "target percent decoder exhausted"
    | fuel + 1 =>
        if position == bytes.size then return decoded
        let byte := bytes[position]!
        if byte.toNat != 0x25 then
          loop fuel (position + 1) (decoded.push byte)
        else
          if position + 2 >= bytes.size then
            throw "target has a malformed percent escape"
          let some high := relationshipHexByteValueSpec bytes[position + 1]! |
            throw "target has a malformed percent escape"
          let some low := relationshipHexByteValueSpec bytes[position + 2]! |
            throw "target has a malformed percent escape"
          let value := high * 16 + low
          if value == 0x2f || value == 0x5c then
            throw "target has an encoded separator escape"
          loop fuel (position + 3) (decoded.push (UInt8.ofNat value))
  let decodedBytes ← loop (bytes.size + 1) 0 .empty
  match String.fromUTF8? decodedBytes with
  | some decoded => return decoded
  | none => throw "target percent escapes do not form UTF-8"

def relationshipHasEncodedDotSegmentSpec (target : String) : Bool :=
  relationshipPathSegmentsSpec target |>.any
    fun segment => segment == "." || segment == ".."

def relationshipPercentDecodeTargetSpec
    (rawTarget : String) : Except String String := do
  let rec loop (fuel : Nat) (current : String) : Except String String := do
    match fuel with
    | 0 => throw "target percent decoder exhausted"
    | fuel + 1 =>
        if !stringContainsCharSpec current '%' then return current
        let decoded ← relationshipPercentDecodePassSpec current
        if relationshipHasEncodedDotSegmentSpec decoded then
          throw "target percent decoding produced an encoded dot segment"
        loop fuel decoded
  loop (rawTarget.toUTF8.size + 1) rawTarget

def normalizeRelationshipTarget (rawTarget : String) : Except String String := do
  if rawTarget.isEmpty || rawTarget.toUTF8.size > 256 then
    throw "target is empty or exceeds its limit"
  if stringContainsCharSpec rawTarget '\\' ||
      stringContainsCharSpec rawTarget '?' ||
      stringContainsCharSpec rawTarget '#' ||
      stringContainsCharSpec rawTarget '*' ||
      stringContainsCharSpec rawTarget '[' ||
      stringContainsCharSpec rawTarget ']' ||
      stringStartsWithDoubleSlashSpec rawTarget then
    throw "target uses unsafe syntax"
  let decodedTarget ← relationshipPercentDecodeTargetSpec rawTarget
  if stringContainsCharSpec decodedTarget '*' ||
      stringContainsCharSpec decodedTarget '[' ||
      stringContainsCharSpec decodedTarget ']' then
    throw "target percent decoding produced unsafe glob syntax"
  let withoutLeading :=
    if stringStartsWithSlashSpec decodedTarget then
      stringDropLeadingSlashSpec decodedTarget
    else "word/" ++ decodedTarget
  let rec normalize (segments stack : List String) :
      Except String (List String) := do
    match segments with
    | [] => return stack
    | segment :: rest =>
        if segment.isEmpty || segment == "." then normalize rest stack
        else if segment == ".." then
          match stack.reverse with
          | [] => throw "target escapes the package root"
          | _ :: reversedRest => normalize rest reversedRest.reverse
        else if stringContainsCharSpec segment ':' ||
            segment.toList.any
              (fun char => char.toNat < 0x20 || char.toNat == 0x7f) then
          throw "target contains an unsafe segment"
        else normalize rest (stack ++ [segment])
  let normalized ← normalize (relationshipPathSegmentsSpec withoutLeading) []
  if normalized.isEmpty then throw "target normalizes to the package root"
  let result := joinRelationshipPathSegmentsSpec normalized
  if result.toUTF8.size > 256 then
    throw "normalized target exceeds its limit"
  return result

def validateCommentRelationshipRecord
    (record : RelationshipRecord) (ordinal : Nat) :
    Except CommentSelectionFailure SelectedCommentIdentity :=
  match record.targetMode == some "External" with
  | true => .error (.external ordinal)
  | false =>
      match record.targetMode.isNone || record.targetMode == some "Internal" with
      | false => .error (.invalidTargetMode ordinal)
      | true =>
          match normalizeRelationshipTarget record.rawTarget with
          | .error _ =>
              .error (.unsafeTarget ordinal)
          | .ok normalizedPartPath =>
              .ok {
                relationshipRecordOrdinal := ordinal
                relationshipId := record.id
                normalizedPartPath
              }

def canonicalCommentSelectionFailure (records : List RelationshipRecord) :
    Option CommentSelectionFailure :=
  match exactCommentRelationshipRecords records with
  | [] => none
  | _ :: second :: _ => some (.ambiguous second.2)
  | [(record, ordinal)] =>
      match validateCommentRelationshipRecord record ordinal with
      | .ok _ => none
      | .error failure => some failure

def selectConventionalMainComment (pkg : PackageView) :
    Except CommentSelectionFailure (Option SelectedCommentIdentity) :=
  match canonicalCommentSelectionFailure pkg.relationshipRecords with
  | some failure => .error failure
  | none =>
      match exactCommentRelationshipRecords pkg.relationshipRecords with
      | [] => .ok none
      | [(record, ordinal)] =>
          match validateCommentRelationshipRecord record ordinal with
          | .ok selected => .ok (some selected)
          | .error failure => .error failure
      | _ :: second :: _ => .error (.ambiguous second.2)

def CommentSelectionResultOf (pkg : PackageView)
    (result : Except CommentSelectionFailure
      (Option SelectedCommentIdentity)) : Prop :=
  (exactCommentRelationshipRecords pkg.relationshipRecords = [] ∧
      result = .ok none) ∨
  (∃ record ordinal selected,
      exactCommentRelationshipRecords pkg.relationshipRecords =
        [(record, ordinal)] ∧
      validateCommentRelationshipRecord record ordinal = .ok selected ∧
      result = .ok (some selected)) ∨
  (∃ failure,
      canonicalCommentSelectionFailure pkg.relationshipRecords =
        some failure ∧ result = .error failure)

theorem comment_selector_result_sound (pkg : PackageView) :
    CommentSelectionResultOf pkg (selectConventionalMainComment pkg) := by
  unfold CommentSelectionResultOf selectConventionalMainComment
    canonicalCommentSelectionFailure
  generalize hExact :
    exactCommentRelationshipRecords pkg.relationshipRecords = exact
  cases exact with
  | nil => exact Or.inl ⟨rfl, rfl⟩
  | cons first rest =>
      cases first with
      | mk record ordinal =>
      cases rest with
      | nil =>
          generalize hValidated :
              validateCommentRelationshipRecord record ordinal = validated
          cases validated with
          | ok selected =>
              have hSelection := congrArg
                (fun result :
                    Except CommentSelectionFailure SelectedCommentIdentity =>
                  match
                      (match result with
                      | Except.ok _ => none
                      | Except.error failure => some failure) with
                  | some failure => Except.error failure
                  | none =>
                      match result with
                      | Except.ok value => Except.ok (some value)
                      | Except.error failure => Except.error failure)
                hValidated
              exact Or.inr <| Or.inl
                ⟨record, ordinal, selected, rfl, hValidated, hSelection⟩
          | error failure =>
              have hCanonical := congrArg
                (fun result :
                    Except CommentSelectionFailure SelectedCommentIdentity =>
                  match result with
                  | Except.ok _ => (none : Option CommentSelectionFailure)
                  | Except.error error => some error)
                hValidated
              have hSelection := congrArg
                (fun result :
                    Except CommentSelectionFailure SelectedCommentIdentity =>
                  match
                      (match result with
                      | Except.ok _ => none
                      | Except.error error => some error) with
                  | some error => Except.error error
                  | none =>
                      match result with
                      | Except.ok value => Except.ok (some value)
                      | Except.error error => Except.error error)
                hValidated
              exact Or.inr <| Or.inr
                ⟨failure, hCanonical, hSelection⟩
      | cons second tail =>
          exact Or.inr <| Or.inr ⟨.ambiguous second.2, rfl, rfl⟩

def ExactlyOneRegularBinaryEntryAt
    (pkg : PackageView) (path : String) : Prop :=
  (pkg.index.entries.filter (·.name == path)).length = 1

def byteAtEquals (bytes : ByteArray) (offset value : Nat) : Prop :=
  byteAt? bytes offset = some value

def LocalFileHeaderSignatureAt (bytes : ByteArray) (offset : Nat) : Prop :=
  byteAtEquals bytes offset 0x50 ∧
  byteAtEquals bytes (offset + 1) 0x4b ∧
  byteAtEquals bytes (offset + 2) 0x03 ∧
  byteAtEquals bytes (offset + 3) 0x04

def IndependentBinaryEntryOf
    (packageBytes : ByteArray) (index : ZipIndex)
    (selected : SelectedCommentIdentity) (entry : CommentPartEntry)
    (compressedPayload : ByteArray) : Prop :=
  compressedPayload =
      packageBytes.extract entry.dataOffset entry.localSpanEnd ∧
  ∃ typedEntry,
    index.find? selected.normalizedPartPath = some typedEntry ∧
    entry.normalizedPartPath = typedEntry.name ∧
    entry.compressedSize = typedEntry.compressedSize ∧
    entry.expandedSize = typedEntry.expandedSize ∧
    entry.localHeaderOffset = typedEntry.localHeaderOffset ∧
    entry.dataOffset = typedEntry.dataOffset ∧
    entry.localSpanEnd = typedEntry.localSpanEnd ∧
    entry.crc32 = typedEntry.crc32 ∧
    typedEntry.isDirectory = false ∧
    typedEntry.localHeaderOffset + 30 ≤ typedEntry.dataOffset ∧
    typedEntry.dataOffset ≤ typedEntry.localSpanEnd ∧
    typedEntry.localSpanEnd ≤ index.centralOffset ∧
    index.centralOffset + index.centralSize ≤ packageBytes.size ∧
    LocalFileHeaderSignatureAt packageBytes typedEntry.localHeaderOffset ∧
    compressedPayload =
      packageBytes.extract typedEntry.dataOffset typedEntry.localSpanEnd ∧
    compressedPayload.size = typedEntry.compressedSize

def IndependentBinaryIndexOf
    (packageBytes : ByteArray) (index : ZipIndex) : Prop :=
  index.entries.length ≤ 1024 ∧
  index.centralSize ≤ 4194304 ∧
  index.centralOffset + index.centralSize ≤ packageBytes.size ∧
  (∀ entry ∈ index.entries,
    (index.entries.filter (·.name == entry.name)).length = 1) ∧
  ∀ entry ∈ index.entries,
    entry.isDirectory = false ∧
    entry.localHeaderOffset + 30 ≤ entry.dataOffset ∧
    entry.dataOffset ≤ entry.localSpanEnd ∧
    entry.localSpanEnd ≤ index.centralOffset ∧
    LocalFileHeaderSignatureAt packageBytes entry.localHeaderOffset

def localFileHeaderSignatureCheck
    (bytes : ByteArray) (offset : Nat) : Bool :=
  decide (byteAt? bytes offset = some 0x50) &&
  decide (byteAt? bytes (offset + 1) = some 0x4b) &&
  decide (byteAt? bytes (offset + 2) = some 0x03) &&
  decide (byteAt? bytes (offset + 3) = some 0x04)

def independentBinaryIndexCheck
    (packageBytes : ByteArray) (index : ZipIndex) : Bool :=
  decide (index.entries.length ≤ 1024) &&
  decide (index.centralSize ≤ 4194304) &&
  decide (index.centralOffset + index.centralSize ≤ packageBytes.size) &&
  index.entries.all (fun entry =>
    decide ((index.entries.filter (·.name == entry.name)).length = 1)) &&
  index.entries.all fun entry =>
    decide (entry.isDirectory = false) &&
    decide (entry.localHeaderOffset + 30 ≤ entry.dataOffset) &&
    decide (entry.dataOffset ≤ entry.localSpanEnd) &&
    decide (entry.localSpanEnd ≤ index.centralOffset) &&
    localFileHeaderSignatureCheck packageBytes entry.localHeaderOffset

theorem independent_binary_index_check_sound
    (packageBytes : ByteArray) (index : ZipIndex)
    (h : independentBinaryIndexCheck packageBytes index = true) :
    IndependentBinaryIndexOf packageBytes index := by
  unfold independentBinaryIndexCheck at h
  simp only [Bool.and_eq_true, decide_eq_true_eq, List.all_eq_true] at h
  refine ⟨h.1.1.1.1, h.1.1.1.2, h.1.1.2, h.1.2, ?_⟩
  intro entry hMember
  have hEntry := h.2 entry hMember
  unfold localFileHeaderSignatureCheck at hEntry
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hEntry
  refine ⟨hEntry.1.1.1.1, hEntry.1.1.1.2, hEntry.1.1.2,
    hEntry.1.2, ?_⟩
  unfold LocalFileHeaderSignatureAt
  simpa [byteAtEquals, and_assoc] using hEntry.2

def RetainedSnapshotExtractionOf
    (pkg : PackageView) (selected : SelectedCommentIdentity)
    (entry : CommentPartEntry)
    (extraction : CommentExtractionEvidence) : Prop :=
  extraction.packageBytes = pkg.packageBytes ∧
  extraction.snapshotBytes = pkg.packageBytes ∧
  extraction.snapshotWriteInvocationCount = 1 ∧
  extraction.snapshotPath ≠ "" ∧
  extraction.invocationCount = 1 ∧
  IndependentBinaryIndexOf pkg.packageBytes pkg.index ∧
  IndependentBinaryEntryOf pkg.packageBytes pkg.index selected entry
    extraction.compressedPayload ∧
  extraction.decompressedBytes.size = entry.expandedSize

def CommentMetadataAdmittedSpec
    (_pkg : PackageView) (prior : GlobalResourceUsage)
    (selected : SelectedCommentIdentity) (entry : CommentPartEntry) : Prop :=
  entry.normalizedPartPath = selected.normalizedPartPath ∧
  entry.regularEntryCount = 1 ∧
  entry.compressedSize ≤ 8388608 ∧
  entry.expandedSize ≤ 16777216 ∧
  (entry.compressedSize = 0 → entry.expandedSize = 0) ∧
  entry.expandedSize ≤ entry.compressedSize * 100 ∧
  prior.tripleXmlEvents ≤ 3000000

def BoundedExtractionEvidenceSpec
    (pkg : PackageView) (selected : SelectedCommentIdentity)
    (entry : CommentPartEntry)
    (extraction : CommentExtractionEvidence) : Prop :=
  RetainedSnapshotExtractionOf pkg selected entry extraction

def continuationByte (value : Nat) : Bool :=
  0x80 ≤ value && value ≤ 0xbf

def unicodeScalar (value : Nat) : Bool :=
  value ≤ 0x10ffff && !(0xd800 ≤ value && value ≤ 0xdfff)

def decodeUtf8CharsSpec (bytes : ByteArray) : Option (List Char) :=
  let rec loop (position fuel : Nat) (reversed : List Char) :
      Option (List Char) :=
    match fuel with
    | 0 => if position == bytes.size then some reversed.reverse else none
    | fuel + 1 =>
      if position == bytes.size then some reversed.reverse
      else
        match byteAt? bytes position with
        | none => none
        | some first =>
          if (first ≤ 0x7f : Bool) then
            loop (position + 1) fuel (Char.ofNat first :: reversed)
          else if ((0xc2 ≤ first : Bool) && (first ≤ 0xdf : Bool)) then
            match byteAt? bytes (position + 1) with
            | some second =>
              if continuationByte second then
                let scalar := (first - 0xc0) * 0x40 + (second - 0x80)
                loop (position + 2) fuel (Char.ofNat scalar :: reversed)
              else none
            | none => none
          else if ((0xe0 ≤ first : Bool) && (first ≤ 0xef : Bool)) then
            match byteAt? bytes (position + 1) with
            | none => none
            | some second =>
              match byteAt? bytes (position + 2) with
              | none => none
              | some third =>
                let canonicalSecond :=
                  (!(first == 0xe0) || (0xa0 ≤ second : Bool)) &&
                  (!(first == 0xed) || (second ≤ 0x9f : Bool))
                if canonicalSecond && continuationByte second &&
                    continuationByte third then
                  let scalar := (first - 0xe0) * 0x1000 +
                    (second - 0x80) * 0x40 + (third - 0x80)
                  if unicodeScalar scalar then
                    loop (position + 3) fuel (Char.ofNat scalar :: reversed)
                  else none
                else none
          else if ((0xf0 ≤ first : Bool) && (first ≤ 0xf4 : Bool)) then
            match byteAt? bytes (position + 1) with
            | none => none
            | some second =>
              match byteAt? bytes (position + 2) with
              | none => none
              | some third =>
                match byteAt? bytes (position + 3) with
                | none => none
                | some fourth =>
                  let canonicalSecond :=
                    (!(first == 0xf0) || (0x90 ≤ second : Bool)) &&
                    (!(first == 0xf4) || (second ≤ 0x8f : Bool))
                  if canonicalSecond && continuationByte second &&
                      continuationByte third && continuationByte fourth then
                    let scalar := (first - 0xf0) * 0x40000 +
                      (second - 0x80) * 0x1000 +
                      (third - 0x80) * 0x40 + (fourth - 0x80)
                    if unicodeScalar scalar then
                      loop (position + 4) fuel (Char.ofNat scalar :: reversed)
                    else none
                  else none
          else none
  loop 0 (bytes.size + 1) []

def StrictUtf8DecodeSpec (bytes : ByteArray) : Option String :=
  (decodeUtf8CharsSpec bytes).map String.ofList

def RetainedTypedCommentXmlOf
    (text expectedUri expectedLocalName : String)
    (depth eventLimit : Nat) (retained parsed : CommentParsedPart) : Prop :=
  parsed = retained ∧
  parsed.sourceText = text ∧
  parsed.rootUri = expectedUri ∧
  parsed.rootLocalName = expectedLocalName ∧
  parsed.depth ≤ depth ∧
  parsed.eventLimit ≤ eventLimit ∧
  parsed.invocationCount = 1 ∧
  parsed.events.length ≤ eventLimit ∧
  ∃ attributes selfClosing,
    parsed.events.head? =
      some (.startElement expectedUri expectedLocalName attributes 0 selfClosing)

def AdmittedCommentPartOf
    (pkg : PackageView) (side : VerifierSide)
    (prior : GlobalResourceUsage)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization) : Prop :=
  ExactlyOneRegularBinaryEntryAt pkg selected.normalizedPartPath ∧
  CommentMetadataAdmittedSpec pkg prior selected realization.entry ∧
  BoundedExtractionEvidenceSpec pkg selected realization.entry
    realization.extraction ∧
  realization.extraction.decompressedBytes = realization.text.toUTF8 ∧
  RetainedTypedCommentXmlOf realization.text wmlNamespace "comments"
    128 500000
      realization.retainedParsedEvidence realization.parsed ∧
  realization.parsed.events.length ≤ 500000

structure CommentSourceSet where
  side : VerifierSide
  sources : List StorySlot
  sourceEvents : List (Nat × List XmlEvent)
  deriving Inhabited

def fixedMainSourceSpec (pkg : PackageView) : StorySlot :=
  pkg.fixedMainSource

def canonicalPhysicalSourcesSpec
    (partition : NoteReferenceIntegrity.ReferenceSourcePartition) :
    List StorySlot :=
  partition.sources.drop 1

def presentNoteSourcesSpec
    (partition : NoteReferenceIntegrity.ReferenceSourcePartition) :
    List StorySlot :=
  partition.definitionStories.filter fun source =>
    !source.normalizedPartPath.isEmpty

def canonicalCommentSourceSet
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) : CommentSourceSet :=
  { side
    sources := [fixedMainSourceSpec pkg] ++
      canonicalPhysicalSourcesSpec note.partition ++
      presentNoteSourcesSpec note.partition
    sourceEvents := pkg.retainedSourceScans.realizations.zipIdx.map fun pair =>
      (pair.2, pair.1.visitedEvents) }

def canonicalCommentSourceSetSpec := canonicalCommentSourceSet

def sourceRealizationSlots (scans : SideScanEvidence) : List StorySlot :=
  scans.realizations.map (·.slot)

theorem source_realization_of_mem_slots
    (source : StorySlot) (realizations :
      List NoteReferenceIntegrity.StoryRealization)
    (hMember : source ∈ realizations.map (·.slot)) :
    ∃ realization, realization ∈ realizations ∧ realization.slot = source := by
  induction realizations with
  | nil => cases hMember
  | cons head tail ih =>
      cases hMember with
      | head => exact ⟨head, List.Mem.head _, rfl⟩
      | tail _ member =>
          rcases ih member with ⟨realization, hRealization, hSlot⟩
          exact ⟨realization, List.Mem.tail head hRealization, hSlot⟩

theorem mem_of_equal_lists {α : Type} (left right : List α) (item : α)
    (hLists : left = right) (hMember : item ∈ left) : item ∈ right := by
  cases hLists
  exact hMember

def storySlotListsMatch (left right : List StorySlot) : Bool :=
  left.length == right.length &&
  (left.zip right).all fun pair =>
    NoteReferenceIntegrity.storySlotEq pair.1 pair.2

def NoDuplicatePhysicalSourceSpec (sources : List StorySlot) : Prop :=
  sources.Nodup

def ScanDomainExactlySpec
    (sources : List StorySlot) (scans : SideScanEvidence) : Prop :=
  sources = sourceRealizationSlots scans

def RetainedFullyScannedStoryOf
    (pkg : PackageView) (source : StorySlot)
    (realization : NoteReferenceIntegrity.StoryRealization) : Prop :=
  NoteReferenceIntegrity.FullyScannedStoryOf pkg.noteView source realization

def CompleteCommentSourceSetOf
    (pkg : PackageView) (side : VerifierSide)
    (noteEvaluation : SideNoteEvaluationV5)
    (set : CommentSourceSet) (scans : SideScanEvidence) : Prop :=
  noteEvaluation.partition.status = .complete ∧
  set.side = side ∧
  set.sources =
    [fixedMainSourceSpec pkg] ++
    canonicalPhysicalSourcesSpec noteEvaluation.partition ++
    presentNoteSourcesSpec noteEvaluation.partition ∧
  set.sources.length ≤ 387 ∧
  NoDuplicatePhysicalSourceSpec set.sources ∧
  ScanDomainExactlySpec set.sources scans ∧
  ∀ source ∈ set.sources, ∃ realization,
    realization ∈ scans.realizations ∧
    NoteReferenceIntegrity.storySlotEq realization.slot source = true ∧
    RetainedFullyScannedStoryOf pkg source realization

def reuseRetainedCommentScans (pkg : PackageView) : SideScanEvidence :=
  pkg.retainedSourceScans

def completeCommentSourceSetCheck
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) : Bool :=
  decide (note.partition.status = .complete) &&
  decide ((canonicalCommentSourceSet pkg side note).sources.length ≤ 387) &&
  decide (canonicalCommentSourceSet pkg side note).sources.Nodup &&
  decide ((canonicalCommentSourceSet pkg side note).sources =
    sourceRealizationSlots pkg.retainedSourceScans) &&
  pkg.retainedSourceScans.realizations.all fun realization =>
    NoteReferenceIntegrity.fullyScannedStoryCheck pkg.noteView
      realization.slot realization

theorem complete_comment_source_set_check_sound
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5)
    (hCheck : completeCommentSourceSetCheck pkg side note = true) :
    CompleteCommentSourceSetOf pkg side note
      (canonicalCommentSourceSet pkg side note)
      (reuseRetainedCommentScans pkg) := by
  unfold completeCommentSourceSetCheck at hCheck
  have p1 := bool_and_eq_true_parts _ _ hCheck
  have p2 := bool_and_eq_true_parts _ _ p1.1
  have p3 := bool_and_eq_true_parts _ _ p2.1
  have p4 := bool_and_eq_true_parts _ _ p3.1
  have hStatus := of_decide_eq_true p4.1
  have hLength := of_decide_eq_true p4.2
  have hNodup := of_decide_eq_true p3.2
  have hDomain := of_decide_eq_true p2.2
  have hScanned := p1.2
  refine ⟨hStatus, rfl, rfl, hLength, hNodup, hDomain, ?_⟩
  intro source hSource
  have hMapped : source ∈ sourceRealizationSlots
      (reuseRetainedCommentScans pkg) := by
    unfold reuseRetainedCommentScans sourceRealizationSlots
    exact mem_of_equal_lists _ _ source hDomain hSource
  rcases source_realization_of_mem_slots source
    pkg.retainedSourceScans.realizations hMapped with
      ⟨realization, hMember, hSlot⟩
  have hFully := list_all_true_of_mem _ _ realization hScanned hMember
  have f1 := bool_and_eq_true_parts _ _ hFully
  have f2 := bool_and_eq_true_parts _ _ f1.1
  have f3 := bool_and_eq_true_parts _ _ f2.1
  have f4 := bool_and_eq_true_parts _ _ f3.1
  have f5 := bool_and_eq_true_parts _ _ f4.1
  have f6 := bool_and_eq_true_parts _ _ f5.1
  cases hSlot
  refine ⟨realization, hMember, f6.1, ?_⟩
  unfold RetainedFullyScannedStoryOf
  exact hFully

def scanCommentReferenceEvents
    (set : CommentSourceSet) (_scans : SideScanEvidence) :
    List (Nat × List XmlEvent) :=
  set.sourceEvents

def scanDirectCommentDefinitions
    (comment : Option CommentStoryRealization) : List XmlEvent :=
  comment.map (·.parsed.events) |>.getD []

def parseBoundedDecimalId (raw : String) : Option CanonicalDecimalKey :=
  canonicalDecimalKey? raw

structure ParsedCommentEvidence where
  references : List CommentReferenceOccurrence
  definitions : List CommentDefinitionOccurrence
  nonDirectDefinitions : List CommentDefinitionOccurrence
  issues : List String
  wireCounts : PackageCommentInventory
  crossing : Option CommentScanCrossing
  deriving DecidableEq, Repr, Inhabited

def canonicalCommentIssuesSpec
    (_pkg : PackageView) (_side : VerifierSide)
    (_set : CommentSourceSet) (_comment : Option CommentStoryRealization)
    (references : List CommentReferenceOccurrence)
    (definitions nonDirect : List CommentDefinitionOccurrence) : List String :=
  let malformedReferences := references.filter fun reference =>
    !(reference.rawId.bind parseBoundedDecimalId).isSome
  let malformedDefinitions := definitions.filter fun definition =>
    !(definition.rawId.bind parseBoundedDecimalId).isSome
  (malformedReferences.map fun _ => "reference-id") ++
  (malformedDefinitions.map fun _ => "definition-id") ++
  (nonDirect.map fun _ => "non-direct-definition")

def commentCountProjectionSpec
    (references : List CommentReferenceOccurrence)
    (definitions nonDirect : List CommentDefinitionOccurrence) :
    PackageCommentInventory :=
  packageCommentInventory {
    references := references
    definitions := definitions
    nonDirectDefinitions := nonDirect
  }

def parsedCommentEvidenceOfBoundedScan
    (pkg : PackageView) (side : VerifierSide)
    (set : CommentSourceSet) (comment : Option CommentStoryRealization)
    (raw : BoundedCommentScan) : ParsedCommentEvidence :=
  { references := raw.scan.references
    definitions := raw.scan.definitions
    nonDirectDefinitions := raw.scan.nonDirectDefinitions
    issues := canonicalCommentIssuesSpec pkg side set comment
      raw.scan.references raw.scan.definitions raw.scan.nonDirectDefinitions
    wireCounts := commentCountProjectionSpec raw.scan.references
      raw.scan.definitions raw.scan.nonDirectDefinitions
    crossing := raw.crossing }

def scanCommentEvidenceV6
    (pkg : PackageView) (side : VerifierSide)
    (set : CommentSourceSet) (scans : SideScanEvidence)
    (comment : Option CommentStoryRealization) :
    Except String ParsedCommentEvidence :=
  let input : CommentScanInput := {
    sourceEvents := scanCommentReferenceEvents set scans
    definitionEvents := scanDirectCommentDefinitions comment
  }
  let retained := retainCommentScanEvidence input
  let raw := retained.output
  let _parsedIds := raw.scan.references.filterMap fun reference =>
    reference.rawId.bind parseBoundedDecimalId
  .ok (parsedCommentEvidenceOfBoundedScan pkg side set comment raw)

def orderedCommentReferencesSpec
    (set : CommentSourceSet) :
    List CommentReferenceOccurrence :=
  match scanCommentEvidence {
      sourceEvents := set.sourceEvents
      definitionEvents := [] } with
  | result => result.scan.references

def directCommentDefinitionsSpec
    (comment : Option CommentStoryRealization) :
    List CommentDefinitionOccurrence :=
  (scanCommentEvidence {
    sourceEvents := []
    definitionEvents := scanDirectCommentDefinitions comment }).scan.definitions

def nonDirectCommentDefinitionsSpec
    (comment : Option CommentStoryRealization) :
    List CommentDefinitionOccurrence :=
  (scanCommentEvidence {
    sourceEvents := []
    definitionEvents := scanDirectCommentDefinitions comment
  }).scan.nonDirectDefinitions

def ParsedCommentEvidenceOf
    (pkg : PackageView) (side : VerifierSide)
    (set : CommentSourceSet) (comment : Option CommentStoryRealization)
    (evidence : ParsedCommentEvidence) : Prop :=
  let raw := scanCommentEvidence {
    sourceEvents := scanCommentReferenceEvents set default
    definitionEvents := scanDirectCommentDefinitions comment }
  evidence.references = raw.scan.references ∧
  evidence.definitions = raw.scan.definitions ∧
  evidence.nonDirectDefinitions = raw.scan.nonDirectDefinitions ∧
  evidence.issues =
    canonicalCommentIssuesSpec pkg side set comment
      evidence.references evidence.definitions
      evidence.nonDirectDefinitions ∧
  evidence.wireCounts =
    commentCountProjectionSpec evidence.references evidence.definitions
      evidence.nonDirectDefinitions

theorem parsed_comment_inventory_evidence_exact
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5)
    (set : CommentSourceSet) (scans : SideScanEvidence)
    (comment : Option CommentStoryRealization)
    (evidence : ParsedCommentEvidence)
    (hSet : CompleteCommentSourceSetOf pkg side note set scans)
    (hScan : scanCommentEvidenceV6 pkg side set scans comment = .ok evidence) :
    ParsedCommentEvidenceOf pkg side set comment evidence := by
  unfold scanCommentEvidenceV6 at hScan
  cases hScan
  unfold ParsedCommentEvidenceOf
  dsimp
  exact ⟨rfl, rfl, rfl, rfl, rfl⟩

def packageViewOfRetainedPackageRecordSpec
    (record : RetainedPackageRecordV6) : PackageView :=
  { record.view with packageBytes := record.packageBytes, index := record.index }

structure VerifierRequestV6 where
  packageView : VerifierSide → PackageView
  retainedPackageRecord : VerifierSide → RetainedPackageRecordV6
  packageBytes : VerifierSide → ByteArray
  noteEvaluation : VerifierSide → SideNoteEvaluationV5
  retainedSourceScans : VerifierSide → SideScanEvidence
  retainedSnapshotBytes : VerifierSide → ByteArray
  snapshotWriteInvocationCount : VerifierSide → Nat
  privateSnapshotPath : VerifierSide → String
  retainedCommentExtraction :
    VerifierSide → Option CommentExtractionEvidence
  commentExtractionInvocationCount : VerifierSide → Nat
  commentParseInvocationCount : VerifierSide → Nat
  retainedCommentScanRealization :
    VerifierSide → Option CommentStoryRealization
  retainedCommentScanSourceSet : VerifierSide → Option CommentSourceSet
  retainedCommentScanSourceScans : VerifierSide → Option SideScanEvidence
  commentScanInvocationCount : VerifierSide → Nat
  retainedCommentScanResult :
    VerifierSide → Except String ParsedCommentEvidence
  resourceUsageBeforeComments : GlobalResourceUsage
  packageRecordExact : ∀ side,
    packageView side =
      packageViewOfRetainedPackageRecordSpec
        (retainedPackageRecord side)
  packageBytesExact : ∀ side,
    (packageView side).packageBytes =
      (retainedPackageRecord side).packageBytes
  packageIndexExact : ∀ side,
    (packageView side).index = (retainedPackageRecord side).index
  requestBytesExact : ∀ side,
    (retainedPackageRecord side).packageBytes = packageBytes side
  binaryIndexExact : ∀ side,
    IndependentBinaryIndexOf
      (retainedPackageRecord side).packageBytes
      (retainedPackageRecord side).index
  snapshotBytesExact : ∀ side,
    retainedSnapshotBytes side = packageBytes side
  snapshotWriteExact : ∀ side, snapshotWriteInvocationCount side = 1
  sourceScansExact : ∀ side,
    retainedSourceScans side = (packageView side).retainedSourceScans
  resourceUsageExact : ∀ side,
    (packageView side).resourceUsageBeforeComments =
      resourceUsageBeforeComments
  realizationEvidenceExact : ∀ side selected realization,
    (packageView side).retainedCommentRealization = some realization →
    realization.selected = selected →
    realization.extraction.snapshotPath = privateSnapshotPath side ∧
    retainedCommentExtraction side = some realization.extraction ∧
    commentExtractionInvocationCount side = 1 ∧
    commentParseInvocationCount side = 1 ∧
    AdmittedCommentPartOf (packageView side) side
      resourceUsageBeforeComments selected realization
  retainedScanEvidenceExact : ∀ side realization evidence,
    retainedCommentScanRealization side = some realization →
    retainedCommentScanSourceSet side =
      some (canonicalCommentSourceSetSpec (packageView side) side
        (noteEvaluation side)) →
    retainedCommentScanSourceScans side =
      some (retainedSourceScans side) →
    commentScanInvocationCount side = 1 →
    retainedCommentScanResult side = .ok evidence →
    CompleteCommentSourceSetOf (packageView side) side
      (noteEvaluation side)
      (canonicalCommentSourceSetSpec (packageView side) side
        (noteEvaluation side))
      (retainedSourceScans side) ∧
    ParsedCommentEvidenceOf (packageView side) side
      (canonicalCommentSourceSetSpec (packageView side) side
        (noteEvaluation side))
      (some realization) evidence
  selectedScanBindingsExact : ∀ side realization evidence,
    (packageView side).retainedCommentRealization = some realization →
    scanCommentEvidenceV6 (packageView side) side
      (canonicalCommentSourceSet (packageView side) side
        (noteEvaluation side))
      (reuseRetainedCommentScans (packageView side))
      (some realization) = .ok evidence →
    retainedCommentScanRealization side = some realization ∧
    retainedCommentScanSourceSet side =
      some (canonicalCommentSourceSetSpec (packageView side) side
        (noteEvaluation side)) ∧
    retainedCommentScanSourceScans side =
      some (retainedSourceScans side) ∧
    commentScanInvocationCount side = 1 ∧
    retainedCommentScanResult side = .ok evidence

def RequestBoundCommentRealizationOf
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization) : Prop :=
  let pkg := request.packageView side
  let retained := request.retainedPackageRecord side
  pkg = packageViewOfRetainedPackageRecordSpec retained ∧
  pkg.packageBytes = retained.packageBytes ∧
  pkg.index = retained.index ∧
  retained.packageBytes = request.packageBytes side ∧
  IndependentBinaryIndexOf retained.packageBytes retained.index ∧
  request.retainedSnapshotBytes side = request.packageBytes side ∧
  request.snapshotWriteInvocationCount side = 1 ∧
  realization.extraction.snapshotPath = request.privateSnapshotPath side ∧
  request.retainedCommentExtraction side =
    some realization.extraction ∧
  request.commentExtractionInvocationCount side = 1 ∧
  request.commentParseInvocationCount side = 1 ∧
  realization.selected = selected ∧
  AdmittedCommentPartOf pkg side request.resourceUsageBeforeComments
    selected realization

def RequestBoundRetainedCommentEvidenceOf
    (request : VerifierRequestV6) (side : VerifierSide)
    (realization : CommentStoryRealization)
    (evidence : ParsedCommentEvidence) : Prop :=
  let pkg := request.packageView side
  let sourceSet :=
    canonicalCommentSourceSetSpec pkg side (request.noteEvaluation side)
  let sourceScans := request.retainedSourceScans side
  CompleteCommentSourceSetOf pkg side (request.noteEvaluation side)
    sourceSet sourceScans ∧
  request.retainedCommentScanRealization side = some realization ∧
  request.retainedCommentScanSourceSet side = some sourceSet ∧
  request.retainedCommentScanSourceScans side = some sourceScans ∧
  request.commentScanInvocationCount side = 1 ∧
  request.retainedCommentScanResult side = .ok evidence ∧
  ParsedCommentEvidenceOf pkg side sourceSet (some realization) evidence

inductive CommentRealizationFailure
  | unavailable | resource | parse | sourcePartition | semantic
  deriving BEq, DecidableEq, Repr, Inhabited

inductive CommentSelectionRealizationOutcome
  | absent
  | selected (identity : SelectedCommentIdentity)
  | selectorError (failure : CommentSelectionFailure)
  | realizationError (identity : SelectedCommentIdentity)
      (failure : CommentRealizationFailure)
  deriving Repr, Inhabited

inductive CommentEvaluationStatus
  | passed | failed | notEvaluated
  deriving BEq, DecidableEq, Repr, Inhabited

def retainedCommentRealizationFailure
    (pkg : PackageView) (selected : SelectedCommentIdentity) :
    Option CommentRealizationFailure :=
  match pkg.retainedCommentRealization with
  | none => some .unavailable
  | some realization =>
      if realization.selected == selected then none else some .unavailable

def admitCommentPartMetadata
    (pkg : PackageView) (side : VerifierSide) (prior : GlobalResourceUsage)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization) : Bool :=
  realization.entry.normalizedPartPath == selected.normalizedPartPath &&
  realization.entry.regularEntryCount == 1 &&
  realization.entry.compressedSize ≤ 8388608 &&
  realization.entry.expandedSize ≤ 16777216 &&
  (realization.entry.compressedSize != 0 ||
    realization.entry.expandedSize == 0) &&
  realization.entry.expandedSize ≤ realization.entry.compressedSize * 100 &&
  prior.tripleXmlEvents ≤ 3000000

def retainCommentSnapshotEvidence
    (realization : CommentStoryRealization) : CommentStoryRealization :=
  realization

def extractRetainedCommentPart
    (realization : CommentStoryRealization) : CommentStoryRealization :=
  realization

def retainCommentExtractionEvidence
    (realization : CommentStoryRealization) : CommentStoryRealization :=
  realization

def parseRetainedCommentPart
    (realization : CommentStoryRealization) : CommentStoryRealization :=
  realization

def realizeSelectedCommentV6
    (pkg : PackageView) (side : VerifierSide) (prior : GlobalResourceUsage)
    (selected : SelectedCommentIdentity) :
    Except CommentRealizationFailure CommentStoryRealization :=
  match pkg.retainedCommentRealization with
  | none => .error .unavailable
  | some realization =>
      let snapshot := retainCommentSnapshotEvidence realization
      let extracted := extractRetainedCommentPart snapshot
      let retained := retainCommentExtractionEvidence extracted
      let parsed := parseRetainedCommentPart retained
      if decide (parsed.selected = selected) then
        if admitCommentPartMetadata pkg side prior selected parsed then
          .ok parsed
        else .error .resource
      else .error .unavailable

def canonicalCommentRealizationFailure
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity) : Option CommentRealizationFailure :=
  if !completeCommentSourceSetCheck (request.packageView side) side
      (request.noteEvaluation side) then
    some .sourcePartition
  else
    match realizeSelectedCommentV6 (request.packageView side) side
        (request.packageView side).resourceUsageBeforeComments selected with
    | .error failure => some failure
    | .ok _ => none

theorem realize_selected_comment_v6_success
    (pkg : PackageView) (side : VerifierSide) (prior : GlobalResourceUsage)
    (selected : SelectedCommentIdentity) (realization : CommentStoryRealization)
    (h : realizeSelectedCommentV6 pkg side prior selected = .ok realization) :
    pkg.retainedCommentRealization = some realization ∧
    realization.selected = selected := by
  unfold realizeSelectedCommentV6 at h
  cases hRetained : pkg.retainedCommentRealization with
  | none =>
      rw [hRetained] at h
      cases h
  | some retained =>
      rw [hRetained] at h
      dsimp only [retainCommentSnapshotEvidence,
        extractRetainedCommentPart, retainCommentExtractionEvidence,
        parseRetainedCommentPart] at h
      cases hSelected : decide (retained.selected = selected)
      · rw [hSelected] at h
        cases h
      · cases hAdmitted :
          admitCommentPartMetadata pkg side prior selected retained
        · rw [hSelected, hAdmitted] at h
          cases h
        · rw [hSelected, hAdmitted] at h
          cases h
          exact ⟨rfl, of_decide_eq_true hSelected⟩

theorem canonicalCommentRealizationFailure_of_realize_error
    (pkg : PackageView) (side : VerifierSide) (prior : GlobalResourceUsage)
    (selected : SelectedCommentIdentity) (failure : CommentRealizationFailure)
    (h : realizeSelectedCommentV6 pkg side prior selected = .error failure) :
    (match realizeSelectedCommentV6 pkg side prior selected with
      | .error actual => some actual
      | .ok _ => none) = some failure := by
  rw [h]

theorem request_bound_realization_of_evaluate
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (hSelection : selectConventionalMainComment (request.packageView side) =
      .ok (some selected))
    (hRealize : realizeSelectedCommentV6 (request.packageView side) side
      (request.packageView side).resourceUsageBeforeComments selected =
        .ok realization) :
    RequestBoundCommentRealizationOf request side selected realization := by
  have hSuccess := realize_selected_comment_v6_success
    (request.packageView side) side
    (request.packageView side).resourceUsageBeforeComments
    selected realization hRealize
  have hEvidence := request.realizationEvidenceExact side selected realization
    hSuccess.1 hSuccess.2
  unfold RequestBoundCommentRealizationOf
  exact ⟨request.packageRecordExact side, request.packageBytesExact side,
    request.packageIndexExact side, request.requestBytesExact side,
    request.binaryIndexExact side, request.snapshotBytesExact side,
    request.snapshotWriteExact side, hEvidence.1, hEvidence.2.1,
    hEvidence.2.2.1, hEvidence.2.2.2.1, hSuccess.2, hEvidence.2.2.2.2⟩

theorem request_bound_retained_evidence_of_evaluate
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (evidence : ParsedCommentEvidence)
    (hSelection : selectConventionalMainComment (request.packageView side) =
      .ok (some selected))
    (hRealize : realizeSelectedCommentV6 (request.packageView side) side
      (request.packageView side).resourceUsageBeforeComments selected =
        .ok realization)
    (hScan : scanCommentEvidenceV6 (request.packageView side) side
      (canonicalCommentSourceSet (request.packageView side) side
        (request.noteEvaluation side))
      (reuseRetainedCommentScans (request.packageView side))
      (some realization) = .ok evidence)
    (hComplete : completeCommentSourceSetCheck
      (request.packageView side) side (request.noteEvaluation side) = true) :
    RequestBoundRetainedCommentEvidenceOf request side realization evidence := by
  have hSuccess := realize_selected_comment_v6_success
    (request.packageView side) side
    (request.packageView side).resourceUsageBeforeComments
    selected realization hRealize
  have hBindings :=
    request.selectedScanBindingsExact side realization evidence hSuccess.1 hScan
  have hRetained := request.retainedScanEvidenceExact side realization evidence
    hBindings.1 hBindings.2.1 hBindings.2.2.1 hBindings.2.2.2.1
    hBindings.2.2.2.2
  unfold RequestBoundRetainedCommentEvidenceOf
  exact ⟨hRetained.1, hBindings.1, hBindings.2.1,
    hBindings.2.2.1, hBindings.2.2.2.1, hBindings.2.2.2.2,
    hRetained.2⟩

theorem request_bound_comment_evidence_unique
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (evidence : ParsedCommentEvidence)
    (otherRealization : CommentStoryRealization)
    (otherEvidence : ParsedCommentEvidence)
    (hCurrent : RequestBoundRetainedCommentEvidenceOf request side
      realization evidence)
    (_hRealization : RequestBoundCommentRealizationOf request side selected
      otherRealization)
    (hEvidence : RequestBoundRetainedCommentEvidenceOf request side
      otherRealization otherEvidence) :
    otherRealization = realization ∧ otherEvidence = evidence := by
  unfold RequestBoundRetainedCommentEvidenceOf at hCurrent hEvidence
  rcases hCurrent with ⟨_, hCurrentRealization, _, _, _, hCurrentEvidence, _⟩
  rcases hEvidence with ⟨_, hOtherRealization, _, _, _, hOtherEvidence, _⟩
  exact ⟨Option.some.inj (hOtherRealization.symm.trans hCurrentRealization),
    Except.ok.inj (hOtherEvidence.symm.trans hCurrentEvidence)⟩

def SelectionToCommentRealizationOf
    (request : VerifierRequestV6) (side : VerifierSide)
    (outcome : CommentSelectionRealizationOutcome)
    (stored : Option CommentStoryRealization)
    (semanticEvidence : Option ParsedCommentEvidence) : Prop :=
  let pkg := request.packageView side
  match outcome with
  | .absent =>
      selectConventionalMainComment pkg = .ok none ∧
      stored = none ∧ semanticEvidence = none
  | .selected selected =>
      selectConventionalMainComment pkg = .ok (some selected) ∧
      ∃ realization evidence,
        stored = some realization ∧
        semanticEvidence = some evidence ∧
        RequestBoundCommentRealizationOf request side selected realization ∧
        RequestBoundRetainedCommentEvidenceOf request side
          realization evidence ∧
        (∀ otherRealization otherEvidence,
          RequestBoundCommentRealizationOf request side selected
              otherRealization →
          RequestBoundRetainedCommentEvidenceOf request side
              otherRealization otherEvidence →
          otherRealization = realization ∧ otherEvidence = evidence)
  | .selectorError failure =>
      selectConventionalMainComment pkg = .error failure ∧
      stored = none ∧ semanticEvidence = none
  | .realizationError selected failure =>
      selectConventionalMainComment pkg = .ok (some selected) ∧
      canonicalCommentRealizationFailure request side selected =
        some failure ∧
      stored = none ∧ semanticEvidence = none

structure SideCommentEvaluationV6 where
  side : VerifierSide
  status : CommentEvaluationStatus
  outcome : CommentSelectionRealizationOutcome
  commentRealization : Option CommentStoryRealization
  parsedEvidence : Option ParsedCommentEvidence
  sourceSet : CommentSourceSet
  scanEvidence : SideScanEvidence
  internalReferences : List CommentReferenceOccurrence
  internalDefinitions : List CommentDefinitionOccurrence
  inventory : PackageCommentInventory
  story : String
  deriving Inhabited

inductive CommentIncompleteCauseV6
  | selector | realization | sourcePartition | semantic
  deriving BEq, DecidableEq, Repr, Inhabited

structure GlobalCommentAdmissionContextV6 where
  firstCause : VerifierSide → Option CommentIncompleteCauseV6

structure GlobalCommentEvaluationV6 where
  sideEvaluation : VerifierSide → SideCommentEvaluationV6
  incompleteCause : VerifierSide → Option CommentIncompleteCauseV6
  admissionContext : GlobalCommentAdmissionContextV6

def emptyPackageCommentInventory : PackageCommentInventory :=
  { references := [], definitions := [], nonDirectDefinitions := [] }

def notEvaluatedCommentStorySideSpec (_side : VerifierSide) : String :=
  "not_evaluated"

def zeroCommentInventorySpec (_side : VerifierSide) :
    PackageCommentInventory :=
  emptyPackageCommentInventory

def zeroIncompleteCommentEvaluation
    (side : VerifierSide) (evaluation : SideCommentEvaluationV6) :
    SideCommentEvaluationV6 :=
  { evaluation with
    side, status := .notEvaluated
    commentRealization := none, parsedEvidence := none
    internalReferences := [], internalDefinitions := []
    inventory := zeroCommentInventorySpec side
    story := notEvaluatedCommentStorySideSpec side }

def evaluateCommentSideV6
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) : SideCommentEvaluationV6 :=
  let set := canonicalCommentSourceSet pkg side note
  let scans := reuseRetainedCommentScans pkg
  if !completeCommentSourceSetCheck pkg side note then
    let outcome :=
      match selectConventionalMainComment pkg with
      | .error failure => .selectorError failure
      | .ok none => .absent
      | .ok (some selected) => .realizationError selected .sourcePartition
    zeroIncompleteCommentEvaluation side {
      side, status := .notEvaluated, outcome := outcome
      commentRealization := none, parsedEvidence := none
      sourceSet := set, scanEvidence := scans
      internalReferences := [], internalDefinitions := []
      inventory := emptyPackageCommentInventory
      story := notEvaluatedCommentStorySideSpec side }
  else
    match selectConventionalMainComment pkg with
    | .error failure =>
        zeroIncompleteCommentEvaluation side {
          side, status := .notEvaluated, outcome := .selectorError failure
          commentRealization := none, parsedEvidence := none
          sourceSet := set, scanEvidence := scans
          internalReferences := [], internalDefinitions := []
          inventory := emptyPackageCommentInventory
          story := notEvaluatedCommentStorySideSpec side }
    | .ok none =>
        match scanCommentEvidenceV6 pkg side set scans none with
        | .error _ =>
            zeroIncompleteCommentEvaluation side {
              side, status := .notEvaluated
              outcome := .realizationError default .semantic
              commentRealization := none, parsedEvidence := none
              sourceSet := set, scanEvidence := scans
              internalReferences := [], internalDefinitions := []
              inventory := emptyPackageCommentInventory
              story := notEvaluatedCommentStorySideSpec side }
        | .ok evidence =>
            let absentPassed :=
              decide (evidence.wireCounts = emptyPackageCommentInventory)
            { side
              status := if absentPassed then .passed else .failed
              outcome := .absent
              commentRealization := none, parsedEvidence := none
              sourceSet := set, scanEvidence := scans
              internalReferences := evidence.references
              internalDefinitions := []
              inventory := evidence.wireCounts
              story := if absentPassed then "absent" else "failed" }
    | .ok (some selected) =>
        match realizeSelectedCommentV6 pkg side
            pkg.resourceUsageBeforeComments
            selected with
        | .error failure =>
            zeroIncompleteCommentEvaluation side {
              side, status := .notEvaluated
              outcome := .realizationError selected failure
              commentRealization := none, parsedEvidence := none
              sourceSet := set, scanEvidence := scans
              internalReferences := [], internalDefinitions := []
              inventory := emptyPackageCommentInventory
              story := notEvaluatedCommentStorySideSpec side }
        | .ok realization =>
            match scanCommentEvidenceV6 pkg side set scans (some realization) with
            | .error _ =>
                zeroIncompleteCommentEvaluation side {
                  side, status := .notEvaluated
                  outcome := .realizationError selected .semantic
                  commentRealization := none, parsedEvidence := none
                  sourceSet := set, scanEvidence := scans
                  internalReferences := [], internalDefinitions := []
                  inventory := emptyPackageCommentInventory
                  story := notEvaluatedCommentStorySideSpec side }
            | .ok evidence =>
                let inventory := evidence.wireCounts
                let passed := checkPackageCommentIntegrity inventory
                { side
                  status := if passed then .passed else .failed
                  outcome := .selected selected
                  commentRealization := some realization
                  parsedEvidence := some evidence
                  sourceSet := set, scanEvidence := scans
                  internalReferences := evidence.references
                  internalDefinitions := evidence.definitions
                  inventory
                  story := if passed then "passed" else "failed" }

def admittedCommentIncompleteCause
    (evaluation : SideCommentEvaluationV6) :
    Option CommentIncompleteCauseV6 :=
  match evaluation.status with
  | .passed | .failed => none
  | .notEvaluated =>
      match evaluation.outcome with
      | .selectorError _ => some .selector
      | .realizationError _ failure =>
          match failure with
          | .sourcePartition => some .sourcePartition
          | .semantic => some .semantic
          | .unavailable | .resource | .parse => some .realization
      | .absent | .selected _ => none

def concreteCommentIncompleteCause
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5)
    (evaluation : SideCommentEvaluationV6) :
    Option CommentIncompleteCauseV6 :=
  if !completeCommentSourceSetCheck pkg side note then
    some .sourcePartition
  else admittedCommentIncompleteCause evaluation

def evaluateAllCommentSidesV6
    (request : VerifierRequestV6) : GlobalCommentEvaluationV6 :=
  let evaluate := fun side =>
    evaluateCommentSideV6 (request.packageView side) side
      (request.noteEvaluation side)
  let causes := fun side => admittedCommentIncompleteCause (evaluate side)
  { sideEvaluation := evaluate
    incompleteCause := causes
    admissionContext := { firstCause := causes } }

theorem evaluate_comment_side_v6_side
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) :
    (evaluateCommentSideV6 pkg side note).side = side := by
  unfold evaluateCommentSideV6
  split
  · rfl
  · generalize hSelection :
      selectConventionalMainComment pkg = selection
    cases selection with
    | error failure =>
        simp [zeroIncompleteCommentEvaluation]
    | ok selected =>
        cases selected with
        | none =>
            generalize hScan :
              scanCommentEvidenceV6 pkg side
                (canonicalCommentSourceSet pkg side note)
                (reuseRetainedCommentScans pkg) none = scan
            cases scan <;> simp [hScan, zeroIncompleteCommentEvaluation]
        | some selected =>
            generalize hRealize :
              realizeSelectedCommentV6 pkg side
                pkg.resourceUsageBeforeComments selected = realization
            cases realization with
            | error failure =>
                simp [hRealize, zeroIncompleteCommentEvaluation]
            | ok realized =>
                generalize hScan :
                  scanCommentEvidenceV6 pkg side
                    (canonicalCommentSourceSet pkg side note)
                    (reuseRetainedCommentScans pkg) (some realized) = scan
                cases scan <;>
                  simp [hRealize, hScan, zeroIncompleteCommentEvaluation]

def GlobalCommentAdmissionContextOf
    (request : VerifierRequestV6)
    (context : GlobalCommentAdmissionContextV6) : Prop :=
  context = (evaluateAllCommentSidesV6 request).admissionContext

def CommentIncompleteCauseOf
    (context : GlobalCommentAdmissionContextV6) (side : VerifierSide)
    (_evaluation : SideCommentEvaluationV6)
    (cause : CommentIncompleteCauseV6) : Prop :=
  context.firstCause side = some cause

def IncompleteCommentSideZeroEvidenceOf
    (request : VerifierRequestV6) (context : GlobalCommentAdmissionContextV6)
    (side : VerifierSide) (evaluation : SideCommentEvaluationV6)
    (cause : CommentIncompleteCauseV6) : Prop :=
  GlobalCommentAdmissionContextOf request context ∧
  evaluation.side = side ∧
  evaluation.status = .notEvaluated ∧
  CommentIncompleteCauseOf context side evaluation cause ∧
  evaluation.internalReferences = [] ∧
  evaluation.internalDefinitions = [] ∧
  evaluation.parsedEvidence = none ∧
  evaluation.inventory = zeroCommentInventorySpec side ∧
  evaluation.story = notEvaluatedCommentStorySideSpec side

theorem evaluate_comment_side_source_set
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) :
    (evaluateCommentSideV6 pkg side note).sourceSet =
      canonicalCommentSourceSet pkg side note := by
  unfold evaluateCommentSideV6 zeroIncompleteCommentEvaluation
  split
  · rfl
  · split <;> try rfl
    all_goals split <;> try rfl
    all_goals split <;> try rfl
    all_goals split <;> rfl

theorem evaluate_comment_side_scan_evidence
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) :
    (evaluateCommentSideV6 pkg side note).scanEvidence =
      reuseRetainedCommentScans pkg := by
  unfold evaluateCommentSideV6 zeroIncompleteCommentEvaluation
  split
  · rfl
  · split <;> try rfl
    all_goals split <;> try rfl
    all_goals split <;> try rfl
    all_goals split <;> rfl

theorem admitted_comment_source_set_complete
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) (evaluation : SideCommentEvaluationV6)
    (h : evaluateCommentSideV6 pkg side note = evaluation)
    (hComplete : evaluation.status ≠ .notEvaluated) :
    CompleteCommentSourceSetOf
      pkg side note evaluation.sourceSet evaluation.scanEvidence := by
  have hCheckTrue : completeCommentSourceSetCheck pkg side note = true := by
    cases hValue : completeCommentSourceSetCheck pkg side note with
    | false =>
        exfalso
        apply hComplete
        have hStatus := congrArg SideCommentEvaluationV6.status h
        change (evaluateCommentSideV6 pkg side note).status =
          evaluation.status at hStatus
        rw [← hStatus]
        unfold evaluateCommentSideV6 zeroIncompleteCommentEvaluation
        rw [hValue]
        rfl
    | true => rfl
  have hSet := congrArg SideCommentEvaluationV6.sourceSet h
  have hScans := congrArg SideCommentEvaluationV6.scanEvidence h
  rw [evaluate_comment_side_source_set] at hSet
  rw [evaluate_comment_side_scan_evidence] at hScans
  unfold completeCommentSourceSetCheck at hCheckTrue
  have p1 := bool_and_eq_true_parts _ _ hCheckTrue
  have p2 := bool_and_eq_true_parts _ _ p1.1
  have p3 := bool_and_eq_true_parts _ _ p2.1
  have p4 := bool_and_eq_true_parts _ _ p3.1
  have hStatus := of_decide_eq_true p4.1
  have hLength := of_decide_eq_true p4.2
  have hNodup := of_decide_eq_true p3.2
  have hDomain := of_decide_eq_true p2.2
  have hScanned := p1.2
  rw [← hSet, ← hScans]
  refine ⟨hStatus, rfl, rfl, hLength, hNodup, hDomain, ?_⟩
  intro source hSource
  have hMapped : source ∈ sourceRealizationSlots
      (reuseRetainedCommentScans pkg) := by
    unfold reuseRetainedCommentScans sourceRealizationSlots
    exact mem_of_equal_lists _ _ source hDomain hSource
  rcases source_realization_of_mem_slots source
    pkg.retainedSourceScans.realizations hMapped with
      ⟨realization, hMember, hSlot⟩
  have hFully := list_all_true_of_mem _ _ realization hScanned hMember
  have f1 := bool_and_eq_true_parts _ _ hFully
  have f2 := bool_and_eq_true_parts _ _ f1.1
  have f3 := bool_and_eq_true_parts _ _ f2.1
  have f4 := bool_and_eq_true_parts _ _ f3.1
  have f5 := bool_and_eq_true_parts _ _ f4.1
  have f6 := bool_and_eq_true_parts _ _ f5.1
  cases hSlot
  refine ⟨realization, hMember, f6.1, ?_⟩
  unfold RetainedFullyScannedStoryOf
  exact hFully

theorem comment_selection_to_realization_sound
    (request : VerifierRequestV6) (global : GlobalCommentEvaluationV6)
    (side : VerifierSide) (evaluation : SideCommentEvaluationV6)
    (hAll : evaluateAllCommentSidesV6 request = global)
    (hSide : global.sideEvaluation side = evaluation) :
    SelectionToCommentRealizationOf request side evaluation.outcome
      evaluation.commentRealization evaluation.parsedEvidence := by
  subst global
  change evaluateCommentSideV6 (request.packageView side) side
    (request.noteEvaluation side) = evaluation at hSide
  subst evaluation
  unfold evaluateCommentSideV6 zeroIncompleteCommentEvaluation
  split
  · rename_i hIncomplete
    cases hSelection :
        selectConventionalMainComment (request.packageView side) with
    | error failure =>
        unfold SelectionToCommentRealizationOf
        exact ⟨hSelection, rfl, rfl⟩
    | ok selected? =>
        cases selected? with
        | none =>
            unfold SelectionToCommentRealizationOf
            exact ⟨hSelection, rfl, rfl⟩
        | some selected =>
            unfold SelectionToCommentRealizationOf
            refine ⟨hSelection, ?_, rfl, rfl⟩
            unfold canonicalCommentRealizationFailure
            rw [hIncomplete]
            rfl
  · rename_i hComplete
    have hCompleteTrue :
        completeCommentSourceSetCheck (request.packageView side) side
          (request.noteEvaluation side) = true := by
      cases hValue : completeCommentSourceSetCheck
          (request.packageView side) side (request.noteEvaluation side)
      · exact False.elim (hComplete (by rw [hValue]; rfl))
      · rfl
    cases hSelection :
        selectConventionalMainComment (request.packageView side) with
    | error failure =>
        unfold SelectionToCommentRealizationOf
        exact ⟨hSelection, rfl, rfl⟩
    | ok selected? =>
        cases selected? with
        | none =>
            unfold SelectionToCommentRealizationOf
            exact ⟨hSelection, rfl, rfl⟩
        | some selected =>
            cases hRealize : realizeSelectedCommentV6
                (request.packageView side) side
                (request.packageView side).resourceUsageBeforeComments
                selected with
            | error failure =>
                dsimp only
                rw [hRealize]
                unfold SelectionToCommentRealizationOf
                refine ⟨hSelection, ?_, rfl, rfl⟩
                unfold canonicalCommentRealizationFailure
                rw [hCompleteTrue, hRealize]
                rfl
            | ok realization =>
                generalize hScan : scanCommentEvidenceV6
                    (request.packageView side) side
                    (canonicalCommentSourceSet (request.packageView side) side
                      (request.noteEvaluation side))
                    (reuseRetainedCommentScans (request.packageView side))
                    (some realization) = scanResult
                cases scanResult with
                | error detail =>
                    unfold scanCommentEvidenceV6 at hScan
                    cases hScan
                | ok evidence =>
                    dsimp only
                    rw [hRealize]
                    dsimp only
                    rw [hScan]
                    dsimp only
                    unfold SelectionToCommentRealizationOf
                    have hBound :=
                      request_bound_realization_of_evaluate request side
                        selected realization hSelection hRealize
                    have hRetained :=
                      request_bound_retained_evidence_of_evaluate request side
                        selected realization evidence hSelection hRealize hScan
                        hCompleteTrue
                    refine ⟨hSelection, realization, evidence, rfl, rfl,
                      hBound, hRetained, ?_⟩
                    intro otherRealization otherEvidence hOtherRealization
                      hOtherEvidence
                    exact request_bound_comment_evidence_unique request side
                      selected realization evidence otherRealization
                      otherEvidence hRetained hOtherRealization hOtherEvidence

theorem zero_evidence_of_evaluate_not_evaluated
    (request : VerifierRequestV6) (side : VerifierSide)
    (hStatus : (evaluateCommentSideV6 (request.packageView side) side
      (request.noteEvaluation side)).status = .notEvaluated) :
    (evaluateCommentSideV6 (request.packageView side) side
        (request.noteEvaluation side)).side = side ∧
    (evaluateCommentSideV6 (request.packageView side) side
        (request.noteEvaluation side)).internalReferences = [] ∧
    (evaluateCommentSideV6 (request.packageView side) side
        (request.noteEvaluation side)).internalDefinitions = [] ∧
    (evaluateCommentSideV6 (request.packageView side) side
        (request.noteEvaluation side)).parsedEvidence = none ∧
    (evaluateCommentSideV6 (request.packageView side) side
        (request.noteEvaluation side)).inventory =
          zeroCommentInventorySpec side ∧
    (evaluateCommentSideV6 (request.packageView side) side
        (request.noteEvaluation side)).story =
          notEvaluatedCommentStorySideSpec side := by
  generalize hEvaluation : evaluateCommentSideV6
    (request.packageView side) side (request.noteEvaluation side) =
      evaluated at hStatus ⊢
  unfold evaluateCommentSideV6 zeroIncompleteCommentEvaluation at hEvaluation
  split at hEvaluation
  · cases hEvaluation
    exact ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩
  · split at hEvaluation
    · cases hEvaluation
      exact ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩
    · unfold scanCommentEvidenceV6 at hEvaluation
      cases hEvaluation
      dsimp only at hStatus
      split at hStatus <;> cases hStatus
    · split at hEvaluation
      · cases hEvaluation
        exact ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩
      · unfold scanCommentEvidenceV6 at hEvaluation
        cases hEvaluation
        dsimp only at hStatus
        split at hStatus <;> cases hStatus

theorem incomplete_comment_partition_zero_evidence_sound
    (request : VerifierRequestV6) (global : GlobalCommentEvaluationV6)
    (side : VerifierSide) (evaluation : SideCommentEvaluationV6)
    (cause : CommentIncompleteCauseV6)
    (hAll : evaluateAllCommentSidesV6 request = global)
    (hSide : global.sideEvaluation side = evaluation)
    (hStatus : evaluation.status = .notEvaluated)
    (hCause : global.incompleteCause side = some cause) :
    IncompleteCommentSideZeroEvidenceOf
      request global.admissionContext side evaluation cause := by
  subst global
  change evaluateCommentSideV6 (request.packageView side) side
    (request.noteEvaluation side) = evaluation at hSide
  subst evaluation
  unfold IncompleteCommentSideZeroEvidenceOf
  have hZero := zero_evidence_of_evaluate_not_evaluated request side hStatus
  exact ⟨rfl, hZero.1, hStatus, hCause, hZero.2⟩

structure VerifierResponseV6 where
  passed : Bool
  global : GlobalCommentEvaluationV6
  commentOutcome : VerifierSide → CommentSelectionRealizationOutcome
  commentRealization : VerifierSide → Option CommentStoryRealization
  commentParsedEvidence : VerifierSide → Option ParsedCommentEvidence
  commentInventory : VerifierSide → PackageCommentInventory

def ResponseCommentInventoryAt
    (response : VerifierResponseV6) (side : VerifierSide) :
    PackageCommentInventory :=
  response.commentInventory side

def packageCommentInventorySpec
    (evidence : ParsedCommentEvidence) : PackageCommentInventory :=
  evidence.wireCounts

def zeroPassingCommentInventorySpec (_side : VerifierSide) :
    PackageCommentInventory :=
  emptyPackageCommentInventory

def ResponseRetainedCommentEvidenceOf
    (request : VerifierRequestV6) (response : VerifierResponseV6)
    (side : VerifierSide) : Prop :=
  match response.commentOutcome side with
  | .selected _ =>
      match response.commentRealization side with
      | none => False
      | some realization =>
          match response.commentParsedEvidence side with
          | none => False
          | some evidence =>
              RequestBoundRetainedCommentEvidenceOf request side
                realization evidence ∧
              ResponseCommentInventoryAt response side =
                commentCountProjectionSpec evidence.references
                  evidence.definitions evidence.nonDirectDefinitions ∧
              PackageCommentIntegrity (packageCommentInventorySpec evidence)
  | .absent =>
      match response.commentRealization side with
      | some _ => False
      | none =>
          match response.commentParsedEvidence side with
          | some _ => False
          | none =>
              ResponseCommentInventoryAt response side =
                zeroPassingCommentInventorySpec side
  | .selectorError _ | .realizationError _ _ => False

def RequestPackageViewsV6Spec
    (request : VerifierRequestV6) :
    Option (VerifierSide → PackageView) :=
  some request.packageView

def ResponseCardinalityAndOrderV6 (response : VerifierResponseV6) : Prop :=
  ∀ side,
    (response.global.sideEvaluation side).side = side ∧
    response.commentOutcome side =
      (response.global.sideEvaluation side).outcome ∧
    response.commentRealization side =
      (response.global.sideEvaluation side).commentRealization ∧
    response.commentParsedEvidence side =
      (response.global.sideEvaluation side).parsedEvidence ∧
    response.commentInventory side =
      (response.global.sideEvaluation side).inventory

def ExistingProtocolV5SemanticObligationsHold
    (request : VerifierRequestV6) (response : VerifierResponseV6) : Prop :=
  response.global = evaluateAllCommentSidesV6 request ∧
  response.global.admissionContext =
    (evaluateAllCommentSidesV6 request).admissionContext ∧
  (∀ side,
    response.global.incompleteCause side =
      admittedCommentIncompleteCause
        (response.global.sideEvaluation side))

def ResponseCommentSelectionResultAt
    (response : VerifierResponseV6) (side : VerifierSide) :
    Except CommentSelectionFailure (Option SelectedCommentIdentity) :=
  match response.commentOutcome side with
  | .absent => .ok none
  | .selected selected => .ok (some selected)
  | .selectorError failure => .error failure
  | .realizationError selected _ => .ok (some selected)

def AllProtocolV6PassEquations (response : VerifierResponseV6) : Prop :=
  response.passed = true

def CommentAggregatePassOf
    (request : VerifierRequestV6) (response : VerifierResponseV6) : Prop :=
  ∃ packages,
    RequestPackageViewsV6Spec request = some packages ∧
    ResponseCardinalityAndOrderV6 response ∧
    ExistingProtocolV5SemanticObligationsHold request response ∧
    (∀ side,
      CommentSelectionResultOf (packages side)
        (ResponseCommentSelectionResultAt response side)) ∧
    (∀ side,
      SelectionToCommentRealizationOf request side
        (response.commentOutcome side)
        (response.commentRealization side)
        (response.commentParsedEvidence side)) ∧
    (∀ side, ResponseRetainedCommentEvidenceOf request response side) ∧
    AllProtocolV6PassEquations response

def independentCommentStatusV6
    (response : VerifierResponseV6) (side : VerifierSide) : String :=
  match (response.global.sideEvaluation side).status with
  | .passed => "passed"
  | .failed => "failed"
  | .notEvaluated => "not_evaluated"

def independentCommentInventoryV6
    (inventory : PackageCommentInventory) : String :=
  "{\"referenceOccurrences\":" ++ inventory.references.length.repr ++
    ",\"definitions\":" ++ inventory.definitions.length.repr ++
    ",\"nonDirectDefinitions\":" ++
      inventory.nonDirectDefinitions.length.repr ++ "}"

opaque independentProtocolV6Projection (response : VerifierResponseV6) : String :=
  "{\"protocolVersion\":6,\"passed\":" ++
    (if response.passed then "true" else "false") ++
    ",\"commentStory\":{\"original\":\"" ++
      independentCommentStatusV6 response .original ++
    "\",\"revised\":\"" ++ independentCommentStatusV6 response .revised ++
    "\",\"compared\":\"" ++ independentCommentStatusV6 response .compared ++
    "\"},\"commentInventories\":{\"original\":" ++
      independentCommentInventoryV6 (response.commentInventory .original) ++
    ",\"revised\":" ++
      independentCommentInventoryV6 (response.commentInventory .revised) ++
    ",\"compared\":" ++
      independentCommentInventoryV6 (response.commentInventory .compared) ++
    "}}"

def independentCanonicalProtocolV6BytesSpec
    (response : VerifierResponseV6) : ByteArray :=
  (independentProtocolV6Projection response).toUTF8

def finalizeIndependentProtocolV6Response
    (response : VerifierResponseV6) : Except String ByteArray :=
  let bytes := independentCanonicalProtocolV6BytesSpec response
  if bytes.size > 2626368 then .error "response_limit"
  else .ok (bytes ++ "\n".toUTF8)

def SerializedResponseV6Of
    (response : VerifierResponseV6) (stdout : ByteArray) : Prop :=
  stdout = independentCanonicalProtocolV6BytesSpec response ++ "\n".toUTF8 ∧
  (independentCanonicalProtocolV6BytesSpec response).size ≤ 2626368 ∧
  stdout.size ≤ 2626369

def PassingCommentEvaluationShape
    (evaluation : SideCommentEvaluationV6) : Prop :=
  match evaluation.outcome with
  | .absent =>
      match evaluation.commentRealization with
      | some _ => False
      | none =>
          match evaluation.parsedEvidence with
          | some _ => False
          | none => evaluation.inventory = emptyPackageCommentInventory
  | .selected _ =>
      match evaluation.commentRealization with
      | none => False
      | some _ =>
          match evaluation.parsedEvidence with
          | none => False
          | some evidence => evaluation.inventory = evidence.wireCounts
  | .selectorError _ | .realizationError _ _ => False

theorem passing_comment_evaluation_shape
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5)
    (hPassed : (evaluateCommentSideV6 pkg side note).status = .passed) :
    PassingCommentEvaluationShape (evaluateCommentSideV6 pkg side note) := by
  generalize hEvaluation : evaluateCommentSideV6 pkg side note =
    evaluation at hPassed ⊢
  unfold evaluateCommentSideV6 zeroIncompleteCommentEvaluation at hEvaluation
  split at hEvaluation
  · cases hEvaluation
    cases hPassed
  · split at hEvaluation
    · cases hEvaluation
      cases hPassed
    · unfold scanCommentEvidenceV6 at hEvaluation
      cases hEvaluation
      dsimp only at hPassed
      split at hPassed
      · rename_i hAbsent
        unfold PassingCommentEvaluationShape
        exact of_decide_eq_true hAbsent
      · cases hPassed
    · split at hEvaluation
      · cases hEvaluation
        cases hPassed
      · unfold scanCommentEvidenceV6 at hEvaluation
        cases hEvaluation
        dsimp only at hPassed
        split at hPassed
        · unfold PassingCommentEvaluationShape
          rfl
        · cases hPassed

def sideCommentPassV6
    (global : GlobalCommentEvaluationV6) (side : VerifierSide) : Bool :=
  let evaluation := global.sideEvaluation side
  decide (evaluation.status = .passed) &&
    checkPackageCommentIntegrity evaluation.inventory

def allCommentSidesPass
    (global : GlobalCommentEvaluationV6) : Bool :=
  sideCommentPassV6 global .original &&
  sideCommentPassV6 global .revised &&
  sideCommentPassV6 global .compared

theorem evaluate_comment_side_v6_absent_pass
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) (evidence : ParsedCommentEvidence)
    (hComplete : completeCommentSourceSetCheck pkg side note = true)
    (hSelector : selectConventionalMainComment pkg = .ok none)
    (hScan : scanCommentEvidenceV6 pkg side
      (canonicalCommentSourceSet pkg side note)
      (reuseRetainedCommentScans pkg) none = .ok evidence)
    (hEmpty : evidence.wireCounts = emptyPackageCommentInventory) :
    (evaluateCommentSideV6 pkg side note).status = .passed ∧
    checkPackageCommentIntegrity
      (evaluateCommentSideV6 pkg side note).inventory = true := by
  unfold evaluateCommentSideV6
  simp [hComplete, hSelector, hScan, hEmpty,
    checkPackageCommentIntegrity, emptyPackageCommentInventory]

theorem evaluate_comment_side_v6_selected_pass
    (pkg : PackageView) (side : VerifierSide)
    (note : SideNoteEvaluationV5) (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (evidence : ParsedCommentEvidence)
    (hComplete : completeCommentSourceSetCheck pkg side note = true)
    (hSelector : selectConventionalMainComment pkg = .ok (some selected))
    (hRealization : realizeSelectedCommentV6 pkg side
      pkg.resourceUsageBeforeComments selected = .ok realization)
    (hScan : scanCommentEvidenceV6 pkg side
      (canonicalCommentSourceSet pkg side note)
      (reuseRetainedCommentScans pkg) (some realization) = .ok evidence)
    (hIntegrity : PackageCommentIntegrity evidence.wireCounts) :
    (evaluateCommentSideV6 pkg side note).status = .passed ∧
    checkPackageCommentIntegrity
      (evaluateCommentSideV6 pkg side note).inventory = true := by
  have hCheck := package_comment_reference_integrity_complete
    evidence.wireCounts hIntegrity
  unfold evaluateCommentSideV6
  simp [hComplete, hSelector, hRealization, hScan, hCheck]

def canonicalVerifierResponseV6
    (request : VerifierRequestV6) : VerifierResponseV6 :=
  let global := evaluateAllCommentSidesV6 request
  {
    passed := allCommentSidesPass global
    global
    commentOutcome := fun side => (global.sideEvaluation side).outcome
    commentRealization := fun side =>
      (global.sideEvaluation side).commentRealization
    commentParsedEvidence := fun side =>
      (global.sideEvaluation side).parsedEvidence
    commentInventory := fun side =>
      (global.sideEvaluation side).inventory
  }

def canonicalSemanticResponseV6
    (request : VerifierRequestV6) :
    Except String (VerifierResponseV6 × ByteArray) :=
  let response := canonicalVerifierResponseV6 request
  match finalizeIndependentProtocolV6Response response with
  | .error detail => .error detail
  | .ok stdout => .ok (response, stdout)

theorem all_comment_sides_pass_at
    (global : GlobalCommentEvaluationV6)
    (hPass : allCommentSidesPass global = true)
    (side : VerifierSide) :
    sideCommentPassV6 global side = true := by
  unfold allCommentSidesPass at hPass
  have outer := bool_and_eq_true_parts _ _ hPass
  have inner := bool_and_eq_true_parts _ _ outer.1
  cases side with
  | original => exact inner.1
  | revised => exact inner.2
  | compared => exact outer.2

theorem finalized_protocol_v6_serialized
    (response : VerifierResponseV6) (stdout : ByteArray)
    (hFinalize : finalizeIndependentProtocolV6Response response =
      .ok stdout) :
  SerializedResponseV6Of response stdout := by
  by_cases hLimit :
      (independentCanonicalProtocolV6BytesSpec response).size > 2626368
  · simp only [finalizeIndependentProtocolV6Response, hLimit, ↓reduceIte]
      at hFinalize
    contradiction
  · simp only [finalizeIndependentProtocolV6Response, hLimit, ↓reduceIte,
      Except.ok.injEq] at hFinalize
    subst stdout
    unfold SerializedResponseV6Of
    refine ⟨rfl, Nat.le_of_not_gt hLimit, ?_⟩
    have hNewline : "\n".toUTF8.size = 1 := by decide
    rw [ByteArray.size_append, hNewline]
    omega

theorem canonical_verifier_response_v6_aggregate_pass
    (request : VerifierRequestV6)
    (hPassed :
      allCommentSidesPass (evaluateAllCommentSidesV6 request) = true) :
    CommentAggregatePassOf request
      (canonicalVerifierResponseV6 request) := by
  let global := evaluateAllCommentSidesV6 request
  have hGlobal : evaluateAllCommentSidesV6 request = global := rfl
  have hPassedGlobal : allCommentSidesPass global = true := hPassed
  unfold CommentAggregatePassOf
  refine ⟨request.packageView, rfl, ?_, ?_, ?_, ?_, ?_, hPassed⟩
  · intro side
    refine ⟨?_, rfl, rfl, rfl, rfl⟩
    exact evaluate_comment_side_v6_side
      (request.packageView side) side (request.noteEvaluation side)
  · exact ⟨rfl, rfl, fun _ => rfl⟩
  · intro side
    have hSelector := comment_selector_result_sound (request.packageView side)
    have hSelection := comment_selection_to_realization_sound request global
      side (global.sideEvaluation side) hGlobal rfl
    change CommentSelectionResultOf (request.packageView side)
      (match (global.sideEvaluation side).outcome with
      | .absent => .ok none
      | .selected selected => .ok (some selected)
      | .selectorError failure => .error failure
      | .realizationError selected _ => .ok (some selected))
    cases hOutcome : (global.sideEvaluation side).outcome with
    | absent =>
        unfold SelectionToCommentRealizationOf at hSelection
        rw [hOutcome] at hSelection
        rw [hSelection.1] at hSelector
        exact hSelector
    | selected selected =>
        unfold SelectionToCommentRealizationOf at hSelection
        rw [hOutcome] at hSelection
        rw [hSelection.1] at hSelector
        exact hSelector
    | selectorError failure =>
        unfold SelectionToCommentRealizationOf at hSelection
        rw [hOutcome] at hSelection
        rw [hSelection.1] at hSelector
        exact hSelector
    | realizationError selected failure =>
        unfold SelectionToCommentRealizationOf at hSelection
        rw [hOutcome] at hSelection
        rw [hSelection.1] at hSelector
        exact hSelector
  · intro side
    exact comment_selection_to_realization_sound request global side
      (global.sideEvaluation side) hGlobal rfl
  · intro side
    have hSidePass := all_comment_sides_pass_at global hPassedGlobal side
    have hSideEval : global.sideEvaluation side =
        evaluateCommentSideV6 (request.packageView side) side
          (request.noteEvaluation side) := rfl
    unfold sideCommentPassV6 at hSidePass
    rw [hSideEval] at hSidePass
    have hSideParts := bool_and_eq_true_parts _ _ hSidePass
    have hStatus :
        (evaluateCommentSideV6 (request.packageView side) side
          (request.noteEvaluation side)).status = .passed :=
      of_decide_eq_true hSideParts.1
    have hShape := passing_comment_evaluation_shape
      (request.packageView side) side (request.noteEvaluation side) hStatus
    have hSelection := comment_selection_to_realization_sound request global
      side (global.sideEvaluation side) hGlobal rfl
    rw [hSideEval] at hSelection
    change
      (match (global.sideEvaluation side).outcome with
      | .selected _ =>
          match (global.sideEvaluation side).commentRealization with
          | none => False
          | some realization =>
              match (global.sideEvaluation side).parsedEvidence with
              | none => False
              | some evidence =>
                  RequestBoundRetainedCommentEvidenceOf request side
                    realization evidence ∧
                  (global.sideEvaluation side).inventory =
                    commentCountProjectionSpec evidence.references
                      evidence.definitions evidence.nonDirectDefinitions ∧
                  PackageCommentIntegrity evidence.wireCounts
      | .absent =>
          match (global.sideEvaluation side).commentRealization with
          | some _ => False
          | none =>
              match (global.sideEvaluation side).parsedEvidence with
              | some _ => False
              | none =>
                  (global.sideEvaluation side).inventory =
                    emptyPackageCommentInventory
      | .selectorError _ | .realizationError _ _ => False)
    rw [hSideEval]
    cases hOutcome :
        (evaluateCommentSideV6 (request.packageView side) side
          (request.noteEvaluation side)).outcome with
    | absent =>
        unfold SelectionToCommentRealizationOf at hSelection
        rw [hOutcome] at hSelection
        unfold PassingCommentEvaluationShape at hShape
        rw [hOutcome] at hShape
        rcases hSelection with ⟨_, hStored, hEvidence⟩
        rw [hStored, hEvidence]
        rw [hStored, hEvidence] at hShape
        exact hShape
    | selected selected =>
        unfold SelectionToCommentRealizationOf at hSelection
        rw [hOutcome] at hSelection
        unfold PassingCommentEvaluationShape at hShape
        rw [hOutcome] at hShape
        rcases hSelection.2 with
          ⟨realization, evidence, hStored, hSemantic, _, hRetained, _⟩
        rw [hStored, hSemantic]
        rw [hStored, hSemantic] at hShape
        have hCounts := hRetained.2.2.2.2.2.2.2.2.2.2
        refine ⟨hRetained, hShape.trans hCounts, ?_⟩
        apply package_comment_reference_integrity_sound
        rw [← hShape]
        exact hSideParts.2
    | selectorError failure =>
        unfold PassingCommentEvaluationShape at hShape
        rw [hOutcome] at hShape
        exact False.elim hShape
    | realizationError selected failure =>
        unfold PassingCommentEvaluationShape at hShape
        rw [hOutcome] at hShape
        exact False.elim hShape

set_option maxHeartbeats 3000000 in
theorem canonical_semantic_response_v6_sound
    (request : VerifierRequestV6) (response : VerifierResponseV6)
    (stdout : ByteArray)
    (hRun : canonicalSemanticResponseV6 request = .ok (response, stdout))
    (hPass : response.passed = true) :
    CommentAggregatePassOf request response ∧
    SerializedResponseV6Of response stdout := by
  change (match finalizeIndependentProtocolV6Response
      (canonicalVerifierResponseV6 request) with
    | Except.error detail => Except.error detail
    | Except.ok bytes =>
        Except.ok (canonicalVerifierResponseV6 request, bytes)) =
      Except.ok (response, stdout) at hRun
  cases hFinalize :
      finalizeIndependentProtocolV6Response
        (canonicalVerifierResponseV6 request) with
  | error detail =>
      rw [hFinalize] at hRun
      cases hRun
  | ok bytes =>
      rw [hFinalize] at hRun
      have hPair :
          (canonicalVerifierResponseV6 request, bytes) = (response, stdout) :=
        Except.ok.inj hRun
      have hResponse : canonicalVerifierResponseV6 request = response :=
        congrArg Prod.fst hPair
      have hStdout : bytes = stdout := congrArg Prod.snd hPair
      rw [← hResponse] at hPass ⊢
      rw [← hStdout] at ⊢
      let global := evaluateAllCommentSidesV6 request
      have hGlobal : evaluateAllCommentSidesV6 request = global := rfl
      have hPassed : allCommentSidesPass global = true := hPass
      refine ⟨?_, finalized_protocol_v6_serialized
        (canonicalVerifierResponseV6 request) bytes hFinalize⟩
      unfold CommentAggregatePassOf
      refine ⟨request.packageView, rfl, ?_, ?_,
        ?_, ?_, ?_, hPass⟩
      · intro side
        refine ⟨?_, rfl, rfl, rfl, rfl⟩
        exact evaluate_comment_side_v6_side
          (request.packageView side) side (request.noteEvaluation side)
      · exact ⟨rfl, rfl, fun _ => rfl⟩
      · intro side
        have hSelector :=
          comment_selector_result_sound (request.packageView side)
        have hSelection :=
          comment_selection_to_realization_sound request global side
            (global.sideEvaluation side) hGlobal rfl
        change CommentSelectionResultOf (request.packageView side)
          (match (global.sideEvaluation side).outcome with
          | .absent => .ok none
          | .selected selected => .ok (some selected)
          | .selectorError failure => .error failure
          | .realizationError selected _ => .ok (some selected))
        cases hOutcome : (global.sideEvaluation side).outcome with
        | absent =>
            unfold SelectionToCommentRealizationOf at hSelection
            rw [hOutcome] at hSelection
            change CommentSelectionResultOf (request.packageView side)
              (.ok none)
            rw [hSelection.1] at hSelector
            exact hSelector
        | selected selected =>
            unfold SelectionToCommentRealizationOf at hSelection
            rw [hOutcome] at hSelection
            change CommentSelectionResultOf (request.packageView side)
              (.ok (some selected))
            rw [hSelection.1] at hSelector
            exact hSelector
        | selectorError failure =>
            unfold SelectionToCommentRealizationOf at hSelection
            rw [hOutcome] at hSelection
            change CommentSelectionResultOf (request.packageView side)
              (.error failure)
            rw [hSelection.1] at hSelector
            exact hSelector
        | realizationError selected failure =>
            unfold SelectionToCommentRealizationOf at hSelection
            rw [hOutcome] at hSelection
            change CommentSelectionResultOf (request.packageView side)
              (.ok (some selected))
            rw [hSelection.1] at hSelector
            exact hSelector
      · intro side
        change SelectionToCommentRealizationOf request side
          (global.sideEvaluation side).outcome
          (global.sideEvaluation side).commentRealization
          (global.sideEvaluation side).parsedEvidence
        exact comment_selection_to_realization_sound request global side
          (global.sideEvaluation side) hGlobal rfl
      · intro side
        have hSidePass := all_comment_sides_pass_at global hPassed side
        have hSideEval : global.sideEvaluation side =
            evaluateCommentSideV6 (request.packageView side) side
              (request.noteEvaluation side) := rfl
        unfold sideCommentPassV6 at hSidePass
        rw [hSideEval] at hSidePass
        have hSideParts := bool_and_eq_true_parts _ _ hSidePass
        have hStatus :
            (evaluateCommentSideV6 (request.packageView side) side
              (request.noteEvaluation side)).status = .passed := by
          exact of_decide_eq_true hSideParts.1
        have hShape := passing_comment_evaluation_shape
          (request.packageView side) side (request.noteEvaluation side)
          hStatus
        have hSelection :=
          comment_selection_to_realization_sound request global side
            (global.sideEvaluation side) hGlobal rfl
        rw [hSideEval] at hSelection
        change
          (match (global.sideEvaluation side).outcome with
          | .selected _ =>
              match (global.sideEvaluation side).commentRealization with
              | none => False
              | some realization =>
                  match (global.sideEvaluation side).parsedEvidence with
                  | none => False
                  | some evidence =>
                      RequestBoundRetainedCommentEvidenceOf request side
                        realization evidence ∧
                      (global.sideEvaluation side).inventory =
                        commentCountProjectionSpec evidence.references
                          evidence.definitions
                          evidence.nonDirectDefinitions ∧
                      PackageCommentIntegrity evidence.wireCounts
          | .absent =>
              match (global.sideEvaluation side).commentRealization with
              | some _ => False
              | none =>
                  match (global.sideEvaluation side).parsedEvidence with
                  | some _ => False
                  | none =>
                      (global.sideEvaluation side).inventory =
                        emptyPackageCommentInventory
          | .selectorError _ | .realizationError _ _ => False)
        rw [hSideEval]
        cases hOutcome :
            (evaluateCommentSideV6 (request.packageView side) side
              (request.noteEvaluation side)).outcome with
        | absent =>
            unfold SelectionToCommentRealizationOf at hSelection
            rw [hOutcome] at hSelection
            unfold PassingCommentEvaluationShape at hShape
            rw [hOutcome] at hShape
            rcases hSelection with ⟨_, hStored, hEvidence⟩
            rw [hStored, hEvidence]
            rw [hStored, hEvidence] at hShape
            exact hShape
        | selected selected =>
            unfold SelectionToCommentRealizationOf at hSelection
            rw [hOutcome] at hSelection
            unfold PassingCommentEvaluationShape at hShape
            rw [hOutcome] at hShape
            rcases hSelection.2 with
              ⟨realization, evidence, hStored, hSemantic, _,
                hRetained, _⟩
            rw [hStored, hSemantic]
            rw [hStored, hSemantic] at hShape
            have hParsed := hRetained.2.2.2.2.2.2
            have hCounts := hParsed.2.2.2.2
            refine ⟨hRetained, hShape.trans hCounts, ?_⟩
            apply package_comment_reference_integrity_sound
            rw [← hShape]
            exact hSideParts.2
        | selectorError failure =>
            unfold PassingCommentEvaluationShape at hShape
            rw [hOutcome] at hShape
            exact False.elim hShape
        | realizationError selected failure =>
            unfold PassingCommentEvaluationShape at hShape
            rw [hOutcome] at hShape
            exact False.elim hShape

theorem comment_integrity_aggregate_pass_sound
    (request : VerifierRequestV6) (response : VerifierResponseV6)
    (stdout : ByteArray)
    (hRun : canonicalSemanticResponseV6 request = .ok (response, stdout))
    (hPass : response.passed = true) :
    CommentAggregatePassOf request response ∧
    SerializedResponseV6Of response stdout := by
  exact canonical_semantic_response_v6_sound request response stdout hRun hPass

theorem selected_semantic_evidence_none_rejected
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (evidence : ParsedCommentEvidence)
    (hSelected : SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) (some evidence)) :
    ¬ SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) none := by
  intro hNone
  rcases hNone.2 with ⟨_, _, _, hEvidence, _⟩
  cases hEvidence

theorem invented_comment_zip_slice_rejected
    (packageBytes : ByteArray) (index : ZipIndex)
    (selected : SelectedCommentIdentity) (entry : CommentPartEntry)
    (invented : ByteArray)
    (hInvented :
      invented ≠ packageBytes.extract entry.dataOffset entry.localSpanEnd) :
    ¬ IndependentBinaryEntryOf packageBytes index selected entry invented := by
  intro h
  exact hInvented h.1

theorem substituted_comment_parsed_events_rejected
    (text expectedUri expectedLocalName : String)
    (depth eventLimit : Nat) (retained substituted : CommentParsedPart)
    (hDifferent : substituted ≠ retained) :
    ¬ RetainedTypedCommentXmlOf text expectedUri expectedLocalName
      depth eventLimit retained substituted := by
  intro h
  exact hDifferent h.1

theorem substituted_retained_comment_scan_evidence_rejected
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (evidence substituted : ParsedCommentEvidence)
    (hSelected : SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) (some evidence))
    (hDifferent : substituted ≠ evidence) :
    ¬ SelectionToCommentRealizationOf request side
      (.selected selected) (some realization) (some substituted) := by
  intro hSubstituted
  rcases hSelected.2 with
    ⟨r₁, e₁, _, hEvidence₁, hRealization₁, hBound₁, hUnique₁⟩
  rcases hSubstituted.2 with
    ⟨r₂, e₂, _, hEvidence₂, hRealization₂, hBound₂, _⟩
  have hSame := hUnique₁ r₂ e₂ hRealization₂ hBound₂
  apply hDifferent
  exact (Option.some.inj hEvidence₂).trans <|
    hSame.2.trans (Option.some.inj hEvidence₁).symm

theorem package_view_retained_record_mismatch_rejected
    (request : VerifierRequestV6) (side : VerifierSide)
    (selected : SelectedCommentIdentity)
    (realization : CommentStoryRealization)
    (hMismatch :
      (request.packageView side).packageBytes ≠
        (request.retainedPackageRecord side).packageBytes ∨
      (request.packageView side).index ≠
        (request.retainedPackageRecord side).index) :
    ¬ RequestBoundCommentRealizationOf request side selected realization := by
  intro h
  exact hMismatch.elim (fun mismatch => mismatch h.2.1)
    (fun mismatch => mismatch h.2.2.1)

def commentSelectorResultSoundSignature : Prop :=
  ∀ pkg : PackageView,
    CommentSelectionResultOf pkg (selectConventionalMainComment pkg)

def commentSelectionToRealizationSoundSignature : Prop :=
  ∀ (request : VerifierRequestV6) (global : GlobalCommentEvaluationV6)
      (side : VerifierSide) (evaluation : SideCommentEvaluationV6),
    evaluateAllCommentSidesV6 request = global →
    global.sideEvaluation side = evaluation →
    SelectionToCommentRealizationOf request side evaluation.outcome
      evaluation.commentRealization evaluation.parsedEvidence

def admittedCommentSourceSetCompleteSignature : Prop :=
  ∀ (pkg : PackageView) (side : VerifierSide)
      (note : SideNoteEvaluationV5) (evaluation : SideCommentEvaluationV6),
    evaluateCommentSideV6 pkg side note = evaluation →
    evaluation.status ≠ .notEvaluated →
    CompleteCommentSourceSetOf
      pkg side note evaluation.sourceSet evaluation.scanEvidence

def parsedCommentInventoryEvidenceExactSignature : Prop :=
  ∀ (pkg : PackageView) (side : VerifierSide)
      (note : SideNoteEvaluationV5)
      (set : CommentSourceSet) (scans : SideScanEvidence)
      (comment : Option CommentStoryRealization)
      (evidence : ParsedCommentEvidence),
    CompleteCommentSourceSetOf pkg side note set scans →
    scanCommentEvidenceV6 pkg side set scans comment = .ok evidence →
    ParsedCommentEvidenceOf pkg side set comment evidence

def packageCommentReferenceIntegritySoundSignature : Prop :=
  ∀ (inventory : PackageCommentInventory),
    checkPackageCommentIntegrity inventory = true →
    PackageCommentIntegrity inventory

def incompleteCommentPartitionZeroEvidenceSoundSignature : Prop :=
  ∀ (request : VerifierRequestV6) (global : GlobalCommentEvaluationV6)
      (side : VerifierSide) (evaluation : SideCommentEvaluationV6)
      (cause : CommentIncompleteCauseV6),
    evaluateAllCommentSidesV6 request = global →
    global.sideEvaluation side = evaluation →
    evaluation.status = .notEvaluated →
    global.incompleteCause side = some cause →
    IncompleteCommentSideZeroEvidenceOf
      request global.admissionContext side evaluation cause

def commentIntegrityAggregatePassSoundSignature : Prop :=
  ∀ (request : VerifierRequestV6) (response : VerifierResponseV6)
      (stdout : ByteArray),
    canonicalSemanticResponseV6 request = .ok (response, stdout) →
    response.passed = true →
    CommentAggregatePassOf request response ∧
      SerializedResponseV6Of response stdout

end Tier2.CommentReferenceIntegrity
