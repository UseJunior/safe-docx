import Lean.Data.Json
import Tier2.CommentReferenceIntegrity
import Tier2.CommentReferenceIntegrity.TypedSemantics
import Tier2.NoteReferenceIntegrity
import Tier2.RelationshipStorySelector

open Lean Tier2.XmlTripleChecker Tier2.RelationshipStorySelector
  Tier2.ConventionalMainNoteSelector
  Tier2.CommentReferenceIntegrity.Typed

set_option linter.unusedSimpArgs false
set_option linter.unusedVariables false
set_option linter.unnecessarySimpa false

abbrev SelectedCommentIdentity :=
  Tier2.CommentReferenceIntegrity.SelectedCommentIdentity
abbrev CommentSelectionFailure :=
  Tier2.CommentReferenceIntegrity.CommentSelectionFailure
abbrev CommentReferenceOccurrence :=
  Tier2.CommentReferenceIntegrity.CommentReferenceOccurrence
abbrev CommentDefinitionOccurrence :=
  Tier2.CommentReferenceIntegrity.CommentDefinitionOccurrence
abbrev CommentScanInput :=
  Tier2.CommentReferenceIntegrity.CommentScanInput
abbrev CommentScan :=
  Tier2.CommentReferenceIntegrity.CommentScan
abbrev BoundedCommentScan :=
  Tier2.CommentReferenceIntegrity.BoundedCommentScan
abbrev RetainedCommentScan :=
  Tier2.CommentReferenceIntegrity.RetainedCommentScan
abbrev ParsedCommentEvidence :=
  Tier2.CommentReferenceIntegrity.ParsedCommentEvidence
abbrev PackageCommentInventory :=
  Tier2.CommentReferenceIntegrity.PackageCommentInventory
def selectConventionalMainCommentRecords :=
  Tier2.CommentReferenceIntegrity.selectConventionalMainCommentRecords
def checkPackageCommentIntegrity :=
  Tier2.CommentReferenceIntegrity.checkPackageCommentIntegrity
def packageCommentInventory :=
  Tier2.CommentReferenceIntegrity.packageCommentInventory
def PackageCommentIntegrity :=
  Tier2.CommentReferenceIntegrity.PackageCommentIntegrity
def retainCommentScanEvidence :=
  Tier2.CommentReferenceIntegrity.retainCommentScanEvidence
def scanCommentEvidence :=
  Tier2.CommentReferenceIntegrity.scanCommentEvidence
def commentReferenceCandidate? :=
  Tier2.CommentReferenceIntegrity.commentReferenceCandidate?

abbrev ReferenceOccurrence := Tier2.NoteReferenceIntegrity.ReferenceOccurrence
abbrev DefinitionOccurrence := Tier2.NoteReferenceIntegrity.DefinitionOccurrence
abbrev NoteDefinitionType := Tier2.NoteReferenceIntegrity.NoteDefinitionType
abbrev CanonicalDecimal := Tier2.NoteReferenceIntegrity.CanonicalDecimal
abbrev ProductionNoteScanInput :=
  Tier2.NoteReferenceIntegrity.ProductionNoteScanInput
abbrev ProductionNoteScan := Tier2.NoteReferenceIntegrity.ProductionNoteScan
abbrev RetainedBoundedProductionNoteScan :=
  Tier2.NoteReferenceIntegrity.RetainedBoundedProductionNoteScan
abbrev VerifierRequestV5 := Tier2.NoteReferenceIntegrity.VerifierRequestV5
abbrev VerifierResponseV5 := Tier2.NoteReferenceIntegrity.VerifierResponseV5
abbrev PackageNoteInventory := Tier2.NoteReferenceIntegrity.PackageNoteInventory
abbrev ProductionAggregateChecks :=
  Tier2.NoteReferenceIntegrity.ProductionAggregateChecks

def parseDecimalId := Tier2.NoteReferenceIntegrity.parseDecimalId

def scanReferenceEvents := Tier2.NoteReferenceIntegrity.scanReferenceEvents
def scanDefinitionEvents := Tier2.NoteReferenceIntegrity.scanDefinitionEvents
def productionNoteScan := Tier2.NoteReferenceIntegrity.productionNoteScan
def productionNoteScanBounded :=
  Tier2.NoteReferenceIntegrity.productionNoteScanBounded
def checkProductionNoteIntegrity :=
  Tier2.NoteReferenceIntegrity.checkProductionNoteIntegrity
def packageInventoryFromProductionScan :=
  Tier2.NoteReferenceIntegrity.packageInventoryFromProductionScan
def packageNoteInventoryEq :=
  Tier2.NoteReferenceIntegrity.packageNoteInventoryEq
def productionAggregatePass :=
  Tier2.NoteReferenceIntegrity.productionAggregatePass
def referenceCandidate? := Tier2.NoteReferenceIntegrity.referenceCandidate?
def definitionCandidate? := Tier2.NoteReferenceIntegrity.definitionCandidate?
def maxSourceEventsPerSide := Tier2.NoteReferenceIntegrity.maxSourceEventsPerSide
def remainingNoteEventBudget :=
  Tier2.NoteReferenceIntegrity.remainingNoteEventBudget
def maxReferenceOccurrences := Tier2.NoteReferenceIntegrity.maxReferenceOccurrences
def maxUniqueReferenceIds := Tier2.NoteReferenceIntegrity.maxUniqueReferenceIds
def maxDefinitions := Tier2.NoteReferenceIntegrity.maxDefinitions
def maxPoisonReferences := Tier2.NoteReferenceIntegrity.maxPoisonReferences
def protocolV5ResponseJson :=
  Tier2.NoteReferenceIntegrity.protocolV5ResponseJson
def finalizeProtocolV5Response :=
  Tier2.NoteReferenceIntegrity.finalizeProtocolV5Response

def maxProtocolV6JsonResponseBytes : Nat := 2626368
def maxProtocolV6ResponseBytes : Nat := 2626369

def typedBoundedBytesOfString (value : String) : BoundedBytes :=
  let bytes := value.toUTF8.toList
  { bytes, limit := bytes.length, admitted := Nat.le_refl _ }

def typedBoundedByteArrayOfString (value : String) : BoundedByteArray :=
  let bytes := value.toUTF8
  { bytes, limit := bytes.size, admitted := Nat.le_refl _ }

def typedXmlEventOfProduction (eventOrdinal : Nat) : XmlEvent → TypedXmlEvent
  | .startElement uri localName attributes depth selfClosing =>
      .startElement (typedBoundedBytesOfString uri)
        (typedBoundedBytesOfString localName)
        (attributes.map fun item => {
          namespaceUri := typedBoundedBytesOfString item.uri
          localName := typedBoundedBytesOfString item.localName
          value := typedBoundedBytesOfString item.value
        })
        depth selfClosing eventOrdinal
  | .endElement uri localName depth =>
      .endElement (typedBoundedBytesOfString uri)
        (typedBoundedBytesOfString localName) depth eventOrdinal
  | .text value depth =>
      .text (typedBoundedByteArrayOfString value) depth eventOrdinal

def typedJsonOfProductionFuel : Nat → Json → TypedJson
  | 0, _ => .null
  | _ + 1, .null => .null
  | _ + 1, .bool value => .bool value
  | _ + 1, .num value =>
      .numberBytes (typedBoundedBytesOfString value.toString)
  | _ + 1, .str value => .bytes (typedBoundedBytesOfString value)
  | fuel + 1, .arr values =>
      .array (values.toList.map (typedJsonOfProductionFuel fuel))
  | fuel + 1, .obj fields => .object (fields.toList.map fun field =>
      (typedBoundedBytesOfString field.1,
        typedJsonOfProductionFuel fuel field.2))

def typedJsonOfProduction (value : Json) : TypedJson :=
  typedJsonOfProductionFuel 2626369 value

def jsonFieldOrNull (response : Json) (field : String) : Json :=
  (response.getObjVal? field).toOption.getD .null

def typedProtocolV6ResponseOfJson
    (response : Json) (passed : Bool) :
    Except String TypedProtocolV6Response := do
  return {
    protocolVersion := .nat 6
    checker := typedJsonOfProduction (jsonFieldOrNull response "checker")
    passed := .bool passed
    fixedStories := typedJsonOfProduction
      (jsonFieldOrNull response "fixedStories")
    presenceMismatches := typedJsonOfProduction
      (jsonFieldOrNull response "presenceMismatches")
    fixedStoryIssues := typedJsonOfProduction
      (jsonFieldOrNull response "fixedStoryIssues")
    relationshipSlots := typedJsonOfProduction
      (jsonFieldOrNull response "relationshipSlots")
    relationshipStories := typedJsonOfProduction
      (jsonFieldOrNull response "relationshipStories")
    selectionIssues := typedJsonOfProduction
      (jsonFieldOrNull response "selectionIssues")
    referenceSourcePartitions := typedJsonOfProduction
      (jsonFieldOrNull response "referenceSourcePartitions")
    noteStories := typedJsonOfProduction
      (jsonFieldOrNull response "noteStories")
    noteInventories := typedJsonOfProduction
      (jsonFieldOrNull response "noteInventories")
    noteIntegrityIssues := typedJsonOfProduction
      (jsonFieldOrNull response "noteIntegrityIssues")
    commentStory := typedJsonOfProduction
      (jsonFieldOrNull response "commentStory")
    commentInventories := typedJsonOfProduction
      (jsonFieldOrNull response "commentInventories")
    commentIntegrityIssues := typedJsonOfProduction
      (jsonFieldOrNull response "commentIntegrityIssues")
  }

def ProtocolV6JsonProjectionOf (response : Json) (passed : Bool)
    (typedResponse : TypedProtocolV6Response) : Prop :=
  ∃ converted,
    typedProtocolV6ResponseOfJson response passed = .ok converted ∧
    independentProtocolV6Projection converted =
      independentProtocolV6Projection typedResponse ∧
    response.compress.toUTF8.data.toList =
      independentProtocolV6Projection typedResponse

instance protocolV6JsonProjectionOfDecidable
    (response : Json) (passed : Bool)
    (typedResponse : TypedProtocolV6Response) :
    Decidable (ProtocolV6JsonProjectionOf response passed typedResponse) := by
  unfold ProtocolV6JsonProjectionOf
  match hConversion : typedProtocolV6ResponseOfJson response passed with
  | .error _ =>
      exact isFalse fun ⟨converted, h, _⟩ => by
        cases h
  | .ok converted =>
      if hProjection :
          independentProtocolV6Projection converted =
            independentProtocolV6Projection typedResponse ∧
          response.compress.toUTF8.data.toList =
            independentProtocolV6Projection typedResponse then
        exact isTrue ⟨converted, rfl, hProjection⟩
      else
        exact isFalse fun ⟨candidate, hCandidate, hRest⟩ => by
          cases hCandidate
          exact hProjection hRest

def protocolV6JsonProjectionCheck (response : Json) (passed : Bool) : Bool :=
  match typedProtocolV6ResponseOfJson response passed with
  | .error _ => false
  | .ok typedResponse =>
      decide (response.compress.toUTF8.data.toList =
        independentProtocolV6Projection typedResponse)

theorem executable_protocol_utf8_json_refines_typed
    (response : Json) (passed : Bool)
    (h : protocolV6JsonProjectionCheck response passed = true) :
    ∃ typedResponse,
      ProtocolV6JsonProjectionOf response passed typedResponse := by
  unfold protocolV6JsonProjectionCheck at h
  split at h
  · contradiction
  · rename_i typedResponse hTyped
    exact ⟨typedResponse, typedResponse, hTyped, rfl, of_decide_eq_true h⟩

theorem typed_protocol_response_pass_of_conversion
    (response : Json) (typedResponse : TypedProtocolV6Response)
    (hConversion :
      typedProtocolV6ResponseOfJson response true = .ok typedResponse) :
    typedResponse.protocolVersion = .nat 6 ∧
    typedResponse.passed = .bool true := by
  unfold typedProtocolV6ResponseOfJson at hConversion
  cases hConversion
  exact ⟨rfl, rfl⟩

def ExecutableSelectorRefinesTyped
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (typedCommentType : BoundedBytes)
    (typedRelationships : List TypedRelationship) : Prop :=
  typedCommentType.bytes =
      Tier2.CommentReferenceIntegrity.commentsRelationshipType.toUTF8.toList ∧
  (typedRelationships.map fun relationship =>
      (relationship.ordinal, relationship.relationshipType.bytes,
        relationship.relationshipId.bytes, relationship.rawTarget.bytes,
        relationship.rawTargetMode.map (·.bytes))) =
    (pkg.relationshipRecords.zipIdx.map fun item =>
      (item.2, item.1.relationshipType.toUTF8.toList,
        item.1.id.toUTF8.toList, item.1.rawTarget.toUTF8.toList,
        item.1.targetMode.map (·.toUTF8.toList))) ∧
  match Tier2.CommentReferenceIntegrity.selectConventionalMainComment pkg,
      selectTypedComment typedCommentType typedRelationships with
  | .ok none, .ok none => True
  | .ok (some selected), .ok (some typedSelected) =>
      typedSelected.relationshipOrdinal =
          selected.relationshipRecordOrdinal ∧
      typedSelected.relationshipId.bytes =
          selected.relationshipId.toUTF8.toList ∧
      typedSelected.normalizedPartPath.bytes =
          selected.normalizedPartPath.toUTF8.toList
  | .error (.ambiguous left), .error (.ambiguous right) => left = right
  | .error (.external left), .error (.external right) => left = right
  | .error (.invalidTargetMode left), .error (.invalidMode right) =>
      left = right
  | .error (.targetLimit left), .error (.targetLimit right) => left = right
  | .error (.unsafeTarget left), .error (.unsafeTarget right) => left = right
  | _, _ => False

instance executableSelectorRefinesTypedDecidable
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (typedCommentType : BoundedBytes)
    (typedRelationships : List TypedRelationship) :
    Decidable (ExecutableSelectorRefinesTyped pkg typedCommentType
      typedRelationships) := by
  unfold ExecutableSelectorRefinesTyped
  split <;> infer_instance

def executableSelectorRefinementCheck
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (typedCommentType : BoundedBytes)
    (typedRelationships : List TypedRelationship) : Bool :=
  decide (ExecutableSelectorRefinesTyped pkg typedCommentType
    typedRelationships)

theorem executable_comment_selector_refines_typed
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (typedCommentType : BoundedBytes)
    (typedRelationships : List TypedRelationship)
    (h : executableSelectorRefinementCheck pkg typedCommentType
      typedRelationships = true) :
    ExecutableSelectorRefinesTyped pkg typedCommentType
      typedRelationships := by
  exact of_decide_eq_true h

def ExecutableRealizationValueOf
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typed : TypedCommentRealization) : Prop :=
  typed.selected.relationshipOrdinal =
      realization.selected.relationshipRecordOrdinal ∧
  typed.selected.relationshipId.bytes =
      realization.selected.relationshipId.toUTF8.toList ∧
  typed.selected.normalizedPartPath.bytes =
      realization.selected.normalizedPartPath.toUTF8.toList ∧
  typed.extraction.packageBytes =
      realization.extraction.packageBytes ∧
  typed.extraction.snapshotBytes =
      realization.extraction.snapshotBytes ∧
  typed.extraction.expandedBytes =
      realization.extraction.decompressedBytes ∧
  typed.entry.name.bytes =
      realization.entry.normalizedPartPath.toUTF8.toList ∧
  typed.entry.compressedSize = realization.entry.compressedSize ∧
  typed.entry.expandedSize = realization.entry.expandedSize ∧
  typed.entry.localHeaderOffset = realization.entry.localHeaderOffset ∧
  typed.entry.dataOffset = realization.entry.dataOffset ∧
  typed.entry.localSpanEnd = realization.entry.localSpanEnd ∧
  typed.extraction.entry = typed.entry ∧
  typed.extraction.compressedSlice =
      realization.extraction.compressedPayload ∧
  typed.parsed.rawBytes = realization.extraction.decompressedBytes ∧
  typed.parsed.expectedRootUri.bytes =
      realization.parsed.rootUri.toUTF8.toList ∧
  typed.parsed.expectedRootLocalName.bytes =
      realization.parsed.rootLocalName.toUTF8.toList ∧
  typed.parsed.depthLimit = realization.parsed.depth ∧
  typed.parsed.eventLimit = realization.parsed.eventLimit ∧
  typed.parsed.events =
      (realization.parsed.events.zipIdx.map fun item =>
        typedXmlEventOfProduction item.2 item.1) ∧
  typed.retainedParsedEvents =
      (realization.retainedParsedEvidence.events.zipIdx.map fun item =>
        typedXmlEventOfProduction item.2 item.1)

def ExecutableRealizationRefinesTyped
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (prior : Tier2.CommentReferenceIntegrity.GlobalResourceUsage)
    (selected : Tier2.CommentReferenceIntegrity.SelectedCommentIdentity)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (evaluation : Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typed : TypedCommentRealization) : Prop :=
  Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
      pkg side prior selected = .ok realization ∧
  Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
      pkg side note = evaluation ∧
  ExecutableRealizationValueOf realization typed

instance executableRealizationRefinesTypedDecidable
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typed : TypedCommentRealization) :
    Decidable (ExecutableRealizationValueOf realization typed) := by
  unfold ExecutableRealizationValueOf
  infer_instance

def executableRealizationRefinementCheck
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typed : TypedCommentRealization) : Bool :=
  decide (ExecutableRealizationValueOf realization typed)

theorem executable_comment_realization_refines_typed
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (prior : Tier2.CommentReferenceIntegrity.GlobalResourceUsage)
    (selected : Tier2.CommentReferenceIntegrity.SelectedCommentIdentity)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (evaluation :
      Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typed : TypedCommentRealization)
    (hRun :
      Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
        pkg side prior selected = .ok realization)
    (hEvaluation :
      Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
        pkg side note = evaluation)
    (h : executableRealizationRefinementCheck realization typed = true) :
    ExecutableRealizationRefinesTyped pkg side prior selected note evaluation
      realization typed := by
  exact ⟨hRun, hEvaluation, of_decide_eq_true h⟩

def typedBoundedIdentityBytes (value : BoundedBytes) : List UInt8 :=
  encodeNatDigits value.bytes.length ++ [UInt8.ofNat 58] ++ value.bytes

def typedAttributeIdentityBytes (attr : TypedXmlAttribute) : List UInt8 :=
  typedBoundedIdentityBytes attr.namespaceUri ++
  typedBoundedIdentityBytes attr.localName ++
  typedBoundedIdentityBytes attr.value

def typedXmlEventIdentityBytes : TypedXmlEvent → List UInt8
  | .startElement namespaceUri localName attributes depth selfClosing ordinal =>
      [UInt8.ofNat 83] ++ typedBoundedIdentityBytes namespaceUri ++
      typedBoundedIdentityBytes localName ++
      encodeNatDigits attributes.length ++ [UInt8.ofNat 58] ++
      (attributes.flatMap typedAttributeIdentityBytes) ++
      encodeNatDigits depth ++ [UInt8.ofNat 58] ++
      [if selfClosing then UInt8.ofNat 49 else UInt8.ofNat 48] ++
      encodeNatDigits ordinal
  | .endElement namespaceUri localName depth ordinal =>
      [UInt8.ofNat 69] ++ typedBoundedIdentityBytes namespaceUri ++
      typedBoundedIdentityBytes localName ++ encodeNatDigits depth ++
      [UInt8.ofNat 58] ++ encodeNatDigits ordinal
  | .text value depth ordinal =>
      [UInt8.ofNat 84] ++ encodeNatDigits value.bytes.size ++
      [UInt8.ofNat 58] ++ value.bytes.data.toList ++
      encodeNatDigits depth ++ [UInt8.ofNat 58] ++ encodeNatDigits ordinal

def ExecutableSourceSetRefinesTyped
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (evaluation :
      Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (typedSources : List TypedStorySource) : Prop :=
  Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      pkg side note = set ∧
  Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
      pkg side note = evaluation ∧
  (typedSources.map fun typed =>
      (typed.sourceOrdinal, typed.partPath.bytes)) =
    (set.sources.map fun source =>
      (source.ordinal, source.normalizedPartPath.toUTF8.toList)) ∧
  (typedSources.map fun typed =>
      (typed.sourceOrdinal,
        typed.parsed.events.map typedXmlEventIdentityBytes)) =
    (set.sourceEvents.map fun eventSource =>
      (eventSource.1,
        eventSource.2.zipIdx.map fun item =>
          typedXmlEventIdentityBytes
            (typedXmlEventOfProduction item.2 item.1)))

def executableSourceSetRefinementCheck
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (typedSources : List TypedStorySource) : Bool :=
  decide (
    (typedSources.map fun typed =>
        (typed.sourceOrdinal, typed.partPath.bytes)) =
      (set.sources.map fun source =>
        (source.ordinal, source.normalizedPartPath.toUTF8.toList))) &&
  decide (
    (typedSources.map fun typed =>
        (typed.sourceOrdinal,
          typed.parsed.events.map typedXmlEventIdentityBytes)) =
      (set.sourceEvents.map fun eventSource =>
        (eventSource.1,
          eventSource.2.zipIdx.map fun item =>
            typedXmlEventIdentityBytes
              (typedXmlEventOfProduction item.2 item.1))))

theorem executable_comment_source_set_refines_typed
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (evaluation :
      Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (typedSources : List TypedStorySource)
    (hSet :
      Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
        pkg side note = set)
    (hEvaluation :
      Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
        pkg side note = evaluation)
    (h : executableSourceSetRefinementCheck set typedSources = true) :
    ExecutableSourceSetRefinesTyped pkg side note set evaluation
      typedSources := by
  unfold executableSourceSetRefinementCheck at h
  simp only [Bool.and_eq_true, decide_eq_true_eq] at h
  exact ⟨hSet, hEvaluation, h⟩

def ExecutableIncompleteValueOf
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (evaluation :
      Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (typed : TypedSideEvaluation) : Prop :=
  evaluation.status =
      Tier2.CommentReferenceIntegrity.CommentEvaluationStatus.notEvaluated ↔
    ∃ cause,
      Tier2.CommentReferenceIntegrity.concreteCommentIncompleteCause
          pkg side note evaluation = some cause ∧
      typed.status = .notEvaluated ∧ evaluation.commentRealization = none ∧
      evaluation.parsedEvidence = none ∧
      evaluation.internalReferences = [] ∧
      evaluation.internalDefinitions = [] ∧
      evaluation.inventory =
        Tier2.CommentReferenceIntegrity.emptyPackageCommentInventory ∧
      typed.realization = none ∧ typed.sources = [] ∧
      typed.scan.references = [] ∧ typed.scan.definitions = [] ∧
      typed.scan.nonDirectDefinitions = [] ∧ typed.scan.crossing = none

def ExecutableIncompleteRefinesTyped
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (evaluation :
      Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (typed : TypedSideEvaluation) : Prop :=
  Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
      pkg side note = evaluation ∧
  ExecutableIncompleteValueOf pkg side note evaluation typed

instance executableIncompleteRefinesTypedDecidable
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (evaluation :
      Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (typed : TypedSideEvaluation) :
    Decidable (ExecutableIncompleteValueOf pkg side note evaluation typed) := by
  unfold ExecutableIncompleteValueOf
  infer_instance

def executableIncompleteRefinementCheck
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (evaluation :
      Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (typed : TypedSideEvaluation) : Bool :=
  decide (ExecutableIncompleteValueOf pkg side note evaluation typed)

theorem executable_comment_incomplete_refines_typed
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (evaluation :
      Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (typed : TypedSideEvaluation)
    (hEvaluation :
      Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
        pkg side note = evaluation)
    (h : executableIncompleteRefinementCheck
      pkg side note evaluation typed = true) :
    ExecutableIncompleteRefinesTyped pkg side note evaluation typed := by
  exact ⟨hEvaluation, of_decide_eq_true h⟩

def executableCommentSelectorRefinesTypedSignature : Prop :=
  ∀ (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (typedCommentType : BoundedBytes)
    (typedRelationships : List TypedRelationship),
    executableSelectorRefinementCheck pkg typedCommentType
      typedRelationships = true →
    ExecutableSelectorRefinesTyped pkg typedCommentType typedRelationships

def executableCommentRealizationRefinesTypedSignature : Prop :=
  ∀ (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (prior : Tier2.CommentReferenceIntegrity.GlobalResourceUsage)
    (selected : Tier2.CommentReferenceIntegrity.SelectedCommentIdentity)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (evaluation : Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typed : TypedCommentRealization),
    Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
      pkg side prior selected = .ok realization →
    Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
      pkg side note = evaluation →
    executableRealizationRefinementCheck realization typed = true →
    ExecutableRealizationRefinesTyped pkg side prior selected note evaluation
      realization typed

def executableCommentSourceSetRefinesTypedSignature : Prop :=
  ∀ (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (evaluation : Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (typedSources : List TypedStorySource),
    Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      pkg side note = set →
    Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
      pkg side note = evaluation →
    executableSourceSetRefinementCheck set typedSources = true →
    ExecutableSourceSetRefinesTyped pkg side note set evaluation typedSources

def executableCommentIncompleteRefinesTypedSignature : Prop :=
  ∀ (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (note : Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5)
    (evaluation : Tier2.CommentReferenceIntegrity.SideCommentEvaluationV6)
    (typed : TypedSideEvaluation),
    Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
      pkg side note = evaluation →
    executableIncompleteRefinementCheck
      pkg side note evaluation typed = true →
    ExecutableIncompleteRefinesTyped pkg side note evaluation typed

def executableProtocolUtf8JsonRefinesTypedSignature : Prop :=
  ∀ (response : Json) (passed : Bool),
    protocolV6JsonProjectionCheck response passed = true →
    ∃ typedResponse,
      ProtocolV6JsonProjectionOf response passed typedResponse

def protocolV6LineFeed : ByteArray := ⟨#[UInt8.ofNat 10]⟩

def finalizeProtocolV6ResponseUnchecked
    (response : Json) : Except String ByteArray :=
  let jsonBytes := response.compress.toUTF8
  if jsonBytes.size > maxProtocolV6JsonResponseBytes then
    .error "protocol v6 JSON response exceeds legal envelope"
  else
    let stdout := jsonBytes ++ protocolV6LineFeed
    if stdout.size > maxProtocolV6ResponseBytes then
      .error "protocol v6 stdout response exceeds legal envelope"
    else .ok stdout

def finalizeProtocolV6Response
    (response : Json) (passed : Bool) : Except String ByteArray :=
  if protocolV6JsonProjectionCheck response passed then
    finalizeProtocolV6ResponseUnchecked response
  else
    .error "protocol v6 production JSON diverges from typed byte projection"

theorem protocol_v6_projection_check_of_finalize_ok
    (response : Json) (passed : Bool) (stdout : ByteArray)
    (hFinalize : finalizeProtocolV6Response response passed = .ok stdout) :
    protocolV6JsonProjectionCheck response passed = true := by
  unfold finalizeProtocolV6Response at hFinalize
  split at hFinalize
  · assumption
  · contradiction

structure Request where
  originalDocxPath : String
  revisedDocxPath : String
  comparedDocxPath : String

def requestFromJson (j : Json) : Except String Request := do
  let object ← j.getObj?
  if object.keys != ["comparedDocxPath", "originalDocxPath", "protocolVersion",
      "revisedDocxPath"] then
    throw "protocol v6 request has unknown or missing keys"
  let protocolVersion ← j.getObjValAs? Nat "protocolVersion"
  if protocolVersion != 6 then throw s!"unsupported protocolVersion: {protocolVersion}"
  return {
    originalDocxPath := (← j.getObjValAs? String "originalDocxPath")
    revisedDocxPath := (← j.getObjValAs? String "revisedDocxPath")
    comparedDocxPath := (← j.getObjValAs? String "comparedDocxPath")
  }

def maxDiagnosticBytes : Nat := 64 * 1024
def maxRequestBytes : Nat := 64 * 1024
def maxCumulativeCompressedBytes : Nat := 16 * 1024 * 1024
def maxCumulativeExpandedBytes : Nat := 32 * 1024 * 1024
def maxCumulativeXmlEvents : Nat := 1000000
def maxTripleCumulativeCompressedBytes : Nat := 3 * maxCumulativeCompressedBytes
def maxTripleCumulativeExpandedBytes : Nat := 3 * maxCumulativeExpandedBytes
def maxTripleSelectedParts : Nat := 3 * maxSelectedParts
def maxIssues : Nat := 511
def maxEvidenceStringBytes : Nat := 1572864
def terminalIssueReserveBytes : Nat := 1024
structure SideResourceUsage where
  compressedBytes : Nat := 0
  expandedBytes : Nat := 0
  xmlEvents : Nat := 0
  deriving Repr, Inhabited

structure ResourceUsage where
  original : SideResourceUsage := {}
  revised : SideResourceUsage := {}
  compared : SideResourceUsage := {}
  deriving Repr, Inhabited

def ResourceUsage.get (usage : ResourceUsage) : VerifierSide → SideResourceUsage
  | .original => usage.original
  | .revised => usage.revised
  | .compared => usage.compared

def ResourceUsage.set (usage : ResourceUsage) (side : VerifierSide)
    (value : SideResourceUsage) : ResourceUsage :=
  match side with
  | .original => { usage with original := value }
  | .revised => { usage with revised := value }
  | .compared => { usage with compared := value }

structure BoundedOutput where
  exitCode : UInt32
  stdout : ByteArray
  stderr : ByteArray

partial def readBounded (handle : IO.FS.Handle) (limit : Nat) (acc : ByteArray := .empty) :
    IO ByteArray := do
  let chunk ← handle.read 4096
  if chunk.isEmpty then return acc
  let next := acc ++ chunk
  if next.size > limit then throw (IO.userError s!"process output exceeds {limit} bytes")
  readBounded handle limit next

def runBounded (cmd : String) (args : Array String) (stdoutLimit : Nat) : IO BoundedOutput := do
  let child ← IO.Process.spawn {
    cmd, args, stdout := .piped, stderr := .piped
  }
  let stderrTask ← IO.asTask (readBounded child.stderr maxDiagnosticBytes) Task.Priority.dedicated
  try
    let stdout ← readBounded child.stdout stdoutLimit
    let exitCode ← child.wait
    let stderr ← IO.ofExcept stderrTask.get
    return { exitCode, stdout, stderr }
  catch error =>
    child.kill
    discard child.wait
    throw error

def crc32Step (crc byte : Nat) : Nat :=
  (List.range 8).foldl (fun value _ =>
    if value % 2 == 1 then Nat.xor (value / 2) 0xedb88320 else value / 2)
    (Nat.xor crc byte)

def crc32 (bytes : ByteArray) : Nat :=
  Nat.xor (bytes.toList.foldl (fun crc byte => crc32Step crc byte.toNat) 0xffffffff)
    0xffffffff

def crc32Hex (bytes : ByteArray) : String :=
  let digits := Nat.toDigits 16 (crc32 bytes)
  String.ofList (List.replicate (8 - min 8 digits.length) '0' ++ digits)

structure Package where
  path : String
  bytes : ByteArray
  packageReadCount : Nat
  index : ZipIndex
  indexExact : buildZipIndex bytes = .ok index
  independentIndexExact :
    Tier2.CommentReferenceIntegrity.IndependentBinaryIndexOf bytes index
  snapshotDirectory : String
  snapshotPath : String
  snapshotBytes : ByteArray
  snapshotWriteCount : Nat
  snapshotWriteCountExact : snapshotWriteCount = 1
  snapshotBytesExact : snapshotBytes = bytes

structure SnapshotRoot where
  path : String
  standaloneOwned : Bool

def byteHex (byte : UInt8) : String :=
  let digits := Nat.toDigits 16 byte.toNat
  String.ofList (List.replicate (2 - min 2 digits.length) '0' ++ digits)

def randomSnapshotToken : IO String := do
  let bytes ← IO.getRandomBytes 16
  return (bytes.toList.map byteHex).foldl (· ++ ·) ""

def cleanupPath (description path : String) (remove : IO Unit) : IO Unit := do
  try remove
  catch error =>
    throw (IO.userError s!"{description} cleanup failed for {path}: {error}")

partial def createPrivateSnapshot (root : SnapshotRoot) (bytes : ByteArray)
    (attempts : Nat := 0) :
    IO (String × String) := do
  if attempts == 8 then
    throw (IO.userError "could not allocate a private package snapshot")
  let token ← randomSnapshotToken
  let directory := s!"{root.path}/package-{token}"
  let path := s!"{directory}/package.docx"
  try
    IO.FS.createDir directory
  catch _ =>
    return ← createPrivateSnapshot root bytes (attempts + 1)
  try
    IO.FS.writeBinFile path bytes
    return (directory, path)
  catch error =>
    try
      if ← System.FilePath.pathExists path then
        cleanupPath "partial package snapshot file" path (IO.FS.removeFile path)
      cleanupPath "partial package snapshot directory" directory (IO.FS.removeDir directory)
    catch cleanupError =>
      throw (IO.userError s!"package snapshot write failed: {error}; {cleanupError}")
    throw (IO.userError s!"package snapshot write failed: {error}")

def cleanupPackageSnapshot (package : Package) : IO Unit := do
  cleanupPath "package snapshot file" package.snapshotPath
    (IO.FS.removeFile package.snapshotPath)
  cleanupPath "package snapshot directory" package.snapshotDirectory
    (IO.FS.removeDir package.snapshotDirectory)

def acquireSnapshotRoot : IO SnapshotRoot := do
  match ← IO.getEnv "SAFE_DOCX_LEAN_TEMP_ROOT" with
  | some path =>
    if path.isEmpty then
      throw (IO.userError "SAFE_DOCX_LEAN_TEMP_ROOT must not be empty")
    if !(← System.FilePath.isDir path) then
      throw (IO.userError s!"SAFE_DOCX_LEAN_TEMP_ROOT is not a directory: {path}")
    return { path, standaloneOwned := false }
  | none =>
    let path ← IO.FS.createTempDir
    return { path := path.toString, standaloneOwned := true }

def cleanupSnapshotRoot (root : SnapshotRoot) : IO Unit := do
  if root.standaloneOwned then
    cleanupPath "standalone verifier snapshot root" root.path
      (IO.FS.removeDirAll root.path)

def loadPackage (root : SnapshotRoot) (path : String) : IO Package := do
  let bytes ← IO.FS.readBinFile path
  match hIndex : buildZipIndex bytes with
  | .error detail => throw (IO.userError s!"package index failed for {path}: {detail}")
  | .ok index =>
    if hIndependent :
        Tier2.CommentReferenceIntegrity.independentBinaryIndexCheck
          bytes index = true then
    let (snapshotDirectory, snapshotPath) ← createPrivateSnapshot root bytes
    return {
      path, bytes, index
      packageReadCount := 1
      indexExact := hIndex
      independentIndexExact :=
        Tier2.CommentReferenceIntegrity.independent_binary_index_check_sound
          bytes index hIndependent
      snapshotDirectory
      snapshotPath
      snapshotBytes := bytes
      snapshotWriteCount := 1
      snapshotWriteCountExact := rfl
      snapshotBytesExact := rfl
    }
    else
      throw (IO.userError
        "package index failed independent retained-evidence validation")

structure SnapshotExtractionEvidence where
  packageBytes : ByteArray
  snapshotBytes : ByteArray
  snapshotPath : String
  snapshotWriteCount : Nat
  zipIndex : ZipIndex
  zipIndexExact : buildZipIndex packageBytes = .ok zipIndex
  selectedPartPath : String
  entry : ZipEntry
  selectedEntryExact : zipIndex.find? selectedPartPath = some entry
  centralOffset : Nat
  centralSize : Nat
  compressedPayload : ByteArray
  decompressedBytes : ByteArray
  extractionInvocationCount : Nat
  externalDecompressionTrusted : Bool
  snapshotBytesExact : snapshotBytes = packageBytes
  compressedPayloadExact :
    compressedPayload = packageBytes.extract entry.dataOffset entry.localSpanEnd
  decompressedSizeExact : decompressedBytes.size = entry.expandedSize
  decompressedCrcExact : crc32 decompressedBytes = entry.crc32

inductive ExtractedPart where
  | missing
  | present (evidence : SnapshotExtractionEvidence)

def decodeDiagnostics (bytes : ByteArray) : String :=
  (String.fromUTF8? bytes).getD "<non-UTF-8 diagnostics>"

def extractPart (package : Package) (partPath : String) : IO ExtractedPart := do
  match hFind : package.index.find? partPath with
  | none => return .missing
  | some entry =>
    let output ← runBounded "unzip" #["-p", "--", package.snapshotPath, entry.name]
      entry.expandedSize
    if output.exitCode != 0 then
      throw (IO.userError
        s!"archive extraction failed for {partPath}: {decodeDiagnostics output.stderr}")
    if hSize : output.stdout.size = entry.expandedSize then
      if hCrc : crc32 output.stdout = entry.crc32 then
        return .present {
          packageBytes := package.bytes
          snapshotBytes := package.snapshotBytes
          snapshotPath := package.snapshotPath
          snapshotWriteCount := package.snapshotWriteCount
          zipIndex := package.index
          zipIndexExact := package.indexExact
          selectedPartPath := partPath
          entry
          selectedEntryExact := hFind
          centralOffset := package.index.centralOffset
          centralSize := package.index.centralSize
          compressedPayload := package.bytes.extract entry.dataOffset entry.localSpanEnd
          decompressedBytes := output.stdout
          extractionInvocationCount := 1
          externalDecompressionTrusted := true
          snapshotBytesExact := package.snapshotBytesExact
          compressedPayloadExact := rfl
          decompressedSizeExact := hSize
          decompressedCrcExact := hCrc
        }
      else
        throw (IO.userError s!"archive extraction CRC mismatch for {partPath}")
    else
      throw (IO.userError s!"archive extraction size mismatch for {partPath}")

def partLimitExceeded (package : Package) (partPath : String) : Bool :=
  match package.index.find? partPath with
  | none => false
  | some entry =>
    entry.compressedSize > maxPartCompressedBytes ||
      entry.expandedSize > maxPartExpandedBytes

structure FixedStory where
  name : String
  packagePart : String
  rootLocalName : String
  noteProjection : Bool

def optionalStories : List FixedStory :=
  [ { name := "footnotes", packagePart := "word/footnotes.xml",
      rootLocalName := "footnotes", noteProjection := true }
  , { name := "endnotes", packagePart := "word/endnotes.xml",
      rootLocalName := "endnotes", noteProjection := true }
  ]

def mainTokens (xml : String) : Except String (List XmlTok) := do
  let parsed ← parseXmlEventsForRootBounded xml wmlNamespace "document"
    maxXmlEventsPerPart maxXmlDepth
  return tokensFromXmlEvents parsed.events

def presenceJson (original revised combined : Bool) : Json :=
  Json.mkObj
    [ ("original", toJson original)
    , ("revised", toJson revised)
    , ("combined", toJson combined)
    ]

structure BoundedStringState where
  reversed : List Char := []
  bytes : Nat := 0
  full : Bool := false

def boundUtf8 (value : String) (limit : Nat) : String :=
  let state := value.toList.foldl (fun (state : BoundedStringState) char =>
    if state.full then state
    else
      let width := (String.singleton char).toUTF8.size
      if width > limit - min limit state.bytes then { state with full := true }
      else { state with reversed := char :: state.reversed, bytes := state.bytes + width })
    ({} : BoundedStringState)
  String.ofList state.reversed.reverse

def storyReportJson (report : StoryReport) : Json :=
  storyReportToJson report

def fixedIssueJson (code name side packagePart detail : String) : Json :=
  Json.mkObj
    [ ("code", toJson code)
    , ("name", toJson name)
    , ("side", toJson side)
    , ("packagePart", toJson packagePart)
    , ("detail", toJson (boundUtf8 detail 256))
    ]

structure LoadedOptionalStories where
  stories : List NamedStoryTriple
  issues : List Json
  usage : ResourceUsage
  aggregateStopped : Bool

def selectionIssueJson (issue : SelectionIssue) : Json :=
  let fields :=
    [ ("code", toJson issue.code)
    , ("detail", toJson (boundUtf8 issue.detail 256))
    ] ++
    (match issue.side with | some value => [("side", toJson value.toString)] | none => []) ++
    (match issue.sectionOrdinal with | some value => [("sectionOrdinal", toJson value)] | none => []) ++
    (match issue.kind with | some value => [("kind", toJson value.toString)] | none => []) ++
    (match issue.role with | some value => [("role", toJson value.toString)] | none => []) ++
    (match issue.relationshipId with | some value => [("relationshipId", toJson value)] | none => []) ++
    (match issue.rawTarget with | some value => [("rawTarget", toJson value)] | none => []) ++
    (match issue.normalizedPartPath with
      | some value => [("normalizedPartPath", toJson value)]
      | none => [])
  Json.mkObj fields

def identityJson (identity : RelationshipIdentity) : Json :=
  Json.mkObj
    [ ("relationshipId", toJson identity.relationshipId)
    , ("normalizedPartPath", toJson identity.normalizedPartPath)
    ]

def slotJson (slot : AlignedSlot) : Json :=
  Json.mkObj
    [ ("slotOrdinal", toJson slot.slotOrdinal)
    , ("sectionOrdinal", toJson slot.sectionOrdinal)
    , ("kind", toJson slot.kind.toString)
    , ("role", toJson slot.role.toString)
    , ("original", identityJson slot.original)
    , ("revised", identityJson slot.revised)
    , ("compared", identityJson slot.compared)
    , ("physicalStoryOrdinal", toJson slot.physicalStoryOrdinal)
    ]

def physicalStoryJson (story : PhysicalStory) (report : StoryReport) : Json :=
  Json.mkObj
    [ ("physicalStoryOrdinal", toJson story.physicalStoryOrdinal)
    , ("kind", toJson story.kind.toString)
    , ("originalPartPath", toJson story.originalPartPath)
    , ("revisedPartPath", toJson story.revisedPartPath)
    , ("comparedPartPath", toJson story.comparedPartPath)
    , ("selectingSlotOrdinals", toJson story.selectingSlotOrdinals)
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson report.originalTokenCount)
        , ("revised", toJson report.revisedTokenCount)
        , ("combined", toJson report.combinedTokenCount)
        ])
    , ("report", reportToJson report.report)
    ]

def utf8Bytes (value : String) : Nat :=
  value.toUTF8.size

def escapedStringBytes (value : String) : Nat :=
  (toJson value).compress.toUTF8.size

partial def protocolEscapedStringByteCharge (root : Json) : Nat :=
  let rec visit : Json → Nat
    | .null | .bool _ | .num _ => 0
    | .str value => (toJson value).compress.toUTF8.size
    | .arr values => values.toList.map visit |>.sum
    | .obj values => values.toList.map (visit ∘ Prod.snd) |>.sum
  visit root

def jsonEvidenceStringBytes (root : Json) : Nat :=
  protocolEscapedStringByteCharge root

def selectionIssueStringBytes (issue : SelectionIssue) : Nat :=
  escapedStringBytes issue.code + escapedStringBytes (boundUtf8 issue.detail 256) +
    (issue.side.map (escapedStringBytes ∘ VerifierSide.toString)).getD 0 +
    (issue.kind.map (escapedStringBytes ∘ StoryKind.toString)).getD 0 +
    (issue.role.map (escapedStringBytes ∘ StoryRole.toString)).getD 0 +
    (issue.relationshipId.map escapedStringBytes).getD 0 +
    (issue.rawTarget.map escapedStringBytes).getD 0 +
    (issue.normalizedPartPath.map escapedStringBytes).getD 0

def slotStringBytes (slot : AlignedSlot) : Nat :=
  escapedStringBytes slot.kind.toString + escapedStringBytes slot.role.toString +
    escapedStringBytes slot.original.relationshipId +
    escapedStringBytes slot.original.normalizedPartPath +
    escapedStringBytes slot.revised.relationshipId +
    escapedStringBytes slot.revised.normalizedPartPath +
    escapedStringBytes slot.compared.relationshipId +
    escapedStringBytes slot.compared.normalizedPartPath

def physicalStoryStringBytes (story : PhysicalStory) : Nat :=
  escapedStringBytes story.kind.toString + escapedStringBytes story.originalPartPath +
    escapedStringBytes story.revisedPartPath + escapedStringBytes story.comparedPartPath

def evidenceStringBytes (fixedIssues : List Json) (selectionIssues : List SelectionIssue)
    (slots : List AlignedSlot) (stories : List PhysicalStory)
    (otherEvidence noteIssues : List Json) : Nat :=
  (fixedIssues.map jsonEvidenceStringBytes).sum +
    (selectionIssues.map selectionIssueStringBytes).sum +
    (slots.map slotStringBytes).sum +
    (stories.map physicalStoryStringBytes).sum +
    (otherEvidence.map jsonEvidenceStringBytes).sum +
    (noteIssues.map jsonEvidenceStringBytes).sum

def firstAggregateIssueCrossingLoop (chargedStrings admittedCount : Nat) :
    List Nat → Option String
  | [] => none
  | candidateStrings :: rest =>
      if admittedCount == maxIssues then some "NOTE_ISSUE_LIMIT_EXCEEDED"
      else if chargedStrings + candidateStrings >
          maxEvidenceStringBytes - terminalIssueReserveBytes then
        some "NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED"
      else firstAggregateIssueCrossingLoop
        (chargedStrings + candidateStrings) (admittedCount + 1) rest

def firstAggregateIssueCrossing (nonIssueStrings : Nat)
    (selectionIssueStrings noteIssueStrings : List Nat) : Option String :=
  if nonIssueStrings > maxEvidenceStringBytes - terminalIssueReserveBytes then
    some "NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED"
  else
    firstAggregateIssueCrossingLoop nonIssueStrings 0
      (selectionIssueStrings ++ noteIssueStrings)

def optionRank {α : Type} (rank : α → Nat) : Option α → Nat
  | none => 0
  | some value => rank value + 1

def sideRank : VerifierSide → Nat
  | .original => 0
  | .revised => 1
  | .compared => 2

def kindRank : StoryKind → Nat
  | .header => 0
  | .footer => 1

def issueLess (left right : SelectionIssue) : Bool :=
  let leftSide := optionRank sideRank left.side
  let rightSide := optionRank sideRank right.side
  let leftSection := optionRank id left.sectionOrdinal
  let rightSection := optionRank id right.sectionOrdinal
  let leftKind := optionRank kindRank left.kind
  let rightKind := optionRank kindRank right.kind
  let leftRole := optionRank StoryRole.rank left.role
  let rightRole := optionRank StoryRole.rank right.role
  if leftSide != rightSide then leftSide < rightSide
  else if leftSection != rightSection then leftSection < rightSection
  else if leftKind != rightKind then leftKind < rightKind
  else if leftRole != rightRole then leftRole < rightRole
  else if left.code != right.code then decide (left.code < right.code)
  else if left.relationshipId != right.relationshipId then
    decide (left.relationshipId.getD "" < right.relationshipId.getD "")
  else if left.rawTarget != right.rawTarget then
    decide (left.rawTarget.getD "" < right.rawTarget.getD "")
  else decide (left.normalizedPartPath.getD "" < right.normalizedPartPath.getD "")

def jsonStringField (value : Json) (key : String) : String :=
  match value.getObjValAs? String key with
  | .ok field => field
  | .error _ => ""

def fixedIssueLess (left right : Json) : Bool :=
  let nameRank := fun value => if value == "footnotes" then 0 else 1
  let sideValueRank := fun value =>
    if value == "original" then 0 else if value == "revised" then 1 else 2
  let leftName := nameRank (jsonStringField left "name")
  let rightName := nameRank (jsonStringField right "name")
  let leftSide := sideValueRank (jsonStringField left "side")
  let rightSide := sideValueRank (jsonStringField right "side")
  if leftName != rightName then leftName < rightName
  else if leftSide != rightSide then leftSide < rightSide
  else decide (jsonStringField left "code" < jsonStringField right "code")

def relationshipParseIssue (side : VerifierSide) (code detail : String) : SelectionIssue :=
  { code := code, side := some side, detail := detail }

def uniqueStrings (values : List String) : List String :=
  values.foldl (fun unique value => if unique.contains value then unique else unique ++ [value]) []

def evidenceEntrySizes (package : Package) (paths : List String) : Nat × Nat :=
  (uniqueStrings paths).foldl (fun totals path =>
    match package.index.find? path with
    | some entry => (totals.1 + entry.compressedSize, totals.2 + entry.expandedSize)
    | none => totals) (0, 0)

def physicalStoryPathForSide (story : PhysicalStory) : VerifierSide → String
  | .original => story.originalPartPath
  | .revised => story.revisedPartPath
  | .compared => story.comparedPartPath

def packageForSide (packages : Package × Package × Package) : VerifierSide → Package
  | .original => packages.1
  | .revised => packages.2.1
  | .compared => packages.2.2

def relationshipMetadataIssue (side : VerifierSide) (code detail : String) :
    SelectionIssue :=
  { code, side := some side, detail }

structure RelationshipMetadataPlan where
  usage : ResourceUsage
  issues : List SelectionIssue
  mayExtractSelected : Bool

def relationshipMetadataPlan (packages : Package × Package × Package)
    (selector : RuntimeSelectorResult) (baseEvents : ResourceUsage) :
    RelationshipMetadataPlan :=
  let sides : List VerifierSide := [.original, .revised, .compared]
  let selectedPaths := fun side =>
    uniqueStrings (selector.physicalStories.map fun story => physicalStoryPathForSide story side)
  let pathCountIssues :=
    sides.flatMap fun side =>
      if (selectedPaths side).length > maxSelectedParts then
        [relationshipMetadataIssue side "UNIQUE_SELECTED_PART_LIMIT_EXCEEDED"
          "unique selected relationship target count exceeds the package limit"]
      else []
  let triplePathIssue :=
    if (sides.map fun side => (selectedPaths side).length).sum > maxTripleSelectedParts ||
        selector.physicalStories.length > maxBindings then
      [{ code := "UNIQUE_SELECTED_PART_LIMIT_EXCEEDED"
         detail := "selected relationship work exceeds the three-package limit" }]
    else []
  let partIssues := selector.physicalStories.flatMap fun story =>
    sides.filterMap fun side =>
      let package := packageForSide packages side
      let path := physicalStoryPathForSide story side
      if partLimitExceeded package path then
        some {
          code := "SELECTED_PART_LIMIT_EXCEEDED"
          side := some side
          kind := some story.kind
          normalizedPartPath := some path
          detail := "selected relationship target exceeds the compressed or expanded part limit"
        }
      else none
  let usage := sides.foldl (fun usage side =>
    let package := packageForSide packages side
    let paths := ["word/document.xml", "word/_rels/document.xml.rels"] ++ selectedPaths side
    let sizes := evidenceEntrySizes package paths
    let current := usage.get side
    usage.set side { current with compressedBytes := sizes.1, expandedBytes := sizes.2 })
    baseEvents
  let aggregateIssues := sides.flatMap fun side =>
    let sideUsage := usage.get side
    (if sideUsage.compressedBytes > maxCumulativeCompressedBytes then
      [relationshipMetadataIssue side "AGGREGATE_COMPRESSED_LIMIT_EXCEEDED"
        "main, relationship, and selected compressed-byte metadata exceed the package limit"]
     else []) ++
    (if sideUsage.expandedBytes > maxCumulativeExpandedBytes then
      [relationshipMetadataIssue side "AGGREGATE_EXPANDED_LIMIT_EXCEEDED"
        "main, relationship, and selected expanded-byte metadata exceed the package limit"]
     else [])
  let tripleCompressed :=
    usage.original.compressedBytes + usage.revised.compressedBytes + usage.compared.compressedBytes
  let tripleExpanded :=
    usage.original.expandedBytes + usage.revised.expandedBytes + usage.compared.expandedBytes
  let tripleIssues :=
    (if tripleCompressed > maxTripleCumulativeCompressedBytes then
      [{ code := "AGGREGATE_COMPRESSED_LIMIT_EXCEEDED"
         detail := "relationship phase exceeds the three-package compressed-byte limit" }]
     else []) ++
    (if tripleExpanded > maxTripleCumulativeExpandedBytes then
      [{ code := "AGGREGATE_EXPANDED_LIMIT_EXCEEDED"
         detail := "relationship phase exceeds the three-package expanded-byte limit" }]
     else [])
  let eventIssues := sides.flatMap fun side =>
    if (usage.get side).xmlEvents > maxCumulativeXmlEvents then
      [relationshipMetadataIssue side "XML_TOKEN_LIMIT_EXCEEDED"
        "main and relationship XML exceed the package event aggregate limit"]
    else []
  let issues := pathCountIssues ++ triplePathIssue ++ partIssues ++ aggregateIssues ++
    tripleIssues ++ eventIssues
  { usage, issues, mayExtractSelected := issues.isEmpty }

def loadRelationships (package : Package) (inventory : DocumentInventory)
    (side : VerifierSide) : IO (List RelationshipRecord × List SelectionIssue × Nat) := do
  if partLimitExceeded package "word/_rels/document.xml.rels" then
    return ([], [relationshipParseIssue side "RELATIONSHIP_LIMIT_EXCEEDED"
      "document relationships part exceeds the compressed or expanded part limit"], 0)
  let extracted ← extractPart package "word/_rels/document.xml.rels"
  match extracted with
  | .missing =>
    if inventory.bindings.isEmpty then return ([], [], 0)
    return ([], [relationshipParseIssue side "MISSING_RELATIONSHIPS_PART"
      "document relationships part is missing for direct bindings"], 0)
  | .present extraction =>
    let bytes := extraction.decompressedBytes
    let some xml := String.fromUTF8? bytes |
      return ([], [relationshipParseIssue side "INVALID_RELATIONSHIPS_XML"
        "document relationships bytes are not valid UTF-8"], 0)
    match parseRelationships xml with
    | .ok parsed => return (parsed.1, [], parsed.2)
    | .error detail =>
      let code :=
        if detail.contains "unexpected root" then "INVALID_RELATIONSHIPS_ROOT"
        else if detail.contains "event limit" then "RELATIONSHIP_LIMIT_EXCEEDED"
        else if detail.contains "duplicate relationship id" then "DUPLICATE_RELATIONSHIP_ID"
        else if detail.contains "Id exceeds" then "RELATIONSHIP_ID_LIMIT_EXCEEDED"
        else if detail.contains "record" || detail.contains "attribute" ||
            detail.contains "direct child" then "MALFORMED_RELATIONSHIP_RECORD"
        else "INVALID_RELATIONSHIPS_XML"
      return ([], [relationshipParseIssue side code detail], 0)

def selectedPartIssue (side : VerifierSide) (story : PhysicalStory) (code detail path : String) :
    SelectionIssue :=
  { code := code
    side := some side
    kind := some story.kind
    normalizedPartPath := some path
    detail := detail }

instance : Inhabited XmlEventParseState := ⟨{}⟩

structure ProductionParseEvidence where
  packagePath : String
  packageBytes : ByteArray
  extraction : SnapshotExtractionEvidence
  normalizedPartPath : String
  entryName : String
  entryCompressedSize : Nat
  entryExpandedSize : Nat
  entryCrc32 : Nat
  extractedBytes : ByteArray
  bytes : ByteArray
  text : String
  expectedRootUri : String
  expectedRootLocalName : String
  eventLimit : Nat
  depthLimit : Nat
  parsed : XmlEventParseState
  parseInvocationCount : Nat
  parseResultExact :
    parseXmlEventsForRootBoundedTyped text expectedRootUri expectedRootLocalName
      eventLimit depthLimit = .ok parsed

def semanticCommentEntryOfProduction
    (evidence : ProductionParseEvidence) :
    Tier2.CommentReferenceIntegrity.CommentPartEntry :=
  { normalizedPartPath := evidence.normalizedPartPath
    compressedSize := evidence.extraction.entry.compressedSize
    expandedSize := evidence.extraction.entry.expandedSize
    regularEntryCount := 1
    localHeaderOffset := evidence.extraction.entry.localHeaderOffset
    dataOffset := evidence.extraction.entry.dataOffset
    localSpanEnd := evidence.extraction.entry.localSpanEnd
    crc32 := evidence.extraction.entry.crc32 }

def semanticCommentExtractionOfProduction
    (evidence : ProductionParseEvidence) :
    Tier2.CommentReferenceIntegrity.CommentExtractionEvidence :=
  { packageBytes := evidence.extraction.packageBytes
    snapshotBytes := evidence.extraction.snapshotBytes
    snapshotPath := evidence.extraction.snapshotPath
    snapshotWriteInvocationCount := evidence.extraction.snapshotWriteCount
    compressedPayload := evidence.extraction.compressedPayload
    decompressedBytes := evidence.extraction.decompressedBytes
    invocationCount := evidence.extraction.extractionInvocationCount }

def semanticCommentParsedPartOfProduction
    (evidence : ProductionParseEvidence) :
    Tier2.CommentReferenceIntegrity.CommentParsedPart :=
  { sourceText := evidence.text
    events := evidence.parsed.events
    rootUri := evidence.expectedRootUri
    rootLocalName := evidence.expectedRootLocalName
    depth := evidence.depthLimit
    eventLimit := evidence.eventLimit
    invocationCount := evidence.parseInvocationCount }

def productionParseEvidence (package : Package) (normalizedPartPath : String)
    (extraction : SnapshotExtractionEvidence) (text expectedRootUri
    expectedRootLocalName : String) (eventLimit depthLimit : Nat)
    (parsed : XmlEventParseState)
    (parseResultExact :
      parseXmlEventsForRootBoundedTyped text expectedRootUri expectedRootLocalName
        eventLimit depthLimit = .ok parsed) : ProductionParseEvidence :=
  { packagePath := package.path
    packageBytes := package.bytes
    extraction
    normalizedPartPath
    entryName := extraction.entry.name
    entryCompressedSize := extraction.entry.compressedSize
    entryExpandedSize := extraction.entry.expandedSize
    entryCrc32 := extraction.entry.crc32
    extractedBytes := extraction.decompressedBytes
    bytes := extraction.decompressedBytes
    text
    expectedRootUri
    expectedRootLocalName
    eventLimit
    depthLimit
    parsed
    parseInvocationCount := 1
    parseResultExact }

def parseProductionEvidence (package : Package) (normalizedPartPath : String)
    (extraction : SnapshotExtractionEvidence) (text expectedRootUri
    expectedRootLocalName : String) (eventLimit depthLimit : Nat) :
    Except XmlEventParseFailure ProductionParseEvidence :=
  match hParse : parseXmlEventsForRootBoundedTyped text expectedRootUri
      expectedRootLocalName eventLimit depthLimit with
  | .error failure => .error failure
  | .ok parsed =>
    .ok (productionParseEvidence package normalizedPartPath extraction text
      expectedRootUri expectedRootLocalName eventLimit depthLimit parsed hParse)

structure LoadedPhysicalStory where
  work : LoadedPhysicalWork
  originalParse : ProductionParseEvidence
  revisedParse : ProductionParseEvidence
  comparedParse : ProductionParseEvidence
  usage : ResourceUsage

structure ParsedSelectedSide where
  tokens : List XmlTok
  eventCount : Nat
  parseEvidence : ProductionParseEvidence

structure SelectedSideLoad where
  result : Except SelectionIssue ParsedSelectedSide
  aggregateStopped : Bool

def loadSelectedSide (package : Package) (story : PhysicalStory) (side : VerifierSide)
    (path : String) (usedEvents : Nat) : IO SelectedSideLoad := do
  if partLimitExceeded package path then
    return {
      result := .error (selectedPartIssue side story "SELECTED_PART_LIMIT_EXCEEDED"
        "selected relationship target exceeds the compressed or expanded part limit" path)
      aggregateStopped := false
    }
  let part ← extractPart package path
  match part with
  | .missing =>
    return {
      result := .error (selectedPartIssue side story "MISSING_TARGET_PART"
        "selected relationship target part is missing" path)
      aggregateStopped := false
    }
  | .present extraction =>
    let bytes := extraction.decompressedBytes
    let some xml := String.fromUTF8? bytes |
      return {
        result := .error (selectedPartIssue side story "INVALID_UTF8"
          "selected relationship target bytes are not valid UTF-8" path)
        aggregateStopped := false
      }
    let remaining := maxCumulativeXmlEvents - min maxCumulativeXmlEvents usedEvents
    let eventLimit := min maxXmlEventsPerPart remaining
    match parseProductionEvidence package path extraction xml wmlNamespace
        story.kind.rootName eventLimit maxXmlDepth with
    | .error failure =>
      let code := match failure.kind with
        | .unexpectedRoot => "TARGET_ROOT_MISMATCH"
        | .depthLimit => "XML_DEPTH_LIMIT_EXCEEDED"
        | .eventLimit => "XML_TOKEN_LIMIT_EXCEEDED"
        | .invalidXml => "INVALID_TARGET_XML"
      let aggregateStopped :=
        failure.kind == .eventLimit && remaining <= maxXmlEventsPerPart
      let boundedDetail :=
        if aggregateStopped then
          "selected story crosses the package XML-event aggregate limit"
        else failure.detail
      return {
        result := .error (selectedPartIssue side story code boundedDetail path)
        aggregateStopped
      }
    | .ok parseEvidence =>
      return {
        result := .ok {
          tokens := tokensFromXmlEvents parseEvidence.parsed.events
          eventCount := parseEvidence.parsed.eventCount
          parseEvidence
        }
        aggregateStopped := false
      }

structure PhysicalLoadAttempt where
  loaded : Option LoadedPhysicalStory
  issues : List SelectionIssue
  usage : ResourceUsage
  aggregateStopped : Bool

def addEventUsage (usage : ResourceUsage) (side : VerifierSide) (count : Nat) :
    ResourceUsage :=
  let current := usage.get side
  usage.set side { current with xmlEvents := current.xmlEvents + count }

def loadPhysicalStory (packages : Package × Package × Package) (story : PhysicalStory)
    (initialUsage : ResourceUsage) : IO PhysicalLoadAttempt := do
  let original ← loadSelectedSide packages.1 story .original story.originalPartPath
    initialUsage.original.xmlEvents
  let usageAfterOriginal := match original.result with
    | .ok parsed => addEventUsage initialUsage .original parsed.eventCount
    | .error _ => initialUsage
  match original.result with
  | .error issue =>
    return {
      loaded := none
      issues := [issue]
      usage := usageAfterOriginal
      aggregateStopped := original.aggregateStopped
    }
  | .ok _ => pure ()
  let revised ← loadSelectedSide packages.2.1 story .revised story.revisedPartPath
    usageAfterOriginal.revised.xmlEvents
  let usageAfterRevised := match revised.result with
    | .ok parsed => addEventUsage usageAfterOriginal .revised parsed.eventCount
    | .error _ => usageAfterOriginal
  match revised.result with
  | .error issue =>
    return {
      loaded := none
      issues := [issue]
      usage := usageAfterRevised
      aggregateStopped := revised.aggregateStopped
    }
  | .ok _ => pure ()
  let combined ← loadSelectedSide packages.2.2 story .compared story.comparedPartPath
    usageAfterRevised.compared.xmlEvents
  let usageAfterCombined := match combined.result with
    | .ok parsed => addEventUsage usageAfterRevised .compared parsed.eventCount
    | .error _ => usageAfterRevised
  match combined.result with
  | .error issue =>
    return {
      loaded := none
      issues := [issue]
      usage := usageAfterCombined
      aggregateStopped := combined.aggregateStopped
    }
  | .ok _ => pure ()
  let .ok originalParsed := original.result | unreachable!
  let .ok revisedParsed := revised.result | unreachable!
  let .ok combinedParsed := combined.result | unreachable!
  return {
    loaded := some {
      work := {
        story
        original := originalParsed.tokens
        revised := revisedParsed.tokens
        combined := combinedParsed.tokens
      }
      originalParse := originalParsed.parseEvidence
      revisedParse := revisedParsed.parseEvidence
      comparedParse := combinedParsed.parseEvidence
      usage := usageAfterCombined
    }
    issues := []
    usage := usageAfterCombined
    aggregateStopped := false
  }

def optionalAggregateIssueJson (story : FixedStory) (side : VerifierSide) (detail : String) :
    Json :=
  fixedIssueJson "OPTIONAL_STORY_AGGREGATE_LIMIT_EXCEEDED" story.name side.toString
    story.packagePart detail

def addEntryUsage (usage : ResourceUsage) (side : VerifierSide) (entry : ZipEntry) :
    ResourceUsage :=
  let current := usage.get side
  usage.set side {
    current with
    compressedBytes := current.compressedBytes + entry.compressedSize
    expandedBytes := current.expandedBytes + entry.expandedSize
  }

def optionalMetadataIssue (usage : ResourceUsage) (story : FixedStory)
    (side : VerifierSide) (entry : ZipEntry) : Option Json :=
  let current := usage.get side
  if entry.compressedSize > maxPartCompressedBytes ||
      entry.expandedSize > maxPartExpandedBytes then
    some (fixedIssueJson "OPTIONAL_STORY_PART_LIMIT_EXCEEDED" story.name side.toString
      story.packagePart "optional story exceeds the compressed or expanded part limit")
  else if current.compressedBytes + entry.compressedSize > maxCumulativeCompressedBytes then
    some (optionalAggregateIssueJson story side
      "optional story crosses the package compressed-byte aggregate limit")
  else if current.expandedBytes + entry.expandedSize > maxCumulativeExpandedBytes then
    some (optionalAggregateIssueJson story side
      "optional story crosses the package expanded-byte aggregate limit")
  else none

structure OptionalSideLoad where
  result : Except Json (List XmlTok × Nat)
  aggregateStopped : Bool

def loadOptionalSide (package : Package) (story : FixedStory) (side : VerifierSide)
    (usedEvents : Nat) : IO OptionalSideLoad := do
  let part ← extractPart package story.packagePart
  match part with
  | .missing => return { result := .ok ([], 0), aggregateStopped := false }
  | .present extraction =>
    let bytes := extraction.decompressedBytes
    let some xml := String.fromUTF8? bytes |
      return {
        result := .error (fixedIssueJson "OPTIONAL_STORY_INVALID_UTF8" story.name
          side.toString story.packagePart "optional story bytes are not valid UTF-8")
        aggregateStopped := false
      }
    let remaining := maxCumulativeXmlEvents - min maxCumulativeXmlEvents usedEvents
    let eventLimit := min maxXmlEventsPerPart remaining
    match parseXmlEventsForRootBoundedTyped xml wmlNamespace story.rootLocalName
        eventLimit maxXmlDepth with
    | .error failure =>
      let aggregateStopped :=
        failure.kind == .eventLimit && remaining <= maxXmlEventsPerPart
      let code := match failure.kind with
        | .unexpectedRoot => "OPTIONAL_STORY_ROOT_MISMATCH"
        | .depthLimit => "OPTIONAL_STORY_XML_DEPTH_LIMIT_EXCEEDED"
        | .eventLimit => "OPTIONAL_STORY_XML_TOKEN_LIMIT_EXCEEDED"
        | .invalidXml => "OPTIONAL_STORY_INVALID_XML"
      let issue :=
        if aggregateStopped then
          optionalAggregateIssueJson story side
            "optional story crosses the package XML-event aggregate limit"
        else
          fixedIssueJson code story.name side.toString
            story.packagePart failure.detail
      return { result := .error issue, aggregateStopped }
    | .ok parsed =>
      let tokens := tokensFromXmlEvents parsed.events
      let projected := if story.noteProjection then projectUserNoteTokens tokens else tokens
      return { result := .ok (projected, parsed.eventCount), aggregateStopped := false }

def loadOptionalStories (packages : Package × Package × Package)
    (initialUsage : ResourceUsage) (initiallyStopped : Bool) : IO LoadedOptionalStories := do
  let sides : List VerifierSide := [.original, .revised, .compared]
  let mut stories := []
  let mut issues := []
  let mut usage := initialUsage
  let mut aggregateStopped := initiallyStopped
  for story in optionalStories do
    let presentSides := sides.filter fun side =>
      (packageForSide packages side).index.find? story.packagePart |>.isSome
    if presentSides.isEmpty then continue
    if aggregateStopped then
      issues := issues ++ presentSides.map fun side =>
        optionalAggregateIssueJson story side
          "optional story was not extracted after an earlier aggregate XML-event limit"
      continue
    let metadataIssues := presentSides.filterMap fun side =>
      let package := packageForSide packages side
      (package.index.find? story.packagePart).bind fun entry =>
        optionalMetadataIssue usage story side entry
    if !metadataIssues.isEmpty then
      issues := issues ++ metadataIssues
      continue
    for side in presentSides do
      let package := packageForSide packages side
      let some entry := package.index.find? story.packagePart | unreachable!
      usage := addEntryUsage usage side entry
    let mut parsed : List (VerifierSide × List XmlTok × Nat) := []
    let mut storyIssues : List Json := []
    for side in sides do
      if aggregateStopped then continue
      let loaded ← loadOptionalSide (packageForSide packages side) story side
        (usage.get side).xmlEvents
      match loaded.result with
      | .error issue =>
        storyIssues := storyIssues ++ [issue]
        if loaded.aggregateStopped then aggregateStopped := true
      | .ok result =>
        parsed := parsed ++ [(side, result.1, result.2)]
        usage := addEventUsage usage side result.2
    if !storyIssues.isEmpty then
      issues := issues ++ storyIssues
    else
      let tokensFor := fun side =>
        match parsed.find? fun value => value.1 == side with
        | some value => value.2.1
        | none => []
      stories := stories ++ [{
        name := story.name
        original := tokensFor .original
        revised := tokensFor .revised
        combined := tokensFor .compared
        originalPresent := presentSides.contains .original
        revisedPresent := presentSides.contains .revised
        combinedPresent := presentSides.contains .compared
      }]
  return { stories, issues, usage, aggregateStopped }

structure MainState where
  story : NamedStoryTriple
  originalParse : ProductionParseEvidence
  revisedParse : ProductionParseEvidence
  comparedParse : ProductionParseEvidence
  originalInventory : DocumentInventory
  revisedInventory : DocumentInventory
  comparedInventory : DocumentInventory

def loadMainState (packages : Package × Package × Package) : IO MainState := do
  if partLimitExceeded packages.1 "word/document.xml" ||
      partLimitExceeded packages.2.1 "word/document.xml" ||
      partLimitExceeded packages.2.2 "word/document.xml" then
    throw (IO.userError "required word/document.xml exceeds the compressed or expanded part limit")
  let originalPart ← extractPart packages.1 "word/document.xml"
  let revisedPart ← extractPart packages.2.1 "word/document.xml"
  let comparedPart ← extractPart packages.2.2 "word/document.xml"
  let .present originalExtraction := originalPart |
    throw (IO.userError "required original word/document.xml is missing")
  let .present revisedExtraction := revisedPart |
    throw (IO.userError "required revised word/document.xml is missing")
  let .present comparedExtraction := comparedPart |
    throw (IO.userError "required compared word/document.xml is missing")
  let originalBytes := originalExtraction.decompressedBytes
  let revisedBytes := revisedExtraction.decompressedBytes
  let comparedBytes := comparedExtraction.decompressedBytes
  let some originalXml := String.fromUTF8? originalBytes |
    throw (IO.userError "required original word/document.xml is not valid UTF-8")
  let some revisedXml := String.fromUTF8? revisedBytes |
    throw (IO.userError "required revised word/document.xml is not valid UTF-8")
  let some comparedXml := String.fromUTF8? comparedBytes |
    throw (IO.userError "required compared word/document.xml is not valid UTF-8")
  let originalParse ← match parseProductionEvidence packages.1 "word/document.xml"
      originalExtraction originalXml wmlNamespace "document"
      maxXmlEventsPerPart maxXmlDepth with
    | .ok evidence => pure evidence
    | .error failure => throw (IO.userError failure.detail)
  let revisedParse ← match parseProductionEvidence packages.2.1 "word/document.xml"
      revisedExtraction revisedXml wmlNamespace "document"
      maxXmlEventsPerPart maxXmlDepth with
    | .ok evidence => pure evidence
    | .error failure => throw (IO.userError failure.detail)
  let comparedParse ← match parseProductionEvidence packages.2.2 "word/document.xml"
      comparedExtraction comparedXml wmlNamespace "document"
      maxXmlEventsPerPart maxXmlDepth with
    | .ok evidence => pure evidence
    | .error failure => throw (IO.userError failure.detail)
  let originalInventory ← IO.ofExcept
    (documentInventoryFromParsed .original originalParse.parsed)
  let revisedInventory ← IO.ofExcept
    (documentInventoryFromParsed .revised revisedParse.parsed)
  let comparedInventory ← IO.ofExcept
    (documentInventoryFromParsed .compared comparedParse.parsed)
  return {
    story := {
      name := "main"
      original := tokensFromXmlEvents originalParse.parsed.events
      revised := tokensFromXmlEvents revisedParse.parsed.events
      combined := tokensFromXmlEvents comparedParse.parsed.events
    }
    originalParse
    revisedParse
    comparedParse
    originalInventory
    revisedInventory
    comparedInventory
  }

structure NoteSource where
  sourceOrdinal : Nat
  sourceStory : String
  sourceStoryOrdinal : Nat
  normalizedPartPath : String
  parseEvidence : ProductionParseEvidence

structure LoadedNotePart where
  identity : SelectedNoteIdentity
  tokens : List XmlTok
  parseEvidence : ProductionParseEvidence

structure LoadedNotePartAttempt where
  result : Except Json LoadedNotePart
  usage : SideResourceUsage
  partPresent : Bool

structure NoteInventoryEvidence where
  side : VerifierSide
  kind : NoteKind
  status : String
  identity : Option SelectedNoteIdentity
  referenceOccurrences : Nat
  uniqueReferenceIds : Nat
  userDefinitions : Nat
  separatorDefinitions : Nat
  continuationSeparatorDefinitions : Nat
  continuationNoticeDefinitions : Nat
  forbiddenDefinitionStoryReferences : Nat
  deriving BEq, DecidableEq

structure NoteSideEvidence where
  side : VerifierSide
  sources : List NoteSource
  footnotesIdentity : Option SelectedNoteIdentity
  endnotesIdentity : Option SelectedNoteIdentity
  footnotesPartPresent : Bool
  endnotesPartPresent : Bool
  footnotesPart : Option LoadedNotePart
  endnotesPart : Option LoadedNotePart
  retainedScan : Option RetainedBoundedProductionNoteScan
  complete : Bool
  semanticLimitCrossed : Bool
  productionIntegrityPassed : Bool
  usage : SideResourceUsage
  issues : List Json
  footnotesInventory : NoteInventoryEvidence
  endnotesInventory : NoteInventoryEvidence

def retainProductionNoteScan (input : ProductionNoteScanInput) :
    RetainedBoundedProductionNoteScan :=
  let output := productionNoteScanBounded input
  { input
    output
    scanInvocationCount := 1
    outputExact := rfl }

def noteKindRank : NoteKind → Nat
  | .footnotes => 0
  | .endnotes => 1

def noteIssueStringRank (values : List String) (value : String) : Nat :=
  (values.zipIdx.find? fun pair => pair.1 == value).map (·.2) |>.getD values.length

def jsonNatField (value : Json) (key : String) : Nat :=
  match value.getObjValAs? Nat key with
  | .ok field => field
  | .error _ => 0

def zeroPaddedNat (width value : Nat) : String :=
  let digits := toString value
  String.ofList (List.replicate (width - digits.length) '0') ++ digits

def jsonPresentSortField (value : Json) (key : String) : String :=
  match value.getObjVal? key with
  | .ok field => "1" ++ field.compress
  | .error _ => "0"

def noteIssueSortKey (issue : Json) : String :=
  let source := match issue.getObjVal? "source" with
    | .ok value => value
    | .error _ => Json.null
  let spaces := ["relationship", "source", "definition", "reference", "poison", "aggregate"]
  let sourceStories := ["main", "header", "footer", "footnotes", "endnotes"]
  [
    zeroPaddedNat 2 (noteIssueStringRank ["original", "revised", "compared"]
      (jsonStringField issue "side")),
    zeroPaddedNat 2 (noteIssueStringRank ["footnotes", "endnotes"]
      (jsonStringField issue "kind")),
    zeroPaddedNat 2 (noteIssueStringRank spaces (jsonStringField issue "ordinalSpace")),
    zeroPaddedNat 5 (jsonNatField issue "firstOccurrenceOrdinal"),
    zeroPaddedNat 2 (noteIssueStringRank sourceStories
      (jsonStringField source "sourceStory")),
    zeroPaddedNat 4 (jsonNatField source "sourceStoryOrdinal"),
    jsonStringField issue "code",
    jsonPresentSortField issue "canonicalId",
    jsonPresentSortField issue "rawId",
    match issue.getObjVal? "rawIdByteLength" with
      | .ok _ => "1" ++ zeroPaddedNat 9 (jsonNatField issue "rawIdByteLength")
      | .error _ => "0",
    jsonPresentSortField issue "rawIdDigest",
    jsonPresentSortField issue "referencedKind",
    jsonPresentSortField issue "relationshipId",
    jsonPresentSortField issue "rawTarget",
    jsonPresentSortField issue "normalizedPartPath"
  ].intersperse "\u0000" |>.foldl (· ++ ·) ""

def noteIssueLess (left right : Json) : Bool :=
  decide (noteIssueSortKey left < noteIssueSortKey right)

def jsonOptionalKey (value : Json) (key : String) : String :=
  match value.getObjVal? key with
  | .ok field => "1" ++ field.compress
  | .error _ => "0"

def noteIssueCoalesceKey (issue : Json) : String :=
  let source := match issue.getObjVal? "source" with
    | .ok value => value
    | .error _ => Json.null
  [
    jsonStringField issue "side",
    jsonStringField issue "kind",
    jsonStringField issue "code",
    jsonStringField issue "ordinalSpace",
    jsonStringField source "sourceStory",
    toString (jsonNatField source "sourceStoryOrdinal"),
    jsonOptionalKey issue "canonicalId",
    jsonOptionalKey issue "rawId",
    jsonOptionalKey issue "rawIdByteLength",
    jsonOptionalKey issue "rawIdDigest",
    jsonOptionalKey issue "referencedKind",
    jsonOptionalKey issue "relationshipId",
    jsonOptionalKey issue "rawTarget",
    jsonOptionalKey issue "normalizedPartPath"
  ].intersperse "\u0000" |>.foldl (· ++ ·) ""

def coalesceNoteIssues (issues : List Json) : List Json :=
  issues.foldl (fun retained issue =>
    let key := noteIssueCoalesceKey issue
    if retained.any (fun existing => noteIssueCoalesceKey existing == key) then
      retained.map fun existing =>
        if noteIssueCoalesceKey existing != key then existing
        else
          let first := min (jsonNatField existing "firstOccurrenceOrdinal")
            (jsonNatField issue "firstOccurrenceOrdinal")
          let count := jsonNatField existing "occurrenceCount" +
            jsonNatField issue "occurrenceCount"
          (existing.setObjVal! "firstOccurrenceOrdinal" (toJson first))
            |>.setObjVal! "occurrenceCount" (toJson count)
    else retained ++ [issue]) []

def noteSourceJson (story : String) (ordinal : Nat) : Json :=
  Json.mkObj [("sourceStory", toJson story), ("sourceStoryOrdinal", toJson ordinal)]

def noteIssueJson (code detail : String) (side : VerifierSide) (kind : NoteKind)
    (ordinalSpace : String) (ordinal : Nat) (sourceStory : String)
    (sourceStoryOrdinal : Nat) (optional : List (String × Json) := []) : Json :=
  Json.mkObj <|
    [ ("code", toJson code)
    , ("side", toJson side.toString)
    , ("kind", toJson kind.toString)
    , ("detail", toJson (boundUtf8 detail 256))
    , ("ordinalSpace", toJson ordinalSpace)
    , ("firstOccurrenceOrdinal", toJson ordinal)
    , ("occurrenceCount", toJson (1 : Nat))
    , ("source", noteSourceJson sourceStory sourceStoryOrdinal)
    ] ++ optional

def noteRelationshipFailureFields (records : List RelationshipRecord)
    (failure : SelectionFailure) : List (String × Json) :=
  let ordinal := match failure with
    | .ambiguous ordinal | .external ordinal | .invalidTargetMode ordinal
    | .targetLimit ordinal | .unsafeTarget ordinal | .missingPart ordinal
    | .wrongRoot ordinal => ordinal
  let record := records[ordinal]?
  match failure with
  | .external _ | .invalidTargetMode _ | .unsafeTarget _ =>
    record.map (fun value =>
      [("relationshipId", toJson value.id), ("rawTarget", toJson value.rawTarget)])
      |>.getD []
  | .targetLimit _ =>
    record.map (fun value => [("relationshipId", toJson value.id)]) |>.getD []
  | .ambiguous _ | .missingPart _ | .wrongRoot _ => []

def noteSelectionIssue (side : VerifierSide) (kind : NoteKind)
    (records : List RelationshipRecord) (failure : SelectionFailure) : Json :=
  let optional := noteRelationshipFailureFields records failure
  match failure with
  | .ambiguous ordinal =>
    noteIssueJson "NOTE_RELATIONSHIP_AMBIGUOUS"
      "multiple exact Transitional note relationships select the semantic note story"
      side kind "relationship" ordinal "main" 0 optional
  | .external ordinal =>
    noteIssueJson "NOTE_RELATIONSHIP_EXTERNAL"
      "the sole exact Transitional note relationship is external"
      side kind "relationship" ordinal "main" 0 optional
  | .invalidTargetMode ordinal =>
    noteIssueJson "NOTE_RELATIONSHIP_INVALID_TARGET_MODE"
      "the sole exact Transitional note relationship has an unsupported TargetMode"
      side kind "relationship" ordinal "main" 0 optional
  | .targetLimit ordinal =>
    noteIssueJson "NOTE_RELATIONSHIP_TARGET_LIMIT_EXCEEDED"
      "the sole exact Transitional note relationship target exceeds its limit"
      side kind "relationship" ordinal "main" 0 optional
  | .unsafeTarget ordinal =>
    noteIssueJson "NOTE_RELATIONSHIP_UNSAFE_TARGET"
      "the sole exact Transitional note relationship target is unsafe"
      side kind "relationship" ordinal "main" 0 optional
  | .missingPart ordinal =>
    noteIssueJson "NOTE_PART_MISSING"
      "the selected Transitional note relationship target is absent"
      side kind "relationship" ordinal "main" 0 optional
  | .wrongRoot ordinal =>
    noteIssueJson "NOTE_PART_ROOT_MISMATCH"
      "the selected Transitional note relationship target has the wrong root"
      side kind "relationship" ordinal "main" 0 optional

def loadedNoteIdentityJson (identity : SelectedNoteIdentity) : Json :=
  Json.mkObj
    [ ("relationshipId", toJson identity.relationshipId)
    , ("normalizedPartPath", toJson identity.normalizedPartPath)
    ]

def definitionSourceJson (kind : NoteKind) (identity : Option SelectedNoteIdentity)
    (partPresent : Bool) : Json :=
  Json.mkObj <|
    [ ("kind", toJson kind.toString) ] ++
    (identity.map fun selected => [("relationship", loadedNoteIdentityJson selected)]).getD [] ++
    [("partPresent", toJson partPresent)]

def loadSelectedNotePart (package : Package) (side : VerifierSide) (kind : NoteKind)
    (sourceOrdinal : Nat) (identity : SelectedNoteIdentity) (usage : SideResourceUsage) :
    IO LoadedNotePartAttempt := do
  let sourceStory := kind.toString
  if partLimitExceeded package identity.normalizedPartPath then
    return {
      result := .error <| noteIssueJson "NOTE_PART_LIMIT_EXCEEDED"
        "selected note part exceeds the compressed or expanded part limit"
        side kind "source" sourceOrdinal sourceStory 0
        [("normalizedPartPath", toJson identity.normalizedPartPath)]
      usage
      partPresent := true
    }
  let some entry := package.index.find? identity.normalizedPartPath |
    return {
      result := .error <| noteIssueJson "NOTE_PART_MISSING"
        "selected note relationship target part is missing"
        side kind "source" sourceOrdinal sourceStory 0
        [("normalizedPartPath", toJson identity.normalizedPartPath)]
      usage
      partPresent := false
    }
  if usage.compressedBytes + entry.compressedSize > maxCumulativeCompressedBytes ||
      usage.expandedBytes + entry.expandedSize > maxCumulativeExpandedBytes then
    return {
      result := .error <| noteIssueJson "NOTE_PART_LIMIT_EXCEEDED"
        "selected note part crosses the package XML-byte aggregate limit"
        side kind "source" sourceOrdinal sourceStory 0
        [("normalizedPartPath", toJson identity.normalizedPartPath)]
      usage
      partPresent := true
    }
  let admittedUsage := {
    usage with
    compressedBytes := usage.compressedBytes + entry.compressedSize
    expandedBytes := usage.expandedBytes + entry.expandedSize
  }
  let extracted ← extractPart package identity.normalizedPartPath
  match extracted with
  | .missing =>
    return {
      result := .error <| noteIssueJson "NOTE_PART_MISSING"
        "selected note relationship target part is missing"
        side kind "source" sourceOrdinal sourceStory 0
        [("normalizedPartPath", toJson identity.normalizedPartPath)]
      usage
      partPresent := false
    }
  | .present extraction =>
    let bytes := extraction.decompressedBytes
    let some xml := String.fromUTF8? bytes |
      return {
        result := .error <| noteIssueJson "NOTE_PART_INVALID_UTF8"
          "selected note part is not valid UTF-8"
          side kind "source" sourceOrdinal sourceStory 0
          [("normalizedPartPath", toJson identity.normalizedPartPath)]
        usage := admittedUsage
        partPresent := true
      }
    let remainingEvents :=
      remainingNoteEventBudget maxSourceEventsPerSide admittedUsage.xmlEvents
    let eventLimit := min maxXmlEventsPerPart remainingEvents
    match parseProductionEvidence package identity.normalizedPartPath extraction xml
        wmlNamespace kind.rootLocalName eventLimit maxXmlDepth with
    | .error failure =>
      let sideEventOverflow := failure.kind == .eventLimit &&
        remainingEvents <= maxXmlEventsPerPart
      let code := if sideEventOverflow then "NOTE_SOURCE_PARTITION_INCOMPLETE"
        else match failure.kind with
          | .unexpectedRoot => "NOTE_PART_ROOT_MISMATCH"
          | .eventLimit | .depthLimit => "NOTE_PART_LIMIT_EXCEEDED"
          | .invalidXml => "NOTE_PART_INVALID_XML"
      let detail := if sideEventOverflow then
        "selected note story crosses the side-wide XML-event limit"
        else failure.detail
      let optional := if sideEventOverflow then []
        else [("normalizedPartPath", toJson identity.normalizedPartPath)]
      return {
        result := .error <| noteIssueJson code detail side kind "source"
          sourceOrdinal sourceStory 0 optional
        usage := admittedUsage
        partPresent := true
      }
    | .ok parseEvidence =>
      return {
        result := .ok {
          identity
          tokens := projectUserNoteTokens
            (tokensFromXmlEvents parseEvidence.parsed.events)
          parseEvidence
        }
        usage := { admittedUsage with
          xmlEvents := admittedUsage.xmlEvents + parseEvidence.parsed.eventCount }
        partPresent := true
      }

def physicalParseForSide (loaded : LoadedPhysicalStory) :
    VerifierSide → ProductionParseEvidence
  | .original => loaded.originalParse
  | .revised => loaded.revisedParse
  | .compared => loaded.comparedParse

def physicalPathForSide (loaded : LoadedPhysicalStory) (side : VerifierSide) : String :=
  physicalStoryPathForSide loaded.work.story side

def sourcesForSide (main : MainState) (physical : List LoadedPhysicalStory)
    (side : VerifierSide) : List NoteSource :=
  let mainParse := match side with
    | .original => main.originalParse
    | .revised => main.revisedParse
    | .compared => main.comparedParse
  [{ sourceOrdinal := 0, sourceStory := "main", sourceStoryOrdinal := 0,
      normalizedPartPath := "word/document.xml", parseEvidence := mainParse }] ++
    physical.zipIdx.map fun (loaded, index) =>
      { sourceOrdinal := index + 1
        sourceStory := loaded.work.story.kind.toString
        sourceStoryOrdinal := index
        normalizedPartPath := physicalPathForSide loaded side
        parseEvidence := physicalParseForSide loaded side }

def sourceIdentityForOrdinal (sources : List NoteSource) (ordinal : Nat) : String × Nat :=
  match sources.find? (·.sourceOrdinal == ordinal) with
  | some source => (source.sourceStory, source.sourceStoryOrdinal)
  | none => ("main", 0)

def countDefinitionTypes (definitions : List DefinitionOccurrence) :
    Nat × Nat × Nat × Nat :=
  definitions.foldl (fun counts definition =>
    match definition.definitionType with
    | .ok .user => (counts.1 + 1, counts.2.1, counts.2.2.1, counts.2.2.2)
    | .ok .separator => (counts.1, counts.2.1 + 1, counts.2.2.1, counts.2.2.2)
    | .ok .continuationSeparator =>
      (counts.1, counts.2.1, counts.2.2.1 + 1, counts.2.2.2)
    | .ok .continuationNotice =>
      (counts.1, counts.2.1, counts.2.2.1, counts.2.2.2 + 1)
    | .error _ => counts) (0, 0, 0, 0)

def canonicalReferencePairs (kind : NoteKind) (references : List ReferenceOccurrence) :
    List (ReferenceOccurrence × CanonicalDecimal) :=
  references.filterMap fun reference =>
    if reference.kind != kind then none
    else reference.rawId.bind fun raw => (parseDecimalId raw).toOption.map (reference, ·)

def canonicalDefinitionPairs (kind : NoteKind) (definitions : List DefinitionOccurrence) :
    List (DefinitionOccurrence × CanonicalDecimal) :=
  definitions.filterMap fun definition =>
    if definition.kind != kind then none
    else match definition.definitionType with
      | .ok .user =>
        definition.rawId.bind fun raw => (parseDecimalId raw).toOption.map (definition, ·)
      | _ => none

def malformedReferenceIssues (side : VerifierSide) (kind : NoteKind)
    (sources : List NoteSource) (references : List ReferenceOccurrence) : List Json :=
  references.filterMap fun reference =>
    if reference.kind != kind then none
    else
      let source := sourceIdentityForOrdinal sources reference.sourceOrdinal
      match reference.rawId with
      | none => some <| noteIssueJson "NOTE_ID_MISSING"
          "note reference has no w:id" side kind "reference"
          reference.occurrenceOrdinal source.1 source.2
      | some raw =>
        match parseDecimalId raw with
        | .ok _ => none
        | .error "lexical_limit" =>
          some <| noteIssueJson "NOTE_ID_LEXICAL_LIMIT_EXCEEDED"
            "note reference w:id exceeds the 64-byte lexical admission bound"
            side kind "reference" reference.occurrenceOrdinal source.1 source.2
            [("rawIdByteLength", toJson raw.toUTF8.size),
             ("rawIdDigest", toJson (crc32Hex raw.toUTF8))]
        | .error _ => some <| noteIssueJson "NOTE_ID_INVALID_DECIMAL"
            "note reference w:id is not an ST_DecimalNumber"
            side kind "reference" reference.occurrenceOrdinal source.1 source.2
            [("rawId", toJson raw)]

def definitionIssues (side : VerifierSide) (kind : NoteKind)
    (definitions : List DefinitionOccurrence) : List Json :=
  definitions.flatMap fun definition =>
    let source := kind.toString
    let typeIssue := match definition.definitionType with
      | .error _ => [noteIssueJson "NOTE_TYPE_INVALID"
          "note definition w:type is not a supported ST_FtnEdn value"
          side kind "definition" definition.occurrenceOrdinal source 0]
      | .ok _ => []
    let idIssue := match definition.rawId with
      | none => [noteIssueJson "NOTE_ID_MISSING" "note definition has no w:id"
          side kind "definition" definition.occurrenceOrdinal source 0]
      | some raw =>
        match parseDecimalId raw with
        | .ok _ => []
        | .error "lexical_limit" =>
          [noteIssueJson "NOTE_ID_LEXICAL_LIMIT_EXCEEDED"
            "note definition w:id exceeds the 64-byte lexical admission bound"
            side kind "definition" definition.occurrenceOrdinal source 0
            [("rawIdByteLength", toJson raw.toUTF8.size),
             ("rawIdDigest", toJson (crc32Hex raw.toUTF8))]]
        | .error _ => [noteIssueJson "NOTE_ID_INVALID_DECIMAL"
            "note definition w:id is not an ST_DecimalNumber"
            side kind "definition" definition.occurrenceOrdinal source 0
            [("rawId", toJson raw)]]
    typeIssue ++ idIssue

def duplicateDefinitionIssues (side : VerifierSide) (kind : NoteKind)
    (pairs : List (DefinitionOccurrence × CanonicalDecimal)) : List Json :=
  pairs.filterMap fun pair =>
    let earlier := pairs.filter fun other =>
      other.1.occurrenceOrdinal < pair.1.occurrenceOrdinal &&
        other.2.text == pair.2.text
    if earlier.isEmpty then none
    else some <| noteIssueJson "NOTE_USER_DEFINITION_DUPLICATE"
      "multiple user note definitions have the same canonical w:id"
      side kind "definition" pair.1.occurrenceOrdinal kind.toString 0
      [("canonicalId", toJson pair.2.text)]

def missingDefinitionIssues (side : VerifierSide) (kind : NoteKind)
    (sources : List NoteSource) (references : List (ReferenceOccurrence × CanonicalDecimal))
    (definitions : List (DefinitionOccurrence × CanonicalDecimal)) : List Json :=
  references.filterMap fun pair =>
    if definitions.any (fun definition => definition.2.text == pair.2.text) then none
    else
      let source := sourceIdentityForOrdinal sources pair.1.sourceOrdinal
      some <| noteIssueJson "NOTE_REFERENCE_MISSING_DEFINITION"
        "note reference has no exactly one matching user definition"
        side kind "reference" pair.1.occurrenceOrdinal source.1 source.2
        [("canonicalId", toJson pair.2.text)]

def poisonIssues (side : VerifierSide) (containingKind : NoteKind)
    (poison : List ReferenceOccurrence) : List Json :=
  poison.map fun reference =>
    noteIssueJson "NOTE_REFERENCE_IN_DEFINITION_STORY"
      "note definition stories cannot contain footnoteReference or endnoteReference"
      side containingKind "poison" reference.occurrenceOrdinal containingKind.toString 0
      [("referencedKind", toJson reference.kind.toString)]

inductive DefinitionPoisonCrossing
  | definition (kind : NoteKind)
  | poison (containingKind referencedKind : NoteKind)
  deriving Repr, Inhabited

structure DefinitionPoisonCounts where
  footnoteDefinitions : Nat := 0
  endnoteDefinitions : Nat := 0
  poisonReferences : Nat := 0

def firstDefinitionPoisonCrossingInStory (containingKind : NoteKind)
    (events : List XmlEvent) (initial : DefinitionPoisonCounts) :
    Option DefinitionPoisonCrossing × DefinitionPoisonCounts :=
  let rec loop (counts : DefinitionPoisonCounts) :
      List XmlEvent → Option DefinitionPoisonCrossing × DefinitionPoisonCounts
    | [] => (none, counts)
    | event :: rest =>
      match definitionCandidate? containingKind event with
      | some _ =>
        let count := if containingKind == .footnotes then
          counts.footnoteDefinitions else counts.endnoteDefinitions
        if count == maxDefinitions then
          (some (.definition containingKind), counts)
        else
          let next := if containingKind == .footnotes then
            { counts with footnoteDefinitions := count + 1 }
          else { counts with endnoteDefinitions := count + 1 }
          loop next rest
      | none =>
        match referenceCandidate? event with
        | some candidate =>
          if counts.poisonReferences == maxPoisonReferences then
            (some (.poison containingKind candidate.1), counts)
          else loop { counts with
            poisonReferences := counts.poisonReferences + 1 } rest
        | none => loop counts rest
  loop initial events

def firstDefinitionPoisonCrossing (footnoteEvents endnoteEvents : List XmlEvent) :
    Option DefinitionPoisonCrossing :=
  let footnotes := firstDefinitionPoisonCrossingInStory .footnotes footnoteEvents {}
  match footnotes.1 with
  | some crossing => some crossing
  | none => (firstDefinitionPoisonCrossingInStory .endnotes endnoteEvents footnotes.2).1

def malformedPoisonIssues (side : VerifierSide) (containingKind : NoteKind)
    (poison : List ReferenceOccurrence) : List Json :=
  poison.flatMap fun reference =>
    let common := [("referencedKind", toJson reference.kind.toString)]
    match reference.rawId with
    | none =>
      [noteIssueJson "NOTE_ID_MISSING"
        "note definition-story reference has no w:id"
        side containingKind "poison" reference.occurrenceOrdinal
        containingKind.toString 0 common]
    | some raw =>
      match parseDecimalId raw with
      | .ok _ => []
      | .error "lexical_limit" =>
        [noteIssueJson "NOTE_ID_LEXICAL_LIMIT_EXCEEDED"
          "note definition-story reference w:id exceeds the 64-byte lexical admission bound"
          side containingKind "poison" reference.occurrenceOrdinal
          containingKind.toString 0
          (common ++
            [("rawIdByteLength", toJson raw.toUTF8.size),
             ("rawIdDigest", toJson (crc32Hex raw.toUTF8))])]
      | .error _ =>
        [noteIssueJson "NOTE_ID_INVALID_DECIMAL"
          "note definition-story reference w:id is not an ST_DecimalNumber"
          side containingKind "poison" reference.occurrenceOrdinal
          containingKind.toString 0
          (common ++ [("rawId", toJson raw)])]

def inventoryEvidence (side : VerifierSide) (kind : NoteKind) (status : String)
    (identity : Option SelectedNoteIdentity) (references uniqueIds : Nat)
    (counts : Nat × Nat × Nat × Nat) (poison : Nat) : NoteInventoryEvidence :=
  { side
    kind
    status
    identity
    referenceOccurrences := references
    uniqueReferenceIds := uniqueIds
    userDefinitions := counts.1
    separatorDefinitions := counts.2.1
    continuationSeparatorDefinitions := counts.2.2.1
    continuationNoticeDefinitions := counts.2.2.2
    forbiddenDefinitionStoryReferences := poison }

def inventoryJson (evidence : NoteInventoryEvidence) : Json :=
  Json.mkObj <|
    [ ("side", toJson evidence.side.toString)
    , ("kind", toJson evidence.kind.toString)
    , ("status", toJson evidence.status)
    ] ++
    (evidence.identity.map fun selected =>
      [("relationship", loadedNoteIdentityJson selected)]).getD [] ++
    [ ("referenceOccurrences", toJson evidence.referenceOccurrences)
    , ("uniqueReferenceIds", toJson evidence.uniqueReferenceIds)
    , ("definitions", Json.mkObj
        [ ("user", toJson evidence.userDefinitions)
        , ("separator", toJson evidence.separatorDefinitions)
        , ("continuationSeparator", toJson evidence.continuationSeparatorDefinitions)
        , ("continuationNotice", toJson evidence.continuationNoticeDefinitions)
        ])
    , ("forbiddenDefinitionStoryReferences",
        toJson evidence.forbiddenDefinitionStoryReferences)
    ]

def zeroInventoryJson (side : VerifierSide) (kind : NoteKind)
    (identity : Option SelectedNoteIdentity) : NoteInventoryEvidence :=
  inventoryEvidence side kind "not_evaluated" identity 0 0 (0, 0, 0, 0) 0

def buildNoteSideEvidence (package : Package) (side : VerifierSide)
    (relationships : List RelationshipRecord) (sources : List NoteSource)
    (usage : SideResourceUsage) :
    IO NoteSideEvidence := do
  let footnoteSelection := selectConventionalMainNoteRecords .footnotes relationships
  let endnoteSelection := selectConventionalMainNoteRecords .endnotes relationships
  let mut issues : List Json := []
  let mut complete := true
  let mut semanticLimitCrossed := false
  let mut currentUsage := usage
  let mut footnotesIdentity : Option SelectedNoteIdentity := none
  match footnoteSelection with
    | .ok identity => footnotesIdentity := identity
    | .error failure =>
      issues := issues ++ [noteSelectionIssue side .footnotes relationships failure]
      complete := false
  let mut endnotesIdentity : Option SelectedNoteIdentity := none
  match endnoteSelection with
    | .ok identity => endnotesIdentity := identity
    | .error failure =>
      issues := issues ++ [noteSelectionIssue side .endnotes relationships failure]
      complete := false
  let mut footnotesPartPresent := false
  let footnotesPart ← match footnotesIdentity with
    | none => pure none
    | some identity =>
      let attempt ←
        loadSelectedNotePart package side .footnotes sources.length identity currentUsage
      currentUsage := attempt.usage
      footnotesPartPresent := attempt.partPresent
      match attempt.result with
      | .ok loaded => pure (some loaded)
      | .error issue =>
        issues := issues ++ [issue]
        complete := false
        pure none
  let mut endnotesPartPresent := false
  let endnotesPart ← match endnotesIdentity with
    | none => pure none
    | some identity =>
      if !complete then pure none
      else
        let attempt ← loadSelectedNotePart package side .endnotes (sources.length + 1)
          identity currentUsage
        currentUsage := attempt.usage
        endnotesPartPresent := attempt.partPresent
        match attempt.result with
        | .ok loaded => pure (some loaded)
        | .error issue =>
          issues := issues ++ [issue]
          complete := false
          pure none
  let scanInput : ProductionNoteScanInput := {
    validSourceEvents := sources.map fun source =>
      (source.sourceOrdinal, source.parseEvidence.parsed.events)
    footnoteDefinitionEvents :=
      footnotesPart.map (·.parseEvidence.parsed.events) |>.getD []
    endnoteDefinitionEvents :=
      endnotesPart.map (·.parseEvidence.parsed.events) |>.getD []
  }
  let retainedScan := retainProductionNoteScan scanInput
  let boundedScan := retainedScan.output
  let productionScan := boundedScan.scan
  let references := productionScan.references
  let footnoteDefinitions := productionScan.footnoteDefinitions
  let endnoteDefinitions := productionScan.endnoteDefinitions
  let footnotePoison := productionScan.footnotePoison
  let endnotePoison := productionScan.endnotePoison
  let productionIntegrityPassed := checkProductionNoteIntegrity productionScan
  for kind in [NoteKind.footnotes, NoteKind.endnotes] do
    let selected := if kind == NoteKind.footnotes then footnotesIdentity else endnotesIdentity
    if selected.isNone then
      if references.any (·.kind == kind) then
        issues := issues ++ [noteIssueJson "NOTE_RELATIONSHIP_REQUIRED"
          "a note reference requires an exact internal note relationship"
          side kind "relationship" 1024 kind.toString 0]
        complete := false
  let admittedEventCount :=
    (sources.map (fun source => source.parseEvidence.parsed.events.length)).sum +
    (footnotesPart.map (fun part => part.parseEvidence.parsed.events.length)).getD 0 +
    (endnotesPart.map (fun part => part.parseEvidence.parsed.events.length)).getD 0
  if admittedEventCount > maxSourceEventsPerSide then
    issues := issues ++ [noteIssueJson "NOTE_SOURCE_PARTITION_INCOMPLETE"
      "canonical admitted source stories exceed the side-wide XML-event limit"
      side .footnotes "source" 0 "main" 0]
    complete := false
  match boundedScan.crossing with
  | none => pure ()
  | some (.references kind sourceOrdinal occurrenceOrdinal) =>
    let source := sourceIdentityForOrdinal sources sourceOrdinal
    issues := issues ++ [noteIssueJson "NOTE_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED"
      "protocol v5 valid-source reference occurrence limit exceeded"
      side kind "reference" occurrenceOrdinal source.1 source.2]
    complete := false
    semanticLimitCrossed := true
  | some (.uniqueIds kind sourceOrdinal occurrenceOrdinal canonicalId) =>
    let source := sourceIdentityForOrdinal sources sourceOrdinal
    issues := issues ++ [noteIssueJson "NOTE_UNIQUE_REFERENCE_LIMIT_EXCEEDED"
      "protocol v5 unique note reference ID limit exceeded"
      side kind "reference" occurrenceOrdinal source.1 source.2
      [("canonicalId", toJson canonicalId)]]
    complete := false
    semanticLimitCrossed := true
  | some (.definitions kind occurrenceOrdinal) =>
      issues := issues ++ [noteIssueJson "NOTE_DEFINITION_LIMIT_EXCEEDED"
        "protocol v5 direct note definition limit exceeded"
        side kind "definition" occurrenceOrdinal kind.toString 0]
      complete := false
      semanticLimitCrossed := true
  | some (.poison containingKind referencedKind occurrenceOrdinal) =>
    issues := issues ++ [noteIssueJson "NOTE_POISON_REFERENCE_LIMIT_EXCEEDED"
      "protocol v5 definition-story reference limit exceeded"
      side containingKind "poison" occurrenceOrdinal containingKind.toString 0
      [("referencedKind", toJson referencedKind.toString)]]
    complete := false
    semanticLimitCrossed := true
  let evaluateKind := fun kind definitions poison =>
    let referencePairs := canonicalReferencePairs kind references
    let definitionPairs := canonicalDefinitionPairs kind definitions
    let semanticIssues := malformedReferenceIssues side kind sources references ++
      definitionIssues side kind definitions ++
      duplicateDefinitionIssues side kind definitionPairs ++
      missingDefinitionIssues side kind sources referencePairs definitionPairs ++
      malformedPoisonIssues side kind poison ++
      poisonIssues side kind poison
    (referencePairs, definitionPairs, semanticIssues)
  let footnoteResult := if semanticLimitCrossed then ([], [], []) else
    evaluateKind .footnotes footnoteDefinitions footnotePoison
  let endnoteResult := if semanticLimitCrossed then ([], [], []) else
    evaluateKind .endnotes endnoteDefinitions endnotePoison
  issues := issues ++ footnoteResult.2.2 ++ endnoteResult.2.2
  if !complete then
    return {
      side, sources, footnotesIdentity, endnotesIdentity,
      footnotesPartPresent, endnotesPartPresent, footnotesPart, endnotesPart,
      retainedScan := some retainedScan,
      complete, semanticLimitCrossed, productionIntegrityPassed := false,
      usage := currentUsage, issues
      footnotesInventory := zeroInventoryJson side .footnotes footnotesIdentity
      endnotesInventory := zeroInventoryJson side .endnotes endnotesIdentity
    }
  let inventoryFor := fun kind identity definitions poison result =>
    let counts := countDefinitionTypes definitions
    let relevantIssues := issues.any fun issue =>
      jsonStringField issue "kind" == kind.toString ||
        (jsonStringField issue "code" == "NOTE_REFERENCE_IN_DEFINITION_STORY" &&
          jsonStringField issue "referencedKind" == kind.toString)
    inventoryEvidence side kind (if relevantIssues then "failed" else "passed") identity
      result.1.length (result.1.map (·.2.text)).eraseDups.length counts poison.length
  return {
    side, sources, footnotesIdentity, endnotesIdentity,
    footnotesPartPresent, endnotesPartPresent, footnotesPart, endnotesPart,
    retainedScan := some retainedScan,
    complete, semanticLimitCrossed, productionIntegrityPassed,
    usage := currentUsage, issues
    footnotesInventory := inventoryFor .footnotes footnotesIdentity footnoteDefinitions
      footnotePoison footnoteResult
    endnotesInventory := inventoryFor .endnotes endnotesIdentity endnoteDefinitions
      endnotePoison endnoteResult
  }

def referenceSourceJson (source : NoteSource) : Json :=
  Json.mkObj <|
    [ ("sourceOrdinal", toJson source.sourceOrdinal)
    , ("sourceStory", toJson source.sourceStory)
    ] ++
    (if source.sourceStory == "main" then []
     else [("physicalStoryOrdinal", toJson source.sourceStoryOrdinal)]) ++
    [("normalizedPartPath", toJson source.normalizedPartPath)]

def partitionJson (evidence : NoteSideEvidence) : Json :=
  Json.mkObj
    [ ("side", toJson evidence.side.toString)
    , ("status", toJson (if evidence.complete then "complete" else "incomplete"))
    , ("sources", Json.arr (evidence.sources.map referenceSourceJson).toArray)
    , ("definitionStories", Json.arr #[
      definitionSourceJson .footnotes evidence.footnotesIdentity evidence.footnotesPartPresent,
        definitionSourceJson .endnotes evidence.endnotesIdentity evidence.endnotesPartPresent
      ])
    ]

def forceIncompleteEvidence (evidence : NoteSideEvidence) : NoteSideEvidence :=
  { evidence with
    complete := false
    footnotesInventory := zeroInventoryJson evidence.side .footnotes evidence.footnotesIdentity
    endnotesInventory := zeroInventoryJson evidence.side .endnotes evidence.endnotesIdentity }

def skippedNoteSideEvidence (side : VerifierSide) (sources : List NoteSource)
    (relationships : List RelationshipRecord) : NoteSideEvidence :=
  let footnotesIdentity := match selectConventionalMainNoteRecords .footnotes relationships with
    | .ok identity => identity
    | .error _ => none
  let endnotesIdentity := match selectConventionalMainNoteRecords .endnotes relationships with
    | .ok identity => identity
    | .error _ => none
  { side
    sources
    footnotesIdentity
    endnotesIdentity
    footnotesPartPresent := false
    endnotesPartPresent := false
    footnotesPart := none
    endnotesPart := none
    retainedScan := none
    complete := false
    semanticLimitCrossed := false
    productionIntegrityPassed := false
    usage := {}
    issues := []
    footnotesInventory := zeroInventoryJson side .footnotes footnotesIdentity
    endnotesInventory := zeroInventoryJson side .endnotes endnotesIdentity }

def noteStoryJson (kind : NoteKind) (sides : List NoteSideEvidence) : Json :=
  let identityFor := fun evidence =>
    if kind == .footnotes then evidence.footnotesIdentity else evidence.endnotesIdentity
  let partFor := fun evidence =>
    if kind == .footnotes then evidence.footnotesPart else evidence.endnotesPart
  let sideRecord := fun side =>
    match sides.find? (·.side == side) with
    | some evidence =>
      let present := if kind == .footnotes then
        evidence.footnotesPartPresent else evidence.endnotesPartPresent
      definitionSourceJson kind (identityFor evidence) present
    | none => definitionSourceJson kind none false
  let parts := sides.map partFor
  let evaluated := sides.length == 3 && sides.all (·.complete)
  let report :=
    if evaluated then
      match parts with
      | [original, revised, compared] =>
        some <| checkNamedStory {
          name := kind.toString
          original := original.map (·.tokens) |>.getD []
          revised := revised.map (·.tokens) |>.getD []
          combined := compared.map (·.tokens) |>.getD []
        }
      | _ => none
    else none
  Json.mkObj <|
    [ ("kind", toJson kind.toString)
    , ("status", toJson <| match report with
        | some value => if value.report.passed then "passed" else "failed"
        | none => "not_evaluated")
    , ("original", sideRecord .original)
    , ("revised", sideRecord .revised)
    , ("compared", sideRecord .compared)
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson (report.map (·.originalTokenCount) |>.getD 0))
        , ("revised", toJson (report.map (·.revisedTokenCount) |>.getD 0))
        , ("combined", toJson (report.map (·.combinedTokenCount) |>.getD 0))
        ])
    ] ++ (report.map fun value => [("report", reportToJson value.report)]).getD []

structure LoadedCommentPart where
  identity : SelectedCommentIdentity
  parseEvidence : ProductionParseEvidence

def semanticCommentRealizationOfProduction
    (part : LoadedCommentPart) :
    Tier2.CommentReferenceIntegrity.CommentStoryRealization :=
  let parsed := semanticCommentParsedPartOfProduction part.parseEvidence
  { selected := part.identity
    entry := semanticCommentEntryOfProduction part.parseEvidence
    extraction := semanticCommentExtractionOfProduction part.parseEvidence
    text := part.parseEvidence.text
    retainedParsedEvidence := parsed
    parsed }

structure CommentInventoryEvidence where
  side : VerifierSide
  status : String
  identity : Option SelectedCommentIdentity
  referenceOccurrences : Nat
  uniqueReferenceIds : Nat
  definitions : Nat
  unreferencedDefinitions : Nat
  nonDirectDefinitions : Nat
  deriving BEq, DecidableEq

structure CommentTripleResourceUsage where
  selectedParts : Nat := 0
  compressedBytes : Nat := 0
  expandedBytes : Nat := 0
  xmlEvents : Nat := 0
  deriving Repr, Inhabited

structure CommentSideEvidence where
  side : VerifierSide
  sources : List NoteSource
  sourcePartitionAdmitted : Bool
  realizationFailureCode : Option String
  realizationFailureDetail : Option String
  identity : Option SelectedCommentIdentity
  partPresent : Bool
  part : Option LoadedCommentPart
  retainedScan : Option RetainedCommentScan
  complete : Bool
  semanticLimitCrossed : Bool
  productionIntegrityPassed : Bool
  usage : SideResourceUsage
  tripleUsage : CommentTripleResourceUsage
  issues : List Json
  inventory : CommentInventoryEvidence

def commentIdentityJson (identity : SelectedCommentIdentity) : Json :=
  Json.mkObj
    [ ("relationshipId", toJson identity.relationshipId)
    , ("relationshipRecordOrdinal", toJson identity.relationshipRecordOrdinal)
    , ("normalizedPartPath", toJson identity.normalizedPartPath)
    ]

def commentSourceJson (source : NoteSource) : Json :=
  Json.mkObj <|
    [ ("sourceOrdinal", toJson source.sourceOrdinal)
    , ("sourceStory", toJson source.sourceStory)
    ] ++
    (if source.sourceStory == "main" ||
        source.sourceStory == "footnotes" ||
        source.sourceStory == "endnotes" then []
     else [("physicalStoryOrdinal", toJson source.sourceStoryOrdinal)]) ++
    [("normalizedPartPath", toJson source.normalizedPartPath)]

def commentIssueJson (code detail : String) (side : VerifierSide)
    (ordinalSpace : String) (ordinal : Nat) (sourceStory : String)
    (sourceStoryOrdinal : Nat)
    (optional : List (String × Json) := []) : Json :=
  Json.mkObj <|
    [ ("code", toJson code)
    , ("side", toJson side.toString)
    , ("kind", toJson "comments")
    , ("detail", toJson (boundUtf8 detail 256))
    , ("ordinalSpace", toJson ordinalSpace)
    , ("firstOccurrenceOrdinal", toJson ordinal)
    , ("occurrenceCount", toJson (1 : Nat))
    , ("source", noteSourceJson sourceStory sourceStoryOrdinal)
    ] ++ optional

def commentSelectionIssue (side : VerifierSide)
    (records : List RelationshipRecord)
    (failure : CommentSelectionFailure) : Json :=
  let ordinal := match failure with
    | .ambiguous value | .external value | .invalidTargetMode value
    | .targetLimit value | .unsafeTarget value => value
  let record := records[ordinal]?
  let relationshipFields := record.map (fun value =>
    [("relationshipId", toJson value.id),
      ("rawTarget", toJson value.rawTarget)]) |>.getD []
  match failure with
  | .ambiguous _ =>
    commentIssueJson "COMMENT_RELATIONSHIP_AMBIGUOUS"
      "multiple exact Transitional comments relationships exist"
      side "relationship" ordinal "main" 0
  | .external _ =>
    commentIssueJson "COMMENT_RELATIONSHIP_EXTERNAL"
      "the sole exact Transitional comments relationship is external"
      side "relationship" ordinal "main" 0 relationshipFields
  | .invalidTargetMode _ =>
    let fields := record.map (fun value =>
      [("relationshipId", toJson value.id),
       ("rawTarget", toJson value.rawTarget),
       ("targetMode", toJson (value.targetMode.getD ""))]) |>.getD []
    commentIssueJson "COMMENT_RELATIONSHIP_INVALID_TARGET_MODE"
      "the sole exact Transitional comments relationship has an invalid TargetMode"
      side "relationship" ordinal "main" 0 fields
  | .targetLimit _ =>
    let fields := record.map (fun value =>
      [("relationshipId", toJson value.id),
       ("rawTargetByteLength", toJson value.rawTarget.toUTF8.size)]) |>.getD []
    commentIssueJson "COMMENT_RELATIONSHIP_TARGET_LIMIT_EXCEEDED"
      "the comments relationship target exceeds its bounded locator limit"
      side "relationship" ordinal "main" 0 fields
  | .unsafeTarget _ =>
    commentIssueJson "COMMENT_RELATIONSHIP_UNSAFE_TARGET"
      "the comments relationship target is unsafe"
      side "relationship" ordinal "main" 0 relationshipFields

def zeroCommentInventory (side : VerifierSide)
    (identity : Option SelectedCommentIdentity) : CommentInventoryEvidence :=
  { side, status := "not_evaluated", identity, referenceOccurrences := 0
    uniqueReferenceIds := 0, definitions := 0, unreferencedDefinitions := 0
    nonDirectDefinitions := 0 }

def globallyStoppedCommentEvidence
    (evidence : CommentSideEvidence) : CommentSideEvidence :=
  { evidence with
    sourcePartitionAdmitted := false
    realizationFailureCode := none
    realizationFailureDetail := none
    identity := none
    partPresent := false
    part := none
    retainedScan := none
    complete := false
    semanticLimitCrossed := false
    productionIntegrityPassed := false
    issues := []
    inventory := zeroCommentInventory evidence.side none }

def applyCommentGlobalStop
    (sides : List CommentSideEvidence) : List CommentSideEvidence :=
  match sides with
  | original :: revised :: compared :: [] =>
      let revised' :=
        if original.complete then revised
        else globallyStoppedCommentEvidence revised
      let compared' :=
        if original.complete && revised.complete then compared
        else globallyStoppedCommentEvidence compared
      [original, revised', compared']
  | other => other

def commentInventoryJson (inventory : CommentInventoryEvidence) : Json :=
  Json.mkObj <|
    [ ("side", toJson inventory.side.toString)
    , ("status", toJson inventory.status)
    , ("relationship", inventory.identity.map commentIdentityJson |>.getD Json.null)
    ] ++
    [ ("referenceOccurrences", toJson inventory.referenceOccurrences)
    , ("uniqueReferenceIds", toJson inventory.uniqueReferenceIds)
    , ("definitions", toJson inventory.definitions)
    , ("unreferencedDefinitions", toJson inventory.unreferencedDefinitions)
    , ("nonDirectDefinitions", toJson inventory.nonDirectDefinitions)
    ]

def selectedCommentStoryJson (sides : List CommentSideEvidence) : Json :=
  let sideRecord := fun side =>
    match sides.find? (·.side == side) with
    | some evidence =>
      let status :=
        if !evidence.complete then "not_evaluated"
        else if evidence.identity.isNone then "absent"
        else if evidence.inventory.status == "failed" then "failed"
        else "passed"
      Json.mkObj
        [ ("status", toJson status)
        , ("relationship",
            evidence.identity.map commentIdentityJson |>.getD Json.null)
        , ("partPresent", toJson evidence.partPresent)
        ]
    | none => Json.mkObj
        [ ("status", toJson "not_evaluated")
        , ("relationship", Json.null)
        , ("partPresent", toJson false)
        ]
  let status :=
    if sides.length != 3 || sides.any (fun side => !side.complete) then
      "not_evaluated"
    else if sides.any (fun side => side.inventory.status == "failed") then
      "failed"
    else "passed"
  Json.mkObj
    [ ("status", toJson status)
    , ("original", sideRecord .original)
    , ("revised", sideRecord .revised)
    , ("compared", sideRecord .compared)
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson <| (sides.find? (·.side == .original)).bind
              (fun evidence => evidence.part.map (·.parseEvidence.parsed.eventCount))
              |>.getD 0)
        , ("revised", toJson <| (sides.find? (·.side == .revised)).bind
              (fun evidence => evidence.part.map (·.parseEvidence.parsed.eventCount))
              |>.getD 0)
        , ("combined", toJson <| (sides.find? (·.side == .compared)).bind
              (fun evidence => evidence.part.map (·.parseEvidence.parsed.eventCount))
              |>.getD 0)
        ])
    ]

def appendCommentNoteSources (evidence : NoteSideEvidence) : List NoteSource :=
  let base := evidence.sources
  let withFootnotes := match evidence.footnotesPart with
    | none => base
    | some part => base ++ [{
        sourceOrdinal := base.length
        sourceStory := "footnotes"
        sourceStoryOrdinal := 0
        normalizedPartPath := part.identity.normalizedPartPath
        parseEvidence := part.parseEvidence
      }]
  match evidence.endnotesPart with
  | none => withFootnotes
  | some part => withFootnotes ++ [{
      sourceOrdinal := withFootnotes.length
      sourceStory := "endnotes"
      sourceStoryOrdinal := 0
      normalizedPartPath := part.identity.normalizedPartPath
      parseEvidence := part.parseEvidence
    }]

def firstCommentReferenceSource?
    (sources : List NoteSource) : Option (NoteSource × Nat) :=
  sources.findSome? fun source =>
    (source.parseEvidence.parsed.events.zipIdx.findSome? fun pair =>
      if commentReferenceCandidate? pair.1 |>.isSome then some pair.2
      else none).map (source, ·)

structure LoadedCommentPartAttempt where
  result : Except Json LoadedCommentPart
  failureCode : Option String
  failureDetail : Option String
  usage : SideResourceUsage
  tripleSelectedParts : Nat
  tripleCompressedBytes : Nat
  tripleExpandedBytes : Nat
  tripleXmlEvents : Nat
  partPresent : Bool
  globalStop : Bool

def commentSelectedPartsBefore (evidence : NoteSideEvidence) : Nat :=
  (evidence.sources.drop 1).length +
    (if evidence.footnotesPart.isSome then 1 else 0) +
    (if evidence.endnotesPart.isSome then 1 else 0)

def loadSelectedCommentPart (package : Package) (side : VerifierSide)
    (identity : SelectedCommentIdentity) (usage : SideResourceUsage)
    (tripleSelectedParts tripleCompressedBytes tripleExpandedBytes
      tripleXmlEvents sideSelectedParts : Nat) :
    IO LoadedCommentPartAttempt := do
  let some entry := package.index.find? identity.normalizedPartPath |
    return {
      result := .error <| commentIssueJson "COMMENT_PART_MISSING"
        "the selected comments part is missing" side "relationship"
        identity.relationshipRecordOrdinal "comments" 0
        [("relationshipId", toJson identity.relationshipId),
         ("normalizedPartPath", toJson identity.normalizedPartPath)]
      failureCode := some "COMMENT_PART_MISSING"
      failureDetail := some "the selected comments part is missing"
      usage
      tripleSelectedParts, tripleCompressedBytes, tripleExpandedBytes,
      tripleXmlEvents
      partPresent := false
      globalStop := true
    }
  if entry.isDirectory then
    return {
      result := .error <| commentIssueJson "COMMENT_PART_MISSING"
        "the selected comments target is not a regular binary part"
        side "relationship" identity.relationshipRecordOrdinal "comments" 0
        [("relationshipId", toJson identity.relationshipId),
         ("normalizedPartPath", toJson identity.normalizedPartPath)]
      failureCode := some "COMMENT_PART_MISSING"
      failureDetail := some "the selected comments target is not a regular binary part"
      usage
      tripleSelectedParts, tripleCompressedBytes, tripleExpandedBytes,
      tripleXmlEvents
      partPresent := false
      globalStop := true
    }
  let limitIssue := if sideSelectedParts + 1 > maxSelectedParts then
      some ("COMMENT_SELECTED_PART_LIMIT_EXCEEDED",
        "the selected comments part crosses the side selected-part limit")
    else if tripleSelectedParts + 1 > maxTripleSelectedParts then
      some ("COMMENT_TRIPLE_SELECTED_PART_LIMIT_EXCEEDED",
        "the selected comments part crosses the three-package selected-part limit")
    else if entry.compressedSize > maxPartCompressedBytes then
      some ("COMMENT_PART_COMPRESSED_LIMIT_EXCEEDED",
        "the selected comments part crosses the compressed-byte limit")
    else if entry.expandedSize > maxPartExpandedBytes then
      some ("COMMENT_PART_EXPANDED_LIMIT_EXCEEDED",
        "the selected comments part crosses the expanded-byte limit")
    else if (entry.compressedSize == 0 && entry.expandedSize != 0) ||
        entry.expandedSize > entry.compressedSize * 100 then
      some ("COMMENT_PART_RATIO_LIMIT_EXCEEDED",
        "the selected comments part crosses the expansion-ratio limit")
    else if usage.compressedBytes + entry.compressedSize >
        maxCumulativeCompressedBytes then
      some ("COMMENT_CUMULATIVE_COMPRESSED_LIMIT_EXCEEDED",
        "the selected comments part crosses the side compressed-byte limit")
    else if usage.expandedBytes + entry.expandedSize >
        maxCumulativeExpandedBytes then
      some ("COMMENT_CUMULATIVE_EXPANDED_LIMIT_EXCEEDED",
        "the selected comments part crosses the side expanded-byte limit")
    else if tripleCompressedBytes + entry.compressedSize >
        maxTripleCumulativeCompressedBytes then
      some ("COMMENT_TRIPLE_COMPRESSED_LIMIT_EXCEEDED",
        "the selected comments part crosses the three-package compressed-byte limit")
    else if tripleExpandedBytes + entry.expandedSize >
        maxTripleCumulativeExpandedBytes then
      some ("COMMENT_TRIPLE_EXPANDED_LIMIT_EXCEEDED",
        "the selected comments part crosses the three-package expanded-byte limit")
    else none
  if let some (code, detail) := limitIssue then
    return {
      result := .error <| commentIssueJson code detail
        side "relationship" identity.relationshipRecordOrdinal "comments" 0
        [("relationshipId", toJson identity.relationshipId),
         ("normalizedPartPath", toJson identity.normalizedPartPath)]
      failureCode := some code
      failureDetail := some detail
      usage
      tripleSelectedParts, tripleCompressedBytes, tripleExpandedBytes,
      tripleXmlEvents
      partPresent := true
      globalStop := true
    }
  let admittedUsage := {
    usage with
    compressedBytes := usage.compressedBytes + entry.compressedSize
    expandedBytes := usage.expandedBytes + entry.expandedSize
  }
  let admittedTripleSelectedParts := tripleSelectedParts + 1
  let admittedTripleCompressedBytes := tripleCompressedBytes + entry.compressedSize
  let admittedTripleExpandedBytes := tripleExpandedBytes + entry.expandedSize
  let extracted ←
    try
      extractPart package identity.normalizedPartPath
    catch _ =>
      pure .missing
  let .present extraction := extracted |
    return {
      result := .error <| commentIssueJson "COMMENT_PART_EXTRACTION_FAILED"
        "the indexed comments part failed retained extraction"
        side "relationship" identity.relationshipRecordOrdinal "comments" 0
        [("relationshipId", toJson identity.relationshipId),
         ("normalizedPartPath", toJson identity.normalizedPartPath)]
      failureCode := some "COMMENT_PART_EXTRACTION_FAILED"
      failureDetail := some "the indexed comments part failed retained extraction"
      usage := admittedUsage
      tripleSelectedParts := admittedTripleSelectedParts
      tripleCompressedBytes := admittedTripleCompressedBytes
      tripleExpandedBytes := admittedTripleExpandedBytes
      tripleXmlEvents
      partPresent := false
      globalStop := true
    }
  let some xml := String.fromUTF8? extraction.decompressedBytes |
    return {
      result := .error <| commentIssueJson "COMMENT_PART_INVALID_UTF8"
        "the selected comments part is not valid UTF-8"
        side "relationship" identity.relationshipRecordOrdinal "comments" 0
        [("relationshipId", toJson identity.relationshipId),
         ("normalizedPartPath", toJson identity.normalizedPartPath)]
      failureCode := some "COMMENT_PART_INVALID_UTF8"
      failureDetail := some "the selected comments part is not valid UTF-8"
      usage := admittedUsage
      tripleSelectedParts := admittedTripleSelectedParts
      tripleCompressedBytes := admittedTripleCompressedBytes
      tripleExpandedBytes := admittedTripleExpandedBytes
      tripleXmlEvents
      partPresent := true
      globalStop := true
    }
  let sideRemaining := maxCumulativeXmlEvents -
    min maxCumulativeXmlEvents admittedUsage.xmlEvents
  let tripleRemaining := 3 * maxCumulativeXmlEvents -
    min (3 * maxCumulativeXmlEvents) tripleXmlEvents
  let eventLimit := min maxXmlEventsPerPart (min sideRemaining tripleRemaining)
  match parseProductionEvidence package identity.normalizedPartPath extraction
      xml wmlNamespace "comments" eventLimit maxXmlDepth with
  | .error failure =>
    let code := match failure.kind with
      | .unexpectedRoot => "COMMENT_PART_ROOT_MISMATCH"
      | .depthLimit => "COMMENT_PART_XML_DEPTH_LIMIT_EXCEEDED"
      | .eventLimit =>
        if sideRemaining <= maxXmlEventsPerPart &&
            sideRemaining <= tripleRemaining then
          "COMMENT_CUMULATIVE_XML_EVENT_LIMIT_EXCEEDED"
        else if tripleRemaining <= maxXmlEventsPerPart then
          "COMMENT_TRIPLE_XML_EVENT_LIMIT_EXCEEDED"
        else "COMMENT_PART_XML_EVENT_LIMIT_EXCEEDED"
      | .invalidXml => "COMMENT_PART_INVALID_XML"
    return {
      result := .error <| commentIssueJson code failure.detail
        side "relationship" identity.relationshipRecordOrdinal "comments" 0
        [("relationshipId", toJson identity.relationshipId),
         ("normalizedPartPath", toJson identity.normalizedPartPath)]
      failureCode := some code
      failureDetail := some failure.detail
      usage := admittedUsage
      tripleSelectedParts := admittedTripleSelectedParts
      tripleCompressedBytes := admittedTripleCompressedBytes
      tripleExpandedBytes := admittedTripleExpandedBytes
      tripleXmlEvents
      partPresent := true
      globalStop := true
    }
  | .ok parseEvidence =>
    return {
      result := .ok { identity, parseEvidence }
      failureCode := none
      failureDetail := none
      usage := { admittedUsage with xmlEvents :=
        admittedUsage.xmlEvents + parseEvidence.parsed.eventCount }
      tripleSelectedParts := admittedTripleSelectedParts
      tripleCompressedBytes := admittedTripleCompressedBytes
      tripleExpandedBytes := admittedTripleExpandedBytes
      tripleXmlEvents := tripleXmlEvents + parseEvidence.parsed.eventCount
      partPresent := true
      globalStop := false
    }

def commentCanonicalReferencePairs
    (references : List CommentReferenceOccurrence) :
    List (CommentReferenceOccurrence × CanonicalDecimal) :=
  references.filterMap fun reference =>
    reference.rawId.bind fun raw =>
      (parseDecimalId raw).toOption.map (reference, ·)

def commentCanonicalDefinitionPairs
    (definitions : List CommentDefinitionOccurrence) :
    List (CommentDefinitionOccurrence × CanonicalDecimal) :=
  definitions.filterMap fun definition =>
    definition.rawId.bind fun raw =>
      (parseDecimalId raw).toOption.map (definition, ·)

def commentSourceIdentity (sources : List NoteSource) (ordinal : Nat) :
    String × Nat :=
  match sources.find? (·.sourceOrdinal == ordinal) with
  | some source => (source.sourceStory, source.sourceStoryOrdinal)
  | none => ("main", 0)

def malformedCommentReferenceIssues (side : VerifierSide)
    (sources : List NoteSource)
    (references : List CommentReferenceOccurrence) : List Json :=
  references.filterMap fun reference =>
    let source := commentSourceIdentity sources reference.sourceOrdinal
    match reference.rawId with
    | none => some <| commentIssueJson "COMMENT_REFERENCE_ID_MISSING"
        "comment reference has no w:id" side "reference"
        reference.occurrenceOrdinal source.1 source.2
    | some raw =>
      match parseDecimalId raw with
      | .ok _ => none
      | .error "lexical_limit" =>
        some <| commentIssueJson "COMMENT_REFERENCE_ID_TOO_LONG"
          "comment reference w:id exceeds 64 UTF-8 bytes"
          side "reference" reference.occurrenceOrdinal source.1 source.2
          [("rawIdByteLength", toJson raw.toUTF8.size)]
      | .error _ =>
        some <| commentIssueJson "COMMENT_REFERENCE_ID_MALFORMED"
          "comment reference w:id is not an ST_DecimalNumber"
          side "reference" reference.occurrenceOrdinal source.1 source.2
          [("rawId", toJson raw)]

def commentDefinitionIssues (side : VerifierSide)
    (definitions : List CommentDefinitionOccurrence) : List Json :=
  definitions.flatMap fun definition =>
    match definition.rawId with
    | none => [commentIssueJson "COMMENT_DEFINITION_ID_MISSING"
        "direct comment definition has no w:id" side "definition"
        definition.occurrenceOrdinal "comments" 0]
    | some raw =>
      match parseDecimalId raw with
      | .ok _ => []
      | .error "lexical_limit" =>
        [commentIssueJson "COMMENT_DEFINITION_ID_TOO_LONG"
          "direct comment definition w:id exceeds 64 UTF-8 bytes"
          side "definition" definition.occurrenceOrdinal "comments" 0
          [("rawIdByteLength", toJson raw.toUTF8.size)]]
      | .error _ =>
        [commentIssueJson "COMMENT_DEFINITION_ID_MALFORMED"
          "direct comment definition w:id is not an ST_DecimalNumber"
          side "definition" definition.occurrenceOrdinal "comments" 0
          [("rawId", toJson raw)]]

def duplicateCommentDefinitionIssues (side : VerifierSide)
    (definitions : List (CommentDefinitionOccurrence × CanonicalDecimal)) :
    List Json :=
  definitions.filterMap fun pair =>
    if definitions.any fun earlier =>
        earlier.1.occurrenceOrdinal < pair.1.occurrenceOrdinal &&
        earlier.2.text == pair.2.text then
      some <| commentIssueJson "COMMENT_DEFINITION_DUPLICATE"
        "multiple direct comment definitions have the same canonical w:id"
        side "definition" pair.1.occurrenceOrdinal "comments" 0
        [("canonicalId", toJson pair.2.text)]
    else none

def missingCommentDefinitionIssues (side : VerifierSide)
    (sources : List NoteSource)
    (references : List (CommentReferenceOccurrence × CanonicalDecimal))
    (definitions : List (CommentDefinitionOccurrence × CanonicalDecimal)) :
    List Json :=
  references.filterMap fun pair =>
    if (definitions.filter fun definition =>
        definition.2.text == pair.2.text).length == 1 then none
    else
      let source := commentSourceIdentity sources pair.1.sourceOrdinal
      some <| commentIssueJson "COMMENT_DEFINITION_MISSING"
        "comment reference does not resolve to exactly one direct definition"
        side "reference" pair.1.occurrenceOrdinal source.1 source.2
        [("canonicalId", toJson pair.2.text)]

def skippedCommentSideEvidence (side : VerifierSide)
    (noteEvidence : NoteSideEvidence)
    (tripleUsage : CommentTripleResourceUsage) : CommentSideEvidence :=
  { side
    sources := appendCommentNoteSources noteEvidence
    sourcePartitionAdmitted := false
    realizationFailureCode := none
    realizationFailureDetail := none
    identity := none
    partPresent := false
    part := none
    retainedScan := none
    complete := false
    semanticLimitCrossed := false
    productionIntegrityPassed := false
    usage := noteEvidence.usage
    tripleUsage
    issues := []
    inventory := zeroCommentInventory side none }

def buildCommentSideEvidence (package : Package) (side : VerifierSide)
    (relationships : List RelationshipRecord)
    (noteEvidence : NoteSideEvidence)
    (tripleUsage : CommentTripleResourceUsage) : IO CommentSideEvidence := do
  let sources := appendCommentNoteSources noteEvidence
  if !noteEvidence.complete then
    return {
      side, sources, sourcePartitionAdmitted := false
      realizationFailureCode := none
      realizationFailureDetail := none
      identity := none, partPresent := false, part := none
      retainedScan := none, complete := false, semanticLimitCrossed := true
      productionIntegrityPassed := false, usage := noteEvidence.usage
      tripleUsage
      issues := [commentIssueJson "COMMENT_SOURCE_PARTITION_INCOMPLETE"
        "the admitted main/note/header/footer source partition is incomplete"
        side "source" 0 "main" 0]
      inventory := zeroCommentInventory side none
    }
  let selection := selectConventionalMainCommentRecords relationships
  match selection with
  | .error failure =>
    return {
      side, sources, sourcePartitionAdmitted := true
      realizationFailureCode := none
      realizationFailureDetail := none
      identity := none, partPresent := false, part := none
      retainedScan := none, complete := false, semanticLimitCrossed := true
      productionIntegrityPassed := false, usage := noteEvidence.usage
      tripleUsage
      issues := [commentSelectionIssue side relationships failure]
      inventory := zeroCommentInventory side none
    }
  | .ok none =>
    match firstCommentReferenceSource? sources with
    | some (source, ordinal) =>
      return {
        side, sources, sourcePartitionAdmitted := true
        realizationFailureCode := none
        realizationFailureDetail := none
        identity := none, partPresent := false, part := none
        retainedScan := none, complete := false, semanticLimitCrossed := true
        productionIntegrityPassed := false, usage := noteEvidence.usage
        tripleUsage
        issues := [commentIssueJson "COMMENT_RELATIONSHIP_REQUIRED"
          "a w:commentReference requires one exact internal comments relationship"
          side "reference" ordinal source.sourceStory source.sourceStoryOrdinal]
        inventory := zeroCommentInventory side none
      }
    | none =>
      let input : CommentScanInput := {
        sourceEvents := sources.map fun source =>
          (source.sourceOrdinal, source.parseEvidence.parsed.events)
        definitionEvents := []
      }
      let retained := retainCommentScanEvidence input
      return {
        side, sources, sourcePartitionAdmitted := true
        realizationFailureCode := none
        realizationFailureDetail := none
        identity := none, partPresent := false, part := none
        retainedScan := some retained, complete := true
        semanticLimitCrossed := false, productionIntegrityPassed := true
        usage := noteEvidence.usage, tripleUsage, issues := []
        inventory := {
          side := side
          status := "passed"
          identity := none
          referenceOccurrences := 0
          uniqueReferenceIds := 0
          definitions := 0
          unreferencedDefinitions := 0
          nonDirectDefinitions := 0
        }
      }
  | .ok (some selected) =>
    let loaded ← loadSelectedCommentPart package side selected noteEvidence.usage
      tripleUsage.selectedParts tripleUsage.compressedBytes
      tripleUsage.expandedBytes tripleUsage.xmlEvents
      (commentSelectedPartsBefore noteEvidence)
    let loadedTripleUsage : CommentTripleResourceUsage := {
      selectedParts := loaded.tripleSelectedParts
      compressedBytes := loaded.tripleCompressedBytes
      expandedBytes := loaded.tripleExpandedBytes
      xmlEvents := loaded.tripleXmlEvents
    }
    match loaded.result with
    | .error issue =>
      return {
        side := side
        sources := sources
        sourcePartitionAdmitted := true
        realizationFailureCode := loaded.failureCode
        realizationFailureDetail := loaded.failureDetail
        identity := some selected
        partPresent := loaded.partPresent
        part := none
        retainedScan := none
        complete := false
        semanticLimitCrossed := loaded.globalStop
        productionIntegrityPassed := false
        usage := loaded.usage
        tripleUsage := loadedTripleUsage
        issues := [issue]
        inventory := zeroCommentInventory side (some selected)
      }
    | .ok part =>
      let input : CommentScanInput := {
        sourceEvents := sources.map fun source =>
          (source.sourceOrdinal, source.parseEvidence.parsed.events)
        definitionEvents := part.parseEvidence.parsed.events
      }
      let retained := retainCommentScanEvidence input
      let scan := retained.output.scan
      let references := commentCanonicalReferencePairs scan.references
      let definitions := commentCanonicalDefinitionPairs scan.definitions
      let malformed := malformedCommentReferenceIssues side sources scan.references ++
        commentDefinitionIssues side scan.definitions
      let duplicates := duplicateCommentDefinitionIssues side definitions
      let missing := missingCommentDefinitionIssues side sources references definitions
      let nonDirect := scan.nonDirectDefinitions.map fun definition =>
        let canonicalId := (definition.rawId.bind fun raw =>
          (parseDecimalId raw).toOption.map (·.text)).getD ""
        commentIssueJson "COMMENT_DEFINITION_NOT_DIRECT"
          "w:comment definitions must be direct children of w:comments"
          side "definition" definition.occurrenceOrdinal "comments" 0
          [("canonicalId", toJson canonicalId)]
      let crossingIssues := match retained.output.crossing with
        | none => []
        | some (.references sourceOrdinal ordinal) =>
          let source := commentSourceIdentity sources sourceOrdinal
          [commentIssueJson "COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED"
            "comment reference occurrence limit exceeded"
            side "reference" ordinal source.1 source.2]
        | some (.uniqueIds sourceOrdinal ordinal canonicalId) =>
          let source := commentSourceIdentity sources sourceOrdinal
          [commentIssueJson "COMMENT_UNIQUE_REFERENCE_ID_LIMIT_EXCEEDED"
            "unique canonical comment reference ID limit exceeded"
            side "reference" ordinal source.1 source.2
            [("canonicalId", toJson canonicalId)]]
        | some (.definitions ordinal) =>
          [commentIssueJson "COMMENT_DEFINITION_LIMIT_EXCEEDED"
            "direct comment definition limit exceeded"
            side "definition" ordinal "comments" 0]
        | some (.nonDirectDefinitions ordinal) =>
          [commentIssueJson "COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED"
            "non-direct comment definition limit exceeded"
            side "definition" ordinal "comments" 0]
      let issues := crossingIssues ++ malformed ++ duplicates ++ missing ++ nonDirect
      let uniqueReferenceIds := references.map (·.2.text) |>.eraseDups.length
      let referencedIds := references.map (·.2.text) |>.eraseDups
      let unreferenced := definitions.filter fun definition =>
        !referencedIds.contains definition.2.text
      let integrityPassed := checkPackageCommentIntegrity
        (packageCommentInventory scan)
      let complete := retained.output.crossing.isNone
      return {
        side, sources, sourcePartitionAdmitted := true
        realizationFailureCode := none
        realizationFailureDetail := none
        identity := some selected, partPresent := true
        part := some part, retainedScan := some retained, complete
        semanticLimitCrossed := retained.output.crossing.isSome
        productionIntegrityPassed := integrityPassed, usage := loaded.usage
        tripleUsage := loadedTripleUsage
        issues
        inventory := {
          side
          status := if !complete then "not_evaluated"
            else if issues.isEmpty then "passed" else "failed"
          identity := some selected
          referenceOccurrences := if complete then references.length else 0
          uniqueReferenceIds := if complete then uniqueReferenceIds else 0
          definitions := if complete then definitions.length else 0
          unreferencedDefinitions := if complete then unreferenced.length else 0
          nonDirectDefinitions :=
            if complete then scan.nonDirectDefinitions.length else 0
        }
      }

structure RunRequestPackageRecord where
  packagePath : String
  packageBytes : ByteArray
  packageReadCount : Nat
  packageIndex : ZipIndex
  packageIndexExact :
    Tier2.CommentReferenceIntegrity.IndependentBinaryIndexOf
      packageBytes packageIndex
  snapshotPath : String
  snapshotBytes : ByteArray
  snapshotWriteCount : Nat
  snapshotWriteCountExact : snapshotWriteCount = 1
  snapshotBytesExact : snapshotBytes = packageBytes
  relationships : List RelationshipRecord
  noteEvidence : NoteSideEvidence
  commentEvidence : CommentSideEvidence

structure RunRequestCoreRequest where
  fixedTriples : List NamedStoryTriple
  relationshipSlots : List AlignedSlot
  relationshipStories : List PhysicalStory
  relationshipTriples : List NamedStoryTriple
  selectionIssues : List SelectionIssue
  original : RunRequestPackageRecord
  revised : RunRequestPackageRecord
  compared : RunRequestPackageRecord

def RunRequestCoreRequest.packageRecord (request : RunRequestCoreRequest) :
    Tier2.NoteReferenceIntegrity.VerifierSide → RunRequestPackageRecord
  | .original => request.original
  | .revised => request.revised
  | .compared => request.compared

def parsedRootFromProductionEvidence
    (evidence : ProductionParseEvidence) : Option ProofXmlRoot :=
  match evidence.parsed.events.head? with
  | some (.startElement uri localName _ 0 _) =>
    some { sourceText := evidence.text, namespaceUri := uri, localName }
  | _ => none

def productionParseCompleted (evidence : ProductionParseEvidence) : Bool :=
  evidence.parsed.rootSeen &&
  evidence.parsed.stack.isEmpty &&
  evidence.parsed.eventCount == evidence.parsed.events.length

def proofPart (path : String) (evidence : ProductionParseEvidence) : ProofPart :=
  { normalizedPartPath := path
    regularEntryCount := 1
    loadedBytes := some evidence.bytes
    decodedText := some evidence.text
    parsedRoot := parsedRootFromProductionEvidence evidence
    events := evidence.parsed.events
    fullyScanned := productionParseCompleted evidence }

def proofPartOfSource (source : NoteSource) : ProofPart :=
  proofPart source.normalizedPartPath source.parseEvidence

def proofPartOfNote (_kind : NoteKind) (part : LoadedNotePart) : ProofPart :=
  proofPart part.identity.normalizedPartPath part.parseEvidence

def typedNoteRelationshipRecords (records : List RelationshipRecord) :
    List TypedNoteRelationshipRecord :=
  records.zipIdx.filterMap fun (record, ordinal) =>
    let kind :=
      if record.relationshipType == NoteKind.footnotes.relationshipType then
        some NoteKind.footnotes
      else if record.relationshipType == NoteKind.endnotes.relationshipType then
        some NoteKind.endnotes
      else none
    kind.map fun noteKind =>
      { relationshipRecordOrdinal := ordinal
        kind := noteKind
        relationshipId := record.id
        normalizedPartPath := (normalizeTarget record.rawTarget).toOption.getD ""
        internal := record.targetMode.isNone || record.targetMode == some "Internal" }

def packageViewOfRecord (record : RunRequestPackageRecord) :
    Tier2.ConventionalMainNoteSelector.PackageView :=
  let evidence := record.noteEvidence
  let noteParts :=
    (evidence.footnotesPart.map (proofPartOfNote .footnotes) |>.toList) ++
    (evidence.endnotesPart.map (proofPartOfNote .endnotes) |>.toList)
  { relationshipRecords := typedNoteRelationshipRecords record.relationships
    parts := evidence.sources.map proofPartOfSource ++ noteParts
    physicalStories := evidence.sources.drop 1 |>.map fun source =>
      { story := source.sourceStory
        ordinal := source.sourceStoryOrdinal
        normalizedPartPath := source.normalizedPartPath } }

def selectedStoriesOfRecord (record : RunRequestPackageRecord) :
    Tier2.NoteReferenceIntegrity.SelectedStories :=
  let pkg := packageViewOfRecord record
  { physical := pkg.physicalStories.filterMap
      Tier2.NoteReferenceIntegrity.physicalStorySlot?
    footnotes := (Tier2.ConventionalMainNoteSelector.selectConventionalMainNote
      pkg .footnotes).toOption.join
    endnotes := (Tier2.ConventionalMainNoteSelector.selectConventionalMainNote
      pkg .endnotes).toOption.join }

def retainedCommentSourceScansOfRecord (record : RunRequestPackageRecord) :
    Tier2.NoteReferenceIntegrity.SideScanEvidence :=
  Tier2.NoteReferenceIntegrity.canonicalScans
    (packageViewOfRecord record) (selectedStoriesOfRecord record)

def noteSideOfCommentSide :
    Tier2.CommentReferenceIntegrity.VerifierSide →
      Tier2.NoteReferenceIntegrity.VerifierSide
  | .original => .original
  | .revised => .revised
  | .compared => .compared

def commentResourceUsageOfCore (request : RunRequestCoreRequest) :
    Tier2.CommentReferenceIntegrity.GlobalResourceUsage :=
  { side := fun side =>
      { xmlEvents :=
          (request.packageRecord (noteSideOfCommentSide side)).noteEvidence.usage.xmlEvents }
    tripleXmlEvents :=
      request.original.noteEvidence.usage.xmlEvents +
      request.revised.noteEvidence.usage.xmlEvents +
      request.compared.noteEvidence.usage.xmlEvents }

def commentPackageViewOfCore (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Tier2.CommentReferenceIntegrity.PackageView :=
  let record := request.packageRecord (noteSideOfCommentSide side)
  { packageBytes := record.packageBytes
    index := record.packageIndex
    relationshipRecords := record.relationships
    noteView := packageViewOfRecord record
    fixedMainSource :=
      { story := .main, ordinal := 0, normalizedPartPath := "word/document.xml" }
    retainedSourceScans := retainedCommentSourceScansOfRecord record
    retainedCommentRealization :=
      record.commentEvidence.part.map semanticCommentRealizationOfProduction
    resourceUsageBeforeComments := commentResourceUsageOfCore request }

def retainedCommentPackageRecordOfCore (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Tier2.CommentReferenceIntegrity.RetainedPackageRecordV6 :=
  let pkg := commentPackageViewOfCore request side
  { view := pkg, packageBytes := pkg.packageBytes, index := pkg.index }

def parsedCommentEvidenceOfProduction
    (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Tier2.CommentReferenceIntegrity.ParsedCommentEvidence :=
  let record := request.packageRecord (noteSideOfCommentSide side)
  let pkg := commentPackageViewOfCore request side
  let note := Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
    (packageViewOfRecord record) (noteSideOfCommentSide side)
      (selectedStoriesOfRecord record)
  let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
    pkg side note
  let comment := pkg.retainedCommentRealization
  let raw := Tier2.CommentReferenceIntegrity.scanCommentEvidence {
    sourceEvents :=
      Tier2.CommentReferenceIntegrity.scanCommentReferenceEvents set
        (Tier2.CommentReferenceIntegrity.reuseRetainedCommentScans pkg)
    definitionEvents :=
      Tier2.CommentReferenceIntegrity.scanDirectCommentDefinitions comment }
  Tier2.CommentReferenceIntegrity.parsedCommentEvidenceOfBoundedScan
    pkg side set comment {
      raw with
      crossing := record.commentEvidence.retainedScan.bind (·.output.crossing) }

def retainedParsedCommentEvidenceOfProduction
    (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Except String Tier2.CommentReferenceIntegrity.ParsedCommentEvidence :=
  let record := request.packageRecord (noteSideOfCommentSide side)
  match record.commentEvidence.retainedScan with
  | none => .error "retained comment scan is absent"
  | some retained =>
      let pkg := commentPackageViewOfCore request side
      let note := Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
        (packageViewOfRecord record) (noteSideOfCommentSide side)
        (selectedStoriesOfRecord record)
      let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
        pkg side note
      let comment := pkg.retainedCommentRealization
      .ok (Tier2.CommentReferenceIntegrity.parsedCommentEvidenceOfBoundedScan
        pkg side set comment retained.output)

def semanticCommentScanInputOfCore
    (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Tier2.CommentReferenceIntegrity.CommentScanInput :=
  let record := request.packageRecord (noteSideOfCommentSide side)
  let pkg := commentPackageViewOfCore request side
  let note := Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
    (packageViewOfRecord record) (noteSideOfCommentSide side)
    (selectedStoriesOfRecord record)
  let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
    pkg side note
  { sourceEvents :=
      Tier2.CommentReferenceIntegrity.scanCommentReferenceEvents set
        (Tier2.CommentReferenceIntegrity.reuseRetainedCommentScans pkg)
    definitionEvents :=
      Tier2.CommentReferenceIntegrity.scanDirectCommentDefinitions
        pkg.retainedCommentRealization }

def retainedCommentScanInputOfProduction
    (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Except String Tier2.CommentReferenceIntegrity.CommentScanInput :=
  let record := request.packageRecord (noteSideOfCommentSide side)
  match record.commentEvidence.retainedScan with
  | none => .error "retained comment scan is absent"
  | some retained => .ok retained.input

def productionScanInputOfRecord (record : RunRequestPackageRecord) :
    ProductionNoteScanInput :=
  { validSourceEvents := record.noteEvidence.sources.map fun source =>
      (source.sourceOrdinal, source.parseEvidence.parsed.events)
    footnoteDefinitionEvents :=
      record.noteEvidence.footnotesPart.map (·.parseEvidence.parsed.events) |>.getD []
    endnoteDefinitionEvents :=
      record.noteEvidence.endnotesPart.map (·.parseEvidence.parsed.events) |>.getD [] }

def productionParseEvidenceCheck (evidence : ProductionParseEvidence) : Bool :=
  decide (evidence.extractedBytes = evidence.bytes) &&
  decide (evidence.bytes = evidence.text.toUTF8) &&
  decide (evidence.parseInvocationCount = 1) &&
  evidence.parsed.rootSeen &&
  evidence.parsed.stack.isEmpty &&
  decide (evidence.parsed.eventCount = evidence.parsed.events.length) &&
  match evidence.parsed.events.head? with
  | some (.startElement uri localName _ 0 _) =>
    uri == evidence.expectedRootUri &&
    localName == evidence.expectedRootLocalName
  | _ => false

def SnapshotExtractionEvidenceOf (record : RunRequestPackageRecord)
    (evidence : SnapshotExtractionEvidence) : Prop :=
  evidence.packageBytes = record.packageBytes ∧
  evidence.snapshotBytes = evidence.packageBytes ∧
  evidence.snapshotPath = record.snapshotPath ∧
  evidence.snapshotWriteCount = 1 ∧
  buildZipIndex evidence.packageBytes = .ok evidence.zipIndex ∧
  evidence.zipIndex.find? evidence.selectedPartPath = some evidence.entry ∧
  evidence.centralOffset = evidence.zipIndex.centralOffset ∧
  evidence.centralSize = evidence.zipIndex.centralSize ∧
  evidence.entry.name = evidence.selectedPartPath ∧
  evidence.entry.dataOffset ≤ evidence.entry.localSpanEnd ∧
  evidence.entry.localSpanEnd ≤ evidence.packageBytes.size ∧
  evidence.compressedPayload =
    evidence.packageBytes.extract evidence.entry.dataOffset evidence.entry.localSpanEnd ∧
  evidence.compressedPayload.size = evidence.entry.compressedSize ∧
  evidence.decompressedBytes.size = evidence.entry.expandedSize ∧
  crc32 evidence.decompressedBytes = evidence.entry.crc32 ∧
  evidence.extractionInvocationCount = 1 ∧
  evidence.externalDecompressionTrusted = true

def snapshotExtractionEvidenceCheck (record : RunRequestPackageRecord)
    (evidence : SnapshotExtractionEvidence) : Bool :=
  decide (evidence.packageBytes = record.packageBytes) &&
  decide (evidence.snapshotPath = record.snapshotPath) &&
  decide (evidence.snapshotWriteCount = 1) &&
  decide (evidence.centralOffset = evidence.zipIndex.centralOffset) &&
  decide (evidence.centralSize = evidence.zipIndex.centralSize) &&
  decide (evidence.entry.name = evidence.selectedPartPath) &&
  decide (evidence.entry.dataOffset ≤ evidence.entry.localSpanEnd) &&
  decide (evidence.entry.localSpanEnd ≤ evidence.packageBytes.size) &&
  decide (evidence.compressedPayload.size = evidence.entry.compressedSize) &&
  decide (evidence.extractionInvocationCount = 1) &&
  evidence.externalDecompressionTrusted

def ProductionParseEvidenceOf (record : RunRequestPackageRecord)
    (evidence : ProductionParseEvidence) : Prop :=
  evidence.packagePath = record.packagePath ∧
  evidence.packageBytes = record.packageBytes ∧
  SnapshotExtractionEvidenceOf record evidence.extraction ∧
  evidence.extraction.decompressedBytes = evidence.extractedBytes ∧
  evidence.extractedBytes = evidence.bytes ∧
  evidence.bytes = evidence.text.toUTF8 ∧
  evidence.entryName = evidence.normalizedPartPath ∧
  evidence.entryExpandedSize = evidence.extractedBytes.size ∧
  evidence.parseInvocationCount = 1 ∧
  evidence.parsed.rootSeen = true ∧
  evidence.parsed.stack = [] ∧
  evidence.parsed.eventCount = evidence.parsed.events.length ∧
  (∃ attributes selfClosing,
    evidence.parsed.events.head? =
      some (.startElement evidence.expectedRootUri
        evidence.expectedRootLocalName attributes 0 selfClosing)) ∧
  parseXmlEventsForRootBoundedTyped evidence.text evidence.expectedRootUri
      evidence.expectedRootLocalName evidence.eventLimit evidence.depthLimit =
    .ok evidence.parsed

def productionParseEvidencesOfRecord (record : RunRequestPackageRecord) :
    List ProductionParseEvidence :=
  record.noteEvidence.sources.map (·.parseEvidence) ++
  (record.noteEvidence.footnotesPart.map (·.parseEvidence)).toList ++
  (record.noteEvidence.endnotesPart.map (·.parseEvidence)).toList ++
  (record.commentEvidence.part.map (·.parseEvidence)).toList

def productionParseProvenanceCheck (record : RunRequestPackageRecord)
    (evidence : ProductionParseEvidence) : Bool :=
  decide (evidence.packagePath = record.packagePath) &&
  decide (evidence.packageBytes = record.packageBytes) &&
  snapshotExtractionEvidenceCheck record evidence.extraction &&
  decide (evidence.extraction.decompressedBytes = evidence.extractedBytes) &&
  !evidence.normalizedPartPath.isEmpty &&
  decide (evidence.entryName = evidence.normalizedPartPath) &&
  decide (evidence.entryExpandedSize = evidence.extractedBytes.size) &&
  decide (evidence.extractedBytes = evidence.bytes)

def productionPackageParserEvidencePass (record : RunRequestPackageRecord) : Bool :=
  (productionParseEvidencesOfRecord record).all fun evidence =>
    productionParseProvenanceCheck record evidence &&
    productionParseEvidenceCheck evidence

def selectedIdentityOptionEq (left right : Option SelectedNoteIdentity) : Bool :=
  decide (left = right)

def selectedRecordsResultIdentity :
    Except SelectionFailure (Option SelectedNoteIdentity) →
      Option SelectedNoteIdentity
  | .ok value => value
  | .error _ => none

def productionSelectorEvidencePass (record : RunRequestPackageRecord) : Bool :=
  selectedIdentityOptionEq record.noteEvidence.footnotesIdentity
      (selectedRecordsResultIdentity <|
        selectConventionalMainNoteRecords .footnotes record.relationships) &&
  selectedIdentityOptionEq record.noteEvidence.endnotesIdentity
      (selectedRecordsResultIdentity <|
        selectConventionalMainNoteRecords .endnotes record.relationships)

def expectedPassedInventoryJson (record : RunRequestPackageRecord)
    (kind : NoteKind) : NoteInventoryEvidence :=
  let evidence := record.noteEvidence
  let scan := evidence.retainedScan.map (·.output.scan) |>.getD
    Tier2.NoteReferenceIntegrity.emptyProductionNoteScan
  let references := canonicalReferencePairs kind scan.references
  let definitions := if kind == .footnotes then
    scan.footnoteDefinitions else scan.endnoteDefinitions
  let poison := if kind == .footnotes then scan.footnotePoison else scan.endnotePoison
  let identity := if kind == .footnotes then
    evidence.footnotesIdentity else evidence.endnotesIdentity
  inventoryEvidence evidence.side kind "passed" identity references.length
    (references.map (·.2.text)).eraseDups.length
    (countDefinitionTypes definitions) poison.length

def productionInventoryEvidencePass (record : RunRequestPackageRecord) : Bool :=
  decide (record.noteEvidence.footnotesInventory =
      expectedPassedInventoryJson record .footnotes) &&
  decide (record.noteEvidence.endnotesInventory =
      expectedPassedInventoryJson record .endnotes)

def productionCommentScanInput (record : RunRequestPackageRecord) :
    CommentScanInput :=
  { sourceEvents := record.commentEvidence.sources.map fun source =>
      (source.sourceOrdinal, source.parseEvidence.parsed.events)
    definitionEvents := record.commentEvidence.part.map
      (·.parseEvidence.parsed.events) |>.getD [] }

def expectedPassedCommentInventory
    (record : RunRequestPackageRecord) : CommentInventoryEvidence :=
  let evidence := record.commentEvidence
  let scan := evidence.retainedScan.map (·.output.scan) |>.getD {
    references := [], definitions := [], nonDirectDefinitions := []
  }
  let references := commentCanonicalReferencePairs scan.references
  let definitions := commentCanonicalDefinitionPairs scan.definitions
  let referencedIds := references.map (·.2.text) |>.eraseDups
  { side := evidence.side
    status := "passed"
    identity := evidence.identity
    referenceOccurrences := references.length
    uniqueReferenceIds := references.map (·.2.text) |>.eraseDups.length
    definitions := definitions.length
    unreferencedDefinitions := (definitions.filter fun definition =>
      !referencedIds.contains definition.2.text).length
    nonDirectDefinitions := scan.nonDirectDefinitions.length }

structure CommentSourceIdentity where
  sourceOrdinal : Nat
  sourceStory : String
  sourceStoryOrdinal : Nat
  normalizedPartPath : String
  deriving BEq, DecidableEq

structure CommentSourceRetainedProjection where
  identity : CommentSourceIdentity
  packageBytes : ByteArray
  decompressedBytes : ByteArray
  text : String
  expectedRootUri : String
  expectedRootLocalName : String
  events : List XmlEvent
  parseInvocationCount : Nat
  extractionInvocationCount : Nat
  deriving DecidableEq

def commentSourceIdentityProjection (source : NoteSource) :
    CommentSourceIdentity :=
  { sourceOrdinal := source.sourceOrdinal
    sourceStory := source.sourceStory
    sourceStoryOrdinal := source.sourceStoryOrdinal
    normalizedPartPath := source.normalizedPartPath }

def commentSourceRetainedProjection (source : NoteSource) :
    CommentSourceRetainedProjection :=
  { identity := commentSourceIdentityProjection source
    packageBytes := source.parseEvidence.packageBytes
    decompressedBytes := source.parseEvidence.extraction.decompressedBytes
    text := source.parseEvidence.text
    expectedRootUri := source.parseEvidence.expectedRootUri
    expectedRootLocalName := source.parseEvidence.expectedRootLocalName
    events := source.parseEvidence.parsed.events
    parseInvocationCount := source.parseEvidence.parseInvocationCount
    extractionInvocationCount :=
      source.parseEvidence.extraction.extractionInvocationCount }

def canonicalCommentSourceIdentities (record : RunRequestPackageRecord) :
    List CommentSourceIdentity :=
  (appendCommentNoteSources record.noteEvidence).map
    commentSourceIdentityProjection

def retainedCommentSourceIdentities (record : RunRequestPackageRecord) :
    List CommentSourceIdentity :=
  record.commentEvidence.sources.map commentSourceIdentityProjection

def canonicalCommentSourceProjections (record : RunRequestPackageRecord) :
    List CommentSourceRetainedProjection :=
  (appendCommentNoteSources record.noteEvidence).map
    commentSourceRetainedProjection

def retainedCommentSourceProjections (record : RunRequestPackageRecord) :
    List CommentSourceRetainedProjection :=
  record.commentEvidence.sources.map commentSourceRetainedProjection

def productionCommentPartAdmissionCheck (record : RunRequestPackageRecord)
    (part : LoadedCommentPart) : Bool :=
  let evidence := part.parseEvidence
  let entry := evidence.extraction.entry
  decide ((record.packageIndex.entries.filter
      (·.name == part.identity.normalizedPartPath)).length = 1) &&
  decide (evidence.extraction.zipIndex = record.packageIndex) &&
  decide (entry.name = part.identity.normalizedPartPath) &&
  decide (evidence.normalizedPartPath = entry.name) &&
  !evidence.extraction.snapshotPath.isEmpty &&
  decide (entry.compressedSize ≤ maxPartCompressedBytes) &&
  decide (entry.expandedSize ≤ maxPartExpandedBytes) &&
  decide (entry.compressedSize ≠ 0 ∨ entry.expandedSize = 0) &&
  decide (entry.expandedSize ≤ entry.compressedSize * 100) &&
  decide (evidence.expectedRootUri = wmlNamespace) &&
  decide (evidence.expectedRootLocalName = "comments") &&
  decide (evidence.depthLimit ≤ maxXmlDepth) &&
  decide (evidence.eventLimit ≤ maxXmlEventsPerPart) &&
  decide (evidence.parsed.events.length ≤ evidence.eventLimit)

def productionCommentEvidencePass (record : RunRequestPackageRecord) : Bool :=
  let evidence := record.commentEvidence
  let selected := selectConventionalMainCommentRecords record.relationships
  let sourceSetExact :=
    decide (retainedCommentSourceProjections record =
      canonicalCommentSourceProjections record) &&
    decide (retainedCommentSourceIdentities record =
      canonicalCommentSourceIdentities record)
  let selectionExact := match selected with
    | .error _ => false
    | .ok none =>
      evidence.identity.isNone && evidence.part.isNone && !evidence.partPresent
    | .ok (some identity) =>
      decide (evidence.identity = some identity) &&
      evidence.partPresent &&
      evidence.part.any fun part =>
        decide (part.identity = identity) &&
        productionCommentPartAdmissionCheck record part
  let retainedExact := evidence.retainedScan.any fun retained =>
    decide (retained.scanInvocationCount = 1) &&
    decide (retained.input = productionCommentScanInput record) &&
    retained.output.crossing.isNone &&
    checkPackageCommentIntegrity (packageCommentInventory retained.output.scan)
  sourceSetExact &&
  selectionExact &&
  retainedExact &&
  evidence.complete &&
  !evidence.semanticLimitCrossed &&
  evidence.productionIntegrityPassed &&
  evidence.issues.isEmpty &&
  decide (evidence.inventory = expectedPassedCommentInventory record)

def commentSelectionResultEq
    (left right : Except CommentSelectionFailure
      (Option SelectedCommentIdentity)) : Bool :=
  match left, right with
  | .error leftFailure, .error rightFailure => leftFailure == rightFailure
  | .ok leftSelected, .ok rightSelected => leftSelected == rightSelected
  | _, _ => false

theorem comment_selection_result_eq_sound
    (left right : Except CommentSelectionFailure
      (Option SelectedCommentIdentity))
    (h : commentSelectionResultEq left right = true) :
    left = right := by
  cases left <;> cases right <;>
    simp [commentSelectionResultEq, beq_iff_eq] at h ⊢ <;>
    assumption

def productionCommentGlobalAdmissionCheck
    (request : RunRequestCoreRequest) : Bool :=
  let selectorCheck := fun side =>
    let record := request.packageRecord (noteSideOfCommentSide side)
    commentSelectionResultEq
      (Tier2.CommentReferenceIntegrity.selectConventionalMainComment
        (commentPackageViewOfCore request side))
      (selectConventionalMainCommentRecords record.relationships)
  let sourceCheck := fun side =>
    let record := request.packageRecord (noteSideOfCommentSide side)
    Tier2.CommentReferenceIntegrity.completeCommentSourceSetCheck
      (commentPackageViewOfCore request side) side
      (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
        (packageViewOfRecord record) (noteSideOfCommentSide side)
        (selectedStoriesOfRecord record))
  let scanCheck := fun side =>
    match retainedParsedCommentEvidenceOfProduction request side with
    | .error _ => false
    | .ok actual =>
        decide (actual = parsedCommentEvidenceOfProduction request side)
  let scanInputCheck := fun side =>
    match retainedCommentScanInputOfProduction request side with
    | .error _ => false
    | .ok actual =>
        decide (actual = semanticCommentScanInputOfCore request side)
  let sides : List Tier2.CommentReferenceIntegrity.VerifierSide :=
    [.original, .revised, .compared]
  decide ((commentResourceUsageOfCore request).tripleXmlEvents ≤
    3 * maxCumulativeXmlEvents) &&
  sides.all selectorCheck &&
  sides.all sourceCheck &&
  sides.all scanCheck &&
  sides.all scanInputCheck

def ProductionCommentEvidenceOf (record : RunRequestPackageRecord) : Prop :=
  let evidence := record.commentEvidence
  retainedCommentSourceProjections record =
      canonicalCommentSourceProjections record ∧
  retainedCommentSourceIdentities record =
      canonicalCommentSourceIdentities record ∧
  (match selectConventionalMainCommentRecords record.relationships with
    | .error _ => False
    | .ok none =>
      evidence.identity = none ∧ evidence.part = none ∧
      evidence.partPresent = false
    | .ok (some identity) =>
      evidence.identity = some identity ∧ evidence.partPresent = true ∧
      ∃ part, evidence.part = some part ∧ part.identity = identity ∧
        productionCommentPartAdmissionCheck record part = true) ∧
  ∃ retained,
    evidence.retainedScan = some retained ∧
    retained.scanInvocationCount = 1 ∧
    retained.input = productionCommentScanInput record ∧
    retained.output = scanCommentEvidence retained.input ∧
    retained.output.crossing = none ∧
    PackageCommentIntegrity (packageCommentInventory retained.output.scan) ∧
    evidence.inventory = expectedPassedCommentInventory record ∧
    evidence.complete = true ∧
    evidence.semanticLimitCrossed = false ∧
    evidence.issues = []

theorem production_comment_evidence_pass_sound
    (record : RunRequestPackageRecord)
    (hPass : productionCommentEvidencePass record = true) :
    ProductionCommentEvidenceOf record := by
  unfold productionCommentEvidencePass at hPass
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hPass
  rcases hPass with
    ⟨⟨⟨⟨⟨⟨⟨⟨hSourceRecords, hSources⟩, hSelection⟩, hRetained⟩, hComplete⟩,
      hNoCrossing⟩, _hIntegrityFlag⟩, hIssues⟩, hInventory⟩
  cases hRetainedOption : record.commentEvidence.retainedScan with
  | none => simp [hRetainedOption] at hRetained
  | some retained =>
    simp only [hRetainedOption, Option.any, Bool.and_eq_true,
      decide_eq_true_eq, Option.isNone_iff_eq_none] at hRetained
    rcases hRetained with ⟨⟨⟨hCount, hInput⟩, hCrossing⟩, hIntegrity⟩
    have hSelectionProp :
        match selectConventionalMainCommentRecords record.relationships with
        | .error _ => False
        | .ok none =>
          record.commentEvidence.identity = none ∧
          record.commentEvidence.part = none ∧
          record.commentEvidence.partPresent = false
        | .ok (some identity) =>
          record.commentEvidence.identity = some identity ∧
          record.commentEvidence.partPresent = true ∧
          ∃ part, record.commentEvidence.part = some part ∧
            part.identity = identity ∧
            productionCommentPartAdmissionCheck record part = true := by
      cases hSelected : selectConventionalMainCommentRecords record.relationships with
      | error failure =>
          simp only [hSelected] at hSelection
          contradiction
      | ok selected =>
        cases selected with
        | none =>
          simp only [hSelected, Bool.and_eq_true,
            Option.isNone_iff_eq_none] at hSelection
          cases hPresent : record.commentEvidence.partPresent <;>
            simp_all
        | some identity =>
          simp only [hSelected, Bool.and_eq_true, decide_eq_true_eq,
            Option.any_eq_true] at hSelection
          exact ⟨hSelection.1.1, hSelection.1.2, hSelection.2⟩
    have hNoCrossingValue :
        record.commentEvidence.semanticLimitCrossed = false := by
      cases hCrossed : record.commentEvidence.semanticLimitCrossed <;>
        simp_all
    exact ⟨hSourceRecords, hSources, hSelectionProp, retained,
      hRetainedOption, hCount, hInput,
      retained.outputExact, hCrossing,
      Tier2.CommentReferenceIntegrity.package_comment_reference_integrity_sound
        _ hIntegrity,
      hInventory, hComplete,
      hNoCrossingValue, List.isEmpty_iff.mp hIssues⟩

theorem production_comment_part_admitted_sound
    (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (part : LoadedCommentPart)
    (hPart :
      (request.packageRecord (noteSideOfCommentSide side)).commentEvidence.part =
        some part)
    (hParser : ∀ evidence,
      evidence ∈ productionParseEvidencesOfRecord
        (request.packageRecord (noteSideOfCommentSide side)) →
      ProductionParseEvidenceOf
        (request.packageRecord (noteSideOfCommentSide side)) evidence)
    (hAdmission : productionCommentPartAdmissionCheck
      (request.packageRecord (noteSideOfCommentSide side)) part = true)
    (hPrior : (commentResourceUsageOfCore request).tripleXmlEvents ≤ 3000000) :
    Tier2.CommentReferenceIntegrity.AdmittedCommentPartOf
      (commentPackageViewOfCore request side) side
      (commentResourceUsageOfCore request) part.identity
      (semanticCommentRealizationOfProduction part) := by
  let record := request.packageRecord (noteSideOfCommentSide side)
  have hParse : ProductionParseEvidenceOf record part.parseEvidence := by
    apply hParser
    simp [productionParseEvidencesOfRecord, record, hPart]
  dsimp [record] at hParse
  unfold productionCommentPartAdmissionCheck at hAdmission
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hAdmission
  unfold Tier2.CommentReferenceIntegrity.AdmittedCommentPartOf
    Tier2.CommentReferenceIntegrity.ExactlyOneRegularBinaryEntryAt
    Tier2.CommentReferenceIntegrity.CommentMetadataAdmittedSpec
    Tier2.CommentReferenceIntegrity.BoundedExtractionEvidenceSpec
    Tier2.CommentReferenceIntegrity.RetainedSnapshotExtractionOf
    Tier2.CommentReferenceIntegrity.RetainedTypedCommentXmlOf
    semanticCommentRealizationOfProduction
    semanticCommentEntryOfProduction semanticCommentExtractionOfProduction
    semanticCommentParsedPartOfProduction commentPackageViewOfCore
  dsimp only
  rcases hParse with ⟨_, hPackage, hExtraction, hExtracted, hBytes,
    hUtf8, hEntryName, hExpanded, hInvocation, _, _, hEvents,
    hRoot, _⟩
  rcases hExtraction with ⟨hExtractionPackage, hSnapshot, _hSnapshotPathExact,
    hSnapshotCount, _, hSelectedEntry, _, _, hSelectedName,
    hDataOrder, hSpanPackage,
    hPayload, hPayloadSize, hDecompressedSize, _, hExtractionCount, _⟩
  obtain ⟨hAdmission, hParsedEvents⟩ := hAdmission
  obtain ⟨hAdmission, hEventLimit⟩ := hAdmission
  obtain ⟨hAdmission, hDepth⟩ := hAdmission
  obtain ⟨hAdmission, hRootLocal⟩ := hAdmission
  obtain ⟨hAdmission, hRootUri⟩ := hAdmission
  obtain ⟨hAdmission, hRatio⟩ := hAdmission
  obtain ⟨hAdmission, hRatioZero⟩ := hAdmission
  obtain ⟨hAdmission, hExpandedLimit⟩ := hAdmission
  obtain ⟨hAdmission, hCompressed⟩ := hAdmission
  obtain ⟨hAdmission, hSnapshotPathBool⟩ := hAdmission
  obtain ⟨hAdmission, hNormalizedPath⟩ := hAdmission
  obtain ⟨hAdmission, hIdentityPath⟩ := hAdmission
  obtain ⟨hMultiplicity, hIndex⟩ := hAdmission
  have hSnapshotPath :
      part.parseEvidence.extraction.snapshotPath ≠ "" := by
    intro hEmpty
    rw [hEmpty] at hSnapshotPathBool
    contradiction
  have hIndexIndependent :=
    (request.packageRecord (noteSideOfCommentSide side)).packageIndexExact
  have hTypedBounds := hIndexIndependent.2.2.2.2
  have hEntryMember :
      part.parseEvidence.extraction.entry ∈
        part.parseEvidence.extraction.zipIndex.entries := by
    have := part.parseEvidence.extraction.selectedEntryExact
    simpa [Tier2.RelationshipStorySelector.ZipIndex.find?] using
      List.mem_of_find?_eq_some this
  have hBounds := hTypedBounds part.parseEvidence.extraction.entry
    (by simpa [hIndex] using hEntryMember)
  have hRatioZeroImp :
      part.parseEvidence.extraction.entry.compressedSize = 0 →
      part.parseEvidence.extraction.entry.expandedSize = 0 := by
    intro hZero
    cases hRatioZero with
    | inl hNonzero => exact False.elim (hNonzero hZero)
    | inr hExpandedZero => exact hExpandedZero
  have hSelectedPartIdentity :
      part.parseEvidence.extraction.selectedPartPath =
        part.identity.normalizedPartPath :=
    hSelectedName.symm.trans hIdentityPath
  have hSelectedEntryAtIdentity :
      part.parseEvidence.extraction.zipIndex.find?
          part.identity.normalizedPartPath =
        some part.parseEvidence.extraction.entry := by
    simpa [hSelectedPartIdentity] using hSelectedEntry
  refine ⟨hMultiplicity, ?_, ?_,
    hExtracted.trans (hBytes.trans hUtf8), ?_,
    Nat.le_trans hParsedEvents hEventLimit⟩
  · exact ⟨hNormalizedPath.trans hIdentityPath, rfl, hCompressed,
      hExpandedLimit, hRatioZeroImp, hRatio, hPrior⟩
  · refine ⟨?_, ?_, hSnapshotCount, hSnapshotPath, hExtractionCount,
      hIndexIndependent, ?_, hDecompressedSize⟩
    · exact hExtractionPackage
    · exact hSnapshot.trans hExtractionPackage
    · refine ⟨?_, part.parseEvidence.extraction.entry, ?_,
        hNormalizedPath, rfl, rfl, rfl, rfl, rfl,
        rfl, hBounds.1, hBounds.2.1, hBounds.2.2.1,
        hBounds.2.2.2.1, ?_, hBounds.2.2.2.2, ?_, hPayloadSize⟩
      · simpa [hExtractionPackage, hPackage] using hPayload
      · simpa [hIndex] using hSelectedEntryAtIdentity
      · exact hIndexIndependent.2.2.1
      · simpa [hExtractionPackage, hPackage] using hPayload
  · refine ⟨rfl, rfl, hRootUri, hRootLocal, hDepth, ?_,
      hInvocation, ?_, ?_⟩
    · exact hEventLimit
    · exact Nat.le_trans hParsedEvents hEventLimit
    · simpa [hRootUri, hRootLocal] using hRoot

def ProductionCommentSemanticProjectionOf
    (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Prop :=
  let record := request.packageRecord (noteSideOfCommentSide side)
  let pkg := commentPackageViewOfCore request side
  let note := Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
    (packageViewOfRecord record) (noteSideOfCommentSide side)
      (selectedStoriesOfRecord record)
  let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
    pkg side note
  let evidence := parsedCommentEvidenceOfProduction request side
  pkg.packageBytes = record.packageBytes ∧
  pkg.index = record.packageIndex ∧
  Tier2.CommentReferenceIntegrity.IndependentBinaryIndexOf
    pkg.packageBytes pkg.index ∧
  pkg.retainedSourceScans = retainedCommentSourceScansOfRecord record ∧
  pkg.retainedCommentRealization =
    record.commentEvidence.part.map semanticCommentRealizationOfProduction ∧
  Tier2.CommentReferenceIntegrity.CommentSelectionResultOf pkg
    (Tier2.CommentReferenceIntegrity.selectConventionalMainComment pkg) ∧
  Tier2.CommentReferenceIntegrity.ParsedCommentEvidenceOf
    pkg side set pkg.retainedCommentRealization evidence ∧
  ∃ retained,
    record.commentEvidence.retainedScan = some retained ∧
    retained.scanInvocationCount = 1 ∧
    retained.input = productionCommentScanInput record ∧
    retained.output =
      Tier2.CommentReferenceIntegrity.scanCommentEvidence retained.input

theorem production_comment_semantic_projection_sound
    (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hProduction : ProductionCommentEvidenceOf
      (request.packageRecord (noteSideOfCommentSide side))) :
    ProductionCommentSemanticProjectionOf request side := by
  let record := request.packageRecord (noteSideOfCommentSide side)
  let pkg := commentPackageViewOfCore request side
  let note := Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
    (packageViewOfRecord record) (noteSideOfCommentSide side)
      (selectedStoriesOfRecord record)
  let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
    pkg side note
  let evidence := parsedCommentEvidenceOfProduction request side
  unfold ProductionCommentSemanticProjectionOf
  change pkg.packageBytes = record.packageBytes ∧
    pkg.index = record.packageIndex ∧
    Tier2.CommentReferenceIntegrity.IndependentBinaryIndexOf
      pkg.packageBytes pkg.index ∧
    pkg.retainedSourceScans = retainedCommentSourceScansOfRecord record ∧
    pkg.retainedCommentRealization =
      record.commentEvidence.part.map semanticCommentRealizationOfProduction ∧
    Tier2.CommentReferenceIntegrity.CommentSelectionResultOf pkg
      (Tier2.CommentReferenceIntegrity.selectConventionalMainComment pkg) ∧
    Tier2.CommentReferenceIntegrity.ParsedCommentEvidenceOf
      pkg side set pkg.retainedCommentRealization evidence ∧
    ∃ retained,
      record.commentEvidence.retainedScan = some retained ∧
      retained.scanInvocationCount = 1 ∧
      retained.input = productionCommentScanInput record ∧
      retained.output =
        Tier2.CommentReferenceIntegrity.scanCommentEvidence retained.input
  rcases hProduction with ⟨_hSourceRecords, _hSources, _hSelection, retained,
    hRetained, hInvocation, hInput, hOutput, _⟩
  refine ⟨rfl, rfl, record.packageIndexExact, rfl, rfl,
    Tier2.CommentReferenceIntegrity.comment_selector_result_sound pkg, ?_,
    retained, hRetained, hInvocation, hInput, hOutput⟩
  exact ⟨rfl, rfl, rfl, rfl, rfl⟩

def productionRecordIntegrityPass (record : RunRequestPackageRecord) : Bool :=
  match record.noteEvidence.retainedScan with
  | none => false
  | some retained =>
    decide (retained.scanInvocationCount = 1) &&
    decide (retained.input = productionScanInputOfRecord record) &&
    retained.output.crossing.isNone &&
    checkProductionNoteIntegrity retained.output.scan

def productionRecordSemanticInventoryPass (record : RunRequestPackageRecord)
    (semanticInventory : PackageNoteInventory) : Bool :=
  packageNoteInventoryEq semanticInventory <|
    packageInventoryFromProductionScan
      (record.noteEvidence.retainedScan.map (·.output.scan) |>.getD
        Tier2.NoteReferenceIntegrity.emptyProductionNoteScan)

def productionSemanticInventoriesPass (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : Bool :=
  productionRecordSemanticInventoryPass request.original
      (semanticResponse.noteInventory .original) &&
  productionRecordSemanticInventoryPass request.revised
      (semanticResponse.noteInventory .revised) &&
  productionRecordSemanticInventoryPass request.compared
      (semanticResponse.noteInventory .compared)

def ProductionPackageRecordOf (record : RunRequestPackageRecord) : Prop :=
  record.packageReadCount = 1 ∧
  record.snapshotWriteCount = 1 ∧
  record.snapshotBytes = record.packageBytes ∧
  (∀ evidence, evidence ∈ productionParseEvidencesOfRecord record →
    ProductionParseEvidenceOf record evidence) ∧
  record.noteEvidence.footnotesIdentity =
    selectedRecordsResultIdentity
      (selectConventionalMainNoteRecords .footnotes record.relationships) ∧
  record.noteEvidence.endnotesIdentity =
    selectedRecordsResultIdentity
      (selectConventionalMainNoteRecords .endnotes record.relationships) ∧
  ∃ retained,
    record.noteEvidence.retainedScan = some retained ∧
    retained.input = productionScanInputOfRecord record ∧
    retained.output = productionNoteScanBounded retained.input ∧
    retained.scanInvocationCount = 1 ∧
    retained.output.crossing = none ∧
    checkProductionNoteIntegrity retained.output.scan = true ∧
    record.noteEvidence.footnotesInventory =
      expectedPassedInventoryJson record .footnotes ∧
    record.noteEvidence.endnotesInventory =
      expectedPassedInventoryJson record .endnotes

theorem production_parse_provenance_check_sound
    (record : RunRequestPackageRecord) (evidence : ProductionParseEvidence)
    (hCheck : productionParseProvenanceCheck record evidence = true) :
    evidence.packagePath = record.packagePath ∧
    evidence.packageBytes = record.packageBytes ∧
    SnapshotExtractionEvidenceOf record evidence.extraction ∧
    evidence.extraction.decompressedBytes = evidence.extractedBytes ∧
    evidence.entryName = evidence.normalizedPartPath ∧
    evidence.entryExpandedSize = evidence.extractedBytes.size ∧
    evidence.extractedBytes = evidence.bytes := by
  unfold productionParseProvenanceCheck at hCheck
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hCheck
  rcases hCheck with
    ⟨⟨⟨⟨⟨⟨⟨hPath, hPackage⟩, hExtractionCheck⟩,
      hExtracted⟩, _hNonempty⟩, hEntry⟩, hSize⟩, hBytes⟩
  have hExtraction : SnapshotExtractionEvidenceOf record evidence.extraction := by
    unfold snapshotExtractionEvidenceCheck at hExtractionCheck
    unfold SnapshotExtractionEvidenceOf
    simp only [Bool.and_eq_true, decide_eq_true_eq] at hExtractionCheck
    have hIndex := evidence.extraction.zipIndexExact
    have hSelected := evidence.extraction.selectedEntryExact
    have hSnapshot := evidence.extraction.snapshotBytesExact
    have hPayload := evidence.extraction.compressedPayloadExact
    have hSize := evidence.extraction.decompressedSizeExact
    have hCrc := evidence.extraction.decompressedCrcExact
    grind
  exact ⟨hPath, hPackage, hExtraction, hExtracted, hEntry, hSize, hBytes⟩

theorem production_parse_evidence_check_sound
    (evidence : ProductionParseEvidence)
    (hCheck : productionParseEvidenceCheck evidence = true) :
    evidence.extractedBytes = evidence.bytes ∧
    evidence.bytes = evidence.text.toUTF8 ∧
    evidence.parseInvocationCount = 1 ∧
    evidence.parsed.rootSeen = true ∧
    evidence.parsed.stack = [] ∧
    evidence.parsed.eventCount = evidence.parsed.events.length ∧
    ∃ attributes selfClosing,
      evidence.parsed.events.head? =
        some (.startElement evidence.expectedRootUri
          evidence.expectedRootLocalName attributes 0 selfClosing) := by
  unfold productionParseEvidenceCheck at hCheck
  simp only [Bool.and_eq_true, decide_eq_true_eq, List.isEmpty_iff] at hCheck
  rcases hCheck with
    ⟨⟨⟨⟨⟨⟨hExtracted, hParserBytes⟩, hInvocation⟩,
      hRootSeen⟩, hStack⟩, hCompleted⟩, hRoot⟩
  refine ⟨hExtracted, hParserBytes, hInvocation, hRootSeen, hStack,
    hCompleted, ?_⟩
  split at hRoot
  · rename_i uri localName attributes selfClosing hHead
    simp only [Bool.and_eq_true, beq_iff_eq] at hRoot
    exact ⟨attributes, selfClosing, by simpa [hRoot.1, hRoot.2] using hHead⟩
  · contradiction

theorem production_package_record_of_checks (record : RunRequestPackageRecord)
    (hRead : record.packageReadCount = 1)
    (hParser : productionPackageParserEvidencePass record = true)
    (hSelector : productionSelectorEvidencePass record = true)
    (hIntegrity : productionRecordIntegrityPass record = true)
    (hInventory : productionInventoryEvidencePass record = true) :
    ProductionPackageRecordOf record := by
  unfold ProductionPackageRecordOf
  refine ⟨hRead, record.snapshotWriteCountExact, record.snapshotBytesExact,
    ?_, ?_, ?_, ?_⟩
  · intro evidence hMember
    unfold productionPackageParserEvidencePass at hParser
    simp only [List.all_eq_true] at hParser
    have hEvidence := hParser evidence hMember
    have hBoth := Tier2.NoteReferenceIntegrity.and_true_components _ _ hEvidence
    have hProvenance :=
      production_parse_provenance_check_sound record evidence hBoth.1
    have hParsed := production_parse_evidence_check_sound evidence hBoth.2
    exact ⟨hProvenance.1, hProvenance.2.1, hProvenance.2.2.1,
      hProvenance.2.2.2.1, hParsed.1, hParsed.2.1,
      hProvenance.2.2.2.2.1, hProvenance.2.2.2.2.2.1, hParsed.2.2.1,
      hParsed.2.2.2.1, hParsed.2.2.2.2.1, hParsed.2.2.2.2.2.1,
      hParsed.2.2.2.2.2.2,
      evidence.parseResultExact⟩
  · unfold productionSelectorEvidencePass selectedIdentityOptionEq at hSelector
    simp only [Bool.and_eq_true, decide_eq_true_eq] at hSelector
    exact hSelector.1
  · unfold productionSelectorEvidencePass selectedIdentityOptionEq at hSelector
    simp only [Bool.and_eq_true, decide_eq_true_eq] at hSelector
    exact hSelector.2
  · cases hRetained : record.noteEvidence.retainedScan with
    | none =>
      simp [productionRecordIntegrityPass, hRetained] at hIntegrity
    | some retained =>
      refine ⟨retained, rfl, ?_, retained.outputExact, ?_, ?_, ?_, ?_, ?_⟩
      · unfold productionRecordIntegrityPass at hIntegrity
        simp only [hRetained, Bool.and_eq_true, decide_eq_true_eq,
          Option.isNone_iff_eq_none] at hIntegrity
        exact hIntegrity.1.1.2
      · unfold productionRecordIntegrityPass at hIntegrity
        simp only [hRetained, Bool.and_eq_true, decide_eq_true_eq,
          Option.isNone_iff_eq_none] at hIntegrity
        exact hIntegrity.1.1.1
      · unfold productionRecordIntegrityPass at hIntegrity
        simp only [hRetained, Bool.and_eq_true, decide_eq_true_eq,
          Option.isNone_iff_eq_none] at hIntegrity
        exact hIntegrity.1.2
      · unfold productionRecordIntegrityPass at hIntegrity
        simp only [hRetained, Bool.and_eq_true, decide_eq_true_eq,
          Option.isNone_iff_eq_none] at hIntegrity
        exact hIntegrity.2
      · unfold productionInventoryEvidencePass at hInventory
        simp only [Bool.and_eq_true, decide_eq_true_eq] at hInventory
        exact hInventory.1
      · unfold productionInventoryEvidencePass at hInventory
        simp only [Bool.and_eq_true, decide_eq_true_eq] at hInventory
        exact hInventory.2

theorem production_retained_comment_part_admitted
    (request : RunRequestCoreRequest)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (part : LoadedCommentPart)
    (hPart :
      (request.packageRecord (noteSideOfCommentSide side)).commentEvidence.part =
        some part)
    (hPackage : ProductionPackageRecordOf
      (request.packageRecord (noteSideOfCommentSide side)))
    (hComment : ProductionCommentEvidenceOf
      (request.packageRecord (noteSideOfCommentSide side)))
    (hPrior : (commentResourceUsageOfCore request).tripleXmlEvents ≤ 3000000) :
    Tier2.CommentReferenceIntegrity.AdmittedCommentPartOf
      (commentPackageViewOfCore request side) side
      (commentResourceUsageOfCore request) part.identity
      (semanticCommentRealizationOfProduction part) := by
  have hSelection := hComment.2.2.1
  cases hSelected :
      selectConventionalMainCommentRecords
        (request.packageRecord
          (noteSideOfCommentSide side)).relationships with
  | error failure =>
      simp only [hSelected] at hSelection
  | ok selected? =>
      cases selected? with
      | none =>
          simp only [hSelected] at hSelection
          have hImpossible := hPart.symm.trans hSelection.2.1
          cases hImpossible
      | some identity =>
          simp only [hSelected] at hSelection
          rcases hSelection.2.2 with
            ⟨selectedPart, hSelectedPart, hIdentity, hAdmission⟩
          have hSamePart : selectedPart = part :=
            Option.some.inj (hSelectedPart.symm.trans hPart)
          subst selectedPart
          subst identity
          exact production_comment_part_admitted_sound request side part hPart
            hPackage.2.2.2.1 hAdmission hPrior

def semanticRequestOfCore (request : RunRequestCoreRequest) : VerifierRequestV5 :=
  let packageView := fun side => packageViewOfRecord (request.packageRecord side)
  let selectedStories := fun side =>
    let package := packageView side
    { physical := package.physicalStories.filterMap
        Tier2.NoteReferenceIntegrity.physicalStorySlot?
      footnotes := (Tier2.ConventionalMainNoteSelector.selectConventionalMainNote
        package .footnotes).toOption.join
      endnotes := (Tier2.ConventionalMainNoteSelector.selectConventionalMainNote
        package .endnotes).toOption.join }
  { packageView
    selectedStories
    incompleteCause := fun _ => none
    genericStories := request.fixedTriples ++ request.relationshipTriples
    genericStoryReports := checkStoryCollection
      (request.fixedTriples ++ request.relationshipTriples) }

structure RunRequestCoreResult where
  responsePassed : Bool
  response : Json
  stdout : ByteArray
  semanticRequest : VerifierRequestV5
  semanticResponse : VerifierResponseV5
  semanticStdout : ByteArray
  typedProjectionCheck : Bool

def runRequestOperationalChecks (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : ProductionAggregateChecks :=
  let fixedReports := checkStoryCollection request.fixedTriples
  let selectedReports := checkStoryCollection request.relationshipTriples
  let noteEvidence :=
    [request.original.noteEvidence, request.revised.noteEvidence,
      request.compared.noteEvidence]
  let commentEvidence := applyCommentGlobalStop
    [request.original.commentEvidence, request.revised.commentEvidence,
      request.compared.commentEvidence]
  let selectionIssues := request.selectionIssues.eraseDups.mergeSort issueLess
  let noteIssues :=
    coalesceNoteIssues (noteEvidence.flatMap (·.issues)) |>.mergeSort noteIssueLess
  let commentIssues :=
    coalesceNoteIssues (commentEvidence.flatMap (·.issues)) |>.mergeSort noteIssueLess
  let ordinaryPartitions := noteEvidence.map partitionJson
  let ordinaryNoteStories :=
    [noteStoryJson .footnotes noteEvidence, noteStoryJson .endnotes noteEvidence]
  let ordinaryInventories := noteEvidence.flatMap fun evidence =>
    [inventoryJson evidence.footnotesInventory,
      inventoryJson evidence.endnotesInventory]
  let ordinaryCommentStory := selectedCommentStoryJson commentEvidence
  let ordinaryCommentInventories :=
    commentEvidence.map fun evidence => commentInventoryJson evidence.inventory
  let ordinaryOtherEvidence :=
    (fixedReports.map storyReportJson) ++ ordinaryPartitions ++ ordinaryNoteStories ++
      ordinaryInventories ++ [ordinaryCommentStory] ++ ordinaryCommentInventories
  let nonIssueStringBytes :=
    evidenceStringBytes [] [] request.relationshipSlots request.relationshipStories
      ordinaryOtherEvidence []
  let terminalIssue := (firstAggregateIssueCrossing nonIssueStringBytes
    (selectionIssues.map selectionIssueStringBytes)
    ((noteIssues ++ commentIssues).map jsonEvidenceStringBytes)).isSome
  let effectiveNoteEvidence := if terminalIssue then
    [ skippedNoteSideEvidence .original (request.original.noteEvidence.sources.take 1) []
    , skippedNoteSideEvidence .revised (request.revised.noteEvidence.sources.take 1) []
    , skippedNoteSideEvidence .compared (request.compared.noteEvidence.sources.take 1) []
    ] else noteEvidence
  let emittedNoteStories :=
    [noteStoryJson .footnotes effectiveNoteEvidence,
      noteStoryJson .endnotes effectiveNoteEvidence]
  let emittedInventories := effectiveNoteEvidence.flatMap fun evidence =>
    [inventoryJson evidence.footnotesInventory,
      inventoryJson evidence.endnotesInventory]
  {
    noTerminalIssue := !terminalIssue
    noSelectionIssues := !terminalIssue && selectionIssues.isEmpty
    noNoteIssues := !terminalIssue && noteIssues.isEmpty && commentIssues.isEmpty
    fixedStoriesPass := storyCollectionPassed
      (if terminalIssue then fixedReports.take 1 else fixedReports)
    relationshipStoriesPass := storyCollectionPassed selectedReports
    semanticPartitionsComplete := noteEvidence.all (·.complete)
    semanticNoteStoriesPass := emittedNoteStories.all fun story =>
      jsonStringField story "status" == "passed"
    inventoriesPass := (emittedInventories.all fun inventory =>
      jsonStringField inventory "status" == "passed") &&
      commentEvidence.all fun evidence =>
        evidence.complete && evidence.inventory.status == "passed"
    productionNoteIntegrityPass :=
      productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised &&
      productionRecordIntegrityPass request.compared &&
      productionSemanticInventoriesPass request semanticResponse &&
      productionCommentEvidencePass request.original &&
      productionCommentEvidencePass request.revised &&
      productionCommentEvidencePass request.compared &&
      productionCommentGlobalAdmissionCheck request
    semanticModelPass := semanticResponse.passed
  }

def runRequestOperationalPass (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : Bool :=
  productionAggregatePass (runRequestOperationalChecks request semanticResponse)

def runRequestCorePass (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : Bool :=
  if semanticResponse.passed then
    runRequestOperationalPass request semanticResponse
  else false

namespace SemanticProtocolSpec

structure Fields where
  passed : Bool
  fixedStories : List StoryReport
  relationshipSlots : List AlignedSlot
  relationshipStories : List (PhysicalStory × StoryReport)
  selectionIssues : List SelectionIssue
  noteSides : List NoteSideEvidence
  noteIssues : List Json
  commentSides : List CommentSideEvidence
  commentIssues : List Json
  terminalCode : Option String

def boundedUtf8 (value : String) (limit : Nat) : String :=
  let state := value.toList.foldl (fun (state : BoundedStringState) char =>
    if state.full then state
    else
      let width := (String.singleton char).toUTF8.size
      if width > limit - min limit state.bytes then { state with full := true }
      else { state with reversed := char :: state.reversed, bytes := state.bytes + width })
    ({} : BoundedStringState)
  String.ofList state.reversed.reverse

def checkReportJson (report : CheckReport) : Json :=
  Json.mkObj
    [ ("passed", toJson report.passed)
    , ("checks", Json.mkObj
        [ ("acceptPreservesFieldStructure", toJson report.acceptPreservesFieldStructure)
        , ("rejectPreservesFieldStructure", toJson report.rejectPreservesFieldStructure)
        , ("acceptTextMatchesRevised", toJson report.acceptTextMatchesRevised)
        , ("rejectTextMatchesOriginal", toJson report.rejectTextMatchesOriginal)
        , ("combinedHasNoFldCharInsideDel", toJson report.combinedHasNoFldCharInsideDel)
        , ("combinedHasValidMoveRanges", toJson report.combinedHasValidMoveRanges)
        ])
    ]

def fixedStoryJson (report : StoryReport) : Json :=
  Json.mkObj
    [ ("name", toJson report.name)
    , ("presence", Json.mkObj
        [ ("original", toJson report.originalPresent)
        , ("revised", toJson report.revisedPresent)
        , ("combined", toJson report.combinedPresent)
        ])
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson report.originalTokenCount)
        , ("revised", toJson report.revisedTokenCount)
        , ("combined", toJson report.combinedTokenCount)
        ])
    , ("report", checkReportJson report.report)
    ]

def relationshipIdentityJson (identity : RelationshipIdentity) : Json :=
  Json.mkObj
    [ ("relationshipId", toJson identity.relationshipId)
    , ("normalizedPartPath", toJson identity.normalizedPartPath)
    ]

def relationshipSlotJson (slot : AlignedSlot) : Json :=
  Json.mkObj
    [ ("slotOrdinal", toJson slot.slotOrdinal)
    , ("sectionOrdinal", toJson slot.sectionOrdinal)
    , ("kind", toJson slot.kind.toString)
    , ("role", toJson slot.role.toString)
    , ("original", relationshipIdentityJson slot.original)
    , ("revised", relationshipIdentityJson slot.revised)
    , ("compared", relationshipIdentityJson slot.compared)
    , ("physicalStoryOrdinal", toJson slot.physicalStoryOrdinal)
    ]

def relationshipStoryJson (pair : PhysicalStory × StoryReport) : Json :=
  let story := pair.1
  let report := pair.2
  Json.mkObj
    [ ("physicalStoryOrdinal", toJson story.physicalStoryOrdinal)
    , ("kind", toJson story.kind.toString)
    , ("originalPartPath", toJson story.originalPartPath)
    , ("revisedPartPath", toJson story.revisedPartPath)
    , ("comparedPartPath", toJson story.comparedPartPath)
    , ("selectingSlotOrdinals", toJson story.selectingSlotOrdinals)
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson report.originalTokenCount)
        , ("revised", toJson report.revisedTokenCount)
        , ("combined", toJson report.combinedTokenCount)
        ])
    , ("report", checkReportJson report.report)
    ]

def selectionIssueJsonSpec (issue : SelectionIssue) : Json :=
  Json.mkObj <|
    [ ("code", toJson issue.code)
    , ("detail", toJson (boundedUtf8 issue.detail 256))
    ] ++
    (issue.side.map fun value => [("side", toJson value.toString)]).getD [] ++
    (issue.sectionOrdinal.map fun value => [("sectionOrdinal", toJson value)]).getD [] ++
    (issue.kind.map fun value => [("kind", toJson value.toString)]).getD [] ++
    (issue.role.map fun value => [("role", toJson value.toString)]).getD [] ++
    (issue.relationshipId.map fun value => [("relationshipId", toJson value)]).getD [] ++
    (issue.rawTarget.map fun value => [("rawTarget", toJson value)]).getD [] ++
    (issue.normalizedPartPath.map fun value =>
      [("normalizedPartPath", toJson value)]).getD []

def sideOrder : VerifierSide → Nat
  | .original => 0
  | .revised => 1
  | .compared => 2

def storyKindOrder : StoryKind → Nat
  | .header => 0
  | .footer => 1

def optionOrder {α : Type} (rank : α → Nat) : Option α → Nat
  | none => 0
  | some value => rank value + 1

def selectionIssueBefore (left right : SelectionIssue) : Bool :=
  let leftSide := optionOrder sideOrder left.side
  let rightSide := optionOrder sideOrder right.side
  let leftSection := optionOrder id left.sectionOrdinal
  let rightSection := optionOrder id right.sectionOrdinal
  let leftKind := optionOrder storyKindOrder left.kind
  let rightKind := optionOrder storyKindOrder right.kind
  let leftRole := optionOrder StoryRole.rank left.role
  let rightRole := optionOrder StoryRole.rank right.role
  if leftSide != rightSide then leftSide < rightSide
  else if leftSection != rightSection then leftSection < rightSection
  else if leftKind != rightKind then leftKind < rightKind
  else if leftRole != rightRole then leftRole < rightRole
  else if left.code != right.code then decide (left.code < right.code)
  else if left.relationshipId != right.relationshipId then
    decide (left.relationshipId.getD "" < right.relationshipId.getD "")
  else if left.rawTarget != right.rawTarget then
    decide (left.rawTarget.getD "" < right.rawTarget.getD "")
  else decide (left.normalizedPartPath.getD "" <
    right.normalizedPartPath.getD "")

def noteIdentityJson (identity : SelectedNoteIdentity) : Json :=
  Json.mkObj
    [ ("relationshipId", toJson identity.relationshipId)
    , ("normalizedPartPath", toJson identity.normalizedPartPath)
    ]

def definitionStoryJson (kind : NoteKind) (identity : Option SelectedNoteIdentity)
    (present : Bool) : Json :=
  Json.mkObj <|
    [("kind", toJson kind.toString)] ++
    (identity.map fun selected =>
      [("relationship", noteIdentityJson selected)]).getD [] ++
    [("partPresent", toJson present)]

def sourceJson (source : NoteSource) : Json :=
  Json.mkObj <|
    [ ("sourceOrdinal", toJson source.sourceOrdinal)
    , ("sourceStory", toJson source.sourceStory)
    ] ++
    (if source.sourceStory == "main" then []
     else [("physicalStoryOrdinal", toJson source.sourceStoryOrdinal)]) ++
    [("normalizedPartPath", toJson source.normalizedPartPath)]

def partitionJsonSpec (evidence : NoteSideEvidence) : Json :=
  Json.mkObj
    [ ("side", toJson evidence.side.toString)
    , ("status", toJson (if evidence.complete then "complete" else "incomplete"))
    , ("sources", Json.arr (evidence.sources.map sourceJson).toArray)
    , ("definitionStories", Json.arr #[
        definitionStoryJson .footnotes evidence.footnotesIdentity
          evidence.footnotesPartPresent,
        definitionStoryJson .endnotes evidence.endnotesIdentity
          evidence.endnotesPartPresent
      ])
    ]

def inventoryJsonSpec (evidence : NoteInventoryEvidence) : Json :=
  Json.mkObj <|
    [ ("side", toJson evidence.side.toString)
    , ("kind", toJson evidence.kind.toString)
    , ("status", toJson evidence.status)
    ] ++
    (evidence.identity.map fun selected =>
      [("relationship", noteIdentityJson selected)]).getD [] ++
    [ ("referenceOccurrences", toJson evidence.referenceOccurrences)
    , ("uniqueReferenceIds", toJson evidence.uniqueReferenceIds)
    , ("definitions", Json.mkObj
        [ ("user", toJson evidence.userDefinitions)
        , ("separator", toJson evidence.separatorDefinitions)
        , ("continuationSeparator", toJson evidence.continuationSeparatorDefinitions)
        , ("continuationNotice", toJson evidence.continuationNoticeDefinitions)
        ])
    , ("forbiddenDefinitionStoryReferences",
        toJson evidence.forbiddenDefinitionStoryReferences)
    ]

def noteStoryJsonSpec (kind : NoteKind) (sides : List NoteSideEvidence) : Json :=
  let identityFor := fun evidence =>
    if kind == .footnotes then evidence.footnotesIdentity else evidence.endnotesIdentity
  let partFor := fun evidence =>
    if kind == .footnotes then evidence.footnotesPart else evidence.endnotesPart
  let presentFor := fun evidence =>
    if kind == .footnotes then evidence.footnotesPartPresent else evidence.endnotesPartPresent
  let sideRecord := fun side =>
    match sides.find? (·.side == side) with
    | some evidence => definitionStoryJson kind (identityFor evidence) (presentFor evidence)
    | none => definitionStoryJson kind none false
  let parts := sides.map partFor
  let evaluated := sides.length == 3 && sides.all (·.complete)
  let report :=
    if evaluated then
      match parts with
      | [original, revised, compared] =>
        some <| checkNamedStory {
          name := kind.toString
          original := original.map (·.tokens) |>.getD []
          revised := revised.map (·.tokens) |>.getD []
          combined := compared.map (·.tokens) |>.getD []
        }
      | _ => none
    else none
  Json.mkObj <|
    [ ("kind", toJson kind.toString)
    , ("status", toJson <| match report with
        | some value => if value.report.passed then "passed" else "failed"
        | none => "not_evaluated")
    , ("original", sideRecord .original)
    , ("revised", sideRecord .revised)
    , ("compared", sideRecord .compared)
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson (report.map (·.originalTokenCount) |>.getD 0))
        , ("revised", toJson (report.map (·.revisedTokenCount) |>.getD 0))
        , ("combined", toJson (report.map (·.combinedTokenCount) |>.getD 0))
        ])
    ] ++
    (report.map fun value => [("report", checkReportJson value.report)]).getD []

def stringField (value : Json) (key : String) : String :=
  match value.getObjValAs? String key with
  | .ok field => field
  | .error _ => ""

def natField (value : Json) (key : String) : Nat :=
  match value.getObjValAs? Nat key with
  | .ok field => field
  | .error _ => 0

def optionalField (value : Json) (key : String) : String :=
  match value.getObjVal? key with
  | .ok field => "1" ++ field.compress
  | .error _ => "0"

def presentSortField (value : Json) (key : String) : String :=
  match value.getObjVal? key with
  | .ok field => "1" ++ field.compress
  | .error _ => "0"

def rankString (values : List String) (value : String) : Nat :=
  (values.zipIdx.find? fun pair => pair.1 == value).map (·.2) |>.getD values.length

def padNat (width value : Nat) : String :=
  let digits := toString value
  String.ofList (List.replicate (width - digits.length) '0') ++ digits

def noteIssueKey (issue : Json) : String :=
  let source := match issue.getObjVal? "source" with
    | .ok value => value
    | .error _ => Json.null
  [ stringField issue "side", stringField issue "kind", stringField issue "code",
    stringField issue "ordinalSpace", stringField source "sourceStory",
    toString (natField source "sourceStoryOrdinal"),
    optionalField issue "canonicalId", optionalField issue "rawId",
    optionalField issue "rawIdByteLength", optionalField issue "rawIdDigest",
    optionalField issue "referencedKind", optionalField issue "relationshipId",
    optionalField issue "rawTarget", optionalField issue "normalizedPartPath"
  ].intersperse "\u0000" |>.foldl (· ++ ·) ""

def coalesceIssues (issues : List Json) : List Json :=
  issues.foldl (fun retained issue =>
    let key := noteIssueKey issue
    if retained.any (fun existing => noteIssueKey existing == key) then
      retained.map fun existing =>
        if noteIssueKey existing != key then existing
        else
          let first := min (natField existing "firstOccurrenceOrdinal")
            (natField issue "firstOccurrenceOrdinal")
          let count := natField existing "occurrenceCount" +
            natField issue "occurrenceCount"
          (existing.setObjVal! "firstOccurrenceOrdinal" (toJson first))
            |>.setObjVal! "occurrenceCount" (toJson count)
    else retained ++ [issue]) []

def noteIssueOrderKey (issue : Json) : String :=
  let source := match issue.getObjVal? "source" with
    | .ok value => value
    | .error _ => Json.null
  [ padNat 2 (rankString ["original", "revised", "compared"]
      (stringField issue "side")),
    padNat 2 (rankString ["footnotes", "endnotes"] (stringField issue "kind")),
    padNat 2 (rankString
      ["relationship", "source", "definition", "reference", "poison", "aggregate"]
      (stringField issue "ordinalSpace")),
    padNat 5 (natField issue "firstOccurrenceOrdinal"),
    padNat 2 (rankString ["main", "header", "footer", "footnotes", "endnotes"]
      (stringField source "sourceStory")),
    padNat 4 (natField source "sourceStoryOrdinal"),
    stringField issue "code", presentSortField issue "canonicalId",
    presentSortField issue "rawId",
    match issue.getObjVal? "rawIdByteLength" with
      | .ok _ => "1" ++ padNat 9 (natField issue "rawIdByteLength")
      | .error _ => "0",
    presentSortField issue "rawIdDigest", presentSortField issue "referencedKind",
    presentSortField issue "relationshipId", presentSortField issue "rawTarget",
    presentSortField issue "normalizedPartPath"
  ].intersperse "\u0000" |>.foldl (· ++ ·) ""

def issueBefore (left right : Json) : Bool :=
  decide (noteIssueOrderKey left < noteIssueOrderKey right)

def escapedEvidenceBytes (root : Json) : Nat :=
  protocolEscapedStringByteCharge root

def escapedStringCharge (value : String) : Nat :=
  (toJson value).compress.toUTF8.size

def selectionEvidenceBytes (issue : SelectionIssue) : Nat :=
  escapedStringCharge issue.code +
    escapedStringCharge (boundedUtf8 issue.detail 256) +
    (issue.side.map (fun side => escapedStringCharge side.toString)).getD 0 +
    (issue.kind.map (fun kind => escapedStringCharge kind.toString)).getD 0 +
    (issue.role.map (fun role => escapedStringCharge role.toString)).getD 0 +
    (issue.relationshipId.map escapedStringCharge).getD 0 +
    (issue.rawTarget.map escapedStringCharge).getD 0 +
    (issue.normalizedPartPath.map escapedStringCharge).getD 0

def slotEvidenceBytes (slot : AlignedSlot) : Nat :=
  escapedStringCharge slot.kind.toString +
    escapedStringCharge slot.role.toString +
    escapedStringCharge slot.original.relationshipId +
    escapedStringCharge slot.original.normalizedPartPath +
    escapedStringCharge slot.revised.relationshipId +
    escapedStringCharge slot.revised.normalizedPartPath +
    escapedStringCharge slot.compared.relationshipId +
    escapedStringCharge slot.compared.normalizedPartPath

def storyEvidenceBytes (story : PhysicalStory) : Nat :=
  escapedStringCharge story.kind.toString +
    escapedStringCharge story.originalPartPath +
    escapedStringCharge story.revisedPartPath +
    escapedStringCharge story.comparedPartPath

def firstCrossingLoop (charged admitted : Nat) : List Nat → Option String
  | [] => none
  | candidate :: rest =>
    if admitted == 511 then some "NOTE_ISSUE_LIMIT_EXCEEDED"
    else if charged + candidate > 1571840 then
      some "NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED"
    else firstCrossingLoop (charged + candidate) (admitted + 1) rest

def firstCrossing (nonIssue : Nat) (selection : List SelectionIssue)
    (note : List Json) : Option String :=
  if nonIssue > 1571840 then some "NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED"
  else firstCrossingLoop nonIssue 0
    ((selection.map selectionEvidenceBytes) ++
      (note.map escapedEvidenceBytes))

def terminalIssue (code : String) : Json :=
  let v6Code := if code == "NOTE_ISSUE_LIMIT_EXCEEDED" then
    "COMMENT_ISSUE_LIMIT_EXCEEDED"
  else "COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED"
  Json.mkObj
    [ ("code", toJson v6Code)
    , ("side", toJson "original")
    , ("kind", toJson "comments")
    , ("detail", toJson <| if code == "NOTE_ISSUE_LIMIT_EXCEEDED" then
        "protocol v6 aggregate ordinary issue limit exceeded"
      else "protocol v6 escaped evidence string budget exceeded")
    , ("ordinalSpace", toJson "aggregate")
    , ("firstOccurrenceOrdinal", toJson (0 : Nat))
    , ("occurrenceCount", toJson (1 : Nat))
    ]

def terminalPartition (side : VerifierSide) (sources : List NoteSource) : Json :=
  Json.mkObj
    [ ("side", toJson side.toString)
    , ("status", toJson "incomplete")
    , ("sources", Json.arr (sources.take 1 |>.map sourceJson).toArray)
    , ("definitionStories", Json.arr #[
        definitionStoryJson .footnotes none false,
        definitionStoryJson .endnotes none false
      ])
    ]

def terminalNoteStory (kind : NoteKind) : Json :=
  Json.mkObj
    [ ("kind", toJson kind.toString)
    , ("status", toJson "not_evaluated")
    , ("original", definitionStoryJson kind none false)
    , ("revised", definitionStoryJson kind none false)
    , ("compared", definitionStoryJson kind none false)
    , ("parsedTokenCounts", Json.mkObj
        [("original", toJson (0 : Nat)), ("revised", toJson (0 : Nat)),
          ("combined", toJson (0 : Nat))])
    ]

def terminalInventory (side : VerifierSide) (kind : NoteKind) : Json :=
  Json.mkObj
    [ ("side", toJson side.toString)
    , ("kind", toJson kind.toString)
    , ("status", toJson "not_evaluated")
    , ("referenceOccurrences", toJson (0 : Nat))
    , ("uniqueReferenceIds", toJson (0 : Nat))
    , ("definitions", Json.mkObj
        [ ("user", toJson (0 : Nat)), ("separator", toJson (0 : Nat)),
          ("continuationSeparator", toJson (0 : Nat)),
          ("continuationNotice", toJson (0 : Nat)) ])
    , ("forbiddenDefinitionStoryReferences", toJson (0 : Nat))
    ]

def terminalCommentStory : Json :=
  Json.mkObj
    [ ("status", toJson "not_evaluated")
    , ("original", Json.mkObj
        [ ("status", toJson "not_evaluated"), ("relationship", Json.null)
        , ("partPresent", toJson false)])
    , ("revised", Json.mkObj
        [ ("status", toJson "not_evaluated"), ("relationship", Json.null)
        , ("partPresent", toJson false)])
    , ("compared", Json.mkObj
        [ ("status", toJson "not_evaluated"), ("relationship", Json.null)
        , ("partPresent", toJson false)])
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson (0 : Nat)), ("revised", toJson (0 : Nat))
        , ("combined", toJson (0 : Nat)) ])
    ]

def terminalCommentInventory (side : VerifierSide) : Json :=
  commentInventoryJson (zeroCommentInventory side none)

def fields (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : Fields :=
  let fixed := semanticResponse.genericStoryReports.take request.fixedTriples.length
  let selected := semanticResponse.genericStoryReports.drop request.fixedTriples.length
  let sides := [request.original.noteEvidence, request.revised.noteEvidence,
    request.compared.noteEvidence]
  let commentSides := applyCommentGlobalStop
    [request.original.commentEvidence, request.revised.commentEvidence,
      request.compared.commentEvidence]
  let selections := request.selectionIssues.eraseDups.mergeSort selectionIssueBefore
  let notes := coalesceIssues (sides.flatMap (·.issues)) |>.mergeSort issueBefore
  let comments :=
    coalesceIssues (commentSides.flatMap (·.issues)) |>.mergeSort issueBefore
  let nonIssueJson :=
    (fixed.map fixedStoryJson) ++
    (sides.map partitionJsonSpec) ++
    [noteStoryJsonSpec .footnotes sides, noteStoryJsonSpec .endnotes sides] ++
    (sides.flatMap fun side =>
      [inventoryJsonSpec side.footnotesInventory,
        inventoryJsonSpec side.endnotesInventory]) ++
    [selectedCommentStoryJson commentSides] ++
    (commentSides.map fun side => commentInventoryJson side.inventory)
  let crossing := firstCrossing
    ((nonIssueJson.map escapedEvidenceBytes |>.sum) +
      (request.relationshipSlots.map slotEvidenceBytes |>.sum) +
      (request.relationshipStories.map storyEvidenceBytes |>.sum))
    selections (notes ++ comments)
  { passed := semanticResponse.passed && crossing.isNone &&
      selections.isEmpty && notes.isEmpty && comments.isEmpty
    fixedStories := fixed
    relationshipSlots := request.relationshipSlots
    relationshipStories := List.zip request.relationshipStories selected
    selectionIssues := selections
    noteSides := sides
    noteIssues := notes
    commentSides
    commentIssues := comments
    terminalCode := crossing }

def encodeFields (fields : Fields) : List (String × Json) :=
  let terminal := fields.terminalCode.isSome
  let fixed := if terminal then fields.fixedStories.take 1 else fields.fixedStories
  let slots := if terminal then [] else fields.relationshipSlots
  let stories := if terminal then [] else fields.relationshipStories
  let selections := if terminal then [] else fields.selectionIssues
  let partitions := if terminal then
    fields.noteSides.map fun side => terminalPartition side.side side.sources
    else fields.noteSides.map partitionJsonSpec
  let noteStories := if terminal then
    [terminalNoteStory .footnotes, terminalNoteStory .endnotes]
    else [noteStoryJsonSpec .footnotes fields.noteSides,
      noteStoryJsonSpec .endnotes fields.noteSides]
  let inventories := if terminal then
    [.original, .revised, .compared].flatMap fun side =>
      [terminalInventory side .footnotes, terminalInventory side .endnotes]
    else fields.noteSides.flatMap fun side =>
      [inventoryJsonSpec side.footnotesInventory,
        inventoryJsonSpec side.endnotesInventory]
  let issues := match fields.terminalCode with
    | some _ => []
    | none => fields.noteIssues
  let commentStory := if terminal then terminalCommentStory
    else selectedCommentStoryJson fields.commentSides
  let commentInventories := if terminal then
    [.original, .revised, .compared].map terminalCommentInventory
    else fields.commentSides.map fun side => commentInventoryJson side.inventory
  let commentIssues := match fields.terminalCode with
    | some code => [terminalIssue code]
    | none => fields.commentIssues
  [ ("protocolVersion", toJson (6 : Nat))
    , ("checker", toJson
        "safe-docx-lean-conventional-main-comment-integrity-checker")
    , ("passed", toJson fields.passed)
    , ("fixedStories", Json.arr (fixed.map fixedStoryJson).toArray)
    , ("presenceMismatches", Json.arr #[])
    , ("fixedStoryIssues", Json.arr #[])
    , ("relationshipSlots", Json.arr (slots.map relationshipSlotJson).toArray)
    , ("relationshipStories", Json.arr (stories.map relationshipStoryJson).toArray)
    , ("selectionIssues", Json.arr (selections.map selectionIssueJsonSpec).toArray)
    , ("referenceSourcePartitions", Json.arr partitions.toArray)
    , ("noteStories", Json.arr noteStories.toArray)
    , ("noteInventories", Json.arr inventories.toArray)
    , ("noteIntegrityIssues", Json.arr issues.toArray)
    , ("commentStory", commentStory)
    , ("commentInventories", Json.arr commentInventories.toArray)
  , ("commentIntegrityIssues", Json.arr commentIssues.toArray)
  ]

def encode (fields : Fields) : Json :=
  Json.mkObj (encodeFields fields)

theorem boundedUtf8_eq (value : String) (limit : Nat) :
    boundedUtf8 value limit = boundUtf8 value limit := by
  unfold boundedUtf8 boundUtf8
  rfl

theorem checkReportJson_eq (report : CheckReport) :
    checkReportJson report = reportToJson report := by
  cases report
  rfl

theorem fixedStoryJson_eq (report : StoryReport) :
    fixedStoryJson report = storyReportJson report := by
  cases report
  simp [fixedStoryJson, storyReportJson, storyReportToJson, checkReportJson_eq]

theorem relationshipIdentityJson_eq (identity : RelationshipIdentity) :
    relationshipIdentityJson identity = identityJson identity := by
  cases identity
  rfl

theorem relationshipSlotJson_eq (slot : AlignedSlot) :
    relationshipSlotJson slot = slotJson slot := by
  cases slot
  simp [relationshipSlotJson, slotJson, relationshipIdentityJson_eq]

theorem relationshipStoryJson_eq (pair : PhysicalStory × StoryReport) :
    relationshipStoryJson pair = physicalStoryJson pair.1 pair.2 := by
  rcases pair with ⟨story, report⟩
  cases story
  cases report
  simp [relationshipStoryJson, physicalStoryJson, checkReportJson_eq]

theorem selectionIssueJsonSpec_eq (issue : SelectionIssue) :
    selectionIssueJsonSpec issue = selectionIssueJson issue := by
  cases issue
  simp only [selectionIssueJsonSpec, selectionIssueJson, boundedUtf8_eq]
  split <;> split <;> split <;> split <;> split <;> split <;> split <;> rfl

theorem selectionIssueBefore_eq (left right : SelectionIssue) :
    selectionIssueBefore left right = issueLess left right := by
  cases left
  cases right
  rfl

theorem noteIdentityJson_eq (identity : SelectedNoteIdentity) :
    noteIdentityJson identity = loadedNoteIdentityJson identity := by
  cases identity
  rfl

theorem definitionStoryJson_eq (kind : NoteKind)
    (identity : Option SelectedNoteIdentity) (present : Bool) :
    definitionStoryJson kind identity present =
      definitionSourceJson kind identity present := by
  cases kind <;> cases identity <;> rfl

theorem sourceJson_eq (source : NoteSource) :
    sourceJson source = referenceSourceJson source := by
  cases source
  simp [sourceJson, referenceSourceJson]

theorem partitionJsonSpec_eq (evidence : NoteSideEvidence) :
    partitionJsonSpec evidence = partitionJson evidence := by
  cases evidence with
  | mk side sources footnotesIdentity endnotesIdentity footnotesPresent endnotesPresent
      footnotesPart endnotesPart retained complete semanticCrossed integrity usage issues
      footnotesInventory endnotesInventory =>
    have hSources : sources.map sourceJson = sources.map referenceSourceJson := by
      apply List.map_congr_left
      intro source _membership
      exact sourceJson_eq source
    simp [partitionJsonSpec, partitionJson, hSources, definitionStoryJson_eq]

theorem inventoryJsonSpec_eq (evidence : NoteInventoryEvidence) :
    inventoryJsonSpec evidence = inventoryJson evidence := by
  cases evidence
  simp [inventoryJsonSpec, inventoryJson, noteIdentityJson_eq]

theorem noteStoryJsonSpec_eq (kind : NoteKind) (sides : List NoteSideEvidence) :
    noteStoryJsonSpec kind sides = noteStoryJson kind sides := by
  simp [noteStoryJsonSpec, noteStoryJson, definitionStoryJson_eq, checkReportJson_eq]

theorem noteIssueKey_eq (issue : Json) :
    noteIssueKey issue = noteIssueCoalesceKey issue := by
  rfl

theorem natField_eq (value : Json) (key : String) :
    natField value key = jsonNatField value key := by
  rfl

theorem stringField_eq (value : Json) (key : String) :
    stringField value key = jsonStringField value key := by
  rfl

theorem optionalField_eq (value : Json) (key : String) :
    optionalField value key = jsonOptionalKey value key := by
  rfl

theorem presentSortField_eq (value : Json) (key : String) :
    presentSortField value key = jsonPresentSortField value key := by
  rfl

theorem rankString_eq (values : List String) (value : String) :
    rankString values value = noteIssueStringRank values value := by
  rfl

theorem padNat_eq (width value : Nat) :
    padNat width value = zeroPaddedNat width value := by
  rfl

theorem coalesceIssues_eq (issues : List Json) :
    coalesceIssues issues = coalesceNoteIssues issues := by
  unfold coalesceIssues coalesceNoteIssues
  simp only [noteIssueKey_eq, natField_eq]

theorem noteIssueOrderKey_eq (issue : Json) :
    noteIssueOrderKey issue = noteIssueSortKey issue := by
  simp [noteIssueOrderKey, noteIssueSortKey, stringField_eq, natField_eq,
    presentSortField_eq, rankString_eq, padNat_eq]

theorem issueBefore_eq (left right : Json) :
    issueBefore left right = noteIssueLess left right := by
  simp [issueBefore, noteIssueLess, noteIssueOrderKey_eq]

theorem fixedStoryEncoder_eq :
    fixedStoryJson = storyReportJson := by
  funext report
  exact fixedStoryJson_eq report

theorem relationshipSlotEncoder_eq :
    relationshipSlotJson = slotJson := by
  funext slot
  exact relationshipSlotJson_eq slot

theorem relationshipStoryEncoder_eq :
    relationshipStoryJson =
      (fun pair => physicalStoryJson pair.1 pair.2) := by
  funext pair
  exact relationshipStoryJson_eq pair

theorem selectionIssueEncoder_eq :
    selectionIssueJsonSpec = selectionIssueJson := by
  funext issue
  exact selectionIssueJsonSpec_eq issue

theorem selectionIssueOrder_eq :
    selectionIssueBefore = issueLess := by
  funext left right
  exact selectionIssueBefore_eq left right

theorem noteIssueOrder_eq :
    issueBefore = noteIssueLess := by
  funext left right
  exact issueBefore_eq left right

theorem partitionEncoder_eq :
    partitionJsonSpec = partitionJson := by
  funext evidence
  exact partitionJsonSpec_eq evidence

theorem inventoryEncoder_eq :
    inventoryJsonSpec = inventoryJson := by
  funext evidence
  exact inventoryJsonSpec_eq evidence

theorem noteStoryEncoder_eq (kind : NoteKind) :
    noteStoryJsonSpec kind = noteStoryJson kind := by
  funext sides
  exact noteStoryJsonSpec_eq kind sides

theorem escapedEvidenceBytes_eq (value : Json) :
    escapedEvidenceBytes value = jsonEvidenceStringBytes value := by
  rfl

theorem escapedEvidenceString_eq (value : String) :
    escapedStringCharge value = escapedStringBytes value := by
  rfl

theorem selectionEvidenceBytes_eq (issue : SelectionIssue) :
    selectionEvidenceBytes issue = selectionIssueStringBytes issue := by
  have hCharge : escapedStringCharge = escapedStringBytes := by
    funext value
    rfl
  cases issue
  simp [selectionEvidenceBytes, selectionIssueStringBytes,
    boundedUtf8_eq, hCharge, Function.comp_def]

theorem slotEvidenceBytes_eq (slot : AlignedSlot) :
    slotEvidenceBytes slot = slotStringBytes slot := by
  cases slot
  simp [slotEvidenceBytes, slotStringBytes, escapedEvidenceString_eq]

theorem storyEvidenceBytes_eq (story : PhysicalStory) :
    storyEvidenceBytes story = physicalStoryStringBytes story := by
  cases story
  simp [storyEvidenceBytes, physicalStoryStringBytes, escapedEvidenceString_eq]

theorem nonIssueEvidenceBytes_eq (otherEvidence : List Json)
    (slots : List AlignedSlot) (stories : List PhysicalStory) :
    (otherEvidence.map escapedEvidenceBytes).sum +
        (slots.map slotEvidenceBytes).sum +
        (stories.map storyEvidenceBytes).sum =
      evidenceStringBytes [] [] slots stories otherEvidence [] := by
  have hOther :
      otherEvidence.map escapedEvidenceBytes =
        otherEvidence.map jsonEvidenceStringBytes := by
    apply List.map_congr_left
    intro value _membership
    exact escapedEvidenceBytes_eq value
  have hSlots :
      slots.map slotEvidenceBytes = slots.map slotStringBytes := by
    apply List.map_congr_left
    intro value _membership
    exact slotEvidenceBytes_eq value
  have hStories :
      stories.map storyEvidenceBytes = stories.map physicalStoryStringBytes := by
    apply List.map_congr_left
    intro value _membership
    exact storyEvidenceBytes_eq value
  rw [hOther, hSlots, hStories]
  simp [evidenceStringBytes, Nat.add_assoc, Nat.add_comm, Nat.add_left_comm]

theorem firstCrossingLoop_eq (charged admitted : Nat) (values : List Nat) :
    firstCrossingLoop charged admitted values =
      firstAggregateIssueCrossingLoop charged admitted values := by
  induction values generalizing charged admitted with
  | nil => rfl
  | cons value values ih =>
    simp only [firstCrossingLoop, firstAggregateIssueCrossingLoop,
      maxIssues, maxEvidenceStringBytes, terminalIssueReserveBytes]
    by_cases hCount : admitted = 511
    · simp [hCount]
    · by_cases hBudget : charged + value > 1571840
      · simp [hCount, hBudget]
      · simp [hCount, hBudget, ih]

theorem firstCrossing_eq (nonIssue : Nat) (selection : List SelectionIssue)
    (note : List Json) :
    firstCrossing nonIssue selection note =
      firstAggregateIssueCrossing nonIssue
        (selection.map selectionIssueStringBytes)
        (note.map jsonEvidenceStringBytes) := by
  have hSelection :
      selection.map selectionEvidenceBytes =
        selection.map selectionIssueStringBytes := by
    apply List.map_congr_left
    intro issue _membership
    exact selectionEvidenceBytes_eq issue
  have hNote :
      note.map escapedEvidenceBytes =
        note.map jsonEvidenceStringBytes := by
    apply List.map_congr_left
    intro issue _membership
    exact escapedEvidenceBytes_eq issue
  simp [firstCrossing, firstAggregateIssueCrossing, firstCrossingLoop_eq,
    hSelection, hNote, maxEvidenceStringBytes, terminalIssueReserveBytes]

theorem selectEmptyNoteRecords (kind : NoteKind) :
    selectConventionalMainNoteRecords kind [] = .ok none := by
  cases kind <;> rfl

theorem terminalPartition_eq (side : VerifierSide) (sources : List NoteSource) :
    terminalPartition side sources =
      partitionJson (skippedNoteSideEvidence side (sources.take 1) []) := by
  have hSources :
      (sources.take 1).map sourceJson =
        (sources.take 1).map referenceSourceJson := by
    apply List.map_congr_left
    intro source _membership
    exact sourceJson_eq source
  cases side <;>
    simp [terminalPartition, partitionJson, skippedNoteSideEvidence,
      hSources, definitionStoryJson_eq, zeroInventoryJson,
      inventoryEvidence, selectEmptyNoteRecords]

theorem findSkippedOriginal :
    [ skippedNoteSideEvidence .original [] []
    , skippedNoteSideEvidence .revised [] []
    , skippedNoteSideEvidence .compared [] []
    ].find? (·.side == .original) =
      some (skippedNoteSideEvidence .original [] []) := by
  simp [skippedNoteSideEvidence, selectEmptyNoteRecords] <;> rfl

theorem findSkippedRevised :
    [ skippedNoteSideEvidence .original [] []
    , skippedNoteSideEvidence .revised [] []
    , skippedNoteSideEvidence .compared [] []
    ].find? (·.side == .revised) =
      some (skippedNoteSideEvidence .revised [] []) := by
  simp [skippedNoteSideEvidence, selectEmptyNoteRecords]
  exact ⟨rfl, rfl⟩

theorem findSkippedCompared :
    [ skippedNoteSideEvidence .original [] []
    , skippedNoteSideEvidence .revised [] []
    , skippedNoteSideEvidence .compared [] []
    ].find? (·.side == .compared) =
      some (skippedNoteSideEvidence .compared [] []) := by
  simp [skippedNoteSideEvidence, selectEmptyNoteRecords]
  exact ⟨rfl, rfl, rfl⟩

theorem terminalNoteStory_eq (kind : NoteKind) :
    terminalNoteStory kind =
      noteStoryJson kind
        [ skippedNoteSideEvidence .original [] []
        , skippedNoteSideEvidence .revised [] []
        , skippedNoteSideEvidence .compared [] []
        ] := by
  cases kind <;>
    unfold terminalNoteStory noteStoryJson <;>
    simp only [findSkippedOriginal, findSkippedRevised, findSkippedCompared] <;>
    simp [skippedNoteSideEvidence, definitionStoryJson_eq,
      zeroInventoryJson, inventoryEvidence, selectEmptyNoteRecords]

theorem findSkippedOriginalSources
    (originalSources revisedSources comparedSources : List NoteSource) :
    [ skippedNoteSideEvidence .original originalSources []
    , skippedNoteSideEvidence .revised revisedSources []
    , skippedNoteSideEvidence .compared comparedSources []
    ].find? (·.side == .original) =
      some (skippedNoteSideEvidence .original originalSources []) := by
  simp [skippedNoteSideEvidence, selectEmptyNoteRecords] <;> decide

theorem findSkippedRevisedSources
    (originalSources revisedSources comparedSources : List NoteSource) :
    [ skippedNoteSideEvidence .original originalSources []
    , skippedNoteSideEvidence .revised revisedSources []
    , skippedNoteSideEvidence .compared comparedSources []
    ].find? (·.side == .revised) =
      some (skippedNoteSideEvidence .revised revisedSources []) := by
  simp [skippedNoteSideEvidence, selectEmptyNoteRecords] <;> decide

theorem findSkippedComparedSources
    (originalSources revisedSources comparedSources : List NoteSource) :
    [ skippedNoteSideEvidence .original originalSources []
    , skippedNoteSideEvidence .revised revisedSources []
    , skippedNoteSideEvidence .compared comparedSources []
    ].find? (·.side == .compared) =
      some (skippedNoteSideEvidence .compared comparedSources []) := by
  simp [skippedNoteSideEvidence, selectEmptyNoteRecords] <;> decide

theorem terminalNoteStorySources_eq (kind : NoteKind)
    (originalSources revisedSources comparedSources : List NoteSource) :
    noteStoryJson kind
        [ skippedNoteSideEvidence .original originalSources []
        , skippedNoteSideEvidence .revised revisedSources []
        , skippedNoteSideEvidence .compared comparedSources []
        ] =
      terminalNoteStory kind := by
  cases kind <;>
    unfold terminalNoteStory noteStoryJson <;>
    simp only [findSkippedOriginalSources, findSkippedRevisedSources,
      findSkippedComparedSources] <;>
    simp [skippedNoteSideEvidence, definitionStoryJson_eq,
      zeroInventoryJson, inventoryEvidence, selectEmptyNoteRecords]

theorem skippedNoteStorySources_eq_empty (kind : NoteKind)
    (originalSources revisedSources comparedSources : List NoteSource) :
    noteStoryJson kind
        [ skippedNoteSideEvidence .original originalSources []
        , skippedNoteSideEvidence .revised revisedSources []
        , skippedNoteSideEvidence .compared comparedSources []
        ] =
      noteStoryJson kind
        [ skippedNoteSideEvidence .original [] []
        , skippedNoteSideEvidence .revised [] []
        , skippedNoteSideEvidence .compared [] []
        ] :=
  (terminalNoteStorySources_eq kind originalSources revisedSources comparedSources).trans
    (terminalNoteStory_eq kind)

@[simp] theorem footnotesBeqFootnotes :
    (NoteKind.footnotes == NoteKind.footnotes) = true := by rfl

@[simp] theorem endnotesBeqFootnotes :
    (NoteKind.endnotes == NoteKind.footnotes) = false := by rfl

theorem skippedInventorySources_eq (side : VerifierSide)
    (kind : NoteKind) (sources : List NoteSource) :
    inventoryJson
        (if kind == .footnotes then
          (skippedNoteSideEvidence side sources []).footnotesInventory
        else (skippedNoteSideEvidence side sources []).endnotesInventory) =
      terminalInventory side kind := by
  cases side <;> cases kind <;>
    simp [skippedNoteSideEvidence, selectEmptyNoteRecords,
      terminalInventory, inventoryJson, zeroInventoryJson, inventoryEvidence]

theorem skippedFootnotesInventorySources_eq (side : VerifierSide)
    (sources : List NoteSource) :
    inventoryJson
        (skippedNoteSideEvidence side sources []).footnotesInventory =
      inventoryJson (zeroInventoryJson side .footnotes none) := by
  simpa [terminalInventory, inventoryJson, zeroInventoryJson, inventoryEvidence] using
    skippedInventorySources_eq side .footnotes sources

theorem skippedEndnotesInventorySources_eq (side : VerifierSide)
    (sources : List NoteSource) :
    inventoryJson
        (skippedNoteSideEvidence side sources []).endnotesInventory =
      inventoryJson (zeroInventoryJson side .endnotes none) := by
  simpa [terminalInventory, inventoryJson, zeroInventoryJson, inventoryEvidence] using
    skippedInventorySources_eq side .endnotes sources

theorem terminalInventory_eq (side : VerifierSide) (kind : NoteKind) :
    terminalInventory side kind =
      inventoryJson (zeroInventoryJson side kind none) := by
  cases side <;> cases kind <;>
    simp [terminalInventory, inventoryJson, zeroInventoryJson, inventoryEvidence]

end SemanticProtocolSpec

def semanticProtocolV6Projection (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : Json :=
  SemanticProtocolSpec.encode (SemanticProtocolSpec.fields request semanticResponse)

def buildRunRequestCoreJson (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : Json :=
  let passed := runRequestCorePass request semanticResponse
  let fixedReports := checkStoryCollection request.fixedTriples
  let selectedReports := checkStoryCollection request.relationshipTriples
  let noteEvidence :=
    [request.original.noteEvidence, request.revised.noteEvidence,
      request.compared.noteEvidence]
  let commentEvidence := applyCommentGlobalStop
    [request.original.commentEvidence, request.revised.commentEvidence,
      request.compared.commentEvidence]
  let selectionIssues := request.selectionIssues.eraseDups.mergeSort issueLess
  let noteIssues :=
    coalesceNoteIssues (noteEvidence.flatMap (·.issues)) |>.mergeSort noteIssueLess
  let commentIssues :=
    coalesceNoteIssues (commentEvidence.flatMap (·.issues)) |>.mergeSort noteIssueLess
  let ordinaryPartitions := noteEvidence.map partitionJson
  let ordinaryNoteStories :=
    [noteStoryJson .footnotes noteEvidence, noteStoryJson .endnotes noteEvidence]
  let ordinaryInventories := noteEvidence.flatMap fun evidence =>
    [inventoryJson evidence.footnotesInventory,
      inventoryJson evidence.endnotesInventory]
  let ordinaryCommentStory := selectedCommentStoryJson commentEvidence
  let ordinaryCommentInventories :=
    commentEvidence.map fun evidence => commentInventoryJson evidence.inventory
  let ordinaryOtherEvidence :=
    (fixedReports.map storyReportJson) ++ ordinaryPartitions ++ ordinaryNoteStories ++
      ordinaryInventories ++ [ordinaryCommentStory] ++ ordinaryCommentInventories
  let nonIssueStringBytes :=
    evidenceStringBytes [] [] request.relationshipSlots request.relationshipStories
      ordinaryOtherEvidence []
  let crossing := firstAggregateIssueCrossing nonIssueStringBytes
    (selectionIssues.map selectionIssueStringBytes)
    ((noteIssues ++ commentIssues).map jsonEvidenceStringBytes)
  let terminalIssue := crossing.isSome
  let emittedSelectionIssues := if terminalIssue then [] else selectionIssues
  let emittedNoteIssues := if terminalIssue then [] else noteIssues
  let emittedCommentIssues := match crossing with
    | some terminalCode => [SemanticProtocolSpec.terminalIssue terminalCode]
    | none => commentIssues
  let emittedSlots := if terminalIssue then [] else request.relationshipSlots
  let physicalJson := if terminalIssue then [] else
    (List.zip request.relationshipStories selectedReports).map fun pair =>
      physicalStoryJson pair.1 pair.2
  let emittedFixedReports := if terminalIssue then fixedReports.take 1 else fixedReports
  let effectiveNoteEvidence := if terminalIssue then
    [ skippedNoteSideEvidence .original (request.original.noteEvidence.sources.take 1) []
    , skippedNoteSideEvidence .revised (request.revised.noteEvidence.sources.take 1) []
    , skippedNoteSideEvidence .compared (request.compared.noteEvidence.sources.take 1) []
    ] else noteEvidence
  let emittedPartitions := effectiveNoteEvidence.map partitionJson
  let emittedNoteStories :=
    [noteStoryJson .footnotes effectiveNoteEvidence,
      noteStoryJson .endnotes effectiveNoteEvidence]
  let emittedInventories := effectiveNoteEvidence.flatMap fun evidence =>
    [inventoryJson evidence.footnotesInventory,
      inventoryJson evidence.endnotesInventory]
  let emittedCommentStory := if terminalIssue then
    SemanticProtocolSpec.terminalCommentStory
    else selectedCommentStoryJson commentEvidence
  let emittedCommentInventories := if terminalIssue then
    [.original, .revised, .compared].map
      SemanticProtocolSpec.terminalCommentInventory
    else commentEvidence.map fun evidence => commentInventoryJson evidence.inventory
  Json.mkObj
    [ ("protocolVersion", toJson (6 : Nat))
    , ("checker", toJson
        "safe-docx-lean-conventional-main-comment-integrity-checker")
    , ("passed", toJson passed)
    , ("fixedStories", Json.arr
        (emittedFixedReports.map storyReportJson).toArray)
    , ("presenceMismatches", Json.arr #[])
    , ("fixedStoryIssues", Json.arr #[])
    , ("relationshipSlots", Json.arr (emittedSlots.map slotJson).toArray)
    , ("relationshipStories", Json.arr physicalJson.toArray)
    , ("selectionIssues", Json.arr
        (emittedSelectionIssues.map selectionIssueJson).toArray)
    , ("referenceSourcePartitions", Json.arr emittedPartitions.toArray)
    , ("noteStories", Json.arr emittedNoteStories.toArray)
    , ("noteInventories", Json.arr emittedInventories.toArray)
    , ("noteIntegrityIssues", Json.arr emittedNoteIssues.toArray)
    , ("commentStory", emittedCommentStory)
    , ("commentInventories", Json.arr emittedCommentInventories.toArray)
    , ("commentIntegrityIssues", Json.arr emittedCommentIssues.toArray)
    ]

theorem check_story_collection_append (left right : List NamedStoryTriple) :
    checkStoryCollection (left ++ right) =
      checkStoryCollection left ++ checkStoryCollection right := by
  unfold checkStoryCollection
  exact List.map_append

set_option maxRecDepth 10000 in
set_option maxHeartbeats 1000000 in
theorem build_run_request_core_json_refines_semantic_projection
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (hReports : semanticResponse.genericStoryReports =
      checkStoryCollection (request.fixedTriples ++ request.relationshipTriples))
    (hPassed : runRequestCorePass request semanticResponse =
      (SemanticProtocolSpec.fields request semanticResponse).passed)
    (hOriginalSide : request.original.noteEvidence.side = .original)
    (hRevisedSide : request.revised.noteEvidence.side = .revised)
    (hComparedSide : request.compared.noteEvidence.side = .compared) :
    buildRunRequestCoreJson request semanticResponse =
      semanticProtocolV6Projection request semanticResponse := by
  have hFixed : semanticResponse.genericStoryReports.take request.fixedTriples.length =
      checkStoryCollection request.fixedTriples := by
    rw [hReports]
    unfold checkStoryCollection
    simp
  have hSelected : semanticResponse.genericStoryReports.drop request.fixedTriples.length =
      checkStoryCollection request.relationshipTriples := by
    rw [hReports]
    unfold checkStoryCollection
    simp
  unfold buildRunRequestCoreJson semanticProtocolV6Projection
  rw [hPassed]
  unfold SemanticProtocolSpec.fields SemanticProtocolSpec.encode
    SemanticProtocolSpec.encodeFields
  rw [hFixed, hSelected]
  simp only [
    SemanticProtocolSpec.fixedStoryJson_eq,
    SemanticProtocolSpec.relationshipSlotJson_eq,
    SemanticProtocolSpec.relationshipStoryJson_eq,
    SemanticProtocolSpec.selectionIssueJsonSpec_eq,
    SemanticProtocolSpec.selectionIssueBefore_eq,
    SemanticProtocolSpec.partitionJsonSpec_eq,
    SemanticProtocolSpec.inventoryJsonSpec_eq,
    SemanticProtocolSpec.noteStoryJsonSpec_eq,
    SemanticProtocolSpec.coalesceIssues_eq,
    SemanticProtocolSpec.issueBefore_eq,
    SemanticProtocolSpec.fixedStoryEncoder_eq,
    SemanticProtocolSpec.relationshipSlotEncoder_eq,
    SemanticProtocolSpec.relationshipStoryEncoder_eq,
    SemanticProtocolSpec.selectionIssueEncoder_eq,
    SemanticProtocolSpec.selectionIssueOrder_eq,
    SemanticProtocolSpec.noteIssueOrder_eq,
    SemanticProtocolSpec.partitionEncoder_eq,
    SemanticProtocolSpec.inventoryEncoder_eq,
    SemanticProtocolSpec.noteStoryEncoder_eq,
    SemanticProtocolSpec.escapedEvidenceBytes_eq,
    SemanticProtocolSpec.slotEvidenceBytes_eq,
    SemanticProtocolSpec.storyEvidenceBytes_eq,
    SemanticProtocolSpec.nonIssueEvidenceBytes_eq,
    SemanticProtocolSpec.firstCrossing_eq,
    SemanticProtocolSpec.terminalIssue,
    SemanticProtocolSpec.terminalPartition_eq,
    SemanticProtocolSpec.terminalNoteStory_eq,
    SemanticProtocolSpec.terminalInventory_eq,
    protocolV5ResponseJson,
    Tier2.NoteReferenceIntegrity.protocolV5ResponseJson]
  generalize hCrossing :
    firstAggregateIssueCrossing _ _ _ = crossing at *
  cases crossing <;> simp_all [
    hOriginalSide, hRevisedSide, hComparedSide,
    SemanticProtocolSpec.skippedNoteStorySources_eq_empty,
    SemanticProtocolSpec.skippedFootnotesInventorySources_eq,
    SemanticProtocolSpec.skippedEndnotesInventorySources_eq]

theorem semantic_fields_terminal_code_eq_operational
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (hReports : semanticResponse.genericStoryReports =
      checkStoryCollection (request.fixedTriples ++ request.relationshipTriples))
    (hNoTerminal :
      (runRequestOperationalChecks request semanticResponse).noTerminalIssue = true) :
    (SemanticProtocolSpec.fields request semanticResponse).terminalCode = none := by
  have hFixed : semanticResponse.genericStoryReports.take request.fixedTriples.length =
      checkStoryCollection request.fixedTriples := by
    rw [hReports]
    unfold checkStoryCollection
    simp
  unfold runRequestOperationalChecks at hNoTerminal
  unfold SemanticProtocolSpec.fields
  rw [hFixed]
  rw [SemanticProtocolSpec.fixedStoryEncoder_eq,
    SemanticProtocolSpec.partitionEncoder_eq,
    SemanticProtocolSpec.inventoryEncoder_eq,
    SemanticProtocolSpec.noteStoryEncoder_eq .footnotes,
    SemanticProtocolSpec.noteStoryEncoder_eq .endnotes,
    SemanticProtocolSpec.selectionIssueOrder_eq,
    SemanticProtocolSpec.noteIssueOrder_eq]
  simp only [
    SemanticProtocolSpec.coalesceIssues_eq,
    SemanticProtocolSpec.firstCrossing_eq,
    SemanticProtocolSpec.escapedEvidenceBytes_eq,
    SemanticProtocolSpec.slotEvidenceBytes_eq,
    SemanticProtocolSpec.storyEvidenceBytes_eq,
    SemanticProtocolSpec.nonIssueEvidenceBytes_eq]
  generalize hCrossing : firstAggregateIssueCrossing _ _ _ = crossing
  cases crossing <;> simp_all

theorem semantic_protocol_fields_pass_of_core_pass
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (hReports : semanticResponse.genericStoryReports =
      checkStoryCollection (request.fixedTriples ++ request.relationshipTriples))
    (hPass : runRequestCorePass request semanticResponse = true) :
    (SemanticProtocolSpec.fields request semanticResponse).passed = true := by
  have hFixed : semanticResponse.genericStoryReports.take request.fixedTriples.length =
      checkStoryCollection request.fixedTriples := by
    rw [hReports]
    unfold checkStoryCollection
    simp
  have hSemantic : semanticResponse.passed = true := by
    unfold runRequestCorePass at hPass
    cases h : semanticResponse.passed <;> simp_all
  have hOperational : runRequestOperationalPass request semanticResponse = true := by
    simpa [runRequestCorePass, hSemantic] using hPass
  unfold runRequestOperationalPass at hOperational
  unfold productionAggregatePass at hOperational
  unfold Tier2.NoteReferenceIntegrity.productionAggregatePass at hOperational
  simp only [Bool.and_eq_true] at hOperational
  have hNoTerminal := hOperational.2.1
  have hNoSelections := hOperational.2.2.1
  have hNoNotes := hOperational.2.2.2.1
  simp only [runRequestOperationalChecks, Bool.and_eq_true] at hNoTerminal hNoSelections hNoNotes
  have hSelectionOrder :
      SemanticProtocolSpec.selectionIssueBefore = issueLess := by
    funext left right
    exact SemanticProtocolSpec.selectionIssueBefore_eq left right
  have hNoteOrder :
      SemanticProtocolSpec.issueBefore = noteIssueLess := by
    funext left right
    exact SemanticProtocolSpec.issueBefore_eq left right
  have hTerminal :
      (SemanticProtocolSpec.fields request semanticResponse).terminalCode = none := by
    exact semantic_fields_terminal_code_eq_operational
      request semanticResponse hReports hNoTerminal
  have hTerminalConcrete := hTerminal
  unfold SemanticProtocolSpec.fields at hTerminalConcrete
  rw [hFixed] at hTerminalConcrete
  have hSelectionEmpty :
      (request.selectionIssues.eraseDups.mergeSort
        SemanticProtocolSpec.selectionIssueBefore).isEmpty = true := by
    rw [hSelectionOrder]
    exact hNoSelections.2
  have hNoteEmpty :
      ((SemanticProtocolSpec.coalesceIssues
          ([request.original.noteEvidence, request.revised.noteEvidence,
            request.compared.noteEvidence].flatMap (·.issues))).mergeSort
        SemanticProtocolSpec.issueBefore).isEmpty = true := by
    rw [hNoteOrder]
    simpa [SemanticProtocolSpec.coalesceIssues_eq,
      List.flatMap_cons, List.flatMap_nil] using hNoNotes.1.2
  have hCommentEmpty :
      ((SemanticProtocolSpec.coalesceIssues
          ((applyCommentGlobalStop
            [request.original.commentEvidence, request.revised.commentEvidence,
              request.compared.commentEvidence]).flatMap (·.issues))).mergeSort
        SemanticProtocolSpec.issueBefore).isEmpty = true := by
    rw [hNoteOrder]
    simpa [SemanticProtocolSpec.coalesceIssues_eq,
      List.flatMap_cons, List.flatMap_nil] using hNoNotes.2
  unfold SemanticProtocolSpec.fields
  rw [hFixed]
  simp only [hSemantic, Bool.true_and, Bool.and_eq_true,
    Option.isNone_iff_eq_none]
  exact ⟨⟨⟨hTerminalConcrete, hSelectionEmpty⟩, hNoteEmpty⟩, hCommentEmpty⟩

def buildRunRequestCoreResponse (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : Bool × Json :=
  (runRequestCorePass request semanticResponse,
    buildRunRequestCoreJson request semanticResponse)

theorem build_run_request_core_response_semantic_pass
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (hPass :
      (buildRunRequestCoreResponse request semanticResponse).1 = true) :
    semanticResponse.passed = true := by
  change runRequestCorePass request semanticResponse = true at hPass
  unfold runRequestCorePass at hPass
  cases hSemantic : semanticResponse.passed
  · simp only [hSemantic, Bool.false_eq_true, ↓reduceIte] at hPass
  · rfl

theorem build_run_request_core_response_failed_semantic
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (hFailed : semanticResponse.passed = false) :
    (buildRunRequestCoreResponse request semanticResponse).1 = false := by
  change runRequestCorePass request semanticResponse = false
  unfold runRequestCorePass
  rw [hFailed]
  rfl

theorem run_request_core_pass_semantic_inventories
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (hPass : runRequestCorePass request semanticResponse = true) :
    productionSemanticInventoriesPass request semanticResponse = true := by
  unfold runRequestCorePass at hPass
  cases hSemantic : semanticResponse.passed
  · simp only [hSemantic, Bool.false_eq_true, ↓reduceIte] at hPass
  · simp only [hSemantic, ↓reduceIte] at hPass
    unfold runRequestOperationalPass at hPass
    have hChecks := Tier2.NoteReferenceIntegrity.production_aggregate_pass_exact
      (runRequestOperationalChecks request semanticResponse) hPass
    have hProduction := hChecks.2.2.2.2.2.2.2.2.1
    change ((((productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised) &&
      productionRecordIntegrityPass request.compared) &&
      productionSemanticInventoriesPass request semanticResponse) &&
      productionCommentEvidencePass request.original &&
      productionCommentEvidencePass request.revised &&
      productionCommentEvidencePass request.compared &&
      productionCommentGlobalAdmissionCheck request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    exact hProduction.1.1.1.1.2

theorem run_request_core_pass_comment_evidence
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (hPass : runRequestCorePass request semanticResponse = true) :
    productionCommentEvidencePass request.original = true ∧
    productionCommentEvidencePass request.revised = true ∧
    productionCommentEvidencePass request.compared = true := by
  unfold runRequestCorePass at hPass
  cases hSemantic : semanticResponse.passed
  · simp only [hSemantic, Bool.false_eq_true, ↓reduceIte] at hPass
  · simp only [hSemantic, ↓reduceIte] at hPass
    unfold runRequestOperationalPass at hPass
    have hChecks := Tier2.NoteReferenceIntegrity.production_aggregate_pass_exact
      (runRequestOperationalChecks request semanticResponse) hPass
    have hProduction := hChecks.2.2.2.2.2.2.2.2.1
    change ((((productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised) &&
      productionRecordIntegrityPass request.compared) &&
      productionSemanticInventoriesPass request semanticResponse) &&
      productionCommentEvidencePass request.original &&
      productionCommentEvidencePass request.revised &&
      productionCommentEvidencePass request.compared &&
      productionCommentGlobalAdmissionCheck request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    exact ⟨hProduction.1.1.1.2, hProduction.1.1.2, hProduction.1.2⟩

theorem run_request_core_pass_comment_global_admission
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (hPass : runRequestCorePass request semanticResponse = true) :
    (commentResourceUsageOfCore request).tripleXmlEvents ≤ 3000000 := by
  unfold runRequestCorePass at hPass
  cases hSemantic : semanticResponse.passed
  · simp only [hSemantic, Bool.false_eq_true, ↓reduceIte] at hPass
  · simp only [hSemantic, ↓reduceIte] at hPass
    unfold runRequestOperationalPass at hPass
    have hChecks := Tier2.NoteReferenceIntegrity.production_aggregate_pass_exact
      (runRequestOperationalChecks request semanticResponse) hPass
    have hProduction := hChecks.2.2.2.2.2.2.2.2.1
    change ((((productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised) &&
      productionRecordIntegrityPass request.compared) &&
      productionSemanticInventoriesPass request semanticResponse) &&
      productionCommentEvidencePass request.original &&
      productionCommentEvidencePass request.revised &&
      productionCommentEvidencePass request.compared &&
      productionCommentGlobalAdmissionCheck request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    unfold productionCommentGlobalAdmissionCheck at hProduction
    simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq,
      List.all_eq_true]
      at hProduction
    simpa [maxCumulativeXmlEvents] using hProduction.2.1.1.1.1

theorem run_request_core_pass_comment_selector_exact
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hPass : runRequestCorePass request semanticResponse = true) :
    Tier2.CommentReferenceIntegrity.selectConventionalMainComment
        (commentPackageViewOfCore request side) =
      selectConventionalMainCommentRecords
        (request.packageRecord (noteSideOfCommentSide side)).relationships := by
  unfold runRequestCorePass at hPass
  cases hSemantic : semanticResponse.passed
  · simp only [hSemantic, Bool.false_eq_true, ↓reduceIte] at hPass
  · simp only [hSemantic, ↓reduceIte] at hPass
    unfold runRequestOperationalPass at hPass
    have hChecks := Tier2.NoteReferenceIntegrity.production_aggregate_pass_exact
      (runRequestOperationalChecks request semanticResponse) hPass
    have hProduction := hChecks.2.2.2.2.2.2.2.2.1
    change ((((productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised) &&
      productionRecordIntegrityPass request.compared) &&
      productionSemanticInventoriesPass request semanticResponse) &&
      productionCommentEvidencePass request.original &&
      productionCommentEvidencePass request.revised &&
      productionCommentEvidencePass request.compared &&
      productionCommentGlobalAdmissionCheck request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    unfold productionCommentGlobalAdmissionCheck at hProduction
    simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq,
      List.all_eq_true] at hProduction
    apply comment_selection_result_eq_sound
    exact hProduction.2.1.1.1.2 side (by cases side <;> simp)

theorem run_request_core_pass_comment_source_set
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hPass : runRequestCorePass request semanticResponse = true) :
    Tier2.CommentReferenceIntegrity.completeCommentSourceSetCheck
      (commentPackageViewOfCore request side) side
      (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
        (packageViewOfRecord
          (request.packageRecord (noteSideOfCommentSide side)))
        (noteSideOfCommentSide side)
        (selectedStoriesOfRecord
          (request.packageRecord (noteSideOfCommentSide side)))) = true := by
  unfold runRequestCorePass at hPass
  cases hSemantic : semanticResponse.passed
  · simp only [hSemantic, Bool.false_eq_true, ↓reduceIte] at hPass
  · simp only [hSemantic, ↓reduceIte] at hPass
    unfold runRequestOperationalPass at hPass
    have hChecks := Tier2.NoteReferenceIntegrity.production_aggregate_pass_exact
      (runRequestOperationalChecks request semanticResponse) hPass
    have hProduction := hChecks.2.2.2.2.2.2.2.2.1
    change ((((productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised) &&
      productionRecordIntegrityPass request.compared) &&
      productionSemanticInventoriesPass request semanticResponse) &&
      productionCommentEvidencePass request.original &&
      productionCommentEvidencePass request.revised &&
      productionCommentEvidencePass request.compared &&
      productionCommentGlobalAdmissionCheck request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    unfold productionCommentGlobalAdmissionCheck at hProduction
    simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq,
      List.all_eq_true]
      at hProduction
    exact hProduction.2.1.1.2 side (by cases side <;> simp)

theorem run_request_core_pass_retained_comment_scan
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hPass : runRequestCorePass request semanticResponse = true) :
    retainedParsedCommentEvidenceOfProduction request side =
      .ok (parsedCommentEvidenceOfProduction request side) := by
  unfold runRequestCorePass at hPass
  cases hSemantic : semanticResponse.passed
  · simp only [hSemantic, Bool.false_eq_true, ↓reduceIte] at hPass
  · simp only [hSemantic, ↓reduceIte] at hPass
    unfold runRequestOperationalPass at hPass
    have hChecks := Tier2.NoteReferenceIntegrity.production_aggregate_pass_exact
      (runRequestOperationalChecks request semanticResponse) hPass
    have hProduction := hChecks.2.2.2.2.2.2.2.2.1
    change ((((productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised) &&
      productionRecordIntegrityPass request.compared) &&
      productionSemanticInventoriesPass request semanticResponse) &&
      productionCommentEvidencePass request.original &&
      productionCommentEvidencePass request.revised &&
      productionCommentEvidencePass request.compared &&
      productionCommentGlobalAdmissionCheck request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    unfold productionCommentGlobalAdmissionCheck at hProduction
    simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq,
      List.all_eq_true]
      at hProduction
    have hValue := hProduction.2.1.2 side (by cases side <;> simp)
    cases hRetained :
        retainedParsedCommentEvidenceOfProduction request side with
    | error detail => simp [hRetained] at hValue
    | ok actual =>
        simp only [hRetained, decide_eq_true_eq] at hValue
        simpa [hValue] using hRetained

theorem run_request_core_pass_retained_comment_scan_input
    (request : RunRequestCoreRequest) (semanticResponse : VerifierResponseV5)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hPass : runRequestCorePass request semanticResponse = true) :
    retainedCommentScanInputOfProduction request side =
      .ok (semanticCommentScanInputOfCore request side) := by
  unfold runRequestCorePass at hPass
  cases hSemantic : semanticResponse.passed
  · simp only [hSemantic, Bool.false_eq_true, ↓reduceIte] at hPass
  · simp only [hSemantic, ↓reduceIte] at hPass
    unfold runRequestOperationalPass at hPass
    have hChecks := Tier2.NoteReferenceIntegrity.production_aggregate_pass_exact
      (runRequestOperationalChecks request semanticResponse) hPass
    have hProduction := hChecks.2.2.2.2.2.2.2.2.1
    change ((((productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised) &&
      productionRecordIntegrityPass request.compared) &&
      productionSemanticInventoriesPass request semanticResponse) &&
      productionCommentEvidencePass request.original &&
      productionCommentEvidencePass request.revised &&
      productionCommentEvidencePass request.compared &&
      productionCommentGlobalAdmissionCheck request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    unfold productionCommentGlobalAdmissionCheck at hProduction
    simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq,
      List.all_eq_true]
      at hProduction
    have hValue := hProduction.2.2 side (by cases side <;> simp)
    cases hRetained :
        retainedCommentScanInputOfProduction request side with
    | error detail => simp [hRetained] at hValue
    | ok actual =>
        simp only [hRetained, decide_eq_true_eq] at hValue
        simpa [hValue] using hRetained

def coreSemanticAdmissionReady (request : RunRequestCoreRequest) : Bool :=
  request.selectionIssues.isEmpty &&
  request.original.noteEvidence.complete &&
  request.revised.noteEvidence.complete &&
  request.compared.noteEvidence.complete &&
  request.original.noteEvidence.issues.isEmpty &&
  request.revised.noteEvidence.issues.isEmpty &&
  request.compared.noteEvidence.issues.isEmpty &&
  request.original.commentEvidence.complete &&
  request.revised.commentEvidence.complete &&
  request.compared.commentEvidence.complete &&
  request.original.commentEvidence.issues.isEmpty &&
  request.revised.commentEvidence.issues.isEmpty &&
  request.compared.commentEvidence.issues.isEmpty &&
  productionPackageParserEvidencePass request.original &&
  productionPackageParserEvidencePass request.revised &&
  productionPackageParserEvidencePass request.compared &&
  productionSelectorEvidencePass request.original &&
  productionSelectorEvidencePass request.revised &&
  productionSelectorEvidencePass request.compared &&
  productionInventoryEvidencePass request.original &&
  productionInventoryEvidencePass request.revised &&
  productionInventoryEvidencePass request.compared &&
  storyCollectionPassed (checkStoryCollection request.fixedTriples) &&
  storyCollectionPassed (checkStoryCollection request.relationshipTriples) &&
  productionRecordIntegrityPass request.original &&
  productionRecordIntegrityPass request.revised &&
  productionRecordIntegrityPass request.compared &&
  decide (request.original.packageReadCount = 1) &&
  decide (request.revised.packageReadCount = 1) &&
  decide (request.compared.packageReadCount = 1) &&
  decide (request.original.noteEvidence.side = .original) &&
  decide (request.revised.noteEvidence.side = .revised) &&
  decide (request.compared.noteEvidence.side = .compared)

theorem core_semantic_admission_ready_sides
    (request : RunRequestCoreRequest)
    (hReady : coreSemanticAdmissionReady request = true) :
    request.original.noteEvidence.side = .original ∧
    request.revised.noteEvidence.side = .revised ∧
    request.compared.noteEvidence.side = .compared := by
  unfold coreSemanticAdmissionReady at hReady
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hReady
  exact ⟨hReady.1.1.2, hReady.1.2, hReady.2⟩

theorem core_semantic_admission_ready_package_evidence
    (request : RunRequestCoreRequest)
    (hReady : coreSemanticAdmissionReady request = true) :
    ProductionPackageRecordOf request.original ∧
    ProductionPackageRecordOf request.revised ∧
    ProductionPackageRecordOf request.compared := by
  unfold coreSemanticAdmissionReady at hReady
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hReady
  have hOldReady := hReady.1.1.1
  have h1 := hOldReady.1
  have hComparedRead := hOldReady.2
  have h2 := h1.1
  have hRevisedRead := h1.2
  have h3 := h2.1
  have hOriginalRead := h2.2
  have h4 := h3.1
  have hComparedIntegrity := h3.2
  have h5 := h4.1
  have hRevisedIntegrity := h4.2
  have h6 := h5.1
  have hOriginalIntegrity := h5.2
  have h7 := h6.1
  have h8 := h7.1
  have h9 := h8.1
  have hComparedInventory := h8.2
  have h10 := h9.1
  have hRevisedInventory := h9.2
  have h11 := h10.1
  have hOriginalInventory := h10.2
  have h12 := h11.1
  have hComparedSelector := h11.2
  have h13 := h12.1
  have hRevisedSelector := h12.2
  have h14 := h13.1
  have hOriginalSelector := h13.2
  have h15 := h14.1
  have hComparedParser := h14.2
  have h16 := h15.1
  have hRevisedParser := h15.2
  have hOriginalParser := h16.2
  refine ⟨?_, ?_, ?_⟩
  · exact production_package_record_of_checks request.original
      hOriginalRead
      hOriginalParser hOriginalSelector hOriginalIntegrity hOriginalInventory
  · exact production_package_record_of_checks request.revised
      hRevisedRead hRevisedParser hRevisedSelector hRevisedIntegrity hRevisedInventory
  · exact production_package_record_of_checks request.compared
      hComparedRead hComparedParser hComparedSelector hComparedIntegrity hComparedInventory

def failedSemanticResponse (request : VerifierRequestV5) : VerifierResponseV5 :=
  let context : Tier2.NoteReferenceIntegrity.GlobalAdmissionContext := {
    packageView := request.packageView
    selectedStories := request.selectedStories
    sideOrder := [.original, .revised, .compared]
    admissionEvents := []
    firstLocalSemanticCrossing := none
  }
  let sideEvaluation := fun side =>
    Tier2.NoteReferenceIntegrity.incompleteSideEvaluation {
      side
      status := .incomplete
      sources := []
      definitionStories := []
    }
  { passed := false
    globalEvaluation := {
      admissionContext := context
      sideEvaluation
      incompleteCause := fun _ => none
    }
    genericStoryReports := []
    genericStoryReportsPassed := false
    noteStoryCount := 2
    inventoryCount := 6
    noteInventory := fun _ =>
      { references := [], definitions := [],
        forbiddenDefinitionStoryReferences := [] }
    serializedPass := false
    serializedBytes := ByteArray.empty }

def finishRunRequestCore (request : RunRequestCoreRequest)
    (semanticRequest : VerifierRequestV5) (semanticResponse : VerifierResponseV5)
    (semanticStdout : ByteArray) : Except String RunRequestCoreResult :=
  let built := buildRunRequestCoreResponse request semanticResponse
  match finalizeProtocolV6Response built.2 built.1 with
  | .error detail => .error detail
  | .ok stdout => .ok {
      responsePassed := built.1
      response := built.2
      stdout
      semanticRequest
      semanticResponse
      semanticStdout
      typedProjectionCheck := protocolV6JsonProjectionCheck built.2 built.1
    }

def runRequestCore (request : RunRequestCoreRequest) :
    Except String RunRequestCoreResult :=
  let semanticRequest := semanticRequestOfCore request
  if coreSemanticAdmissionReady request then
    match Tier2.NoteReferenceIntegrity.canonicalSemanticResponse semanticRequest with
    | .error detail => .error detail
    | .ok (semanticResponse, semanticStdout) =>
      finishRunRequestCore request semanticRequest semanticResponse semanticStdout
  else
    finishRunRequestCore request semanticRequest
      (failedSemanticResponse semanticRequest) ByteArray.empty

def protocolV6FieldNames : List String :=
  [ "protocolVersion", "checker", "passed", "fixedStories",
    "presenceMismatches", "fixedStoryIssues", "relationshipSlots",
    "relationshipStories", "selectionIssues", "referenceSourcePartitions",
    "noteStories", "noteInventories", "noteIntegrityIssues",
    "commentStory", "commentInventories", "commentIntegrityIssues" ]

def ProtocolV6EveryFieldOf (expected actual : Json) : Prop :=
  actual = expected ∧
  ∀ field, field ∈ protocolV6FieldNames →
    actual.getObjVal? field = expected.getObjVal? field

def SemanticProtocolV6ProjectionOf (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) (actual : Json) : Prop :=
  ProtocolV6EveryFieldOf
    (semanticProtocolV6Projection request semanticResponse) actual

def FinalizedProtocolV6ResponseOf (response : Json) (passed : Bool)
    (stdout : ByteArray) : Prop :=
  stdout = response.compress.toUTF8 ++ protocolV6LineFeed ∧
  response.compress.toUTF8.size ≤ maxProtocolV6JsonResponseBytes ∧
  stdout.size ≤ maxProtocolV6ResponseBytes ∧
  protocolV6JsonProjectionCheck response passed = true

theorem finalized_protocol_v6_response_exact (response : Json) (passed : Bool)
    (stdout : ByteArray)
    (hFinalize : finalizeProtocolV6Response response passed = .ok stdout) :
    FinalizedProtocolV6ResponseOf response passed stdout := by
  simp only [finalizeProtocolV6Response] at hFinalize
  split at hFinalize
  · rename_i hProjection
    unfold finalizeProtocolV6ResponseUnchecked at hFinalize
    dsimp only at hFinalize
    split at hFinalize
    · contradiction
    · rename_i hJson
      split at hFinalize
      · contradiction
      · rename_i hStdout
        cases hFinalize
        exact ⟨rfl, Nat.le_of_not_gt hJson, Nat.le_of_not_gt hStdout,
          hProjection⟩
  · contradiction

theorem protocol_v6_every_field_exact (expected actual : Json)
    (hExact : actual = expected) : ProtocolV6EveryFieldOf expected actual := by
  subst actual
  exact ⟨rfl, fun _ _ => rfl⟩

def ProductionRunRequestRefinesSemanticOf (request : RunRequestCoreRequest)
    (result : RunRequestCoreResult) : Prop :=
  ProductionPackageRecordOf request.original ∧
  ProductionPackageRecordOf request.revised ∧
  ProductionPackageRecordOf request.compared ∧
  ProductionCommentEvidenceOf request.original ∧
  ProductionCommentEvidenceOf request.revised ∧
  ProductionCommentEvidenceOf request.compared ∧
  result.semanticRequest = semanticRequestOfCore request ∧
  result.semanticRequest.packageView .original = packageViewOfRecord request.original ∧
  result.semanticRequest.packageView .revised = packageViewOfRecord request.revised ∧
  result.semanticRequest.packageView .compared = packageViewOfRecord request.compared ∧
  Tier2.NoteReferenceIntegrity.canonicalSemanticResponse result.semanticRequest =
    .ok (result.semanticResponse, result.semanticStdout) ∧
  Tier2.NoteReferenceIntegrity.AggregatePassOf
    result.semanticRequest result.semanticResponse ∧
  result.semanticResponse.globalEvaluation =
    Tier2.NoteReferenceIntegrity.evaluateAllNoteSidesV5 result.semanticRequest ∧
  (∀ side, result.semanticResponse.noteInventory side =
    Tier2.NoteReferenceIntegrity.derivedPackageInventory result.semanticRequest side) ∧
  productionSemanticInventoriesPass request result.semanticResponse = true ∧
  result.responsePassed = result.semanticResponse.passed ∧
  SemanticProtocolV6ProjectionOf
    request result.semanticResponse result.response ∧
  FinalizedProtocolV6ResponseOf result.response result.responsePassed
    result.stdout

namespace Tier2.NoteReferenceIntegrity

def productionRunRequestCoreRefinementSignature : Prop :=
  ∀ (request : RunRequestCoreRequest) (result : RunRequestCoreResult),
    runRequestCore request = .ok result →
    result.responsePassed = true →
    ProductionRunRequestRefinesSemanticOf request result

theorem production_run_request_core_refinement_sound (request : RunRequestCoreRequest)
    (result : RunRequestCoreResult)
    (hRun : runRequestCore request = .ok result)
    (hPass : result.responsePassed = true) :
    ProductionRunRequestRefinesSemanticOf request result := by
  cases hReady : coreSemanticAdmissionReady request
  · let semanticRequest := semanticRequestOfCore request
    let semanticResponse := failedSemanticResponse semanticRequest
    have hFailed : semanticResponse.passed = false := by rfl
    have hBuiltFailed :=
      build_run_request_core_response_failed_semantic request semanticResponse hFailed
    dsimp only [semanticResponse, semanticRequest] at hBuiltFailed
    cases hFinalize : _root_.finalizeProtocolV6Response
        (buildRunRequestCoreResponse request semanticResponse).2
        (buildRunRequestCoreResponse request semanticResponse).1 with
    | error detail =>
      dsimp only [semanticResponse, semanticRequest] at hFinalize
      simp [runRequestCore, hReady, finishRunRequestCore, hFinalize] at hRun
    | ok stdout =>
      dsimp only [semanticResponse, semanticRequest] at hFinalize
      simp [runRequestCore, hReady, finishRunRequestCore, hFinalize] at hRun
      cases hRun
      exact nomatch hBuiltFailed.symm.trans hPass
  · cases hVerify : Tier2.NoteReferenceIntegrity.canonicalSemanticResponse
        (semanticRequestOfCore request) with
    | error detail =>
      simp [runRequestCore, hReady, hVerify] at hRun
    | ok semanticResult =>
      rcases semanticResult with ⟨semanticResponse, semanticStdout⟩
      cases hFinalize : _root_.finalizeProtocolV6Response
          (buildRunRequestCoreResponse request semanticResponse).2
          (buildRunRequestCoreResponse request semanticResponse).1 with
      | error detail =>
        simp [runRequestCore, hReady, hVerify, finishRunRequestCore,
          hFinalize] at hRun
      | ok stdout =>
        simp [runRequestCore, hReady, hVerify, finishRunRequestCore,
          hFinalize] at hRun
        cases hRun
        have hSemanticPass : semanticResponse.passed = true :=
          build_run_request_core_response_semantic_pass request semanticResponse hPass
        have hProductionInventories :
            productionSemanticInventoriesPass request semanticResponse = true := by
          apply run_request_core_pass_semantic_inventories request semanticResponse
          exact hPass
        have hCommentChecks :=
          run_request_core_pass_comment_evidence request semanticResponse hPass
        have hComments :
            ProductionCommentEvidenceOf request.original ∧
            ProductionCommentEvidenceOf request.revised ∧
            ProductionCommentEvidenceOf request.compared :=
          ⟨production_comment_evidence_pass_sound _ hCommentChecks.1,
           production_comment_evidence_pass_sound _ hCommentChecks.2.1,
           production_comment_evidence_pass_sound _ hCommentChecks.2.2⟩
        have hSemantic :=
          Tier2.NoteReferenceIntegrity.note_integrity_aggregate_pass_sound
          (semanticRequestOfCore request)
          semanticResponse semanticStdout hVerify hSemanticPass
        have hPackages :=
          core_semantic_admission_ready_package_evidence request hReady
        have hSides :=
          core_semantic_admission_ready_sides request hReady
        have hFields :=
          Tier2.NoteReferenceIntegrity.canonical_semantic_response_fields_exact
            (semanticRequestOfCore request) semanticResponse semanticStdout hVerify
        have hReportExact := hSemantic.1.2.1
        change semanticResponse.genericStoryReports =
          checkStoryCollection
            (request.fixedTriples ++ request.relationshipTriples) at hReportExact
        refine ⟨hPackages.1, hPackages.2.1, hPackages.2.2,
          hComments.1, hComments.2.1, hComments.2.2,
          rfl, rfl, rfl, rfl, hVerify, hSemantic.1,
          hFields.1, hFields.2, hProductionInventories, ?_, ?_, ?_⟩
        · exact hPass.trans hSemanticPass.symm
        · unfold SemanticProtocolV6ProjectionOf
          apply protocol_v6_every_field_exact
          exact build_run_request_core_json_refines_semantic_projection
            request semanticResponse hReportExact
            (hPass.trans
              (semantic_protocol_fields_pass_of_core_pass
                request semanticResponse hReportExact hPass).symm)
            hSides.1 hSides.2.1 hSides.2.2
        · exact finalized_protocol_v6_response_exact _ _ _ hFinalize

abbrev RunRequestCoreRequestV6 := RunRequestCoreRequest
abbrev RunRequestCoreResultV6 := RunRequestCoreResult

def productionPackageRecordAt
    (request : RunRequestCoreRequestV6)
    (evidence :
      ProductionPackageRecordOf request.original ∧
      ProductionPackageRecordOf request.revised ∧
      ProductionPackageRecordOf request.compared)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    ProductionPackageRecordOf
      (request.packageRecord (noteSideOfCommentSide side)) := by
  cases side with
  | original => exact evidence.1
  | revised => exact evidence.2.1
  | compared => exact evidence.2.2

def productionCommentEvidenceAt
    (request : RunRequestCoreRequestV6)
    (evidence :
      ProductionCommentEvidenceOf request.original ∧
      ProductionCommentEvidenceOf request.revised ∧
      ProductionCommentEvidenceOf request.compared)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    ProductionCommentEvidenceOf
      (request.packageRecord (noteSideOfCommentSide side)) := by
  cases side with
  | original => exact evidence.1
  | revised => exact evidence.2.1
  | compared => exact evidence.2.2

noncomputable def semanticRequestOfCoreV6
    (request : RunRequestCoreRequestV6)
    (packageEvidence :
      ProductionPackageRecordOf request.original ∧
      ProductionPackageRecordOf request.revised ∧
      ProductionPackageRecordOf request.compared)
    (commentEvidence :
      ProductionCommentEvidenceOf request.original ∧
      ProductionCommentEvidenceOf request.revised ∧
      ProductionCommentEvidenceOf request.compared)
    (hPrior : (commentResourceUsageOfCore request).tripleXmlEvents ≤ 3000000)
    (hSources : ∀ side,
      Tier2.CommentReferenceIntegrity.completeCommentSourceSetCheck
        (commentPackageViewOfCore request side) side
        (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
          (packageViewOfRecord
            (request.packageRecord (noteSideOfCommentSide side)))
          (noteSideOfCommentSide side)
          (selectedStoriesOfRecord
            (request.packageRecord (noteSideOfCommentSide side)))) = true) :
    Tier2.CommentReferenceIntegrity.VerifierRequestV6 :=
  let record := fun side =>
    request.packageRecord (noteSideOfCommentSide side)
  let pkg := commentPackageViewOfCore request
  let note := fun side =>
    Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
      (packageViewOfRecord (record side)) (noteSideOfCommentSide side)
      (selectedStoriesOfRecord (record side))
  let set := fun side =>
    Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      (pkg side) side (note side)
  let scans := fun side => retainedCommentSourceScansOfRecord (record side)
  let part := fun side => (record side).commentEvidence.part
  let retainedScan := fun side => (record side).commentEvidence.retainedScan
  {
    packageView := pkg
    retainedPackageRecord := retainedCommentPackageRecordOfCore request
    packageBytes := fun side => (record side).packageBytes
    noteEvaluation := note
    retainedSourceScans := scans
    retainedSnapshotBytes := fun side => (record side).snapshotBytes
    snapshotWriteInvocationCount := fun side =>
      (record side).snapshotWriteCount
    privateSnapshotPath := fun side => (record side).snapshotPath
    retainedCommentExtraction := fun side =>
      (part side).map fun loaded =>
        semanticCommentExtractionOfProduction loaded.parseEvidence
    commentExtractionInvocationCount := fun side =>
      (part side).map (·.parseEvidence.extraction.extractionInvocationCount)
        |>.getD 0
    commentParseInvocationCount := fun side =>
      (part side).map (·.parseEvidence.parseInvocationCount) |>.getD 0
    retainedCommentScanRealization := fun side =>
      (pkg side).retainedCommentRealization
    retainedCommentScanSourceSet := fun side => some (set side)
    retainedCommentScanSourceScans := fun side => some (scans side)
    commentScanInvocationCount := fun side =>
      (retainedScan side).map (·.scanInvocationCount) |>.getD 0
    retainedCommentScanResult := fun side =>
      Tier2.CommentReferenceIntegrity.scanCommentEvidenceV6
        (pkg side) side (set side) (scans side)
        (pkg side).retainedCommentRealization
    resourceUsageBeforeComments := commentResourceUsageOfCore request
    packageRecordExact := by
      intro side
      rfl
    packageBytesExact := by
      intro side
      rfl
    packageIndexExact := by
      intro side
      rfl
    requestBytesExact := by
      intro side
      rfl
    binaryIndexExact := by
      intro side
      exact (record side).packageIndexExact
    snapshotBytesExact := by
      intro side
      exact (record side).snapshotBytesExact
    snapshotWriteExact := by
      intro side
      exact (record side).snapshotWriteCountExact
    sourceScansExact := by
      intro side
      rfl
    resourceUsageExact := by
      intro side
      rfl
    realizationEvidenceExact := by
      intro side selected realization hRealization hSelected
      cases hPart : part side with
      | none =>
          simp [pkg, commentPackageViewOfCore, record, part, hPart] at hRealization
      | some loaded =>
          have hRealizationExact :
              semanticCommentRealizationOfProduction loaded = realization := by
            simpa [pkg, commentPackageViewOfCore, record, part, hPart]
              using hRealization
          subst realization
          have hIdentity : loaded.identity = selected := hSelected
          subst selected
          have hPackage := productionPackageRecordAt request
            packageEvidence side
          have hComment := productionCommentEvidenceAt request
            commentEvidence side
          have hParse : ProductionParseEvidenceOf (record side)
              loaded.parseEvidence := by
            apply hPackage.2.2.2.1
            simp [productionParseEvidencesOfRecord, record, part, hPart]
          rcases hParse with ⟨_, _, hExtraction, _, _, _, _, _, hParseCount, _⟩
          rcases hExtraction with
            ⟨_, _, hSnapshotPath, _, _, _, _, _, _, _, _, _, _, _, _,
              hExtractionCount, _⟩
          refine ⟨hSnapshotPath, ?_, ?_, hParseCount, ?_⟩
          · rfl
          · simp [part, hPart, hExtractionCount]
          · exact production_retained_comment_part_admitted request side loaded
              (by simpa [record, part] using hPart)
              hPackage hComment hPrior
    retainedScanEvidenceExact := by
      intro side realization evidence _hRealization _hSet _hScans
        _hInvocation hResult
      have hComplete :=
        Tier2.CommentReferenceIntegrity.complete_comment_source_set_check_sound
          (pkg side) side (note side) (hSources side)
      rw [_hRealization] at hResult
      have hParsed :=
        Tier2.CommentReferenceIntegrity.parsed_comment_inventory_evidence_exact
          (pkg side) side (note side) (set side) (scans side)
          (some realization) evidence hComplete hResult
      exact ⟨hComplete, hParsed⟩
    selectedScanBindingsExact := by
      intro side realization evidence hRealization hScan
      have hComment := productionCommentEvidenceAt request
        commentEvidence side
      rcases hComment with ⟨_, _, _, retained, hRetained,
        hInvocation, _⟩
      refine ⟨hRealization, rfl, rfl, ?_, ?_⟩
      · simp [retainedScan, record, hRetained, hInvocation]
      · rw [hRealization]
        exact hScan
  }

set_option maxHeartbeats 1000000 in
theorem semantic_request_of_core_v6_all_comment_sides_pass
    (request : RunRequestCoreRequestV6)
    (packageEvidence :
      ProductionPackageRecordOf request.original ∧
      ProductionPackageRecordOf request.revised ∧
      ProductionPackageRecordOf request.compared)
    (commentEvidence :
      ProductionCommentEvidenceOf request.original ∧
      ProductionCommentEvidenceOf request.revised ∧
      ProductionCommentEvidenceOf request.compared)
    (hPrior : (commentResourceUsageOfCore request).tripleXmlEvents ≤ 3000000)
    (hSources : ∀ side,
      Tier2.CommentReferenceIntegrity.completeCommentSourceSetCheck
        (commentPackageViewOfCore request side) side
        (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
          (packageViewOfRecord
            (request.packageRecord (noteSideOfCommentSide side)))
          (noteSideOfCommentSide side)
          (selectedStoriesOfRecord
            (request.packageRecord (noteSideOfCommentSide side)))) = true)
    (hSelectors : ∀ side,
      Tier2.CommentReferenceIntegrity.selectConventionalMainComment
          (commentPackageViewOfCore request side) =
        selectConventionalMainCommentRecords
          (request.packageRecord
            (noteSideOfCommentSide side)).relationships)
    (hParsed : ∀ side,
      retainedParsedCommentEvidenceOfProduction request side =
        .ok (parsedCommentEvidenceOfProduction request side))
    (hScanInputs : ∀ side,
      retainedCommentScanInputOfProduction request side =
        .ok (semanticCommentScanInputOfCore request side)) :
    Tier2.CommentReferenceIntegrity.allCommentSidesPass
      (Tier2.CommentReferenceIntegrity.evaluateAllCommentSidesV6
        (semanticRequestOfCoreV6 request packageEvidence commentEvidence
          hPrior hSources)) = true := by
  have hSide : ∀ side,
      Tier2.CommentReferenceIntegrity.sideCommentPassV6
        (Tier2.CommentReferenceIntegrity.evaluateAllCommentSidesV6
          (semanticRequestOfCoreV6 request packageEvidence commentEvidence
            hPrior hSources)) side = true := by
    intro side
    unfold Tier2.CommentReferenceIntegrity.sideCommentPassV6
    simp only [Tier2.CommentReferenceIntegrity.evaluateAllCommentSidesV6]
    change (decide (
      (Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
        (commentPackageViewOfCore request side) side
        (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
          (packageViewOfRecord
            (request.packageRecord (noteSideOfCommentSide side)))
          (noteSideOfCommentSide side)
          (selectedStoriesOfRecord
            (request.packageRecord
              (noteSideOfCommentSide side))))).status =
        .passed) &&
      Tier2.CommentReferenceIntegrity.checkPackageCommentIntegrity
        (Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
          (commentPackageViewOfCore request side) side
          (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
            (packageViewOfRecord
              (request.packageRecord (noteSideOfCommentSide side)))
            (noteSideOfCommentSide side)
            (selectedStoriesOfRecord
              (request.packageRecord
                (noteSideOfCommentSide side))))).inventory) = true
    unfold Tier2.CommentReferenceIntegrity.evaluateCommentSideV6
    simp only [hSources side, Bool.not_true, Bool.false_eq_true, ↓reduceIte]
    rw [hSelectors side]
    have hComment := productionCommentEvidenceAt request commentEvidence side
    rcases hComment with
      ⟨hSourceProjection, hSourceIdentity, hSelectionEvidence,
        retained, hRetained, hInvocation, hInput, hOutput, hCrossing,
        hIntegrity, hInventory, hComplete, hSemanticLimit, hIssues⟩
    have hParsedExact := hParsed side
    have hScanInputExact := hScanInputs side
    simp only [retainedParsedCommentEvidenceOfProduction, hRetained,
      retainedCommentScanInputOfProduction, Except.ok.injEq]
      at hParsedExact hScanInputExact
    have hWireExact := congrArg
      Tier2.CommentReferenceIntegrity.ParsedCommentEvidence.wireCounts
      hParsedExact
    have hReferencesExact := congrArg
      Tier2.CommentReferenceIntegrity.ParsedCommentEvidence.references
      hParsedExact
    have hDefinitionsExact := congrArg
      Tier2.CommentReferenceIntegrity.ParsedCommentEvidence.definitions
      hParsedExact
    have hNonDirectExact := congrArg
      Tier2.CommentReferenceIntegrity.ParsedCommentEvidence.nonDirectDefinitions
      hParsedExact
    have hIssuesExact := congrArg
      Tier2.CommentReferenceIntegrity.ParsedCommentEvidence.issues
      hParsedExact
    have hCrossingExact := congrArg
      Tier2.CommentReferenceIntegrity.ParsedCommentEvidence.crossing
      hParsedExact
    have hIntegrityCheck :
        Tier2.CommentReferenceIntegrity.checkPackageCommentIntegrity
          (Tier2.CommentReferenceIntegrity.packageCommentInventory
            retained.output.scan) = true :=
      Tier2.CommentReferenceIntegrity.package_comment_reference_integrity_complete
        _ hIntegrity
    have hRetainedOutputExact :
        Tier2.CommentReferenceIntegrity.scanCommentEvidence
            (semanticCommentScanInputOfCore request side) =
          retained.output := by
      rw [← hScanInputExact]
      simpa [scanCommentEvidence] using hOutput.symm
    have hSemanticScan :
        Tier2.CommentReferenceIntegrity.scanCommentEvidenceV6
          (commentPackageViewOfCore request side) side
          (Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
            (commentPackageViewOfCore request side) side
            (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
              (packageViewOfRecord
                (request.packageRecord (noteSideOfCommentSide side)))
              (noteSideOfCommentSide side)
              (selectedStoriesOfRecord
                (request.packageRecord (noteSideOfCommentSide side)))))
          (Tier2.CommentReferenceIntegrity.reuseRetainedCommentScans
            (commentPackageViewOfCore request side))
          (commentPackageViewOfCore request side).retainedCommentRealization =
        .ok (parsedCommentEvidenceOfProduction request side) := by
      unfold Tier2.CommentReferenceIntegrity.scanCommentEvidenceV6
      change Except.ok
          (Tier2.CommentReferenceIntegrity.parsedCommentEvidenceOfBoundedScan
            (commentPackageViewOfCore request side) side
            (Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
              (commentPackageViewOfCore request side) side
              (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
                (packageViewOfRecord
                  (request.packageRecord (noteSideOfCommentSide side)))
                (noteSideOfCommentSide side)
                (selectedStoriesOfRecord
                  (request.packageRecord (noteSideOfCommentSide side)))))
            (commentPackageViewOfCore request side).retainedCommentRealization
            (Tier2.CommentReferenceIntegrity.scanCommentEvidence
              (semanticCommentScanInputOfCore request side))) =
        Except.ok (parsedCommentEvidenceOfProduction request side)
      rw [hRetainedOutputExact]
      exact congrArg Except.ok hParsedExact
    have hWireInventory :
        Tier2.CommentReferenceIntegrity.packageCommentInventory
            retained.output.scan =
          (parsedCommentEvidenceOfProduction request side).wireCounts := by
      simpa [Tier2.CommentReferenceIntegrity.commentCountProjectionSpec]
        using hWireExact
    cases hSelection :
        selectConventionalMainCommentRecords
          (request.packageRecord
            (noteSideOfCommentSide side)).relationships with
    | error failure =>
        rw [hSelection] at hSelectionEvidence
        exact False.elim hSelectionEvidence
    | ok selected =>
        cases selected with
        | none =>
            rw [hSelection] at hSelectionEvidence
            have hSemanticSelector :
                Tier2.CommentReferenceIntegrity.selectConventionalMainComment
                    (commentPackageViewOfCore request side) =
                  .ok none := by
              rw [hSelectors side, hSelection]
            have hSemanticScanNone :
                Tier2.CommentReferenceIntegrity.scanCommentEvidenceV6
                    (commentPackageViewOfCore request side) side
                    (Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
                      (commentPackageViewOfCore request side) side
                      (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
                        (packageViewOfRecord
                          (request.packageRecord (noteSideOfCommentSide side)))
                        (noteSideOfCommentSide side)
                        (selectedStoriesOfRecord
                          (request.packageRecord
                            (noteSideOfCommentSide side)))))
                    (Tier2.CommentReferenceIntegrity.reuseRetainedCommentScans
                      (commentPackageViewOfCore request side)) none =
                  .ok (parsedCommentEvidenceOfProduction request side) := by
              simpa [commentPackageViewOfCore, hSelectionEvidence.2.1]
                using hSemanticScan
            have hRawDefinitions :
                retained.output.scan.definitions = [] := by
              rw [← hRetainedOutputExact]
              apply Tier2.CommentReferenceIntegrity.scan_comment_evidence_definitions_empty
              rw [← hScanInputExact, hInput]
              simp [productionCommentScanInput, hSelectionEvidence.2.1]
            have hInventoryDefinitions :
                (Tier2.CommentReferenceIntegrity.packageCommentInventory
                  retained.output.scan).definitions = [] := by
              simp [Tier2.CommentReferenceIntegrity.packageCommentInventory,
                hRawDefinitions]
            have hActualEmpty :=
              Tier2.CommentReferenceIntegrity.package_comment_integrity_without_definitions_is_empty
                _ hIntegrity hInventoryDefinitions
            have hSemanticEmpty :
                (parsedCommentEvidenceOfProduction request side).wireCounts =
                  Tier2.CommentReferenceIntegrity.emptyPackageCommentInventory := by
              rw [← hWireInventory]
              exact hActualEmpty
            have hPass :=
              Tier2.CommentReferenceIntegrity.evaluate_comment_side_v6_absent_pass
                  (commentPackageViewOfCore request side) side
                  (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
                    (packageViewOfRecord
                      (request.packageRecord (noteSideOfCommentSide side)))
                    (noteSideOfCommentSide side)
                    (selectedStoriesOfRecord
                      (request.packageRecord (noteSideOfCommentSide side))))
                  (parsedCommentEvidenceOfProduction request side)
                  (hSources side) hSemanticSelector hSemanticScanNone
                  hSemanticEmpty
            unfold Tier2.CommentReferenceIntegrity.evaluateCommentSideV6 at hPass
            dsimp only at hPass
            simp only [hSources side, Bool.not_true, Bool.false_eq_true,
              ↓reduceIte] at hPass
            rw [hSemanticSelector] at hPass
            simp only [Bool.and_eq_true]
            exact ⟨decide_eq_true hPass.1, hPass.2⟩
        | some selected =>
            rw [hSelection] at hSelectionEvidence
            rcases hSelectionEvidence with
              ⟨hIdentity, hPresent, part, hPart, hPartIdentity, hAdmission⟩
            have hSemanticSelector :
                Tier2.CommentReferenceIntegrity.selectConventionalMainComment
                    (commentPackageViewOfCore request side) =
                  .ok (some selected) := by
              rw [hSelectors side, hSelection]
            have hAdmit :
                Tier2.CommentReferenceIntegrity.admitCommentPartMetadata
                    (commentPackageViewOfCore request side) side
                    (commentResourceUsageOfCore request) selected
                    (semanticCommentRealizationOfProduction part) = true := by
              unfold productionCommentPartAdmissionCheck at hAdmission
              simp only [Bool.and_eq_true, decide_eq_true_eq,
                Bool.not_eq_true, Bool.or_eq_true] at hAdmission
              unfold Tier2.CommentReferenceIntegrity.admitCommentPartMetadata
              simp only [Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq,
                bne_iff_ne, Bool.or_eq_true]
              simp_all [semanticCommentRealizationOfProduction,
                semanticCommentEntryOfProduction, commentPackageViewOfCore,
                maxPartCompressedBytes, maxPartExpandedBytes]
            have hRealization :
                Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
                    (commentPackageViewOfCore request side) side
                    (commentResourceUsageOfCore request) selected =
                  .ok (semanticCommentRealizationOfProduction part) := by
              unfold Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
              simp [commentPackageViewOfCore, hPart, hPartIdentity, hAdmit,
                semanticCommentRealizationOfProduction,
                Tier2.CommentReferenceIntegrity.retainCommentSnapshotEvidence,
                Tier2.CommentReferenceIntegrity.extractRetainedCommentPart,
                Tier2.CommentReferenceIntegrity.retainCommentExtractionEvidence,
                Tier2.CommentReferenceIntegrity.parseRetainedCommentPart]
              simpa [commentPackageViewOfCore, hPart,
                semanticCommentRealizationOfProduction, hPartIdentity]
                using hAdmit
            have hSemanticScanSome :
                Tier2.CommentReferenceIntegrity.scanCommentEvidenceV6
                    (commentPackageViewOfCore request side) side
                    (Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
                      (commentPackageViewOfCore request side) side
                      (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
                        (packageViewOfRecord
                          (request.packageRecord (noteSideOfCommentSide side)))
                        (noteSideOfCommentSide side)
                        (selectedStoriesOfRecord
                          (request.packageRecord
                            (noteSideOfCommentSide side)))))
                    (Tier2.CommentReferenceIntegrity.reuseRetainedCommentScans
                      (commentPackageViewOfCore request side))
                    (some (semanticCommentRealizationOfProduction part)) =
                  .ok (parsedCommentEvidenceOfProduction request side) := by
              simpa [commentPackageViewOfCore, hPart] using hSemanticScan
            have hSemanticIntegrity :
                Tier2.CommentReferenceIntegrity.PackageCommentIntegrity
                  (parsedCommentEvidenceOfProduction request side).wireCounts := by
              rw [← hWireInventory]
              exact hIntegrity
            have hPass :=
              Tier2.CommentReferenceIntegrity.evaluate_comment_side_v6_selected_pass
                (commentPackageViewOfCore request side) side
                (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
                  (packageViewOfRecord
                    (request.packageRecord (noteSideOfCommentSide side)))
                  (noteSideOfCommentSide side)
                  (selectedStoriesOfRecord
                    (request.packageRecord (noteSideOfCommentSide side))))
                selected (semanticCommentRealizationOfProduction part)
                (parsedCommentEvidenceOfProduction request side)
                (hSources side) hSemanticSelector hRealization
                hSemanticScanSome hSemanticIntegrity
            unfold Tier2.CommentReferenceIntegrity.evaluateCommentSideV6 at hPass
            dsimp only at hPass
            simp only [hSources side, Bool.not_true, Bool.false_eq_true,
              ↓reduceIte] at hPass
            rw [hSemanticSelector] at hPass
            simp only [Bool.and_eq_true]
            exact ⟨decide_eq_true hPass.1, hPass.2⟩
  unfold Tier2.CommentReferenceIntegrity.allCommentSidesPass
  simp only [Bool.and_eq_true]
  exact ⟨⟨hSide .original, hSide .revised⟩, hSide .compared⟩

def semanticNoteRequestOfCoreV6 (request : RunRequestCoreRequestV6) :
    VerifierRequestV5 :=
  semanticRequestOfCore request

def buildRunRequestCoreV6Response (request : RunRequestCoreRequestV6)
    (semanticResponse : VerifierResponseV5) : Bool × Json :=
  buildRunRequestCoreResponse request semanticResponse

def finishRunRequestCoreV6 (request : RunRequestCoreRequestV6)
    (semanticRequest : VerifierRequestV5)
    (semanticResponse : VerifierResponseV5) (semanticStdout : ByteArray) :
    Except String RunRequestCoreResultV6 :=
  let (responsePassed, response) :=
    buildRunRequestCoreV6Response request semanticResponse
  match finalizeProtocolV6Response response responsePassed with
  | .error detail => .error detail
  | .ok stdout =>
      .ok {
        responsePassed := responsePassed
        response := response
        stdout := stdout
        semanticRequest := semanticRequest
        semanticResponse := semanticResponse
        semanticStdout := semanticStdout
        typedProjectionCheck :=
          protocolV6JsonProjectionCheck response responsePassed }

def protocolV6Projection (request : RunRequestCoreRequestV6)
    (semanticResponse : VerifierResponseV5) : Json :=
  semanticProtocolV6Projection request semanticResponse

def typedBoundedBytesOfByteArray (value : ByteArray) : BoundedBytes :=
  let bytes := value.toList
  { bytes, limit := bytes.length, admitted := Nat.le_refl _ }

def typedEntryOfProduction (entry : ZipEntry) : TypedEntry := {
  name := typedBoundedBytesOfString entry.name
  flags := entry.flags
  method := entry.method
  crc32 := entry.crc32
  compressedSize := entry.compressedSize
  expandedSize := entry.expandedSize
  localHeaderOffset := entry.localHeaderOffset
  dataOffset := entry.dataOffset
  localSpanEnd := entry.localSpanEnd
  isDirectory := entry.isDirectory
}

def typedIndexOfProduction (index : ZipIndex) : TypedPackageIndex := {
  entries := index.entries.map typedEntryOfProduction
  centralOffset := index.centralOffset
  centralSize := index.centralSize
}

def typedRelationshipModeOfProduction
    (record : RelationshipRecord) : RelationshipMode :=
  if record.targetMode == some "External" then .external
  else if record.targetMode.isNone ||
      record.targetMode == some "Internal" then .internal
  else .invalid

def typedRelationshipOfProduction
    (record : RelationshipRecord) (ordinal : Nat) : TypedRelationship := {
  ordinal
  relationshipType := typedBoundedBytesOfString record.relationshipType
  relationshipId := typedBoundedBytesOfString record.id
  rawTarget := typedBoundedBytesOfString record.rawTarget
  rawTargetMode := record.targetMode.map typedBoundedBytesOfString
  normalizedTarget :=
    (Tier2.CommentReferenceIntegrity.normalizeRelationshipTarget
      record.rawTarget).toOption.map typedBoundedBytesOfString
  mode := typedRelationshipModeOfProduction record
}

def typedRelationshipsOfProduction
    (records : List RelationshipRecord) : List TypedRelationship :=
  records.zipIdx.map fun pair =>
    typedRelationshipOfProduction pair.1 pair.2

def typedParsedPartOfProduction
    (evidence : ProductionParseEvidence) : TypedParsedPart := {
  rawBytes := evidence.bytes
  expectedRootUri := typedBoundedBytesOfString evidence.expectedRootUri
  expectedRootLocalName :=
    typedBoundedBytesOfString evidence.expectedRootLocalName
  events := evidence.parsed.events.zipIdx.map fun item =>
    typedXmlEventOfProduction item.2 item.1
  depthLimit := evidence.depthLimit
  eventLimit := evidence.eventLimit
}

def typedStorySourceOfProduction (side : Side)
    (source : NoteSource) : TypedStorySource := {
  side
  sourceOrdinal := source.sourceOrdinal
  partPath := typedBoundedBytesOfString source.normalizedPartPath
  parsed := typedParsedPartOfProduction source.parseEvidence
}

def emptyTypedParsedPart : TypedParsedPart := {
  rawBytes := ByteArray.empty
  expectedRootUri := typedBoundedBytesOfString ""
  expectedRootLocalName := typedBoundedBytesOfString ""
  events := []
  depthLimit := 0
  eventLimit := 0
}

def missingTypedMainSource (side : Side) : TypedStorySource := {
  side
  sourceOrdinal := 0
  partPath := typedBoundedBytesOfString ""
  parsed := emptyTypedParsedPart
}

def typedSourceKindOfProduction (source : NoteSource) : TypedSourceKind :=
  if source.sourceStory == "header" then .header
  else if source.sourceStory == "footer" then .footer
  else if source.sourceStory == "footnotes" then .footnotes
  else if source.sourceStory == "endnotes" then .endnotes
  else .main

def typedSourceSlotOfProduction (side : Side)
    (source : NoteSource) : TypedSourceSlot := {
  kind := typedSourceKindOfProduction source
  physicalStoryOrdinal := source.sourceStoryOrdinal
  source := typedStorySourceOfProduction side source
}

def typedHeaderFooterKindOfProduction :
    Tier2.RelationshipStorySelector.StoryKind → TypedSourceKind
  | .header => .header
  | .footer => .footer

def typedHeaderFooterSlotOfProduction
    (slot : AlignedSlot) : TypedHeaderFooterSlot := {
  slotOrdinal := slot.slotOrdinal
  physicalStoryOrdinal := slot.physicalStoryOrdinal
  kind := typedHeaderFooterKindOfProduction slot.kind
  originalPartPath := typedBoundedBytesOfString
    slot.original.normalizedPartPath
  revisedPartPath := typedBoundedBytesOfString
    slot.revised.normalizedPartPath
  comparedPartPath := typedBoundedBytesOfString
    slot.compared.normalizedPartPath
}

def physicalStoryPathForTypedSide
    (story : PhysicalStory) : Side → String
  | .original => story.originalPartPath
  | .revised => story.revisedPartPath
  | .compared => story.comparedPartPath

def typedHeaderFooterStoryOfProduction
    (side : Side) (sources : List NoteSource)
    (story : PhysicalStory) : TypedHeaderFooterStory := {
  physicalStoryOrdinal := story.physicalStoryOrdinal
  kind := typedHeaderFooterKindOfProduction story.kind
  partPath := typedBoundedBytesOfString
    (physicalStoryPathForTypedSide story side)
  originalPartPath := typedBoundedBytesOfString story.originalPartPath
  revisedPartPath := typedBoundedBytesOfString story.revisedPartPath
  comparedPartPath := typedBoundedBytesOfString story.comparedPartPath
  selectingSlotOrdinals := story.selectingSlotOrdinals
  source := (sources.find? fun source =>
    source.sourceStoryOrdinal = story.physicalStoryOrdinal &&
    source.sourceStory = story.kind.toString).map
      (typedStorySourceOfProduction side)
}

def typedNoteSelectionOfProduction
    (side : Side) (evidence : NoteSideEvidence)
    (sources : List NoteSource) (kind : NoteKind) : TypedNoteSelection :=
  let identity := if kind == .footnotes then
    evidence.footnotesIdentity else evidence.endnotesIdentity
  let present := if kind == .footnotes then
    evidence.footnotesPartPresent else evidence.endnotesPartPresent
  {
    kind := if kind == .footnotes then .footnotes else .endnotes
    relationshipSelected := identity.isSome
    referencePresent := evidence.retainedScan.map
      (fun retained =>
        retained.output.scan.references.any
          (fun reference => reference.kind == kind)) |>.getD false
    selectedPartPath := identity.map fun value =>
      typedBoundedBytesOfString value.normalizedPartPath
    partPresent := present
    source := (sources.find? fun source =>
      source.sourceStory = kind.toString).map
        (typedStorySourceOfProduction side)
  }

def typedPriorSourceAdmissionOfProduction
    (request : RunRequestCoreRequestV6)
    (evidence : NoteSideEvidence) : TypedPriorSourceAdmission :=
  if !request.selectionIssues.isEmpty then
    .relationshipSelectionFailure
  else if evidence.retainedScan.isNone then
    .storyRealizationFailure
  else if evidence.semanticLimitCrossed then
    .resourceFailure
  else if !evidence.complete then
    .noteSemanticFailure
  else
    .admitted

def typedSelectedCommentOfProduction
    (selected : SelectedCommentIdentity) : TypedSelectedComment := {
  relationshipOrdinal := selected.relationshipRecordOrdinal
  relationshipId := typedBoundedBytesOfString selected.relationshipId
  normalizedPartPath :=
    typedBoundedBytesOfString selected.normalizedPartPath
}

def typedExtractionOfProduction
    (evidence : SnapshotExtractionEvidence) : TypedExtraction := {
  packageBytes := evidence.packageBytes
  snapshotBytes := evidence.snapshotBytes
  entry := typedEntryOfProduction evidence.entry
  compressedSlice := evidence.compressedPayload
  expandedBytes := evidence.decompressedBytes
}

def typedCommentRealizationOfProduction
    (part : LoadedCommentPart) : TypedCommentRealization := {
  selected := typedSelectedCommentOfProduction part.identity
  entry := typedEntryOfProduction part.parseEvidence.extraction.entry
  extraction := typedExtractionOfProduction part.parseEvidence.extraction
  retainedParsedEvents :=
    part.parseEvidence.parsed.events.zipIdx.map fun item =>
      typedXmlEventOfProduction item.2 item.1
  parsed := typedParsedPartOfProduction part.parseEvidence
}

def typedCanonicalIdOfRaw (raw : Option String) :
    Option TypedCanonicalId :=
  raw.bind Tier2.CommentReferenceIntegrity.parseBoundedDecimalId |>.map
    fun key => { negative := key.negative, digits := key.digits }

def typedReferenceOfProduction
    (reference : CommentReferenceOccurrence) : TypedReference := {
  sourceOrdinal := reference.sourceOrdinal
  occurrenceOrdinal := reference.occurrenceOrdinal
  rawId := reference.rawId.map typedBoundedBytesOfString
  canonicalId := typedCanonicalIdOfRaw reference.rawId
}

def typedDefinitionOfProduction
    (definition : CommentDefinitionOccurrence) : TypedDefinition := {
  occurrenceOrdinal := definition.occurrenceOrdinal
  rawId := definition.rawId.map typedBoundedBytesOfString
  canonicalId := typedCanonicalIdOfRaw definition.rawId
  direct := definition.direct
}

def typedScanCrossingOfProduction :
    Tier2.CommentReferenceIntegrity.CommentScanCrossing → TypedScanCrossing
  | Tier2.CommentReferenceIntegrity.CommentScanCrossing.references
      sourceOrdinal occurrenceOrdinal =>
      TypedScanCrossing.references sourceOrdinal occurrenceOrdinal
  | Tier2.CommentReferenceIntegrity.CommentScanCrossing.uniqueIds
      sourceOrdinal occurrenceOrdinal canonicalId =>
      TypedScanCrossing.uniqueIds sourceOrdinal occurrenceOrdinal
        ((typedCanonicalIdOfRaw (some canonicalId)).getD
          { negative := false, digits := [] })
  | Tier2.CommentReferenceIntegrity.CommentScanCrossing.definitions
      occurrenceOrdinal =>
      TypedScanCrossing.definitions occurrenceOrdinal
  | Tier2.CommentReferenceIntegrity.CommentScanCrossing.nonDirectDefinitions
      occurrenceOrdinal =>
      TypedScanCrossing.nonDirectDefinitions occurrenceOrdinal

def typedCommentScanOfProduction
    (evidence : CommentSideEvidence) : TypedCommentScan :=
  match evidence.retainedScan with
  | none => emptyTypedCommentScan
  | some retained => {
      references := retained.output.scan.references.map
        typedReferenceOfProduction
      definitions := retained.output.scan.definitions.map
        typedDefinitionOfProduction
      nonDirectDefinitions :=
        retained.output.scan.nonDirectDefinitions.map
          typedDefinitionOfProduction
      crossing := retained.output.crossing.map typedScanCrossingOfProduction
    }

def typedScanInputOfRecord (record : RunRequestPackageRecord) :
    TypedScanInput :=
  let admittedScan := record.commentEvidence.retainedScan.isSome
  {
    wmlNamespace := typedBoundedBytesOfString wmlNamespace
    idLocalName := typedBoundedBytesOfString "id"
    referenceLocalName := typedBoundedBytesOfString "commentReference"
    definitionLocalName := typedBoundedBytesOfString "comment"
    sourceEvents := if admittedScan then
      record.commentEvidence.sources.map fun source =>
        (source.sourceOrdinal,
          source.parseEvidence.parsed.events.zipIdx.map fun item =>
            typedXmlEventOfProduction item.2 item.1)
      else []
    definitionEvents := if admittedScan then
      record.commentEvidence.part.map (fun part =>
        part.parseEvidence.parsed.events.zipIdx.map fun item =>
          typedXmlEventOfProduction item.2 item.1) |>.getD []
      else []
  }

def productionTypedCommentScanCheck
    (record : RunRequestPackageRecord) : Bool :=
  decide (typedCommentScanOfProduction record.commentEvidence =
    scanTypedCommentEvidence (typedScanInputOfRecord record))

theorem production_typed_comment_scan_check_sound
    (record : RunRequestPackageRecord)
    (h : productionTypedCommentScanCheck record = true) :
    typedCommentScanOfProduction record.commentEvidence =
      scanTypedCommentEvidence (typedScanInputOfRecord record) := by
  exact of_decide_eq_true h

theorem typedCommentScanOfProduction_reference_length
    (evidence : CommentSideEvidence) :
    (typedCommentScanOfProduction evidence).references.length =
      (evidence.retainedScan.map
        (·.output.scan.references.length)).getD 0 := by
  unfold typedCommentScanOfProduction
  cases evidence.retainedScan <;> simp [emptyTypedCommentScan]

def typedPackageViewOfRecord (side : Side)
    (request : RunRequestCoreRequestV6)
    (record : RunRequestPackageRecord) : TypedPackageView := {
  packageBytes := record.packageBytes
  index := typedIndexOfProduction record.packageIndex
  commentType :=
    typedBoundedBytesOfString
      Tier2.CommentReferenceIntegrity.commentsRelationshipType
  commentsRootNamespace := typedBoundedBytesOfString wmlNamespace
  commentsRootLocalName := typedBoundedBytesOfString "comments"
  relationships := typedRelationshipsOfProduction record.relationships
  mainSource := (record.commentEvidence.sources.find?
      (fun source => source.sourceStory == "main")).map
      (typedStorySourceOfProduction side) |>.getD
        (missingTypedMainSource side)
  headerFooterSlots :=
    request.relationshipSlots.map typedHeaderFooterSlotOfProduction
  headerFooterStories := request.relationshipStories.map
    (typedHeaderFooterStoryOfProduction side record.commentEvidence.sources)
  noteSelections :=
    [ typedNoteSelectionOfProduction side record.noteEvidence
        record.commentEvidence.sources .footnotes
    , typedNoteSelectionOfProduction side record.noteEvidence
        record.commentEvidence.sources .endnotes
    ]
  priorSourceAdmission :=
    typedPriorSourceAdmissionOfProduction request record.noteEvidence
  realizationFailure := record.commentEvidence.realizationFailureCode.bind
    fun code =>
      if code == "COMMENT_PART_MISSING" then some .partMissing
      else if code == "COMMENT_SELECTED_PART_LIMIT_EXCEEDED" then some .selectedPartLimit
      else if code == "COMMENT_TRIPLE_SELECTED_PART_LIMIT_EXCEEDED" then some .tripleSelectedPartLimit
      else if code == "COMMENT_PART_COMPRESSED_LIMIT_EXCEEDED" then some .partCompressedLimit
      else if code == "COMMENT_PART_EXPANDED_LIMIT_EXCEEDED" then some .partExpandedLimit
      else if code == "COMMENT_PART_RATIO_LIMIT_EXCEEDED" then some .partRatioLimit
      else if code == "COMMENT_CUMULATIVE_COMPRESSED_LIMIT_EXCEEDED" then some .cumulativeCompressedLimit
      else if code == "COMMENT_CUMULATIVE_EXPANDED_LIMIT_EXCEEDED" then some .cumulativeExpandedLimit
      else if code == "COMMENT_TRIPLE_COMPRESSED_LIMIT_EXCEEDED" then some .tripleCompressedLimit
      else if code == "COMMENT_TRIPLE_EXPANDED_LIMIT_EXCEEDED" then some .tripleExpandedLimit
      else if code == "COMMENT_PART_EXTRACTION_FAILED" then some .extractionFailed
      else if code == "COMMENT_PART_INVALID_UTF8" then some .invalidUtf8
      else if code == "COMMENT_PART_INVALID_XML" then some .invalidXml
      else if code == "COMMENT_PART_XML_DEPTH_LIMIT_EXCEEDED" then some .xmlDepthLimit
      else if code == "COMMENT_PART_XML_EVENT_LIMIT_EXCEEDED" then some .xmlEventLimit
      else if code == "COMMENT_CUMULATIVE_XML_EVENT_LIMIT_EXCEEDED" then some .cumulativeXmlEventLimit
      else if code == "COMMENT_TRIPLE_XML_EVENT_LIMIT_EXCEEDED" then some .tripleXmlEventLimit
      else if code == "COMMENT_PART_ROOT_MISMATCH" then some .rootMismatch
      else none
  realizationFailureDetail :=
    record.commentEvidence.realizationFailureDetail.map
      typedBoundedBytesOfString
  selectedPartPresent := record.commentEvidence.partPresent
  realization := record.commentEvidence.part.map
    typedCommentRealizationOfProduction
  retainedScan := typedCommentScanOfProduction record.commentEvidence
}

def typedInheritedV5OfJson (response : Json) (passed : Bool) :
    TypedInheritedV5Evaluation := {
  passed
  fixedStories := typedJsonOfProduction
    (jsonFieldOrNull response "fixedStories")
  presenceMismatches := typedJsonOfProduction
    (jsonFieldOrNull response "presenceMismatches")
  fixedStoryIssues := typedJsonOfProduction
    (jsonFieldOrNull response "fixedStoryIssues")
  relationshipSlots := typedJsonOfProduction
    (jsonFieldOrNull response "relationshipSlots")
  relationshipStories := typedJsonOfProduction
    (jsonFieldOrNull response "relationshipStories")
  selectionIssues := typedJsonOfProduction
    (jsonFieldOrNull response "selectionIssues")
  referenceSourcePartitions := typedJsonOfProduction
    (jsonFieldOrNull response "referenceSourcePartitions")
  noteStories := typedJsonOfProduction
    (jsonFieldOrNull response "noteStories")
  noteInventories := typedJsonOfProduction
    (jsonFieldOrNull response "noteInventories")
  noteIntegrityIssues := typedJsonOfProduction
    (jsonFieldOrNull response "noteIntegrityIssues")
}

def typedInheritedV5OfSemanticEvaluation
    (request : RunRequestCoreRequestV6)
    (semanticResponse : VerifierResponseV5) : TypedInheritedV5Evaluation :=
  let fields := SemanticProtocolSpec.fields request semanticResponse
  typedInheritedV5OfJson (SemanticProtocolSpec.encode fields) fields.passed

def typedInheritedV5OfOperationalRequest
    (request : RunRequestCoreRequestV6)
    (semanticResponse : VerifierResponseV5) : TypedInheritedV5Evaluation :=
  let fixedReports := checkStoryCollection request.fixedTriples
  let selectedReports := checkStoryCollection request.relationshipTriples
  let noteSides := [request.original.noteEvidence,
    request.revised.noteEvidence, request.compared.noteEvidence]
  let noteIssues :=
    coalesceNoteIssues (noteSides.flatMap (·.issues)) |>.mergeSort noteIssueLess
  {
    passed := runRequestCorePass request semanticResponse
    fixedStories := typedJsonOfProduction <| Json.arr
      (fixedReports.map storyReportJson).toArray
    presenceMismatches := .array []
    fixedStoryIssues := .array []
    relationshipSlots := typedJsonOfProduction <| Json.arr
      (request.relationshipSlots.map slotJson).toArray
    relationshipStories := typedJsonOfProduction <| Json.arr
      ((List.zip request.relationshipStories selectedReports).map fun pair =>
        physicalStoryJson pair.1 pair.2).toArray
    selectionIssues := typedJsonOfProduction <| Json.arr
      (request.selectionIssues.eraseDups.mergeSort issueLess
        |>.map selectionIssueJson).toArray
    referenceSourcePartitions := typedJsonOfProduction <| Json.arr
      (noteSides.map partitionJson).toArray
    noteStories := typedJsonOfProduction <| Json.arr
      [noteStoryJson .footnotes noteSides,
       noteStoryJson .endnotes noteSides].toArray
    noteInventories := typedJsonOfProduction <| Json.arr
      (noteSides.flatMap fun evidence =>
        [inventoryJson evidence.footnotesInventory,
         inventoryJson evidence.endnotesInventory]).toArray
    noteIntegrityIssues := typedJsonOfProduction <| Json.arr
      noteIssues.toArray
  }

def typedRequestOfProduction (request : RunRequestCoreRequestV6)
    (result : RunRequestCoreResultV6) : Except String TypedRequestV6 := do
  return {
    original := typedPackageViewOfRecord .original request request.original
    revised := typedPackageViewOfRecord .revised request request.revised
    compared := typedPackageViewOfRecord .compared request request.compared
    inherited :=
      typedInheritedV5OfOperationalRequest request result.semanticResponse
  }

def TypedRequestOfProduction (request : RunRequestCoreRequestV6)
    (result : RunRequestCoreResultV6) (typedRequest : TypedRequestV6) : Prop :=
  typedRequestOfProduction request result = .ok typedRequest ∧
  typedRequest.original =
    typedPackageViewOfRecord .original request request.original ∧
  typedRequest.revised =
    typedPackageViewOfRecord .revised request request.revised ∧
  typedRequest.compared =
    typedPackageViewOfRecord .compared request request.compared ∧
  typedRequest.inherited =
    typedInheritedV5OfOperationalRequest request result.semanticResponse ∧
  typedRequest.original.packageBytes = request.original.packageBytes ∧
  typedRequest.revised.packageBytes = request.revised.packageBytes ∧
  typedRequest.compared.packageBytes = request.compared.packageBytes ∧
  typedRequest.original.index =
    typedIndexOfProduction request.original.packageIndex ∧
  typedRequest.revised.index =
    typedIndexOfProduction request.revised.packageIndex ∧
  typedRequest.compared.index =
    typedIndexOfProduction request.compared.packageIndex ∧
  typedRequest.original.retainedScan.references.length =
    (request.original.commentEvidence.retainedScan.map
      (·.output.scan.references.length)).getD 0 ∧
  typedRequest.revised.retainedScan.references.length =
    (request.revised.commentEvidence.retainedScan.map
      (·.output.scan.references.length)).getD 0 ∧
  typedRequest.compared.retainedScan.references.length =
    (request.compared.commentEvidence.retainedScan.map
      (·.output.scan.references.length)).getD 0 ∧
  typedRequest.original.retainedScan =
    scanTypedCommentEvidence (typedScanInputOfRecord request.original) ∧
  typedRequest.revised.retainedScan =
    scanTypedCommentEvidence (typedScanInputOfRecord request.revised) ∧
  typedRequest.compared.retainedScan =
    scanTypedCommentEvidence (typedScanInputOfRecord request.compared)

def ProductionRunRequestV6RefinesSemanticOf
    (request : RunRequestCoreRequestV6)
    (result : RunRequestCoreResultV6) : Prop :=
  ProductionRunRequestRefinesSemanticOf request result ∧
  ∃ (packageEvidence :
        ProductionPackageRecordOf request.original ∧
        ProductionPackageRecordOf request.revised ∧
        ProductionPackageRecordOf request.compared)
      (commentEvidence :
        ProductionCommentEvidenceOf request.original ∧
        ProductionCommentEvidenceOf request.revised ∧
        ProductionCommentEvidenceOf request.compared)
      (hPrior :
        (commentResourceUsageOfCore request).tripleXmlEvents ≤ 3000000)
      (hSources : ∀ side,
        Tier2.CommentReferenceIntegrity.completeCommentSourceSetCheck
          (commentPackageViewOfCore request side) side
          (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
            (packageViewOfRecord
              (request.packageRecord (noteSideOfCommentSide side)))
            (noteSideOfCommentSide side)
            (selectedStoriesOfRecord
              (request.packageRecord (noteSideOfCommentSide side)))) = true),
    let semanticRequest := semanticRequestOfCoreV6 request packageEvidence
      commentEvidence hPrior hSources
    let global :=
      Tier2.CommentReferenceIntegrity.evaluateAllCommentSidesV6 semanticRequest
    let response :=
      Tier2.CommentReferenceIntegrity.canonicalVerifierResponseV6 semanticRequest
    (∀ side,
      semanticRequest.packageView side =
        (semanticRequest.retainedPackageRecord side).view ∧
      (semanticRequest.packageView side).packageBytes =
        (semanticRequest.retainedPackageRecord side).packageBytes ∧
      (semanticRequest.packageView side).index =
        (semanticRequest.retainedPackageRecord side).index) ∧
    (∀ side,
      ProductionCommentSemanticProjectionOf request side) ∧
    (∀ side,
      retainedParsedCommentEvidenceOfProduction request side =
        .ok (parsedCommentEvidenceOfProduction request side)) ∧
    (∀ side,
      retainedCommentScanInputOfProduction request side =
        .ok (semanticCommentScanInputOfCore request side)) ∧
    Tier2.CommentReferenceIntegrity.allCommentSidesPass global = true ∧
    response.global = global ∧
    (∀ side,
      Tier2.CommentReferenceIntegrity.SelectionToCommentRealizationOf
        semanticRequest side (response.commentOutcome side)
        (response.commentRealization side)
        (response.commentParsedEvidence side)) ∧
    (∀ side,
      Tier2.CommentReferenceIntegrity.ResponseRetainedCommentEvidenceOf
        semanticRequest response side) ∧
    Tier2.CommentReferenceIntegrity.CommentAggregatePassOf
      semanticRequest response ∧
    result.response =
      protocolV6Projection request result.semanticResponse ∧
    SemanticProtocolV6ProjectionOf
      request result.semanticResponse result.response ∧
    FinalizedProtocolV6ResponseOf result.response result.responsePassed
      result.stdout ∧
    ∃ typedRequest typedResponse canonicalBytes,
      TypedRequestOfProduction request result typedRequest ∧
      typedResponse = canonicalTypedResponseV6 typedRequest ∧
      TypedCommentAggregatePassOf typedRequest typedResponse ∧
      TypedSerializedResponseV6Of typedResponse canonicalBytes ∧
      ProtocolV6JsonProjectionOf result.response result.responsePassed
        typedResponse ∧
      result.response.compress.toUTF8.data.toList = canonicalBytes ∧
      result.stdout.data.toList = canonicalBytes ++ [UInt8.ofNat 10]

def productionTypedCommentChecks
    (request : RunRequestCoreRequestV6) (result : RunRequestCoreResultV6) : Bool :=
  productionTypedCommentScanCheck request.original &&
  productionTypedCommentScanCheck request.revised &&
  productionTypedCommentScanCheck request.compared &&
  match typedRequestOfProduction request result with
  | .error _ => false
  | .ok typedRequest =>
      let typedResponse := canonicalTypedResponseV6 typedRequest
      let canonicalBytes := independentProtocolV6Projection typedResponse
      let canonicalByteArray : ByteArray := ⟨canonicalBytes.toArray⟩
      match typedProtocolV6ResponseOfJson
          result.response result.responsePassed with
      | .error _ => false
      | .ok projected =>
          decide (independentProtocolV6Projection projected =
            independentProtocolV6Projection typedResponse) &&
          decide (result.response.compress.toUTF8 = canonicalByteArray) &&
          decide (result.stdout = canonicalByteArray.push (UInt8.ofNat 10))

def firstByteMismatch : List UInt8 → List UInt8 → Nat →
    Option (Nat × Option UInt8 × Option UInt8)
  | [], [], _ => none
  | [], right :: _, ordinal => some (ordinal, none, some right)
  | left :: _, [], ordinal => some (ordinal, some left, none)
  | left :: leftRest, right :: rightRest, ordinal =>
      if left == right then firstByteMismatch leftRest rightRest (ordinal + 1)
      else some (ordinal, some left, some right)

def typedEntryAdmissionDiagnostic (pkg : TypedPackageView)
    (entry : TypedEntry) : String :=
  let nameLength := typedUInt16At? pkg.packageBytes
    (entry.localHeaderOffset + 26)
  let extraLength := typedUInt16At? pkg.packageBytes
    (entry.localHeaderOffset + 28)
  s!"name={String.fromUTF8? ⟨entry.name.bytes.toArray⟩}; " ++
  s!"directory={entry.isDirectory}; safe={typedSafeEntryNameCheck entry.name entry.isDirectory}; " ++
  s!"signature={typedLocalHeaderSignatureCheck pkg.packageBytes entry.localHeaderOffset}; " ++
  s!"localFlags={typedUInt16At? pkg.packageBytes (entry.localHeaderOffset + 6)} centralFlags={entry.flags}; " ++
  s!"localMethod={typedUInt16At? pkg.packageBytes (entry.localHeaderOffset + 8)} centralMethod={entry.method}; " ++
  s!"localNameLength={nameLength} centralNameLength={entry.name.bytes.length}; " ++
  s!"localExtraLength={extraLength}; dataOffset={entry.dataOffset}; " ++
  s!"spanEnd={entry.localSpanEnd}; compressed={entry.compressedSize}; centralOffset={pkg.index.centralOffset}"

def typedPackageAdmissionDiagnostic (pkg : TypedPackageView) : String :=
  let invalidEntry := pkg.index.entries.find? fun entry =>
    !typedEntryLocalHeaderCheck pkg.packageBytes pkg.index entry
  match selectTypedComment pkg.commentType pkg.relationships, pkg.realization with
  | .ok (some selected), some realization =>
      s!"index={typedBinaryIndexCheck pkg.packageBytes pkg.index}; " ++
      s!"entries={pkg.index.entries.length}; invalidEntry=({invalidEntry.map (typedEntryAdmissionDiagnostic pkg)}); " ++
      s!"selected={typedSelectedEntryCheck pkg.index selected.normalizedPartPath realization.entry}; " ++
      s!"extraction={typedExtractionCheck pkg.packageBytes pkg.index realization.entry realization.extraction}; " ++
      s!"parsed={typedParsedPartCheck realization.extraction pkg.commentsRootNamespace pkg.commentsRootLocalName realization.retainedParsedEvents realization.parsed}"
  | _, realization =>
      s!"selectedAdmission=false; realizationPresent={realization.isSome}"

def productionTypedMismatchDetail
    (request : RunRequestCoreRequestV6)
    (result : RunRequestCoreResultV6) : String :=
  match typedRequestOfProduction request result with
  | .error detail => s!"typed request construction failed: {detail}"
  | .ok typedRequest =>
      let expected :=
        independentProtocolV6Projection
          (canonicalTypedResponseV6 typedRequest)
      let actual := result.response.compress.toUTF8.data.toList
      match firstByteMismatch actual expected 0 with
      | none => "stdout differs after canonical JSON equality"
      | some (ordinal, left, right) =>
          let start := ordinal - min ordinal 32
          let actualContext :=
            String.fromUTF8? ⟨(actual.drop start |>.take 96).toArray⟩
          let typedContext :=
            String.fromUTF8? ⟨(expected.drop start |>.take 96).toArray⟩
          s!"canonical JSON differs at byte {ordinal}; actual={left.map UInt8.toNat}; typed={right.map UInt8.toNat}; actualLength={actual.length}; typedLength={expected.length}; actualContext={actualContext}; typedContext={typedContext}; originalAdmission=({typedPackageAdmissionDiagnostic typedRequest.original}); revisedAdmission=({typedPackageAdmissionDiagnostic typedRequest.revised}); comparedAdmission=({typedPackageAdmissionDiagnostic typedRequest.compared})"

def runRequestCoreV6 (request : RunRequestCoreRequestV6) :
    Except String RunRequestCoreResultV6 :=
  match runRequestCore request with
  | .error detail => .error detail
  | .ok result =>
      if productionTypedCommentChecks request result then .ok result
      else .error
        (productionTypedMismatchDetail request result)

theorem run_request_core_v6_base
    (request : RunRequestCoreRequestV6) (result : RunRequestCoreResultV6)
    (hRun : runRequestCoreV6 request = .ok result) :
    runRequestCore request = .ok result := by
  unfold runRequestCoreV6 at hRun
  cases hBase : runRequestCore request with
  | error detail =>
      simp [hBase] at hRun
  | ok base =>
      cases hChecks : productionTypedCommentChecks request base
      · simp only [hBase, hChecks, ↓reduceIte] at hRun
        contradiction
      · simp only [hBase, hChecks, ↓reduceIte] at hRun
        change (Except.ok base :
          Except String RunRequestCoreResultV6) = .ok result at hRun
        cases hRun
        rfl

theorem run_request_core_v6_typed_scans
    (request : RunRequestCoreRequestV6) (result : RunRequestCoreResultV6)
    (hRun : runRequestCoreV6 request = .ok result) :
    productionTypedCommentChecks request result = true := by
  unfold runRequestCoreV6 at hRun
  cases hBase : runRequestCore request with
  | error detail =>
      simp [hBase] at hRun
  | ok base =>
      cases hChecks : productionTypedCommentChecks request base
      · simp only [hBase, hChecks, ↓reduceIte] at hRun
        contradiction
      · simp only [hBase, hChecks, ↓reduceIte] at hRun
        cases hRun
        exact hChecks

set_option maxHeartbeats 1000000 in
theorem run_request_core_v6_ok_operational_pass
    (request : RunRequestCoreRequestV6) (result : RunRequestCoreResultV6)
    (hRun : runRequestCoreV6 request = .ok result) :
    runRequestCorePass request result.semanticResponse =
      result.responsePassed := by
  have hBase := run_request_core_v6_base request result hRun
  cases hReady : coreSemanticAdmissionReady request
  · let semanticRequest := semanticRequestOfCore request
    let semanticResponse := failedSemanticResponse semanticRequest
    cases hFinalize : _root_.finalizeProtocolV6Response
        (buildRunRequestCoreResponse request semanticResponse).2
        (buildRunRequestCoreResponse request semanticResponse).1 with
    | error detail =>
        dsimp only [semanticResponse, semanticRequest] at hFinalize
        simp [semanticNoteRequestOfCoreV6, hReady,
          runRequestCore, finishRunRequestCore, hFinalize] at hBase
    | ok stdout =>
        dsimp only [semanticResponse, semanticRequest] at hFinalize
        simp [semanticNoteRequestOfCoreV6, hReady,
          runRequestCore, finishRunRequestCore, hFinalize] at hBase
        cases hBase
        rfl
  · cases hVerify : Tier2.NoteReferenceIntegrity.canonicalSemanticResponse
        (semanticRequestOfCore request) with
    | error detail =>
        simp [semanticNoteRequestOfCoreV6, hReady,
          runRequestCore, hVerify] at hBase
    | ok semanticResult =>
        rcases semanticResult with ⟨semanticResponse, semanticStdout⟩
        cases hFinalize : _root_.finalizeProtocolV6Response
            (buildRunRequestCoreResponse request semanticResponse).2
            (buildRunRequestCoreResponse request semanticResponse).1 with
        | error detail =>
            simp [semanticNoteRequestOfCoreV6, hReady,
              hVerify, runRequestCore, finishRunRequestCore, hFinalize] at hBase
        | ok stdout =>
            simp [semanticNoteRequestOfCoreV6, hReady,
              hVerify, runRequestCore, finishRunRequestCore, hFinalize] at hBase
            cases hBase
            rfl

theorem production_run_request_core_v6_refinement_sound
    (request : RunRequestCoreRequestV6) (result : RunRequestCoreResultV6)
    (hRun : runRequestCoreV6 request = .ok result)
    (hPass : result.responsePassed = true) :
    ProductionRunRequestV6RefinesSemanticOf request result := by
  have hOld := production_run_request_core_refinement_sound request result
    (run_request_core_v6_base request result hRun) hPass
  let packageEvidence :
      ProductionPackageRecordOf request.original ∧
      ProductionPackageRecordOf request.revised ∧
      ProductionPackageRecordOf request.compared :=
    ⟨hOld.1, hOld.2.1, hOld.2.2.1⟩
  let commentEvidence :
      ProductionCommentEvidenceOf request.original ∧
      ProductionCommentEvidenceOf request.revised ∧
      ProductionCommentEvidenceOf request.compared :=
    ⟨hOld.2.2.2.1, hOld.2.2.2.2.1, hOld.2.2.2.2.2.1⟩
  have hCorePass : runRequestCorePass request result.semanticResponse = true := by
    exact (run_request_core_v6_ok_operational_pass request result hRun).trans hPass
  have hPrior :=
    run_request_core_pass_comment_global_admission request
      result.semanticResponse hCorePass
  have hSources := fun side =>
    run_request_core_pass_comment_source_set request result.semanticResponse
      side hCorePass
  have hSelectors := fun side =>
    run_request_core_pass_comment_selector_exact request
      result.semanticResponse side hCorePass
  have hParsed := fun side =>
    run_request_core_pass_retained_comment_scan request
      result.semanticResponse side hCorePass
  have hScanInputs := fun side =>
    run_request_core_pass_retained_comment_scan_input request
      result.semanticResponse side hCorePass
  let semanticRequest := semanticRequestOfCoreV6 request packageEvidence
    commentEvidence hPrior hSources
  let global :=
    Tier2.CommentReferenceIntegrity.evaluateAllCommentSidesV6 semanticRequest
  let response :=
    Tier2.CommentReferenceIntegrity.canonicalVerifierResponseV6 semanticRequest
  have hAllPass :=
    semantic_request_of_core_v6_all_comment_sides_pass request packageEvidence
      commentEvidence hPrior hSources hSelectors hParsed hScanInputs
  have hAggregate :
      Tier2.CommentReferenceIntegrity.CommentAggregatePassOf
        semanticRequest response := by
    exact Tier2.CommentReferenceIntegrity.canonical_verifier_response_v6_aggregate_pass
      semanticRequest hAllPass
  have hSelections : ∀ side,
      Tier2.CommentReferenceIntegrity.SelectionToCommentRealizationOf
        semanticRequest side (response.commentOutcome side)
        (response.commentRealization side)
        (response.commentParsedEvidence side) := by
    rcases hAggregate with ⟨_, _, _, _, _, hExact, _, _⟩
    exact hExact
  have hRetained : ∀ side,
      Tier2.CommentReferenceIntegrity.ResponseRetainedCommentEvidenceOf
        semanticRequest response side := by
    rcases hAggregate with ⟨_, _, _, _, _, _, hExact, _⟩
    exact hExact
  have hProtocol :
      SemanticProtocolV6ProjectionOf
        request result.semanticResponse result.response := by
    rcases hOld with
      ⟨_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, hExact, _⟩
    exact hExact
  have hFinalized :
      FinalizedProtocolV6ResponseOf result.response result.responsePassed
        result.stdout := by
    rcases hOld with
      ⟨_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, hExact⟩
    exact hExact
  have hTypedChecks :=
    run_request_core_v6_typed_scans request result hRun
  unfold productionTypedCommentChecks at hTypedChecks
  simp only [Bool.and_eq_true] at hTypedChecks
  let typedRequest : TypedRequestV6 := {
    original := typedPackageViewOfRecord .original request request.original
    revised := typedPackageViewOfRecord .revised request request.revised
    compared := typedPackageViewOfRecord .compared request request.compared
    inherited :=
      typedInheritedV5OfOperationalRequest request result.semanticResponse
  }
  have hTypedRequest :
      TypedRequestOfProduction request result typedRequest := by
    unfold TypedRequestOfProduction typedRequestOfProduction
    refine ⟨?_, rfl, rfl, rfl, rfl, rfl, rfl, rfl,
      ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_⟩
    · rfl
    · simp [typedRequest, typedPackageViewOfRecord, typedIndexOfProduction]
    · simp [typedRequest, typedPackageViewOfRecord, typedIndexOfProduction]
    · simp [typedRequest, typedPackageViewOfRecord, typedIndexOfProduction]
    · exact typedCommentScanOfProduction_reference_length
        request.original.commentEvidence
    · exact typedCommentScanOfProduction_reference_length
        request.revised.commentEvidence
    · exact typedCommentScanOfProduction_reference_length
        request.compared.commentEvidence
    · exact production_typed_comment_scan_check_sound request.original
        hTypedChecks.1.1.1
    · exact production_typed_comment_scan_check_sound request.revised
        hTypedChecks.1.1.2
    · exact production_typed_comment_scan_check_sound request.compared
        hTypedChecks.1.2
  let canonicalTypedResponse := canonicalTypedResponseV6 typedRequest
  let canonicalBytes :=
    independentProtocolV6Projection canonicalTypedResponse
  have hProtocolChecks := hTypedChecks.2
  simp only [hTypedRequest.1] at hProtocolChecks
  have hProtocolDecoded :
      ∃ projected,
        typedProtocolV6ResponseOfJson
          result.response result.responsePassed = .ok projected ∧
        (independentProtocolV6Projection projected =
            independentProtocolV6Projection
              (canonicalTypedResponseV6 typedRequest) ∧
          result.response.compress.toUTF8 =
            (⟨(independentProtocolV6Projection
              (canonicalTypedResponseV6 typedRequest)).toArray⟩ :
              ByteArray)) ∧
        result.stdout =
          (⟨(independentProtocolV6Projection
            (canonicalTypedResponseV6 typedRequest)).toArray⟩ :
              ByteArray).push (UInt8.ofNat 10) := by
    cases hConversion :
        typedProtocolV6ResponseOfJson
          result.response result.responsePassed with
    | error message =>
        simp [hConversion] at hProtocolChecks
    | ok projected =>
        refine ⟨projected, rfl, ?_⟩
        simpa [hConversion, Bool.and_eq_true, decide_eq_true_eq] using
          hProtocolChecks
  rcases hProtocolDecoded with
    ⟨projected, hProjected, hProtocolChecks⟩
  have hTypedAggregate :
      TypedCommentAggregatePassOf typedRequest
        (canonicalTypedResponseV6 typedRequest) := by
    exact (typed_comment_integrity_aggregate_pass_sound typedRequest).1
  have hTypedSerialized :
      TypedSerializedResponseV6Of canonicalTypedResponse canonicalBytes := by
    exact (typed_comment_integrity_aggregate_pass_sound typedRequest).2
  have hStdout :
      result.stdout.data.toList =
        canonicalBytes ++ [UInt8.ofNat 10] := by
    rw [hProtocolChecks.2]
    simp [canonicalBytes, canonicalTypedResponse]
  have hResponseBytes :
      result.response.compress.toUTF8.data.toList = canonicalBytes := by
    rw [hProtocolChecks.1.2]
  have hTypedProjection :
      ProtocolV6JsonProjectionOf result.response result.responsePassed
        canonicalTypedResponse := by
    unfold ProtocolV6JsonProjectionOf
    exact ⟨projected, hProjected, hProtocolChecks.1.1, hResponseBytes⟩
  have hTypedContract :
      ∃ typedRequest typedResponse canonicalBytes,
        TypedRequestOfProduction request result typedRequest ∧
        typedResponse = canonicalTypedResponseV6 typedRequest ∧
        TypedCommentAggregatePassOf typedRequest typedResponse ∧
        TypedSerializedResponseV6Of typedResponse canonicalBytes ∧
        ProtocolV6JsonProjectionOf result.response result.responsePassed
          typedResponse ∧
        result.response.compress.toUTF8.data.toList = canonicalBytes ∧
        result.stdout.data.toList =
          canonicalBytes ++ [UInt8.ofNat 10] := by
    exact ⟨typedRequest, canonicalTypedResponse, canonicalBytes,
      hTypedRequest, rfl,
      hTypedAggregate, hTypedSerialized, hTypedProjection,
      hResponseBytes, hStdout⟩
  refine ⟨hOld, packageEvidence, commentEvidence, hPrior, hSources, ?_⟩
  refine ⟨?_, ?_, hParsed, hScanInputs, hAllPass, rfl,
    hSelections, hRetained, hAggregate, ?_, hProtocol,
    ⟨hFinalized, hTypedContract⟩⟩
  · intro side
    exact ⟨rfl, rfl, rfl⟩
  · intro side
    exact production_comment_semantic_projection_sound request side
      (productionCommentEvidenceAt request commentEvidence side)
  · exact hProtocol.1

def productionRunRequestCoreV6RefinementSignature : Prop :=
  ∀ (request : RunRequestCoreRequestV6) (result : RunRequestCoreResultV6),
    runRequestCoreV6 request = .ok result →
    result.responsePassed = true →
    ProductionRunRequestV6RefinesSemanticOf request result

end Tier2.NoteReferenceIntegrity

def runRequestWithPackages (request : Request)
    (packages : Package × Package × Package) : IO ByteArray := do
  let originalPackage := packages.1
  let revisedPackage := packages.2.1
  let comparedPackage := packages.2.2
  let main ← loadMainState packages
  let (originalRelationships, originalRelationshipIssues, originalRelationshipEvents) ←
    loadRelationships originalPackage main.originalInventory .original
  let (revisedRelationships, revisedRelationshipIssues, revisedRelationshipEvents) ←
    loadRelationships revisedPackage main.revisedInventory .revised
  let (comparedRelationships, comparedRelationshipIssues, comparedRelationshipEvents) ←
    loadRelationships comparedPackage main.comparedInventory .compared
  let relationshipIssues := originalRelationshipIssues ++ revisedRelationshipIssues ++
    comparedRelationshipIssues
  let selector ← IO.ofExcept <| alignInventories main.originalInventory main.revisedInventory
    main.comparedInventory originalRelationships revisedRelationships comparedRelationships
  let mut selectionIssues := relationshipIssues ++ selector.issues
  let baseEvents : ResourceUsage := {
    original := {
      xmlEvents := main.originalInventory.eventCount + originalRelationshipEvents
    }
    revised := {
      xmlEvents := main.revisedInventory.eventCount + revisedRelationshipEvents
    }
    compared := {
      xmlEvents := main.comparedInventory.eventCount + comparedRelationshipEvents
    }
  }
  let metadataPlan := relationshipMetadataPlan packages selector baseEvents
  selectionIssues := selectionIssues ++ metadataPlan.issues
  let mut loadedPhysicalStories : List LoadedPhysicalStory := []
  let mut usage := metadataPlan.usage
  let mut selectedAggregateStopped := false
  if metadataPlan.mayExtractSelected then
    for story in selector.physicalStories do
      if selectedAggregateStopped then break
      let attempt ← loadPhysicalStory packages story usage
      usage := attempt.usage
      selectionIssues := selectionIssues ++ attempt.issues
      if let some loaded := attempt.loaded then
        loadedPhysicalStories := loadedPhysicalStories ++ [loaded]
      if attempt.aggregateStopped then selectedAggregateStopped := true
  let loadedPhysicalWorks := loadedPhysicalStories.map (·.work)
  selectionIssues := selectionIssues.eraseDups.mergeSort issueLess
  let fixedTriples := [main.story]
  let (evidenceSlots, projectedLoadedWorks) ←
    IO.ofExcept <| projectLoadedSelection selector.alignedSlots loadedPhysicalWorks
  let projectedPhysicalStories := projectedLoadedWorks.map (·.story)
  let selectedTriples := projectedLoadedWorks.map LoadedPhysicalWork.triple
  let completePhysicalSelection :=
    loadedPhysicalWorks.length == selector.physicalStories.length
  if completePhysicalSelection then
    IO.ofExcept <| validateAggregateSelection selector.candidateOutcomes selector.alignedSlots
      selector.physicalStories loadedPhysicalWorks selectedTriples
  let originalSources := sourcesForSide main loadedPhysicalStories .original
  let revisedSources := sourcesForSide main loadedPhysicalStories .revised
  let comparedSources := sourcesForSide main loadedPhysicalStories .compared
  let sourcePartitionComplete := selectionIssues.isEmpty && completePhysicalSelection &&
    !selectedAggregateStopped
  let originalNoteEvidence ← if sourcePartitionComplete then
      buildNoteSideEvidence originalPackage .original originalRelationships originalSources
        usage.original
    else pure <| skippedNoteSideEvidence .original originalSources originalRelationships
  let revisedNoteEvidence ← if sourcePartitionComplete &&
      !originalNoteEvidence.semanticLimitCrossed then
      buildNoteSideEvidence revisedPackage .revised revisedRelationships revisedSources usage.revised
    else pure <| skippedNoteSideEvidence .revised revisedSources revisedRelationships
  let comparedNoteEvidence ← if sourcePartitionComplete &&
      !originalNoteEvidence.semanticLimitCrossed &&
      !revisedNoteEvidence.semanticLimitCrossed then
      buildNoteSideEvidence comparedPackage .compared comparedRelationships comparedSources
        usage.compared
    else pure <| skippedNoteSideEvidence .compared comparedSources comparedRelationships
  let commentTripleUsage : CommentTripleResourceUsage := {
    selectedParts :=
      commentSelectedPartsBefore originalNoteEvidence +
      commentSelectedPartsBefore revisedNoteEvidence +
      commentSelectedPartsBefore comparedNoteEvidence
    compressedBytes :=
      originalNoteEvidence.usage.compressedBytes +
      revisedNoteEvidence.usage.compressedBytes +
      comparedNoteEvidence.usage.compressedBytes
    expandedBytes :=
      originalNoteEvidence.usage.expandedBytes +
      revisedNoteEvidence.usage.expandedBytes +
      comparedNoteEvidence.usage.expandedBytes
    xmlEvents :=
      originalNoteEvidence.usage.xmlEvents +
      revisedNoteEvidence.usage.xmlEvents +
      comparedNoteEvidence.usage.xmlEvents
  }
  let originalCommentEvidence ←
    buildCommentSideEvidence originalPackage .original originalRelationships
      originalNoteEvidence commentTripleUsage
  let revisedCommentEvidence ←
    if !originalCommentEvidence.semanticLimitCrossed then
      buildCommentSideEvidence revisedPackage .revised revisedRelationships
        revisedNoteEvidence originalCommentEvidence.tripleUsage
    else
      pure <| skippedCommentSideEvidence .revised revisedNoteEvidence
        originalCommentEvidence.tripleUsage
  let comparedCommentEvidence ←
    if !originalCommentEvidence.semanticLimitCrossed &&
        !revisedCommentEvidence.semanticLimitCrossed then
      buildCommentSideEvidence comparedPackage .compared comparedRelationships
        comparedNoteEvidence revisedCommentEvidence.tripleUsage
    else
      pure <| skippedCommentSideEvidence .compared comparedNoteEvidence
        revisedCommentEvidence.tripleUsage
  let originalCorePackage : RunRequestPackageRecord := {
    packagePath := originalPackage.path
    packageBytes := originalPackage.bytes
    packageReadCount := originalPackage.packageReadCount
    packageIndex := originalPackage.index
    packageIndexExact := originalPackage.independentIndexExact
    snapshotPath := originalPackage.snapshotPath
    snapshotBytes := originalPackage.snapshotBytes
    snapshotWriteCount := originalPackage.snapshotWriteCount
    snapshotWriteCountExact := originalPackage.snapshotWriteCountExact
    snapshotBytesExact := originalPackage.snapshotBytesExact
    relationships := originalRelationships
    noteEvidence := originalNoteEvidence
    commentEvidence := originalCommentEvidence
  }
  let revisedCorePackage : RunRequestPackageRecord := {
    packagePath := revisedPackage.path
    packageBytes := revisedPackage.bytes
    packageReadCount := revisedPackage.packageReadCount
    packageIndex := revisedPackage.index
    packageIndexExact := revisedPackage.independentIndexExact
    snapshotPath := revisedPackage.snapshotPath
    snapshotBytes := revisedPackage.snapshotBytes
    snapshotWriteCount := revisedPackage.snapshotWriteCount
    snapshotWriteCountExact := revisedPackage.snapshotWriteCountExact
    snapshotBytesExact := revisedPackage.snapshotBytesExact
    relationships := revisedRelationships
    noteEvidence := revisedNoteEvidence
    commentEvidence := revisedCommentEvidence
  }
  let comparedCorePackage : RunRequestPackageRecord := {
    packagePath := comparedPackage.path
    packageBytes := comparedPackage.bytes
    packageReadCount := comparedPackage.packageReadCount
    packageIndex := comparedPackage.index
    packageIndexExact := comparedPackage.independentIndexExact
    snapshotPath := comparedPackage.snapshotPath
    snapshotBytes := comparedPackage.snapshotBytes
    snapshotWriteCount := comparedPackage.snapshotWriteCount
    snapshotWriteCountExact := comparedPackage.snapshotWriteCountExact
    snapshotBytesExact := comparedPackage.snapshotBytesExact
    relationships := comparedRelationships
    noteEvidence := comparedNoteEvidence
    commentEvidence := comparedCommentEvidence
  }
  let coreRequest : RunRequestCoreRequest := {
    fixedTriples
    relationshipSlots := evidenceSlots
    relationshipStories := projectedPhysicalStories
    relationshipTriples := selectedTriples
    selectionIssues
    original := originalCorePackage
    revised := revisedCorePackage
    compared := comparedCorePackage
  }
  let core ← IO.ofExcept <|
    Tier2.NoteReferenceIntegrity.runRequestCoreV6 coreRequest
  return core.stdout

def withLoadedPackage {α : Type} (root : SnapshotRoot) (path : String)
    (use : Package → IO α) : IO α := do
  let package ← loadPackage root path
  try
    use package
  finally
    cleanupPackageSnapshot package

def runRequest (root : SnapshotRoot) (request : Request) : IO ByteArray :=
  withLoadedPackage root request.originalDocxPath fun originalPackage =>
  withLoadedPackage root request.revisedDocxPath fun revisedPackage =>
  withLoadedPackage root request.comparedDocxPath fun comparedPackage =>
    runRequestWithPackages request (originalPackage, revisedPackage, comparedPackage)

def main : IO Unit := do
  let stdin ← IO.getStdin
  let raw ← stdin.readToEnd
  if raw.toUTF8.size > maxRequestBytes then
    throw (IO.userError "protocol request exceeds 64 KiB")
  match Json.parse raw with
  | .error error => throw (IO.userError s!"JSON parse error: {error}")
  | .ok json =>
    match requestFromJson json with
    | .error error => throw (IO.userError s!"request parse error: {error}")
    | .ok request =>
      let root ← acquireSnapshotRoot
      try
        let stdout ← runRequest root request
        (← IO.getStdout).write stdout
      finally
        cleanupSnapshotRoot root
