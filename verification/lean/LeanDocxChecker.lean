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
  let bytes := value.toUTF8.data.toList
  { bytes, limit := bytes.length, admitted := Nat.le_refl _ }

def typedBoundedByteArrayOfString (value : String) : BoundedByteArray :=
  let bytes := value.toUTF8
  { bytes, limit := bytes.size, admitted := Nat.le_refl _ }

theorem bounded_bytes_ext
    (left right : BoundedBytes)
    (hBytes : left.bytes = right.bytes)
    (hLimit : left.limit = right.limit) :
    left = right := by
  cases left
  cases right
  simp_all

theorem string_eq_of_utf8_data_to_list_eq
    (left right : String)
    (hBytes :
      left.toUTF8.data.toList = right.toUTF8.data.toList) :
    left = right := by
  apply String.toByteArray_inj.mp
  rw [← String.toUTF8_eq_toByteArray,
    ← String.toUTF8_eq_toByteArray]
  apply ByteArray.ext
  exact Array.toList_inj.mp hBytes

def typedXmlNameOfProduction (value : String) : BoundedBytes :=
  if value == wmlNamespace then typedWmlNamespace
  else if value == "id" then typedLiteral [105,100]
  else if value == "comment" then
    typedLiteral [99,111,109,109,101,110,116]
  else if value == "commentRangeStart" then
    typedLiteral [99,111,109,109,101,110,116,82,97,110,103,101,83,116,97,114,116]
  else if value == "commentRangeEnd" then
    typedLiteral [99,111,109,109,101,110,116,82,97,110,103,101,69,110,100]
  else if value == "commentReference" then
    typedLiteral [99,111,109,109,101,110,116,82,101,102,101,114,101,110,99,101]
  else typedBoundedBytesOfString value

theorem typed_xml_name_of_production_bytes (value : String) :
    (typedXmlNameOfProduction value).bytes =
      value.toUTF8.data.toList := by
  by_cases hWml : value = wmlNamespace
  · subst value
    decide
  · by_cases hId : value = "id"
    · subst value
      decide
    · by_cases hComment : value = "comment"
      · subst value
        decide
      · by_cases hStart : value = "commentRangeStart"
        · subst value
          decide
        · by_cases hEnd : value = "commentRangeEnd"
          · subst value
            decide
          · by_cases hReference : value = "commentReference"
            · subst value
              decide
            · simp [typedXmlNameOfProduction, hWml, hId, hComment,
                hStart, hEnd, hReference, typedBoundedBytesOfString]

theorem typed_xml_name_of_production_reflects_equality (left right : String) :
    (typedXmlNameOfProduction left).bytes =
        (typedXmlNameOfProduction right).bytes ↔
      left = right := by
  rw [typed_xml_name_of_production_bytes,
    typed_xml_name_of_production_bytes]
  constructor
  · exact string_eq_of_utf8_data_to_list_eq left right
  · intro h
    exact congrArg (fun value => value.toUTF8.data.toList) h

def typedXmlAttributeOfProduction
    (item : ExpandedXmlAttribute) : TypedXmlAttribute := {
  namespaceUri := typedXmlNameOfProduction item.uri
  localName := typedXmlNameOfProduction item.localName
  value := typedBoundedByteArrayOfString item.value
}

theorem mapTR_loop_eq {α β : Type} (f : α → β)
    (values : List α) (acc : List β) :
    List.mapTR.loop f values acc = acc.reverse ++ values.map f := by
  induction values generalizing acc with
  | nil => simp [List.mapTR.loop]
  | cons head tail ih =>
      rw [List.mapTR.loop, ih]
      simp

theorem mapTR_eq_map {α β : Type} (f : α → β) (values : List α) :
    values.mapTR f = values.map f := by
  simp [List.mapTR, mapTR_loop_eq]

theorem typed_wml_namespace_adapter :
    typedWmlNamespace =
      typedXmlNameOfProduction wmlNamespace := by
  decide

theorem typed_id_local_name_adapter :
    typedLiteral [105, 100] = typedXmlNameOfProduction "id" := by
  decide

theorem typed_attribute_match_of_production
    (item : ExpandedXmlAttribute) :
    (decide
        ((typedXmlAttributeOfProduction item).namespaceUri.bytes =
          typedWmlNamespace.bytes) &&
      decide
        ((typedXmlAttributeOfProduction item).localName.bytes =
          (typedLiteral [105, 100]).bytes)) =
    (item.uri == wmlNamespace && item.localName == "id") := by
  apply Bool.eq_iff_iff.mpr
  simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq]
  rw [typed_wml_namespace_adapter, typed_id_local_name_adapter]
  simp only [typedXmlAttributeOfProduction,
    typed_xml_name_of_production_reflects_equality]

theorem expanded_wml_attribute_loop_as_find
    (attributes : List ExpandedXmlAttribute) :
    Tier2.NoteReferenceIntegrity.expandedWmlAttribute?.loop
        "id" attributes =
      (attributes.find? fun item =>
        item.uri == wmlNamespace &&
          item.localName == "id").map (·.value) := by
  induction attributes with
  | nil => rfl
  | cons head tail ih =>
      simp [Tier2.NoteReferenceIntegrity.expandedWmlAttribute?.loop, ih]
      by_cases h :
          head.uri = wmlNamespace ∧
            head.localName = "id"
      · simp [h]
      · simp [h]

theorem expanded_wml_attribute_as_find
    (attributes : List ExpandedXmlAttribute) :
    Tier2.NoteReferenceIntegrity.expandedWmlAttribute?
        attributes "id" =
      (attributes.find? fun item =>
        item.uri == wmlNamespace &&
          item.localName == "id").map (·.value) := by
  exact expanded_wml_attribute_loop_as_find attributes

theorem typed_attribute_value_of_production
    (attributes : List ExpandedXmlAttribute) :
    typedAttributeValue?
        (typedDefinitionScanInputV7 [])
        (attributes.mapTR typedXmlAttributeOfProduction) =
      (Tier2.NoteReferenceIntegrity.expandedWmlAttribute?
        attributes "id").map typedBoundedBytesOfString := by
  rw [mapTR_eq_map]
  induction attributes with
  | nil => rfl
  | cons head tail ih =>
      simp only [List.map_cons, typedAttributeValue?, List.find?_cons,
        typedDefinitionScanInputV7]
      split
      · rename_i hTyped
        have h :
            head.uri == wmlNamespace &&
              head.localName == "id" := by
          rw [← typed_attribute_match_of_production head]
          exact hTyped
        simp only [Option.map_some]
        rw [expanded_wml_attribute_as_find]
        rw [List.find?_cons, h]
        simp only [Option.map_some]
        congr 1
      · rename_i hTyped
        have hRaw :
            (head.uri == wmlNamespace &&
              head.localName == "id") = false := by
          have hMatch := typed_attribute_match_of_production head
          exact hMatch.symm.trans hTyped
        rw [expanded_wml_attribute_as_find, List.find?_cons, hRaw]
        simp only [Option.map_map]
        simp only [typedAttributeValue?,
          typedDefinitionScanInputV7] at ih
        rw [expanded_wml_attribute_as_find, Option.map_map] at ih
        exact ih

theorem typed_comment_local_name_adapter :
    typedLiteral [99,111,109,109,101,110,116] =
      typedXmlNameOfProduction "comment" := by
  decide

theorem typed_definition_match_of_production
    (uri localName : String) :
    (decide
        ((typedXmlNameOfProduction uri).bytes =
          typedWmlNamespace.bytes) &&
      decide
        ((typedXmlNameOfProduction localName).bytes =
          (typedLiteral [99,111,109,109,101,110,116]).bytes)) =
    (uri == wmlNamespace && localName == "comment") := by
  apply Bool.eq_iff_iff.mpr
  simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq]
  rw [typed_wml_namespace_adapter,
    typed_comment_local_name_adapter]
  simp only [typed_xml_name_of_production_reflects_equality]

def typedXmlEventOfProduction (eventOrdinal : Nat) : XmlEvent → TypedXmlEvent
  | .startElement uri localName attributes depth selfClosing =>
      .startElement (typedXmlNameOfProduction uri)
        (typedXmlNameOfProduction localName)
        (attributes.mapTR typedXmlAttributeOfProduction)
        depth selfClosing eventOrdinal
  | .endElement uri localName depth =>
      .endElement (typedXmlNameOfProduction uri)
        (typedXmlNameOfProduction localName) depth eventOrdinal
  | .text value depth =>
      .text (typedBoundedByteArrayOfString value) depth eventOrdinal

theorem typed_definition_candidate_of_production
    (eventOrdinal : Nat) (event : XmlEvent) :
    typedDefinitionCandidate? (typedDefinitionScanInputV7 [])
        (typedXmlEventOfProduction eventOrdinal event) =
      (Tier2.CommentReferenceIntegrity.commentDefinitionCandidate? event).map
        (fun candidate =>
          (candidate.1.map typedBoundedBytesOfString, candidate.2)) := by
  cases event with
  | startElement uri localName attributes depth selfClosing =>
      simp only [typedXmlEventOfProduction, typedDefinitionCandidate?,
        typedDefinitionScanInputV7,
        Tier2.CommentReferenceIntegrity.commentDefinitionCandidate?]
      split
      · rename_i hTyped
        have hRaw :
            (uri == wmlNamespace && localName == "comment") = true := by
          have hMatch :=
            typed_definition_match_of_production uri localName
          exact hMatch.symm.trans hTyped
        simp only [hRaw, if_true, Option.map_some]
        change some
            (typedAttributeValue? (typedDefinitionScanInputV7 [])
              (attributes.mapTR typedXmlAttributeOfProduction),
              depth == 1) =
          some
            ((Tier2.NoteReferenceIntegrity.expandedWmlAttribute?
              attributes "id").map typedBoundedBytesOfString,
              depth == 1)
        rw [typed_attribute_value_of_production]
      · rename_i hTyped
        have hTypedFalse :
            (decide
                ((typedXmlNameOfProduction uri).bytes =
                  typedWmlNamespace.bytes) &&
              decide
                ((typedXmlNameOfProduction localName).bytes =
                  (typedLiteral
                    [99,111,109,109,101,110,116]).bytes)) =
              false :=
          Bool.eq_false_iff.mpr hTyped
        have hRaw :
            (uri == wmlNamespace && localName == "comment") = false := by
          have hMatch :=
            typed_definition_match_of_production uri localName
          exact hMatch.symm.trans hTypedFalse
        simp [hRaw]
  | endElement uri localName depth =>
      rfl
  | text value depth =>
      rfl

def typedXmlEventsOfProductionSpecV7 :
    Nat → List XmlEvent → List TypedXmlEvent
  | _, [] => []
  | ordinal, event :: rest =>
      typedXmlEventOfProduction ordinal event ::
        typedXmlEventsOfProductionSpecV7 (ordinal + 1) rest

theorem typed_xml_events_of_production_spec_v7_length
    (ordinal : Nat) (events : List XmlEvent) :
    (typedXmlEventsOfProductionSpecV7 ordinal events).length = events.length := by
  induction events generalizing ordinal with
  | nil => rfl
  | cons _ rest hInduction =>
      simp only [typedXmlEventsOfProductionSpecV7, List.length_cons,
        hInduction]

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
    protocolVersion := .nat 7
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
    typedResponse.protocolVersion = .nat 7 ∧
    typedResponse.passed = .bool true := by
  unfold typedProtocolV6ResponseOfJson at hConversion
  cases hConversion
  exact ⟨rfl, rfl⟩

def ExecutableSelectorRefinesTyped
    (pkg : Tier2.CommentReferenceIntegrity.PackageView)
    (typedCommentType : BoundedBytes)
    (typedRelationships : List TypedRelationship) : Prop :=
  typedCommentType.bytes =
      Tier2.CommentReferenceIntegrity.commentsRelationshipType.toUTF8.data.toList ∧
  (typedRelationships.map fun relationship =>
      (relationship.ordinal, relationship.relationshipType.bytes,
        relationship.relationshipId.bytes, relationship.rawTarget.bytes,
        relationship.rawTargetMode.map (·.bytes))) =
    (pkg.relationshipRecords.zipIdx.map fun item =>
      (item.2, item.1.relationshipType.toUTF8.data.toList,
        item.1.id.toUTF8.data.toList, item.1.rawTarget.toUTF8.data.toList,
        item.1.targetMode.map (·.toUTF8.data.toList))) ∧
  match Tier2.CommentReferenceIntegrity.selectConventionalMainComment pkg,
      selectTypedComment typedCommentType typedRelationships with
  | .ok none, .ok none => True
  | .ok (some selected), .ok (some typedSelected) =>
      typedSelected.relationshipOrdinal =
          selected.relationshipRecordOrdinal ∧
      typedSelected.relationshipId.bytes =
          selected.relationshipId.toUTF8.data.toList ∧
      typedSelected.normalizedPartPath.bytes =
          selected.normalizedPartPath.toUTF8.data.toList
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
      realization.selected.relationshipId.toUTF8.data.toList ∧
  typed.selected.normalizedPartPath.bytes =
      realization.selected.normalizedPartPath.toUTF8.data.toList ∧
  typed.extraction.packageBytes =
      realization.extraction.packageBytes ∧
  typed.extraction.snapshotBytes =
      realization.extraction.snapshotBytes ∧
  typed.extraction.expandedBytes =
      realization.extraction.decompressedBytes ∧
  typed.entry.name.bytes =
      realization.entry.normalizedPartPath.toUTF8.data.toList ∧
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
      realization.parsed.rootUri.toUTF8.data.toList ∧
  typed.parsed.expectedRootLocalName.bytes =
      realization.parsed.rootLocalName.toUTF8.data.toList ∧
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
  encodeNatDigits attr.value.bytes.size ++ [UInt8.ofNat 58] ++
  attr.value.bytes.data.toList

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
      (source.ordinal, source.normalizedPartPath.toUTF8.data.toList)) ∧
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
        (source.ordinal, source.normalizedPartPath.toUTF8.data.toList))) &&
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
    .error "protocol v7 JSON response exceeds legal envelope"
  else
    let stdout := jsonBytes ++ protocolV6LineFeed
    if stdout.size > maxProtocolV6ResponseBytes then
      .error "protocol v7 stdout response exceeds legal envelope"
    else .ok stdout

def finalizeProtocolV6Response
    (response : Json) (passed : Bool) : Except String ByteArray :=
  if protocolV6JsonProjectionCheck response passed then
    finalizeProtocolV6ResponseUnchecked response
  else
    .error "protocol v7 production JSON diverges from typed byte projection"

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
    throw "protocol v7 request has unknown or missing keys"
  let protocolVersion ← j.getObjValAs? Nat "protocolVersion"
  if protocolVersion != 7 then throw s!"unsupported protocolVersion: {protocolVersion}"
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

partial def readBoundedChunks (handle : IO.FS.Handle) (limit total : Nat)
    (chunks : List ByteArray) : IO (Nat × List ByteArray) := do
  let chunk ← handle.read 4096
  if chunk.isEmpty then return (total, chunks)
  let nextTotal := total + chunk.size
  if nextTotal > limit then
    throw (IO.userError s!"process output exceeds {limit} bytes")
  readBoundedChunks handle limit nextTotal (chunk :: chunks)

def readBounded (handle : IO.FS.Handle) (limit : Nat) : IO ByteArray := do
  let (total, reversedChunks) ← readBoundedChunks handle limit 0 []
  return reversedChunks.reverse.foldl ByteArray.append
    (ByteArray.emptyWithCapacity total)

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

def crc32Bit (value : Nat) : Nat :=
  if value % 2 == 1 then Nat.xor (value / 2) 0xedb88320 else value / 2

def crc32Step (crc byte : Nat) : Nat :=
  let bit0 := crc32Bit (Nat.xor crc byte)
  let bit1 := crc32Bit bit0
  let bit2 := crc32Bit bit1
  let bit3 := crc32Bit bit2
  let bit4 := crc32Bit bit3
  let bit5 := crc32Bit bit4
  let bit6 := crc32Bit bit5
  crc32Bit bit6

set_option backward.match.sparseCases false in
def crc32Loop (bytes : ByteArray) : Nat → Nat → Nat → Nat
  | 0, _, crc => crc
  | remaining + 1, index, crc =>
      crc32Loop bytes remaining (index + 1)
        (crc32Step crc (bytes.get! index).toNat)

def crc32 (bytes : ByteArray) : Nat :=
  Nat.xor (crc32Loop bytes bytes.size 0 0xffffffff) 0xffffffff

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

def commentIssuePhaseRankV7 (code : String) : Nat :=
  if code == "COMMENT_SOURCE_PARTITION_INCOMPLETE" then 1
  else if code.startsWith "COMMENT_DEFINITION_" ||
      code == "COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED" then 2
  else if code.startsWith "COMMENT_REFERENCE_ID_" ||
      code.startsWith "COMMENT_RANGE_START_ID_" ||
      code.startsWith "COMMENT_RANGE_END_ID_" ||
      code == "COMMENT_RELATIONSHIP_REQUIRED" ||
      code == "COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED" ||
      code == "COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED" ||
      code == "COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED" ||
      code == "COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED" then 3
  else if [
      "COMMENT_REFERENCE_DUPLICATE", "COMMENT_REFERENCE_MISSING",
      "COMMENT_RANGE_START_DUPLICATE", "COMMENT_RANGE_END_DUPLICATE",
      "COMMENT_RANGE_START_ORPHANED", "COMMENT_RANGE_END_ORPHANED",
      "COMMENT_RANGE_CROSS_STORY", "COMMENT_RANGE_REVERSED"
    ].contains code then 4
  else if code == "COMMENT_ISSUE_LIMIT_EXCEEDED" ||
      code == "COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED" then 5
  else 0

def commentIssueCodeRankV7 (code : String) : Nat :=
  noteIssueStringRank [
    "COMMENT_RANGE_START_ID_MISSING", "COMMENT_RANGE_START_ID_TOO_LONG",
    "COMMENT_RANGE_START_ID_MALFORMED", "COMMENT_RANGE_END_ID_MISSING",
    "COMMENT_RANGE_END_ID_TOO_LONG", "COMMENT_RANGE_END_ID_MALFORMED",
    "COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED",
    "COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED",
    "COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED",
    "COMMENT_REFERENCE_DUPLICATE", "COMMENT_REFERENCE_MISSING",
    "COMMENT_RANGE_START_DUPLICATE", "COMMENT_RANGE_END_DUPLICATE",
    "COMMENT_RANGE_START_ORPHANED", "COMMENT_RANGE_END_ORPHANED",
    "COMMENT_RANGE_CROSS_STORY", "COMMENT_RANGE_REVERSED"
  ] code

def commentIssueSortKeyV7 (issue : Json) : String :=
  let source := match issue.getObjVal? "source" with
    | .ok value => value
    | .error _ => Json.null
  [
    zeroPaddedNat 2 (noteIssueStringRank ["original", "revised", "compared"]
      (jsonStringField issue "side")),
    zeroPaddedNat 2 (commentIssuePhaseRankV7 (jsonStringField issue "code")),
    zeroPaddedNat 3 (jsonNatField issue "sourceSetOrdinal"),
    zeroPaddedNat 2 (noteIssueStringRank
      ["main", "header", "footer", "footnotes", "endnotes", "comments"]
      (jsonStringField source "sourceStory")),
    zeroPaddedNat 3 (jsonNatField source "sourceStoryOrdinal"),
    zeroPaddedNat 6 (jsonNatField issue "sourceEventOrdinal"),
    zeroPaddedNat 2 (noteIssueStringRank
      ["rangeStart", "rangeEnd", "reference", "relationship", "source",
        "definition", "aggregate"]
      (jsonStringField issue "ordinalSpace")),
    zeroPaddedNat 4 (jsonNatField issue "firstOccurrenceOrdinal"),
    zeroPaddedNat 3 (commentIssueCodeRankV7 (jsonStringField issue "code")),
    jsonStringField issue "code",
    jsonStringField issue "canonicalId"
  ].intersperse "\u0000" |>.foldl (· ++ ·) ""

def commentIssueLessV7 (left right : Json) : Bool :=
  decide (commentIssueSortKeyV7 left < commentIssueSortKeyV7 right)

def commentIssueCoalesceKeyV7 (issue : Json) : String :=
  let source := match issue.getObjVal? "source" with
    | .ok value => value
    | .error _ => Json.null
  [
    jsonStringField issue "side", jsonStringField issue "kind",
    jsonStringField issue "code", jsonStringField issue "ordinalSpace",
    jsonStringField source "sourceStory",
    toString (jsonNatField source "sourceStoryOrdinal"),
    jsonOptionalKey issue "sourceSetOrdinal",
    jsonOptionalKey issue "relatedSource",
    jsonOptionalKey issue "relatedSourceSetOrdinal",
    jsonOptionalKey issue "relatedSourceEventOrdinal",
    jsonOptionalKey issue "canonicalId", jsonOptionalKey issue "rawId",
    jsonOptionalKey issue "rawIdByteLength",
    jsonOptionalKey issue "relationshipId", jsonOptionalKey issue "rawTarget",
    jsonOptionalKey issue "rawTargetByteLength", jsonOptionalKey issue "targetMode",
    jsonOptionalKey issue "normalizedPartPath",
    jsonOptionalKey issue "rangeEndEventOrdinal"
  ].intersperse "\u0000" |>.foldl (· ++ ·) ""

def coalesceCommentIssuesV7 (issues : List Json) : List Json :=
  issues.foldl (fun retained issue =>
    let key := commentIssueCoalesceKeyV7 issue
    if retained.any (fun existing => commentIssueCoalesceKeyV7 existing == key) then
      retained.map fun existing =>
        if commentIssueCoalesceKeyV7 existing != key then existing
        else
          let count := min 4096 (jsonNatField existing "occurrenceCount" +
            jsonNatField issue "occurrenceCount")
          let earliest := if commentIssueLessV7 issue existing then issue else existing
          earliest.setObjVal! "occurrenceCount" (toJson count)
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
  rangeStartOccurrences : Nat := 0
  rangeEndOccurrences : Nat := 0
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
    rangeStartOccurrences := 0, rangeEndOccurrences := 0
    uniqueReferenceIds := 0, definitions := 0, unreferencedDefinitions := 0
    nonDirectDefinitions := 0 }

def commentInventoryJson (inventory : CommentInventoryEvidence) : Json :=
  Json.mkObj <|
    [ ("side", toJson inventory.side.toString)
    , ("status", toJson inventory.status)
    , ("relationship", inventory.identity.map commentIdentityJson |>.getD Json.null)
    ] ++
    [ ("referenceOccurrences", toJson inventory.referenceOccurrences)
    , ("rangeStartOccurrences", toJson inventory.rangeStartOccurrences)
    , ("rangeEndOccurrences", toJson inventory.rangeEndOccurrences)
    , ("uniqueReferenceIds", toJson inventory.uniqueReferenceIds)
    , ("definitions", toJson inventory.definitions)
    , ("unreferencedDefinitions", toJson inventory.unreferencedDefinitions)
    , ("nonDirectDefinitions", toJson inventory.nonDirectDefinitions)
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

inductive CommentMarkerKindV7
  | rangeStart
  | rangeEnd
  | reference
  deriving BEq, DecidableEq, Repr, Inhabited

def CommentMarkerKindV7.ordinalSpace : CommentMarkerKindV7 → String
  | .rangeStart => "rangeStart"
  | .rangeEnd => "rangeEnd"
  | .reference => "reference"

structure CommentMarkerOccurrenceV7 where
  kind : CommentMarkerKindV7
  sourceSetOrdinal : Nat
  sourceStory : String
  sourceStoryOrdinal : Nat
  sourceEventOrdinal : Nat
  markerOccurrenceOrdinal : Nat
  kindOccurrenceOrdinal : Nat
  rawId : Option String
  canonicalId : Option String
  deriving DecidableEq, Repr, Inhabited

structure CommentMarkerAssociationV7 where
  referenceCount : Nat := 0
  rangeStartCount : Nat := 0
  rangeEndCount : Nat := 0
  firstReference : Option CommentMarkerOccurrenceV7 := none
  firstRangeStart : Option CommentMarkerOccurrenceV7 := none
  firstRangeEnd : Option CommentMarkerOccurrenceV7 := none
  firstDuplicateReference : Option CommentMarkerOccurrenceV7 := none
  firstDuplicateRangeStart : Option CommentMarkerOccurrenceV7 := none
  firstDuplicateRangeEnd : Option CommentMarkerOccurrenceV7 := none
  deriving DecidableEq, Repr, Inhabited

inductive CommentMarkerCrossingV7
  | relationshipRequired (occurrence : CommentMarkerOccurrenceV7)
  | referenceLimit (occurrence : CommentMarkerOccurrenceV7)
  | rangeStartLimit (occurrence : CommentMarkerOccurrenceV7)
  | rangeEndLimit (occurrence : CommentMarkerOccurrenceV7)
  | uniqueIdLimit (occurrence : CommentMarkerOccurrenceV7) (canonicalId : String)
  deriving DecidableEq, Repr, Inhabited

structure ParsedCommentRangeEvidence where
  occurrences : Array CommentMarkerOccurrenceV7 := #[]
  canonicalIds : Array String := #[]
  associations : Std.HashMap String CommentMarkerAssociationV7 := {}
  referenceOccurrences : Nat := 0
  rangeStartOccurrences : Nat := 0
  rangeEndOccurrences : Nat := 0
  markerOccurrences : Nat := 0
  processedEventCount : Nat := 0
  processedStoryCount : Nat := 0
  crossing : Option CommentMarkerCrossingV7 := none
  typedState : TypedMarkerScanState := {}
  deriving Inhabited

def concurrentTypedMarkerSourceKindV7 :
    Tier2.NoteReferenceIntegrity.SourceStory → TypedSourceKind
  | .main => .main
  | .header => .header
  | .footer => .footer
  | .footnotes => .footnotes
  | .endnotes => .endnotes

def concurrentTypedMarkerSlotV7
    (realization : Tier2.NoteReferenceIntegrity.StoryRealization) :
    TypedSourceSlot := {
  kind := concurrentTypedMarkerSourceKindV7 realization.slot.story
  physicalStoryOrdinal := realization.slot.ordinal
  source := {
    side := .original
    sourceOrdinal := realization.slot.ordinal
    partPath := typedBoundedBytesOfString realization.slot.normalizedPartPath
    parsed := {
      rawBytes := ByteArray.empty
      expectedRootUri := typedBoundedBytesOfString ""
      expectedRootLocalName := typedBoundedBytesOfString ""
      events := []
      depthLimit := 0
      eventLimit := 0
    }
  }
}

def concurrentTypedMarkerInputV7
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence) :
    TypedMarkerScanInput := {
  stories := []
  slots := scans.realizations.map concurrentTypedMarkerSlotV7
  wmlNamespace := typedWmlNamespace
  idLocalName := typedLiteral [105,100]
  rangeStartLocalName :=
    typedLiteral [99,111,109,109,101,110,116,82,97,110,103,101,83,116,97,114,116]
  rangeEndLocalName :=
    typedLiteral [99,111,109,109,101,110,116,82,97,110,103,101,69,110,100]
  referenceLocalName :=
    typedLiteral [99,111,109,109,101,110,116,82,101,102,101,114,101,110,99,101]
}

def commentMarkerCandidateV7 : XmlEvent →
    Option (CommentMarkerKindV7 × Option String)
  | .startElement uri localName attributes _ _ =>
    if uri != wmlNamespace then none
    else if localName == "commentRangeStart" then
      some (.rangeStart,
        Tier2.NoteReferenceIntegrity.expandedWmlAttribute? attributes "id")
    else if localName == "commentRangeEnd" then
      some (.rangeEnd,
        Tier2.NoteReferenceIntegrity.expandedWmlAttribute? attributes "id")
    else if localName == "commentReference" then
      some (.reference,
        Tier2.NoteReferenceIntegrity.expandedWmlAttribute? attributes "id")
    else none
  | .endElement .. | .text .. => none

def commentMarkerKindCandidateV7 : XmlEvent → Option CommentMarkerKindV7
  | .startElement uri localName _ _ _ =>
    if uri != wmlNamespace then none
    else if localName == "commentRangeStart" then some .rangeStart
    else if localName == "commentRangeEnd" then some .rangeEnd
    else if localName == "commentReference" then some .reference
    else none
  | .endElement .. | .text .. => none

def updateCommentMarkerAssociationV7
    (association : CommentMarkerAssociationV7)
    (occurrence : CommentMarkerOccurrenceV7) : CommentMarkerAssociationV7 :=
  match occurrence.kind with
  | .reference =>
      { association with
        referenceCount := association.referenceCount + 1
        firstReference := association.firstReference.orElse (fun _ => some occurrence)
        firstDuplicateReference :=
          if association.referenceCount == 1 then some occurrence
          else association.firstDuplicateReference }
  | .rangeStart =>
      { association with
        rangeStartCount := association.rangeStartCount + 1
        firstRangeStart := association.firstRangeStart.orElse (fun _ => some occurrence)
        firstDuplicateRangeStart :=
          if association.rangeStartCount == 1 then some occurrence
          else association.firstDuplicateRangeStart }
  | .rangeEnd =>
      { association with
        rangeEndCount := association.rangeEndCount + 1
        firstRangeEnd := association.firstRangeEnd.orElse (fun _ => some occurrence)
        firstDuplicateRangeEnd :=
          if association.rangeEndCount == 1 then some occurrence
          else association.firstDuplicateRangeEnd }

def retainedCommentMarkerStoppedV7
    (relationshipPresent : Bool)
    (state : ParsedCommentRangeEvidence) : Bool :=
  if relationshipPresent then state.typedState.crossing.isSome
  else state.crossing.isSome

def scanRetainedCommentMarkerEventV7
    (typedInput : TypedMarkerScanInput) (relationshipPresent : Bool)
    (sourceSetOrdinal : Nat) (sourceStory : String)
    (sourceStoryOrdinal eventOrdinal : Nat)
    (state : ParsedCommentRangeEvidence) (event : XmlEvent) :
    ParsedCommentRangeEvidence :=
  if retainedCommentMarkerStoppedV7 relationshipPresent state then state
  else
    let typedState :=
      scanTypedMarkerEventV7 typedInput sourceSetOrdinal eventOrdinal
        state.typedState (typedXmlEventOfProduction eventOrdinal event)
    let result := if !relationshipPresent then
      match commentMarkerKindCandidateV7 event with
      | none => state
      | some kind =>
        let kindOrdinal := match kind with
          | .reference => state.referenceOccurrences
          | .rangeStart => state.rangeStartOccurrences
          | .rangeEnd => state.rangeEndOccurrences
        let occurrence : CommentMarkerOccurrenceV7 := {
          kind
          sourceSetOrdinal
          sourceStory
          sourceStoryOrdinal
          sourceEventOrdinal := eventOrdinal
          markerOccurrenceOrdinal := state.markerOccurrences
          kindOccurrenceOrdinal := kindOrdinal
          rawId := none
          canonicalId := none
        }
        { state with crossing := some (.relationshipRequired occurrence) }
    else
      match commentMarkerCandidateV7 event with
      | none => state
      | some (kind, rawId) =>
        let kindOrdinal := match kind with
          | .reference => state.referenceOccurrences
          | .rangeStart => state.rangeStartOccurrences
          | .rangeEnd => state.rangeEndOccurrences
        let canonicalId := rawId.bind fun raw =>
          (parseDecimalId raw).toOption.map (·.text)
        let occurrence : CommentMarkerOccurrenceV7 := {
          kind
          sourceSetOrdinal
          sourceStory
          sourceStoryOrdinal
          sourceEventOrdinal := eventOrdinal
          markerOccurrenceOrdinal := state.markerOccurrences
          kindOccurrenceOrdinal := kindOrdinal
          rawId
          canonicalId
        }
        if kind == .reference && kindOrdinal ==
            Tier2.CommentReferenceIntegrity.maxCommentReferences then
          { state with crossing := some (.referenceLimit occurrence) }
        else if kind == .rangeStart && kindOrdinal ==
            Tier2.CommentReferenceIntegrity.maxCommentReferences then
          { state with crossing := some (.rangeStartLimit occurrence) }
        else if kind == .rangeEnd && kindOrdinal ==
            Tier2.CommentReferenceIntegrity.maxCommentReferences then
          { state with crossing := some (.rangeEndLimit occurrence) }
        else
          let nextReference := state.referenceOccurrences +
            (if kind == .reference then 1 else 0)
          let nextStart := state.rangeStartOccurrences +
            (if kind == .rangeStart then 1 else 0)
          let nextEnd := state.rangeEndOccurrences +
            (if kind == .rangeEnd then 1 else 0)
          match canonicalId with
          | none =>
            { state with
              occurrences := state.occurrences.push occurrence
              referenceOccurrences := nextReference
              rangeStartOccurrences := nextStart
              rangeEndOccurrences := nextEnd
              markerOccurrences := state.markerOccurrences + 1 }
          | some canonical =>
            match state.associations[canonical]? with
            | some association =>
              { state with
                occurrences := state.occurrences.push occurrence
                associations := state.associations.insert canonical
                  (updateCommentMarkerAssociationV7 association occurrence)
                referenceOccurrences := nextReference
                rangeStartOccurrences := nextStart
                rangeEndOccurrences := nextEnd
                markerOccurrences := state.markerOccurrences + 1 }
            | none =>
              if state.canonicalIds.size ==
                  Tier2.CommentReferenceIntegrity.maxUniqueCommentReferenceIds then
                { state with crossing := some (.uniqueIdLimit occurrence canonical) }
              else
                { state with
                  occurrences := state.occurrences.push occurrence
                  canonicalIds := state.canonicalIds.push canonical
                  associations := state.associations.insert canonical
                    (updateCommentMarkerAssociationV7 {} occurrence)
                  referenceOccurrences := nextReference
                  rangeStartOccurrences := nextStart
                  rangeEndOccurrences := nextEnd
                  markerOccurrences := state.markerOccurrences + 1 }
    { result with typedState }

theorem scan_retained_comment_marker_event_v7_typed_state
    (typedInput : TypedMarkerScanInput)
    (sourceSetOrdinal : Nat) (sourceStory : String)
    (sourceStoryOrdinal eventOrdinal : Nat)
    (state : ParsedCommentRangeEvidence) (event : XmlEvent) :
    (scanRetainedCommentMarkerEventV7 typedInput true sourceSetOrdinal
      sourceStory sourceStoryOrdinal eventOrdinal state event).typedState =
    scanTypedMarkerEventV7 typedInput sourceSetOrdinal eventOrdinal
      state.typedState (typedXmlEventOfProduction eventOrdinal event) := by
  unfold scanRetainedCommentMarkerEventV7 retainedCommentMarkerStoppedV7
  simp only [Bool.true_eq, ↓reduceIte, Bool.not_true]
  split
  · rename_i hCrossing
    unfold scanTypedMarkerEventV7
    rw [if_pos hCrossing]
  · rfl

def commentMarkerSourceStoryName :
    Tier2.NoteReferenceIntegrity.SourceStory → String
  | .main => "main"
  | .header => "header"
  | .footer => "footer"
  | .footnotes => "footnotes"
  | .endnotes => "endnotes"

def scanRetainedCommentStoryEventsLoopV7
    (typedInput : TypedMarkerScanInput) (relationshipPresent : Bool)
    (sourceSetOrdinal : Nat)
    (sourceStory : String) (sourceStoryOrdinal : Nat) :
    Nat → ParsedCommentRangeEvidence → List XmlEvent →
      ParsedCommentRangeEvidence
  | _, state, [] => state
  | eventOrdinal, state, event :: rest =>
      if retainedCommentMarkerStoppedV7 relationshipPresent state then state
      else
        let afterEvent := scanRetainedCommentMarkerEventV7
          typedInput relationshipPresent
          sourceSetOrdinal sourceStory sourceStoryOrdinal eventOrdinal
          { state with
            processedEventCount := state.processedEventCount + 1
            typedState := { state.typedState with
              processedEventCount := state.typedState.processedEventCount + 1 } }
          event
        if retainedCommentMarkerStoppedV7 relationshipPresent afterEvent then afterEvent
        else scanRetainedCommentStoryEventsLoopV7 typedInput relationshipPresent
          sourceSetOrdinal sourceStory sourceStoryOrdinal
          (eventOrdinal + 1) afterEvent rest

def scanRetainedCommentStoryEventsV7
    (typedInput : TypedMarkerScanInput) (relationshipPresent : Bool)
    (sourceSetOrdinal : Nat)
    (realization : Tier2.NoteReferenceIntegrity.StoryRealization)
    (state : ParsedCommentRangeEvidence) : ParsedCommentRangeEvidence :=
  scanRetainedCommentStoryEventsLoopV7 typedInput relationshipPresent sourceSetOrdinal
    (commentMarkerSourceStoryName realization.slot.story)
    realization.slot.ordinal 0 state realization.visitedEvents

theorem scan_retained_comment_story_events_loop_v7_typed_state :
    ∀ (typedInput : TypedMarkerScanInput)
      (sourceSetOrdinal : Nat) (sourceStory : String)
      (sourceStoryOrdinal eventOrdinal : Nat)
      (state : ParsedCommentRangeEvidence) (events : List XmlEvent),
    (scanRetainedCommentStoryEventsLoopV7 typedInput true sourceSetOrdinal
      sourceStory sourceStoryOrdinal eventOrdinal state events).typedState =
    scanTypedStoryEventsV7 typedInput sourceSetOrdinal eventOrdinal
      (events.length + 1) state.typedState
      (typedXmlEventsOfProductionSpecV7 eventOrdinal events)
  | _, _, _, _, _, _, [] => rfl
  | typedInput, sourceSetOrdinal, sourceStory, sourceStoryOrdinal,
      eventOrdinal, state, event :: rest => by
      unfold scanRetainedCommentStoryEventsLoopV7
        typedXmlEventsOfProductionSpecV7 scanTypedStoryEventsV7
      by_cases hStopped : state.typedState.crossing.isSome = true
      · simp [retainedCommentMarkerStoppedV7, hStopped]
      · simp only [retainedCommentMarkerStoppedV7, Bool.true_eq,
          ↓reduceIte, hStopped, if_false]
        rw [scan_retained_comment_marker_event_v7_typed_state]
        by_cases hAfter :
            (scanTypedMarkerEventV7 typedInput sourceSetOrdinal eventOrdinal
              { state.typedState with
                processedEventCount := state.typedState.processedEventCount + 1 }
              (typedXmlEventOfProduction eventOrdinal event)).crossing.isSome =
              true
        · simpa [retainedCommentMarkerStoppedV7, hAfter] using
            scan_retained_comment_marker_event_v7_typed_state
              typedInput sourceSetOrdinal sourceStory sourceStoryOrdinal
              eventOrdinal
              { state with
                processedEventCount := state.processedEventCount + 1
                typedState := { state.typedState with
                  processedEventCount :=
                    state.typedState.processedEventCount + 1 } }
              event
        · simp only [retainedCommentMarkerStoppedV7, Bool.true_eq,
            ↓reduceIte, hAfter, if_false]
          have hInduction :=
            scan_retained_comment_story_events_loop_v7_typed_state
            typedInput sourceSetOrdinal sourceStory sourceStoryOrdinal
            (eventOrdinal + 1)
            (scanRetainedCommentMarkerEventV7 typedInput true sourceSetOrdinal
              sourceStory sourceStoryOrdinal eventOrdinal
              { state with
                processedEventCount := state.processedEventCount + 1
                typedState := { state.typedState with
                  processedEventCount :=
                    state.typedState.processedEventCount + 1 } }
              event)
            rest
          rw [scan_retained_comment_marker_event_v7_typed_state] at hInduction
          simpa only [List.length_cons, Nat.add_assoc,
            Nat.reduceAdd] using hInduction

def scanRetainedCommentStoriesLoopV7
    (typedInput : TypedMarkerScanInput) (relationshipPresent : Bool) :
    Nat → ParsedCommentRangeEvidence →
      List Tier2.NoteReferenceIntegrity.StoryRealization →
      ParsedCommentRangeEvidence
  | _, state, [] => state
  | sourceSetOrdinal, state, realization :: rest =>
      if retainedCommentMarkerStoppedV7 relationshipPresent state then state
      else
        let afterStory := scanRetainedCommentStoryEventsV7
          typedInput relationshipPresent sourceSetOrdinal
          realization { state with
            processedStoryCount := state.processedStoryCount + 1
            typedState := { state.typedState with
              processedStoryCount := state.typedState.processedStoryCount + 1 } }
        if retainedCommentMarkerStoppedV7 relationshipPresent afterStory then afterStory
        else scanRetainedCommentStoriesLoopV7 typedInput relationshipPresent
          (sourceSetOrdinal + 1) afterStory rest

inductive ConcurrentTypedStoryEventsV7 :
    List TypedStorySource →
      List Tier2.NoteReferenceIntegrity.StoryRealization → Prop
  | nil : ConcurrentTypedStoryEventsV7 [] []
  | cons (story : TypedStorySource)
      (realization : Tier2.NoteReferenceIntegrity.StoryRealization)
      (stories : List TypedStorySource)
      (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization)
      (eventsExact : story.parsed.events =
        typedXmlEventsOfProductionSpecV7 0 realization.visitedEvents)
      (restExact : ConcurrentTypedStoryEventsV7 stories realizations) :
      ConcurrentTypedStoryEventsV7
        (story :: stories) (realization :: realizations)

theorem concurrent_typed_story_events_v7_length
    (stories : List TypedStorySource)
    (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization)
    (hExact : ConcurrentTypedStoryEventsV7 stories realizations) :
    stories.length = realizations.length := by
  induction hExact with
  | nil => rfl
  | cons _ _ _ _ _ _ hInduction =>
      simp only [List.length_cons, hInduction]

theorem scan_retained_comment_stories_loop_v7_typed_state
    (typedInput : TypedMarkerScanInput) :
    ∀ (sourceSetOrdinal : Nat) (state : ParsedCommentRangeEvidence)
      (stories : List TypedStorySource)
      (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization),
    ConcurrentTypedStoryEventsV7 stories realizations →
    (scanRetainedCommentStoriesLoopV7 typedInput true sourceSetOrdinal
      state realizations).typedState =
    scanTypedStoriesV7 typedInput sourceSetOrdinal
      (stories.length + 1) state.typedState stories
  | _, _, [], [], .nil => rfl
  | sourceSetOrdinal, state, story :: stories,
      realization :: realizations, .cons _ _ _ _ hEvents hRest => by
      unfold scanRetainedCommentStoriesLoopV7 scanTypedStoriesV7
      by_cases hStopped : state.typedState.crossing.isSome = true
      · simp [retainedCommentMarkerStoppedV7, hStopped]
      · simp only [retainedCommentMarkerStoppedV7, Bool.true_eq,
          ↓reduceIte, hStopped, if_false]
        let beforeStory : ParsedCommentRangeEvidence := {
          state with
          processedStoryCount := state.processedStoryCount + 1
          typedState := { state.typedState with
            processedStoryCount := state.typedState.processedStoryCount + 1 }
        }
        let afterStory := scanRetainedCommentStoryEventsV7 typedInput true
          sourceSetOrdinal realization beforeStory
        have hStory :
            afterStory.typedState =
              scanTypedStoryEventsV7 typedInput sourceSetOrdinal 0
                (story.parsed.events.length + 1)
                beforeStory.typedState story.parsed.events := by
          unfold afterStory scanRetainedCommentStoryEventsV7
          rw [hEvents]
          simpa only [typed_xml_events_of_production_spec_v7_length] using
            scan_retained_comment_story_events_loop_v7_typed_state
            typedInput sourceSetOrdinal
            (commentMarkerSourceStoryName realization.slot.story)
            realization.slot.ordinal 0 beforeStory realization.visitedEvents
        by_cases hAfter :
            (scanTypedStoryEventsV7 typedInput sourceSetOrdinal 0
              (story.parsed.events.length + 1)
              beforeStory.typedState story.parsed.events).crossing.isSome = true
        · have hAfterStory : afterStory.typedState.crossing.isSome = true := by
            rw [hStory]
            exact hAfter
          rw [show
            (scanRetainedCommentStoryEventsV7 typedInput true
              sourceSetOrdinal realization beforeStory).typedState.crossing.isSome =
                true by
              exact hAfterStory]
          rw [hAfter]
          simp only [Bool.false_eq_true, if_false, if_true]
          exact hStory
        · have hInduction :=
            scan_retained_comment_stories_loop_v7_typed_state typedInput
              (sourceSetOrdinal + 1) afterStory stories realizations hRest
          rw [hStory] at hInduction
          have hTypedAfterFalse :
              (scanTypedStoryEventsV7 typedInput sourceSetOrdinal 0
                (story.parsed.events.length + 1)
                beforeStory.typedState story.parsed.events).crossing.isSome =
                  false :=
            Bool.eq_false_iff.mpr hAfter
          have hAfterStory :
              afterStory.typedState.crossing.isSome = false := by
            rw [hStory]
            exact hTypedAfterFalse
          rw [show
            (scanRetainedCommentStoryEventsV7 typedInput true
              sourceSetOrdinal realization beforeStory).typedState.crossing.isSome =
                false by
              exact hAfterStory]
          rw [hTypedAfterFalse]
          simpa only [Bool.false_eq_true, if_false,
            List.length_cons, Nat.add_assoc, Nat.reduceAdd] using hInduction

def scanRetainedCommentMarkersForRelationshipV7
    (relationshipPresent : Bool)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence) :
    Except String ParsedCommentRangeEvidence :=
  if Tier2.CommentReferenceIntegrity.storySlotListsMatch set.sources
      (scans.realizations.map (·.slot)) then
    let typedInput := concurrentTypedMarkerInputV7 scans
    .ok <| scanRetainedCommentStoriesLoopV7 typedInput relationshipPresent
      0 {} scans.realizations
  else
    .error "retained comment source set does not match retained story scans"

def scanRetainedCommentMarkersV7
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence) :
    Except String ParsedCommentRangeEvidence :=
  scanRetainedCommentMarkersForRelationshipV7 true set scans

theorem scan_retained_comment_markers_for_relationship_v7_set_source_ext
    (relationshipPresent : Bool)
    (left right : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (hSources : left.sources = right.sources) :
    scanRetainedCommentMarkersForRelationshipV7
        relationshipPresent left scans =
      scanRetainedCommentMarkersForRelationshipV7
        relationshipPresent right scans := by
  unfold scanRetainedCommentMarkersForRelationshipV7
  rw [hSources]

theorem scan_retained_comment_markers_v7_set_source_ext
    (left right : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (hSources : left.sources = right.sources) :
    scanRetainedCommentMarkersV7 left scans =
      scanRetainedCommentMarkersV7 right scans :=
  scan_retained_comment_markers_for_relationship_v7_set_source_ext
    true left right scans hSources

def retainedCommentEarlyCrossingEventV7 : XmlEvent :=
  .startElement wmlNamespace "commentRangeStart"
    [{ uri := wmlNamespace, localName := "id", value := "7" }] 1 true

def retainedCommentSkippedEventV7 : XmlEvent :=
  .startElement wmlNamespace "commentReference"
    [{ uri := wmlNamespace, localName := "id", value := "8" }] 1 true

theorem retained_comment_event_scan_stops_at_crossing_witness :
    let typedInput := concurrentTypedMarkerInputV7 {
      realizations := []
      parsedReferences := []
      parsedDefinitions := []
      parsedPoison := []
    }
    let initial : ParsedCommentRangeEvidence :=
      { rangeStartOccurrences :=
          Tier2.CommentReferenceIntegrity.maxCommentReferences
        typedState := {
          rangeStartOccurrences :=
            Tier2.CommentReferenceIntegrity.maxCommentReferences
        } }
    let result := scanRetainedCommentStoryEventsLoopV7 typedInput false
      0 "main" 0 0 initial
        [retainedCommentEarlyCrossingEventV7, retainedCommentSkippedEventV7]
    result.processedEventCount = 1 ∧
    result.rangeStartOccurrences =
      Tier2.CommentReferenceIntegrity.maxCommentReferences ∧
    result.referenceOccurrences = 0 ∧
    result.crossing.isSome = true := by
  decide

theorem retained_comment_story_scan_does_not_enter_later_stories
    (typedInput : TypedMarkerScanInput)
    (sourceOrdinal : Nat) (state : ParsedCommentRangeEvidence)
    (stories : List Tier2.NoteReferenceIntegrity.StoryRealization)
    (hCrossing : state.typedState.crossing.isSome = true) :
    scanRetainedCommentStoriesLoopV7
      typedInput true sourceOrdinal state stories = state := by
  cases stories with
  | nil => rfl
  | cons story rest =>
      simp [scanRetainedCommentStoriesLoopV7,
        retainedCommentMarkerStoppedV7, hCrossing]

def retainedCommentSourceStoryV7 (sourceStory : String) :
    Tier2.NoteReferenceIntegrity.SourceStory :=
  if sourceStory == "header" then .header
  else if sourceStory == "footer" then .footer
  else if sourceStory == "footnotes" then .footnotes
  else if sourceStory == "endnotes" then .endnotes
  else .main

def retainedCommentStoryRealizationV7 (source : NoteSource) :
    Tier2.NoteReferenceIntegrity.StoryRealization :=
  { slot := {
      story := retainedCommentSourceStoryV7 source.sourceStory
      ordinal := source.sourceStoryOrdinal
      normalizedPartPath := source.normalizedPartPath }
    bytes := source.parseEvidence.bytes
    text := source.parseEvidence.text
    root := {
      sourceText := source.parseEvidence.text
      namespaceUri := source.parseEvidence.expectedRootUri
      localName := source.parseEvidence.expectedRootLocalName }
    visitedEvents := source.parseEvidence.parsed.events
    completed := source.parseEvidence.parsed.rootSeen &&
      source.parseEvidence.parsed.stack.isEmpty &&
      source.parseEvidence.parsed.eventCount ==
        source.parseEvidence.parsed.events.length }

def retainedCommentStoryRealizationsV7 :
    List NoteSource → List Tier2.NoteReferenceIntegrity.StoryRealization
  | [] => []
  | source :: rest =>
      retainedCommentStoryRealizationV7 source ::
        retainedCommentStoryRealizationsV7 rest

def retainedMissingRelationshipStoryV7
    (story : Tier2.NoteReferenceIntegrity.SourceStory)
    (ordinal : Nat) (events : List XmlEvent) :
    Tier2.NoteReferenceIntegrity.StoryRealization :=
  { slot := {
      story
      ordinal
      normalizedPartPath := if story == .main then
        "word/document.xml" else "word/header1.xml" }
    bytes := ByteArray.empty
    text := ""
    root := { sourceText := "", namespaceUri := "", localName := "" }
    visitedEvents := events
    completed := true }

def retainedMissingRelationshipScansV7 :
    Tier2.NoteReferenceIntegrity.SideScanEvidence :=
  { realizations := [
      retainedMissingRelationshipStoryV7 .main 0
        [retainedCommentEarlyCrossingEventV7, retainedCommentSkippedEventV7],
      retainedMissingRelationshipStoryV7 .header 0
        [retainedCommentSkippedEventV7]]
    parsedReferences := []
    parsedDefinitions := []
    parsedPoison := [] }

def retainedMissingRelationshipSetV7 :
    Tier2.CommentReferenceIntegrity.CommentSourceSet :=
  { side := .original
    sources := retainedMissingRelationshipScansV7.realizations.map (·.slot)
    sourceEvents := [] }

def retainedMissingRelationshipEarlyStopCheckV7 :
    Except String ParsedCommentRangeEvidence → Bool
  | .error _ => false
  | .ok evidence =>
    evidence.processedEventCount == 1 &&
    evidence.processedStoryCount == 1 &&
    evidence.occurrences.isEmpty &&
    evidence.canonicalIds.isEmpty &&
    evidence.referenceOccurrences == 0 &&
    evidence.rangeStartOccurrences == 0 &&
    evidence.rangeEndOccurrences == 0 &&
    match evidence.crossing with
    | some (.relationshipRequired occurrence) =>
        occurrence.kind == .rangeStart &&
        occurrence.sourceSetOrdinal == 0 &&
        occurrence.sourceStory == "main" &&
        occurrence.sourceStoryOrdinal == 0 &&
        occurrence.sourceEventOrdinal == 0 &&
        occurrence.rawId.isNone &&
        occurrence.canonicalId.isNone
    | _ => false

theorem retained_missing_relationship_scan_stops_at_first_marker_witness :
    retainedMissingRelationshipEarlyStopCheckV7
      (scanRetainedCommentMarkersForRelationshipV7 false
        retainedMissingRelationshipSetV7
        retainedMissingRelationshipScansV7) = true := by
  decide

def retainedCommentMarkerSourceSetV7 (side : VerifierSide)
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence) :
    Tier2.CommentReferenceIntegrity.CommentSourceSet :=
  { side
    sources := scans.realizations.map (·.slot)
    sourceEvents := Tier2.CommentReferenceIntegrity.indexedVisitedEvents
      0 scans.realizations }

def retainedCommentMarkerScanForRelationshipV7
    (relationshipPresent : Bool)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence) :
    Except String ParsedCommentRangeEvidence :=
  scanRetainedCommentMarkersForRelationshipV7 relationshipPresent set scans

structure RetainedCommentMarkerScanRun
    (relationshipPresent : Bool) (side : VerifierSide) where
  set : Tier2.CommentReferenceIntegrity.CommentSourceSet
  scans : Tier2.NoteReferenceIntegrity.SideScanEvidence
  setExact : set = retainedCommentMarkerSourceSetV7 side scans
  result : Except String ParsedCommentRangeEvidence
  resultExact :
    result =
      retainedCommentMarkerScanForRelationshipV7
        relationshipPresent set scans

theorem retained_comment_marker_scan_run_exact
    (relationshipPresent : Bool) (side : VerifierSide)
    (run : RetainedCommentMarkerScanRun relationshipPresent side)
    (evidence : ParsedCommentRangeEvidence)
    (hResult : run.result = .ok evidence) :
    retainedCommentMarkerScanForRelationshipV7
      relationshipPresent run.set run.scans = .ok evidence :=
  run.resultExact.symm.trans hResult

theorem retained_comment_marker_scan_run_for_matching_set
    (relationshipPresent : Bool) (side : VerifierSide)
    (run : RetainedCommentMarkerScanRun relationshipPresent side)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (evidence : ParsedCommentRangeEvidence)
    (hSources : set.sources = run.scans.realizations.map (·.slot))
    (hResult : run.result = .ok evidence) :
    retainedCommentMarkerScanForRelationshipV7
      relationshipPresent set run.scans = .ok evidence := by
  have hRunSetSources :
      run.set.sources = run.scans.realizations.map (·.slot) := by
    have hExact := congrArg
      Tier2.CommentReferenceIntegrity.CommentSourceSet.sources run.setExact
    simpa [retainedCommentMarkerSourceSetV7] using hExact
  unfold retainedCommentMarkerScanForRelationshipV7
  rw [scan_retained_comment_markers_for_relationship_v7_set_source_ext
    relationshipPresent set run.set run.scans
      (hSources.trans hRunSetSources.symm)]
  exact retained_comment_marker_scan_run_exact
    relationshipPresent side run evidence hResult

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
  markerScanRun :
    Option (RetainedCommentMarkerScanRun identity.isSome side)
  markerScanInvocationCount : Nat
  complete : Bool
  semanticLimitCrossed : Bool
  productionIntegrityPassed : Bool
  usage : SideResourceUsage
  tripleUsage : CommentTripleResourceUsage
  issues : List Json
  inventory : CommentInventoryEvidence

def CommentSideEvidence.markerScan
    (evidence : CommentSideEvidence) :
    Option ParsedCommentRangeEvidence :=
  evidence.markerScanRun.bind (·.result.toOption)

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
    markerScanRun := none
    markerScanInvocationCount := 0
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

def commentMarkerIssueJsonV7 (code detail : String) (side : VerifierSide)
    (occurrence : CommentMarkerOccurrenceV7) (occurrenceCount : Nat := 1)
    (optional : List (String × Json) := []) : Json :=
  Json.mkObj <|
    [ ("code", toJson code)
    , ("side", toJson side.toString)
    , ("kind", toJson "comments")
    , ("detail", toJson (boundUtf8 detail 256))
    , ("ordinalSpace", toJson occurrence.kind.ordinalSpace)
    , ("firstOccurrenceOrdinal", toJson occurrence.kindOccurrenceOrdinal)
    , ("occurrenceCount", toJson occurrenceCount)
    , ("source", noteSourceJson occurrence.sourceStory occurrence.sourceStoryOrdinal)
    , ("sourceSetOrdinal", toJson occurrence.sourceSetOrdinal)
    , ("sourceEventOrdinal", toJson occurrence.sourceEventOrdinal)
    ] ++ optional

def malformedCommentMarkerIssuesV7 (side : VerifierSide)
    (evidence : ParsedCommentRangeEvidence) : List Json :=
  evidence.occurrences.foldl (fun issues occurrence =>
    if occurrence.canonicalId.isSome then issues
    else
      let codePrefix := match occurrence.kind with
        | .rangeStart => "COMMENT_RANGE_START_ID"
        | .rangeEnd => "COMMENT_RANGE_END_ID"
        | .reference => "COMMENT_REFERENCE_ID"
      let label := match occurrence.kind with
        | .rangeStart => "comment range start"
        | .rangeEnd => "comment range end"
        | .reference => "comment reference"
      let issue := match occurrence.rawId with
        | none => commentMarkerIssueJsonV7 (codePrefix ++ "_MISSING")
            (label ++ " has no w:id") side occurrence
        | some raw =>
          if raw.toUTF8.size > 64 then
            commentMarkerIssueJsonV7 (codePrefix ++ "_TOO_LONG")
              (label ++ " w:id exceeds 64 UTF-8 bytes") side occurrence 1
              [("rawIdByteLength", toJson raw.toUTF8.size)]
          else
            commentMarkerIssueJsonV7 (codePrefix ++ "_MALFORMED")
              (label ++ " w:id is not an ST_DecimalNumber") side occurrence 1
              [("rawId", toJson raw)]
      issues ++ [issue]) []

def commentMarkerCrossingIssuesV7 (side : VerifierSide)
    (crossing : Option CommentMarkerCrossingV7) : List Json :=
  match crossing with
  | none => []
  | some (.relationshipRequired occurrence) =>
      [commentMarkerIssueJsonV7 "COMMENT_RELATIONSHIP_REQUIRED"
        "a comment marker requires one exact internal comments relationship"
        side occurrence]
  | some (.referenceLimit occurrence) =>
      [commentMarkerIssueJsonV7 "COMMENT_REFERENCE_OCCURRENCE_LIMIT_EXCEEDED"
        "comment reference occurrence limit exceeded" side occurrence]
  | some (.rangeStartLimit occurrence) =>
      [commentMarkerIssueJsonV7 "COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED"
        "comment range start occurrence limit exceeded" side occurrence]
  | some (.rangeEndLimit occurrence) =>
      [commentMarkerIssueJsonV7 "COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED"
        "comment range end occurrence limit exceeded" side occurrence]
  | some (.uniqueIdLimit occurrence canonicalId) =>
      [commentMarkerIssueJsonV7
        "COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED"
        "unique canonical comment reference or range ID limit exceeded"
        side occurrence 1 [("canonicalId", toJson canonicalId)]]

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

def commentDefinitionCountsV7
    (definitions : List (CommentDefinitionOccurrence × CanonicalDecimal)) :
    Std.HashMap String Nat :=
  definitions.foldl (fun counts definition =>
    let id := definition.2.text
    counts.insert id (counts[id]?.getD 0 + 1)) {}

def earlierCommentMarkerV7
    (left right : CommentMarkerOccurrenceV7) : CommentMarkerOccurrenceV7 :=
  if left.markerOccurrenceOrdinal ≤ right.markerOccurrenceOrdinal then left else right

def earliestCommentMarkerV7
    (association : CommentMarkerAssociationV7) :
    Option CommentMarkerOccurrenceV7 :=
  [association.firstRangeStart, association.firstRangeEnd,
    association.firstReference].foldl (fun current candidate =>
      match current, candidate with
      | none, other => other
      | some value, none => some value
      | some left, some right => some (earlierCommentMarkerV7 left right)) none

def sameCommentMarkerStoryV7
    (left right : CommentMarkerOccurrenceV7) : Bool :=
  left.sourceStory == right.sourceStory &&
  left.sourceStoryOrdinal == right.sourceStoryOrdinal

def relatedCrossStoryMarkerV7 (first : CommentMarkerOccurrenceV7)
    (association : CommentMarkerAssociationV7) :
    Option CommentMarkerOccurrenceV7 :=
  [association.firstRangeStart, association.firstRangeEnd,
    association.firstReference].foldl (fun current candidate =>
      match candidate with
      | none => current
      | some value =>
        if sameCommentMarkerStoryV7 first value then current
        else match current with
          | none => some value
          | some prior => some (earlierCommentMarkerV7 prior value)) none

def canonicalCommentTopologyIssueV7 (side : VerifierSide)
    (canonicalId : String) (association : CommentMarkerAssociationV7) :
    Option Json :=
  let canonical := [("canonicalId", toJson canonicalId)]
  if association.referenceCount > 1 then
    association.firstDuplicateReference.map fun occurrence =>
      commentMarkerIssueJsonV7 "COMMENT_REFERENCE_DUPLICATE"
        "multiple comment references have the same canonical w:id"
        side occurrence (association.referenceCount - 1) canonical
  else if association.referenceCount == 0 &&
      (association.rangeStartCount > 0 || association.rangeEndCount > 0) then
    (earliestCommentMarkerV7 association).map fun occurrence =>
      commentMarkerIssueJsonV7 "COMMENT_REFERENCE_MISSING"
        "a comment range endpoint has no unique comment reference"
        side occurrence 1 canonical
  else if association.rangeStartCount > 1 then
    association.firstDuplicateRangeStart.map fun occurrence =>
      commentMarkerIssueJsonV7 "COMMENT_RANGE_START_DUPLICATE"
        "multiple comment range starts have the same canonical w:id"
        side occurrence (association.rangeStartCount - 1) canonical
  else if association.rangeEndCount > 1 then
    association.firstDuplicateRangeEnd.map fun occurrence =>
      commentMarkerIssueJsonV7 "COMMENT_RANGE_END_DUPLICATE"
        "multiple comment range ends have the same canonical w:id"
        side occurrence (association.rangeEndCount - 1) canonical
  else if association.rangeStartCount == 1 && association.rangeEndCount == 0 then
    association.firstRangeStart.map fun occurrence =>
      commentMarkerIssueJsonV7 "COMMENT_RANGE_START_ORPHANED"
        "the Safe-DOCX paired-or-point profile rejects an unmatched range start"
        side occurrence 1 canonical
  else if association.rangeEndCount == 1 && association.rangeStartCount == 0 then
    association.firstRangeEnd.map fun occurrence =>
      commentMarkerIssueJsonV7 "COMMENT_RANGE_END_ORPHANED"
        "the Safe-DOCX paired-or-point profile rejects an unmatched range end"
        side occurrence 1 canonical
  else if association.rangeStartCount == 1 && association.rangeEndCount == 1 &&
      association.referenceCount == 1 then
    match earliestCommentMarkerV7 association with
    | none => none
    | some first =>
      match relatedCrossStoryMarkerV7 first association with
      | some related =>
        some <| commentMarkerIssueJsonV7 "COMMENT_RANGE_CROSS_STORY"
          "comment range endpoints and reference must share one physical story"
          side first 1 <| canonical ++
          [ ("relatedSource",
              noteSourceJson related.sourceStory related.sourceStoryOrdinal)
          , ("relatedSourceSetOrdinal", toJson related.sourceSetOrdinal)
          , ("relatedSourceEventOrdinal", toJson related.sourceEventOrdinal)
          ]
      | none =>
        match association.firstRangeStart, association.firstRangeEnd with
        | some start, some finish =>
          if start.sourceEventOrdinal < finish.sourceEventOrdinal then none
          else some <| commentMarkerIssueJsonV7 "COMMENT_RANGE_REVERSED"
            "comment range start must precede its end in the same physical story"
            side start 1 <| canonical ++
            [("rangeEndEventOrdinal", toJson finish.sourceEventOrdinal)]
        | _, _ => none
  else none

def commentTopologyIssuesV7 (side : VerifierSide)
    (evidence : ParsedCommentRangeEvidence) : List Json :=
  evidence.canonicalIds.foldl (fun issues canonicalId =>
    match evidence.associations[canonicalId]? with
    | none => issues
    | some association =>
      match canonicalCommentTopologyIssueV7 side canonicalId association with
      | none => issues
      | some issue => issues ++ [issue]) []

def missingCommentDefinitionIssuesV7 (side : VerifierSide)
    (evidence : ParsedCommentRangeEvidence)
    (definitionCounts : Std.HashMap String Nat) : List Json :=
  evidence.canonicalIds.foldl (fun issues canonicalId =>
    if definitionCounts[canonicalId]?.getD 0 == 1 then issues
    else match evidence.associations[canonicalId]?.bind earliestCommentMarkerV7 with
      | none => issues
      | some occurrence =>
        issues ++ [commentMarkerIssueJsonV7 "COMMENT_DEFINITION_MISSING"
          "comment source ID does not resolve to exactly one direct definition"
          side occurrence 1 [("canonicalId", toJson canonicalId)]]) []

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
    markerScanRun := none
    markerScanInvocationCount := 0
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
    (tripleUsage : CommentTripleResourceUsage)
    (markerSourceScans : Tier2.NoteReferenceIntegrity.SideScanEvidence) :
    IO CommentSideEvidence := do
  let sources := appendCommentNoteSources noteEvidence
  let markerSourceSet := retainedCommentMarkerSourceSetV7 side markerSourceScans
  if !noteEvidence.complete then
    return {
      side, sources, sourcePartitionAdmitted := false
      realizationFailureCode := none
      realizationFailureDetail := none
      identity := none, partPresent := false, part := none
      retainedScan := none, markerScanRun := none, markerScanInvocationCount := 0
      complete := false, semanticLimitCrossed := true
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
      retainedScan := none, markerScanRun := none, markerScanInvocationCount := 0
      complete := false, semanticLimitCrossed := true
      productionIntegrityPassed := false, usage := noteEvidence.usage
      tripleUsage
      issues := [commentSelectionIssue side relationships failure]
      inventory := zeroCommentInventory side none
    }
  | .ok none =>
    let markerScanResult := retainedCommentMarkerScanForRelationshipV7
      false markerSourceSet markerSourceScans
    let .ok markerScan := markerScanResult | return {
      side, sources, sourcePartitionAdmitted := false
      realizationFailureCode := none
      realizationFailureDetail := some "retained comment source identities do not match"
      identity := none, partPresent := false, part := none
      retainedScan := none, markerScanRun := some {
        set := markerSourceSet
        scans := markerSourceScans
        setExact := rfl
        result := markerScanResult
        resultExact := rfl
      }, markerScanInvocationCount := 1
      complete := false, semanticLimitCrossed := true
      productionIntegrityPassed := false, usage := noteEvidence.usage
      tripleUsage
      issues := [commentIssueJson "COMMENT_SOURCE_PARTITION_INCOMPLETE"
        "the retained comment source identities do not match the retained scans"
        side "source" 0 "main" 0]
      inventory := zeroCommentInventory side none
    }
    match markerScan.crossing with
    | some crossing =>
      return {
        side, sources, sourcePartitionAdmitted := true
        realizationFailureCode := none
        realizationFailureDetail := none
        identity := none, partPresent := false, part := none
        retainedScan := none, markerScanRun := some {
          set := markerSourceSet
          scans := markerSourceScans
          setExact := rfl
          result := markerScanResult
          resultExact := rfl
        }
        markerScanInvocationCount := 1
        complete := false, semanticLimitCrossed := true
        productionIntegrityPassed := false, usage := noteEvidence.usage
        tripleUsage
        issues := commentMarkerCrossingIssuesV7 side (some crossing)
        inventory := zeroCommentInventory side none
      }
    | none =>
      let input : CommentScanInput := {
        sourceEvents := []
        definitionEvents := []
      }
      let retained := retainCommentScanEvidence input
      return {
        side, sources, sourcePartitionAdmitted := true
        realizationFailureCode := none
        realizationFailureDetail := none
        identity := none, partPresent := false, part := none
        retainedScan := some retained, markerScanRun := some {
          set := markerSourceSet
          scans := markerSourceScans
          setExact := rfl
          result := markerScanResult
          resultExact := rfl
        }
        markerScanInvocationCount := 1, complete := true
        semanticLimitCrossed := false, productionIntegrityPassed := true
        usage := noteEvidence.usage, tripleUsage, issues := []
        inventory := {
          side := side
          status := "passed"
          identity := none
          referenceOccurrences := 0
          rangeStartOccurrences := 0
          rangeEndOccurrences := 0
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
        part := none, retainedScan := none, markerScanRun := none
        markerScanInvocationCount := 0
        complete := false
        semanticLimitCrossed := loaded.globalStop
        productionIntegrityPassed := false
        usage := loaded.usage
        tripleUsage := loadedTripleUsage
        issues := [issue]
        inventory := zeroCommentInventory side (some selected)
      }
    | .ok part =>
      let markerScanResult := retainedCommentMarkerScanForRelationshipV7
        true markerSourceSet markerSourceScans
      let .ok markerScan := markerScanResult | return {
        side := side
        sources := sources
        sourcePartitionAdmitted := false
        realizationFailureCode := none
        realizationFailureDetail := some "retained comment source identities do not match"
        identity := some selected
        partPresent := true
        part := some part
        retainedScan := none, markerScanRun := some {
          set := markerSourceSet
          scans := markerSourceScans
          setExact := rfl
          result := markerScanResult
          resultExact := rfl
        }, markerScanInvocationCount := 1
        complete := false, semanticLimitCrossed := true
        productionIntegrityPassed := false
        usage := loaded.usage
        tripleUsage := loadedTripleUsage
        issues := [commentIssueJson "COMMENT_SOURCE_PARTITION_INCOMPLETE"
          "the retained comment source identities do not match the retained scans"
          side "source" 0 "main" 0]
        inventory := zeroCommentInventory side (some selected)
      }
      let input : CommentScanInput := {
        sourceEvents := []
        definitionEvents := part.parseEvidence.parsed.events
      }
      let retained := retainCommentScanEvidence input
      let scan := retained.output.scan
      let definitions := commentCanonicalDefinitionPairs scan.definitions
      let definitionCounts := commentDefinitionCountsV7 definitions
      let malformed := malformedCommentMarkerIssuesV7 side markerScan ++
        commentDefinitionIssues side scan.definitions
      let duplicates := duplicateCommentDefinitionIssues side definitions
      let missing := missingCommentDefinitionIssuesV7 side markerScan definitionCounts
      let topology := commentTopologyIssuesV7 side markerScan
      let nonDirect := scan.nonDirectDefinitions.map fun definition =>
        let canonicalId := definition.rawId.bind fun raw =>
          (parseDecimalId raw).toOption.map (·.text)
        commentIssueJson "COMMENT_DEFINITION_NOT_DIRECT"
          "w:comment definitions must be direct children of w:comments"
          side "definition" definition.occurrenceOrdinal "comments" 0
          (canonicalId.map (fun value => ("canonicalId", toJson value))).toList
      let definitionCrossingIssues := match retained.output.crossing with
        | none => []
        | some (.definitions ordinal) =>
          [commentIssueJson "COMMENT_DEFINITION_LIMIT_EXCEEDED"
            "direct comment definition limit exceeded"
            side "definition" ordinal "comments" 0]
        | some (.nonDirectDefinitions ordinal) =>
          [commentIssueJson "COMMENT_NON_DIRECT_DEFINITION_LIMIT_EXCEEDED"
            "non-direct comment definition limit exceeded"
            side "definition" ordinal "comments" 0]
        | some (.references ..) | some (.uniqueIds ..) => []
      let crossingIssues := commentMarkerCrossingIssuesV7 side markerScan.crossing ++
        definitionCrossingIssues
      let complete := markerScan.crossing.isNone && retained.output.crossing.isNone
      let issues := if complete then
          malformed ++ duplicates ++ missing ++ nonDirect ++ topology
        else crossingIssues
      let unreferenced := definitions.filter fun definition =>
        !markerScan.associations.contains definition.2.text
      let integrityPassed := complete && issues.isEmpty
      return {
        side, sources, sourcePartitionAdmitted := true
        realizationFailureCode := none
        realizationFailureDetail := none
        identity := some selected, partPresent := true
        part := some part, retainedScan := some retained
        markerScanRun := some {
          set := markerSourceSet
          scans := markerSourceScans
          setExact := rfl
          result := markerScanResult
          resultExact := rfl
        }, markerScanInvocationCount := 1, complete
        semanticLimitCrossed := retained.output.crossing.isSome
        productionIntegrityPassed := integrityPassed, usage := loaded.usage
        tripleUsage := loadedTripleUsage
        issues
        inventory := {
          side
          status := if !complete then "not_evaluated"
            else if issues.isEmpty then "passed" else "failed"
          identity := some selected
          referenceOccurrences := if complete then markerScan.referenceOccurrences else 0
          rangeStartOccurrences := if complete then markerScan.rangeStartOccurrences else 0
          rangeEndOccurrences := if complete then markerScan.rangeEndOccurrences else 0
          uniqueReferenceIds := if complete then markerScan.canonicalIds.size else 0
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

def typedNoteRelationshipRecordsFrom :
    Nat → List RelationshipRecord → List TypedNoteRelationshipRecord
  | _, [] => []
  | ordinal, record :: rest =>
      let tail := typedNoteRelationshipRecordsFrom (ordinal + 1) rest
      let kind :=
        if record.relationshipType == NoteKind.footnotes.relationshipType then
          some NoteKind.footnotes
        else if record.relationshipType == NoteKind.endnotes.relationshipType then
          some NoteKind.endnotes
        else none
      match kind with
      | none => tail
      | some noteKind =>
          { relationshipRecordOrdinal := ordinal
            kind := noteKind
            relationshipId := record.id
            normalizedPartPath :=
              (normalizeTarget record.rawTarget).toOption.getD ""
            internal := record.targetMode.isNone ||
              record.targetMode == some "Internal" } :: tail

def typedNoteRelationshipRecords (records : List RelationshipRecord) :
    List TypedNoteRelationshipRecord :=
  typedNoteRelationshipRecordsFrom 0 records

def packageViewOfNoteEvidence (relationships : List RelationshipRecord)
    (evidence : NoteSideEvidence) :
    Tier2.ConventionalMainNoteSelector.PackageView :=
  let noteParts :=
    (evidence.footnotesPart.map (proofPartOfNote .footnotes) |>.toList) ++
    (evidence.endnotesPart.map (proofPartOfNote .endnotes) |>.toList)
  { relationshipRecords := typedNoteRelationshipRecords relationships
    parts := evidence.sources.map proofPartOfSource ++ noteParts
    physicalStories := evidence.sources.drop 1 |>.map fun source =>
      { story := source.sourceStory
        ordinal := source.sourceStoryOrdinal
        normalizedPartPath := source.normalizedPartPath } }

def packageViewOfRecord (record : RunRequestPackageRecord) :
    Tier2.ConventionalMainNoteSelector.PackageView :=
  packageViewOfNoteEvidence record.relationships record.noteEvidence

def selectedStoriesOfRecord (record : RunRequestPackageRecord) :
    Tier2.NoteReferenceIntegrity.SelectedStories :=
  let pkg := packageViewOfRecord record
  { physical := pkg.physicalStories.filterMap
      Tier2.NoteReferenceIntegrity.physicalStorySlot?
    footnotes := (Tier2.ConventionalMainNoteSelector.selectConventionalMainNote
      pkg .footnotes).toOption.join
    endnotes := (Tier2.ConventionalMainNoteSelector.selectConventionalMainNote
        pkg .endnotes).toOption.join }

def retainedCommentSourceScansOfEvidence
    (relationships : List RelationshipRecord) (evidence : NoteSideEvidence) :
    Tier2.NoteReferenceIntegrity.SideScanEvidence :=
  let pkg := packageViewOfNoteEvidence relationships evidence
  let selected : Tier2.NoteReferenceIntegrity.SelectedStories := {
    physical := pkg.physicalStories.filterMap
      Tier2.NoteReferenceIntegrity.physicalStorySlot?
    footnotes := (Tier2.ConventionalMainNoteSelector.selectConventionalMainNote
      pkg .footnotes).toOption.join
    endnotes := (Tier2.ConventionalMainNoteSelector.selectConventionalMainNote
      pkg .endnotes).toOption.join }
  Tier2.NoteReferenceIntegrity.canonicalScans pkg selected

def retainedCommentSourceScansOfRecord (record : RunRequestPackageRecord) :
    Tier2.NoteReferenceIntegrity.SideScanEvidence :=
  retainedCommentSourceScansOfEvidence record.relationships record.noteEvidence

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
  { sourceEvents := []
    definitionEvents := record.commentEvidence.part.map
      (·.parseEvidence.parsed.events) |>.getD [] }

def expectedPassedCommentInventory
    (record : RunRequestPackageRecord) : CommentInventoryEvidence :=
  let evidence := record.commentEvidence
  let scan := evidence.retainedScan.map (·.output.scan) |>.getD {
    references := [], definitions := [], nonDirectDefinitions := []
  }
  let definitions := commentCanonicalDefinitionPairs scan.definitions
  let markerScan := evidence.markerScan.getD {}
  let sourceIds := markerScan.canonicalIds.toList
  { side := evidence.side
    status := "passed"
    identity := evidence.identity
    referenceOccurrences := markerScan.referenceOccurrences
    rangeStartOccurrences := markerScan.rangeStartOccurrences
    rangeEndOccurrences := markerScan.rangeEndOccurrences
    uniqueReferenceIds := sourceIds.length
    definitions := definitions.length
    unreferencedDefinitions := (definitions.filter fun definition =>
      !sourceIds.contains definition.2.text).length
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
  let markerExact := match evidence.markerScanRun with
    | none => false
    | some retainedRun => match retainedRun.result with
      | .error _ => false
      | .ok expected => evidence.markerScan.any fun actual =>
      expected.crossing.isNone &&
      decide (evidence.markerScanInvocationCount = 1) &&
      decide (actual.occurrences = expected.occurrences) &&
      decide (actual.canonicalIds = expected.canonicalIds) &&
      decide (actual.referenceOccurrences = expected.referenceOccurrences) &&
      decide (actual.rangeStartOccurrences = expected.rangeStartOccurrences) &&
      decide (actual.rangeEndOccurrences = expected.rangeEndOccurrences) &&
      decide (actual.markerOccurrences = expected.markerOccurrences) &&
      decide (actual.processedEventCount = expected.processedEventCount) &&
      decide (actual.processedStoryCount = expected.processedStoryCount) &&
      decide (actual.crossing = expected.crossing) &&
      expected.canonicalIds.all fun canonical =>
        decide (actual.associations[canonical]? = expected.associations[canonical]?)
  (sourceSetExact &&
    selectionExact &&
    retainedExact &&
    evidence.complete &&
    !evidence.semanticLimitCrossed &&
    evidence.productionIntegrityPassed &&
    evidence.issues.isEmpty &&
    decide (evidence.inventory = expectedPassedCommentInventory record)) &&
  markerExact

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

def productionCommentGlobalAdmissionCheckV7
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
  let sides : List Tier2.CommentReferenceIntegrity.VerifierSide :=
    [.original, .revised, .compared]
  decide ((commentResourceUsageOfCore request).tripleXmlEvents ≤
    3 * maxCumulativeXmlEvents) &&
  sides.all selectorCheck &&
  sides.all sourceCheck

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
  (∃ markerRun markerEvidence,
    evidence.markerScanRun = some markerRun ∧
    markerRun.result = .ok markerEvidence ∧
    markerRun.result =
      retainedCommentMarkerScanForRelationshipV7
        evidence.identity.isSome markerRun.set markerRun.scans ∧
    markerEvidence.crossing = none ∧
    evidence.markerScanInvocationCount = 1 ∧
    evidence.markerScan = some markerEvidence) ∧
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
  simp only [Bool.and_eq_true] at hPass
  have hLegacy := hPass.1
  have hMarker := hPass.2
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hLegacy
  rcases hLegacy with
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
    cases hMarkerRun :
        record.commentEvidence.markerScanRun with
    | none => simp [hMarkerRun] at hMarker
    | some markerRun =>
      cases hMarkerResult : markerRun.result with
      | error detail => simp [hMarkerRun, hMarkerResult] at hMarker
      | ok markerEvidence =>
        simp only [hMarkerRun, hMarkerResult, CommentSideEvidence.markerScan,
          Option.bind_some, Except.toOption, Option.any,
          Bool.and_eq_true, decide_eq_true_eq] at hMarker
        have hMarkerEvidence :
            ∃ markerRun markerEvidence,
              record.commentEvidence.markerScanRun = some markerRun ∧
              markerRun.result = .ok markerEvidence ∧
              markerRun.result =
                retainedCommentMarkerScanForRelationshipV7
                  record.commentEvidence.identity.isSome
                  markerRun.set markerRun.scans ∧
              markerEvidence.crossing = none ∧
              record.commentEvidence.markerScanInvocationCount = 1 ∧
              record.commentEvidence.markerScan = some markerEvidence := by
          exact ⟨markerRun, markerEvidence, hMarkerRun, hMarkerResult,
            markerRun.resultExact,
            Option.isNone_iff_eq_none.mp
              hMarker.1.1.1.1.1.1.1.1.1.1.1,
            hMarker.1.1.1.1.1.1.1.1.1.1.2,
            by
              unfold CommentSideEvidence.markerScan
              rw [hMarkerRun]
              change markerRun.result.toOption = some markerEvidence
              rw [hMarkerResult]
              change (Except.ok markerEvidence :
                Except String ParsedCommentRangeEvidence).toOption =
                  some markerEvidence
              rfl⟩
        exact ⟨hSourceRecords, hSources, hSelectionProp, hMarkerEvidence, retained,
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
  rcases hProduction with ⟨_hSourceRecords, _hSources, _hSelection, _hMarker,
    retained,
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
    coalesceCommentIssuesV7 (commentEvidence.flatMap (·.issues))
      |>.mergeSort commentIssueLessV7
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
      productionCommentGlobalAdmissionCheckV7 request
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
        "protocol v7 aggregate ordinary issue limit exceeded"
      else "protocol v7 escaped evidence string budget exceeded")
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
    coalesceCommentIssuesV7 (commentSides.flatMap (·.issues))
      |>.mergeSort commentIssueLessV7
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
  [ ("protocolVersion", toJson (7 : Nat))
    , ("checker", toJson
        "safe-docx-lean-conventional-main-comment-range-integrity-checker")
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
    coalesceCommentIssuesV7 (commentEvidence.flatMap (·.issues))
      |>.mergeSort commentIssueLessV7
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
    [ ("protocolVersion", toJson (7 : Nat))
    , ("checker", toJson
        "safe-docx-lean-conventional-main-comment-range-integrity-checker")
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
      ((coalesceCommentIssuesV7
          ((applyCommentGlobalStop
            [request.original.commentEvidence, request.revised.commentEvidence,
              request.compared.commentEvidence]).flatMap (·.issues))).mergeSort
        commentIssueLessV7).isEmpty = true := by
    simpa [List.flatMap_cons, List.flatMap_nil] using hNoNotes.2
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
      productionCommentGlobalAdmissionCheckV7 request) = true at hProduction
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
      productionCommentGlobalAdmissionCheckV7 request) = true at hProduction
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
      productionCommentGlobalAdmissionCheckV7 request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    unfold productionCommentGlobalAdmissionCheckV7 at hProduction
    simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq,
      List.all_eq_true]
      at hProduction
    simpa [maxCumulativeXmlEvents] using hProduction.2.1.1

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
      productionCommentGlobalAdmissionCheckV7 request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    unfold productionCommentGlobalAdmissionCheckV7 at hProduction
    simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq,
      List.all_eq_true] at hProduction
    apply comment_selection_result_eq_sound
    exact hProduction.2.1.2 side (by cases side <;> simp)

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
      productionCommentGlobalAdmissionCheckV7 request) = true at hProduction
    simp only [Bool.and_eq_true] at hProduction
    unfold productionCommentGlobalAdmissionCheckV7 at hProduction
    simp only [Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq,
      List.all_eq_true]
      at hProduction
    exact hProduction.2.2 side (by cases side <;> simp)

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

theorem run_request_core_response_exact
    (request : RunRequestCoreRequest) (result : RunRequestCoreResult)
    (hRun : runRequestCore request = .ok result) :
    result.response =
      (buildRunRequestCoreResponse request result.semanticResponse).2 := by
  unfold runRequestCore at hRun
  split at hRun
  · rename_i hReady
    cases hSemantic : Tier2.NoteReferenceIntegrity.canonicalSemanticResponse
        (semanticRequestOfCore request) with
    | error detail => simp [hSemantic] at hRun
    | ok semanticResult =>
      rcases semanticResult with ⟨semanticResponse, semanticStdout⟩
      cases hFinalize : finalizeProtocolV6Response
          (buildRunRequestCoreResponse request semanticResponse).2
          (buildRunRequestCoreResponse request semanticResponse).1 with
      | error detail =>
          simp [hSemantic, finishRunRequestCore, hFinalize] at hRun
      | ok stdout =>
          simp [hSemantic, finishRunRequestCore, hFinalize] at hRun
          cases hRun
          rfl
  · rename_i hNotReady
    cases hFinalize : finalizeProtocolV6Response
        (buildRunRequestCoreResponse request
          (failedSemanticResponse (semanticRequestOfCore request))).2
        (buildRunRequestCoreResponse request
          (failedSemanticResponse (semanticRequestOfCore request))).1 with
    | error detail =>
        simp [finishRunRequestCore, hFinalize] at hRun
    | ok stdout =>
        simp [finishRunRequestCore, hFinalize] at hRun
        cases hRun
        rfl

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
      rcases hComment with ⟨_, _, _, _, retained, hRetained,
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
        _hMarkerEvidence, retained, hRetained, hInvocation, hInput, hOutput, hCrossing,
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
    (Tier2.RelationshipStorySelector.normalizeTarget
      record.rawTarget).toOption.map typedBoundedBytesOfString
  mode := typedRelationshipModeOfProduction record
}

def typedRelationshipsOfProductionFrom :
    Nat → List RelationshipRecord → List TypedRelationship
  | _, [] => []
  | ordinal, record :: rest =>
      typedRelationshipOfProduction record ordinal ::
        typedRelationshipsOfProductionFrom (ordinal + 1) rest

def typedRelationshipsOfProduction
    (records : List RelationshipRecord) : List TypedRelationship :=
  typedRelationshipsOfProductionFrom 0 records

def typedXmlEventsOfProductionFrom :
    Nat → List TypedXmlEvent → List XmlEvent → List TypedXmlEvent
  | _, output, [] => output.reverse
  | ordinal, output, event :: rest =>
      typedXmlEventsOfProductionFrom (ordinal + 1)
        (typedXmlEventOfProduction ordinal event :: output) rest

def typedXmlEventsOfProduction (events : List XmlEvent) : List TypedXmlEvent :=
  typedXmlEventsOfProductionFrom 0 [] events

theorem typed_xml_events_of_production_from_eq_spec :
    ∀ ordinal output events,
      typedXmlEventsOfProductionFrom ordinal output events =
        output.reverse ++ typedXmlEventsOfProductionSpecV7 ordinal events
  | _, _, [] => by
      simp [typedXmlEventsOfProductionFrom, typedXmlEventsOfProductionSpecV7]
  | ordinal, output, event :: rest => by
      rw [typedXmlEventsOfProductionFrom,
        typed_xml_events_of_production_from_eq_spec]
      simp only [List.reverse_cons, List.append_assoc]
      rfl

theorem typed_xml_events_of_production_eq_spec
    (events : List XmlEvent) :
    typedXmlEventsOfProduction events =
      typedXmlEventsOfProductionSpecV7 0 events := by
  unfold typedXmlEventsOfProduction
  rw [typed_xml_events_of_production_from_eq_spec]
  rfl

def typedParsedPartOfProduction
    (evidence : ProductionParseEvidence) : TypedParsedPart := {
  rawBytes := evidence.bytes
  expectedRootUri := typedBoundedBytesOfString evidence.expectedRootUri
  expectedRootLocalName :=
    typedBoundedBytesOfString evidence.expectedRootLocalName
  events := typedXmlEventsOfProduction evidence.parsed.events
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
    (side : Side) (source : Option NoteSource)
    (story : PhysicalStory) : TypedHeaderFooterStory := {
  physicalStoryOrdinal := story.physicalStoryOrdinal
  kind := typedHeaderFooterKindOfProduction story.kind
  partPath := typedBoundedBytesOfString
    (physicalStoryPathForTypedSide story side)
  originalPartPath := typedBoundedBytesOfString story.originalPartPath
  revisedPartPath := typedBoundedBytesOfString story.revisedPartPath
  comparedPartPath := typedBoundedBytesOfString story.comparedPartPath
  selectingSlotOrdinals := story.selectingSlotOrdinals
  source := source.map (typedStorySourceOfProduction side)
}

def typedHeaderFooterStoriesOfProduction
    (side : Side) : List NoteSource → List PhysicalStory →
      List TypedHeaderFooterStory
  | _, [] => []
  | [], story :: rest =>
      typedHeaderFooterStoryOfProduction side none story ::
        typedHeaderFooterStoriesOfProduction side [] rest
  | source :: sourceRest, story :: rest =>
      typedHeaderFooterStoryOfProduction side (some source) story ::
        typedHeaderFooterStoriesOfProduction side sourceRest rest

def typedHeaderFooterSourceSlotsOfProduction
    (side : Side) : List NoteSource → List PhysicalStory →
      List TypedSourceSlot × List NoteSource
  | sources, [] => ([], sources)
  | [], _ :: rest =>
      typedHeaderFooterSourceSlotsOfProduction side [] rest
  | source :: sourceRest, story :: rest =>
      let tail :=
        typedHeaderFooterSourceSlotsOfProduction side sourceRest rest
      ({
        kind := typedHeaderFooterKindOfProduction story.kind
        physicalStoryOrdinal := story.physicalStoryOrdinal
        source := typedStorySourceOfProduction side source
      } :: tail.1, tail.2)

def typedNoteSourceSlotsOfProduction
    (side : Side) (sources : List NoteSource)
    (footnotesPresent endnotesPresent : Bool) : List TypedSourceSlot :=
  let footnoteSource :=
    if footnotesPresent then sources.head? else none
  let endnoteSources :=
    if footnotesPresent then sources.drop 1 else sources
  let endnoteSource :=
    if endnotesPresent then endnoteSources.head? else none
  (footnoteSource.map (fun source => {
      kind := TypedSourceKind.footnotes
      physicalStoryOrdinal := 0
      source := typedStorySourceOfProduction side source
    })).toList ++
  (endnoteSource.map (fun source => {
      kind := TypedSourceKind.endnotes
      physicalStoryOrdinal := 0
      source := typedStorySourceOfProduction side source
    })).toList

def typedCommentSourceDomainSlotsOfProduction
    (side : Side) (sources : List NoteSource)
    (stories : List PhysicalStory)
    (footnotesPresent endnotesPresent : Bool) : List TypedSourceSlot :=
  match sources with
  | [] => [{
      kind := .main
      physicalStoryOrdinal := 0
      source := missingTypedMainSource side
    }]
  | mainSource :: sourceTail =>
      let headerFooter :=
        typedHeaderFooterSourceSlotsOfProduction side sourceTail stories
      {
        kind := .main
        physicalStoryOrdinal := 0
        source := typedStorySourceOfProduction side mainSource
      } :: headerFooter.1 ++
        typedNoteSourceSlotsOfProduction side headerFooter.2
          footnotesPresent endnotesPresent

theorem typed_header_footer_stories_filter_map_v7 :
    ∀ (side : Side) (sources : List NoteSource)
      (stories : List PhysicalStory),
      (typedHeaderFooterStoriesOfProduction side sources stories).filterMap
          (fun story => story.source.map fun source => {
            kind := story.kind
            physicalStoryOrdinal := story.physicalStoryOrdinal
            source
          }) =
        (typedHeaderFooterSourceSlotsOfProduction side sources stories).1
  | _, _, [] => rfl
  | side, [], _ :: rest => by
      unfold typedHeaderFooterStoriesOfProduction
        typedHeaderFooterSourceSlotsOfProduction
        typedHeaderFooterStoryOfProduction
      exact typed_header_footer_stories_filter_map_v7 side [] rest
  | side, _ :: sourceRest, _ :: rest => by
      unfold typedHeaderFooterStoriesOfProduction
        typedHeaderFooterSourceSlotsOfProduction
        typedHeaderFooterStoryOfProduction
      simp only [List.filterMap_cons, Option.map_some, List.cons.injEq,
        true_and]
      exact typed_header_footer_stories_filter_map_v7
        side sourceRest rest

theorem typed_header_footer_source_slots_remainder_v7 :
    ∀ (side : Side) (sources : List NoteSource)
      (stories : List PhysicalStory),
      (typedHeaderFooterSourceSlotsOfProduction side sources stories).2 =
        sources.drop stories.length
  | _, _, [] => by simp [typedHeaderFooterSourceSlotsOfProduction]
  | side, [], _ :: rest => by
      unfold typedHeaderFooterSourceSlotsOfProduction
      simpa using typed_header_footer_source_slots_remainder_v7
        side [] rest
  | side, _ :: sourceRest, _ :: rest => by
      unfold typedHeaderFooterSourceSlotsOfProduction
      simpa using typed_header_footer_source_slots_remainder_v7
        side sourceRest rest

theorem typed_header_footer_source_slots_empty_v7 :
    ∀ (side : Side) (stories : List PhysicalStory),
      (typedHeaderFooterSourceSlotsOfProduction side [] stories).1 = []
  | _, [] => rfl
  | side, _ :: rest => by
      unfold typedHeaderFooterSourceSlotsOfProduction
      exact typed_header_footer_source_slots_empty_v7 side rest

def typedNoteSelectionOfProduction
    (side : Side) (evidence : NoteSideEvidence)
    (source : Option NoteSource) (kind : NoteKind) : TypedNoteSelection :=
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
    source := source.map (typedStorySourceOfProduction side)
  }

theorem typed_note_selections_filter_map_v7
    (side : Side) (evidence : NoteSideEvidence)
    (footnoteSource endnoteSource : Option NoteSource) :
    [ typedNoteSelectionOfProduction side evidence
        footnoteSource .footnotes
    , typedNoteSelectionOfProduction side evidence
        endnoteSource .endnotes
    ].filterMap (fun selection =>
        selection.source.map fun source => ({
          kind := selection.kind
          physicalStoryOrdinal := 0
          source
        } : TypedSourceSlot)) =
      (footnoteSource.map (fun source => ({
        kind := TypedSourceKind.footnotes
        physicalStoryOrdinal := 0
        source := typedStorySourceOfProduction side source
      } : TypedSourceSlot))).toList ++
      (endnoteSource.map (fun source => ({
        kind := TypedSourceKind.endnotes
        physicalStoryOrdinal := 0
        source := typedStorySourceOfProduction side source
      } : TypedSourceSlot))).toList := by
  cases footnoteSource <;> cases endnoteSource <;>
    simp [typedNoteSelectionOfProduction]

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

def exactProductionCommentRelationshipsFrom :
    Nat → List RelationshipRecord → List (RelationshipRecord × Nat)
  | _, [] => []
  | ordinal, record :: rest =>
      let tail := exactProductionCommentRelationshipsFrom
        (ordinal + 1) rest
      if record.relationshipType ==
          Tier2.CommentReferenceIntegrity.commentsRelationshipType then
        (record, ordinal) :: tail
      else tail

theorem exact_production_comment_relationships_from_zip :
    ∀ ordinal (records : List RelationshipRecord),
    exactProductionCommentRelationshipsFrom ordinal records =
      (List.zipIdx records ordinal).filter fun pair =>
        pair.1.relationshipType ==
          Tier2.CommentReferenceIntegrity.commentsRelationshipType
  | _, [] => rfl
  | ordinal, record :: rest => by
      unfold exactProductionCommentRelationshipsFrom List.zipIdx
      rw [exact_production_comment_relationships_from_zip
        (ordinal + 1) rest]
      by_cases h :
          record.relationshipType ==
            Tier2.CommentReferenceIntegrity.commentsRelationshipType
      · simp [h]
      · simp [h]

theorem exact_typed_comment_relationships_of_production :
    ∀ ordinal (records : List RelationshipRecord),
    exactTypedCommentRelationships
        (typedBoundedBytesOfString
          Tier2.CommentReferenceIntegrity.commentsRelationshipType)
        (typedRelationshipsOfProductionFrom ordinal records) =
      (exactProductionCommentRelationshipsFrom ordinal records).map
        (fun item => typedRelationshipOfProduction item.1 item.2)
  | _, [] => rfl
  | ordinal, record :: rest => by
      have hTail :=
        exact_typed_comment_relationships_of_production
          (ordinal + 1) rest
      rw [typedRelationshipsOfProductionFrom,
        exactProductionCommentRelationshipsFrom,
        exactTypedCommentRelationships, List.filter_cons]
      by_cases hRaw :
          (record.relationshipType ==
            Tier2.CommentReferenceIntegrity.commentsRelationshipType) = true
      · have hString :
            record.relationshipType =
              Tier2.CommentReferenceIntegrity.commentsRelationshipType :=
          beq_iff_eq.mp hRaw
        have hTyped :
            decide
              (record.relationshipType.toUTF8.data.toList =
                (Tier2.CommentReferenceIntegrity.commentsRelationshipType).toUTF8.data.toList) =
              true := by
          rw [hString]
          rfl
        rw [if_pos hRaw]
        simp only [List.map_cons]
        split
        · exact congrArg
            (List.cons (typedRelationshipOfProduction record ordinal))
            hTail
        · rename_i hTypedNeg
          exact False.elim (hTypedNeg hTyped)
      · have hTyped :
            decide
              (record.relationshipType.toUTF8.data.toList =
                (Tier2.CommentReferenceIntegrity.commentsRelationshipType).toUTF8.data.toList) =
              false := by
          apply Bool.eq_false_iff.mpr
          intro hEqual
          apply hRaw
          apply beq_iff_eq.mpr
          apply string_eq_of_utf8_data_to_list_eq
          exact of_decide_eq_true hEqual
        rw [if_neg hRaw]
        split
        · rename_i hTypedPos
          have hTypedPos' :
              decide
                (record.relationshipType.toUTF8.data.toList =
                  (Tier2.CommentReferenceIntegrity.commentsRelationshipType).toUTF8.data.toList) =
                true := by
            simpa [typedRelationshipOfProduction,
              typedBoundedBytesOfString] using hTypedPos
          rw [hTyped] at hTypedPos'
          contradiction
        · exact hTail

theorem typed_selector_success_of_production
    (records : List RelationshipRecord)
    (selected : SelectedCommentIdentity)
    (hSelected :
      Tier2.CommentReferenceIntegrity.selectConventionalMainCommentRecords
        records = .ok (some selected)) :
    selectTypedComment
        (typedBoundedBytesOfString
          Tier2.CommentReferenceIntegrity.commentsRelationshipType)
        (typedRelationshipsOfProduction records) =
      .ok (some (typedSelectedCommentOfProduction selected)) := by
  unfold typedRelationshipsOfProduction
  unfold selectTypedComment selectTypedCommentSpec
  rw [exact_typed_comment_relationships_of_production]
  unfold Tier2.CommentReferenceIntegrity.selectConventionalMainCommentRecords
    at hSelected
  unfold Tier2.CommentReferenceIntegrity.exactCommentRelationshipRecords
    at hSelected
  rw [← exact_production_comment_relationships_from_zip] at hSelected
  generalize hExact :
      exactProductionCommentRelationshipsFrom 0 records = exact
  rw [hExact] at hSelected
  cases exact with
  | nil =>
      nomatch hSelected
  | cons first rest =>
      rcases first with ⟨record, ordinal⟩
      cases rest with
      | nil =>
          simp only [List.map_cons, List.map_nil]
          unfold selectSingleTypedCommentRelationship
          dsimp only at hSelected ⊢
          simp only [List.isEmpty, Bool.not_true, Bool.false_eq_true,
            if_false] at hSelected
          by_cases hExternal :
              (record.targetMode == some "External") = true
          · rw [if_pos hExternal] at hSelected
            contradiction
          · rw [if_neg hExternal] at hSelected
            by_cases hInvalid :
                (!(record.targetMode.isNone ||
                  record.targetMode == some "Internal")) = true
            · rw [if_pos hInvalid] at hSelected
              contradiction
            · rw [if_neg hInvalid] at hSelected
              cases hNormalize :
                  Tier2.RelationshipStorySelector.normalizeTarget
                    record.rawTarget with
              | error detail =>
                  simp [hNormalize] at hSelected
              | ok normalized =>
                  simp only [hNormalize, Except.ok.injEq,
                    Option.some.injEq] at hSelected
                  subst selected
                  have hExternalFalse :
                      (record.targetMode == some "External") = false :=
                    Bool.eq_false_iff.mpr hExternal
                  have hInternal :
                      (record.targetMode.isNone ||
                        record.targetMode == some "Internal") = true := by
                    have hNot := Bool.eq_false_iff.mpr hInvalid
                    cases hMode :
                        (record.targetMode.isNone ||
                          record.targetMode == some "Internal") <;>
                      simp [hMode] at hNot ⊢
                  have hSize :
                      ¬record.rawTarget.toUTF8.data.toList.length > 256 := by
                    unfold Tier2.RelationshipStorySelector.normalizeTarget
                      at hNormalize
                    by_cases hBound :
                        (record.rawTarget.isEmpty ||
                          decide (record.rawTarget.toUTF8.size >
                            Tier2.RelationshipStorySelector.maxLocatorBytes)) =
                          true
                    · rw [if_pos hBound] at hNormalize
                      contradiction
                    · intro hLarge
                      have hLarge' :
                          record.rawTarget.toUTF8.size >
                            Tier2.RelationshipStorySelector.maxLocatorBytes := by
                        simpa [
                          Tier2.RelationshipStorySelector.maxLocatorBytes]
                          using hLarge
                      apply hBound
                      rw [Bool.or_eq_true]
                      apply Or.inr
                      exact decide_eq_true hLarge'
                  have hUtf8Size :
                      ¬256 < record.rawTarget.utf8ByteSize := by
                    change
                      ¬256 < record.rawTarget.toUTF8.data.toList.length
                    exact hSize
                  simp only [typedRelationshipOfProduction,
                    typedRelationshipModeOfProduction,
                    typedSelectedCommentOfProduction,
                    hExternalFalse, hInternal, Bool.false_eq_true, if_false,
                    typedBoundedBytesOfString, hUtf8Size, hSize, hNormalize,
                    if_true, Except.toOption, Option.map]
      | cons second tail =>
          nomatch hSelected

theorem typed_selector_none_of_production
    (records : List RelationshipRecord)
    (hSelected :
      Tier2.CommentReferenceIntegrity.selectConventionalMainCommentRecords
        records = .ok none) :
    selectTypedComment
        (typedBoundedBytesOfString
          Tier2.CommentReferenceIntegrity.commentsRelationshipType)
        (typedRelationshipsOfProduction records) = .ok none := by
  unfold typedRelationshipsOfProduction
  unfold selectTypedComment selectTypedCommentSpec
  rw [exact_typed_comment_relationships_of_production]
  unfold Tier2.CommentReferenceIntegrity.selectConventionalMainCommentRecords
    at hSelected
  unfold Tier2.CommentReferenceIntegrity.exactCommentRelationshipRecords
    at hSelected
  rw [← exact_production_comment_relationships_from_zip] at hSelected
  generalize hExact :
      exactProductionCommentRelationshipsFrom 0 records = exact
  rw [hExact] at hSelected
  cases exact with
  | nil => rfl
  | cons first rest =>
      rcases first with ⟨record, ordinal⟩
      cases rest with
      | cons second tail =>
          simp at hSelected
      | nil =>
          dsimp only at hSelected
          simp only [List.isEmpty, Bool.not_true, Bool.false_eq_true,
            if_false] at hSelected
          split at hSelected
          · contradiction
          · split at hSelected
            · contradiction
            · split at hSelected
              · contradiction
              · nomatch hSelected

def typedExtractionOfProduction
    (evidence : SnapshotExtractionEvidence) : TypedExtraction := {
  packageBytes := evidence.packageBytes
  snapshotBytes := evidence.snapshotBytes
  entry := typedEntryOfProduction evidence.entry
  compressedSlice := evidence.compressedPayload
  expandedBytes := evidence.decompressedBytes
}

def typedCommentRealizationOfProduction
    (part : LoadedCommentPart) : TypedCommentRealization :=
  let parsed := typedParsedPartOfProduction part.parseEvidence
  {
    selected := typedSelectedCommentOfProduction part.identity
    entry := typedEntryOfProduction part.parseEvidence.extraction.entry
    extraction := typedExtractionOfProduction part.parseEvidence.extraction
    retainedParsedEvents := parsed.events
    parsed
  }

def typedCanonicalIdOfRaw (raw : Option String) :
    Option TypedCanonicalId :=
  raw.map typedBoundedBytesOfString |>.bind parseTypedDecimalId

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

def typedDefinitionStateOfProduction
    (state : Tier2.CommentReferenceIntegrity.CommentScanState) :
    TypedScanState := {
  scan := {
    references := []
    definitions := state.scan.definitions.map typedDefinitionOfProduction
    nonDirectDefinitions :=
      state.scan.nonDirectDefinitions.map typedDefinitionOfProduction
    crossing := state.crossing.map typedScanCrossingOfProduction
  }
  canonicalReferenceIds := []
}

theorem scan_typed_definition_event_of_production
    (state : Tier2.CommentReferenceIntegrity.CommentScanState)
    (eventOrdinal : Nat) (event : XmlEvent) :
    scanTypedDefinitionEvent (typedDefinitionScanInputV7 [])
        (typedDefinitionStateOfProduction state)
        (typedXmlEventOfProduction eventOrdinal event) =
      typedDefinitionStateOfProduction
        (Tier2.CommentReferenceIntegrity.scanCommentDefinitionEvent
          state event) := by
  unfold scanTypedDefinitionEvent
  unfold Tier2.CommentReferenceIntegrity.scanCommentDefinitionEvent
  have hCrossingMap :
      (typedDefinitionStateOfProduction state).scan.crossing =
        state.crossing.map typedScanCrossingOfProduction := rfl
  rw [hCrossingMap, Option.isSome_map]
  by_cases hCrossing : state.crossing.isSome = true
  · simp [hCrossing, typedDefinitionStateOfProduction]
  · simp only [hCrossing]
    rw [typed_definition_candidate_of_production]
    cases hCandidate :
        Tier2.CommentReferenceIntegrity.commentDefinitionCandidate? event with
    | none =>
        simp [typedDefinitionStateOfProduction]
    | some candidate =>
        rcases candidate with ⟨rawId, direct⟩
        simp only [Option.map_some]
        by_cases hDirect : direct = true
        · simp only [hDirect, if_true]
          rw [show
            (typedDefinitionStateOfProduction state).scan.definitions.length =
              state.scan.definitions.length by
                simp [typedDefinitionStateOfProduction]]
          by_cases hLimit : state.scan.definitions.length = 4096
          · simp [hLimit,
              Tier2.CommentReferenceIntegrity.maxCommentDefinitions,
              typedDefinitionStateOfProduction,
              typedScanCrossingOfProduction]
          · simp [hLimit,
              Tier2.CommentReferenceIntegrity.maxCommentDefinitions,
              typedDefinitionStateOfProduction, List.map_append,
              typedDefinitionOfProduction, typedCanonicalIdOfRaw]
        · have hDirectFalse : direct = false :=
            Bool.eq_false_iff.mpr hDirect
          simp only [hDirectFalse]
          rw [show
            (typedDefinitionStateOfProduction state).scan.nonDirectDefinitions.length =
              state.scan.nonDirectDefinitions.length by
                simp [typedDefinitionStateOfProduction]]
          by_cases hLimit :
              state.scan.nonDirectDefinitions.length = 4096
          · simp [hLimit,
              Tier2.CommentReferenceIntegrity.maxNonDirectCommentDefinitions,
              typedDefinitionStateOfProduction,
              typedScanCrossingOfProduction]
          · simp [hLimit,
              Tier2.CommentReferenceIntegrity.maxNonDirectCommentDefinitions,
              typedDefinitionStateOfProduction, List.map_append,
              typedDefinitionOfProduction, typedCanonicalIdOfRaw]

theorem fold_typed_definition_events_of_production :
    ∀ (eventOrdinal : Nat) (events : List XmlEvent)
      (state : Tier2.CommentReferenceIntegrity.CommentScanState),
    (typedXmlEventsOfProductionSpecV7 eventOrdinal events).foldl
        (scanTypedDefinitionEvent (typedDefinitionScanInputV7 []))
        (typedDefinitionStateOfProduction state) =
      typedDefinitionStateOfProduction
        (events.foldl
          Tier2.CommentReferenceIntegrity.scanCommentDefinitionEvent
          state)
  | _, [], _ => rfl
  | eventOrdinal, event :: rest, state => by
      simp only [typedXmlEventsOfProductionSpecV7, List.foldl_cons]
      rw [scan_typed_definition_event_of_production]
      exact fold_typed_definition_events_of_production
        (eventOrdinal + 1) rest
        (Tier2.CommentReferenceIntegrity.scanCommentDefinitionEvent
          state event)

theorem typed_definition_scan_of_production
    (events : List XmlEvent) :
    scanTypedCommentEvidence
        (typedDefinitionScanInputV7
          (typedXmlEventsOfProduction events)) =
      let production :=
        Tier2.CommentReferenceIntegrity.scanCommentEvidence {
          sourceEvents := []
          definitionEvents := events
        }
      {
        references := []
        definitions :=
          production.scan.definitions.map typedDefinitionOfProduction
        nonDirectDefinitions :=
          production.scan.nonDirectDefinitions.map
            typedDefinitionOfProduction
        crossing :=
          production.crossing.map typedScanCrossingOfProduction
      } := by
  rw [typed_xml_events_of_production_eq_spec]
  unfold scanTypedCommentEvidence typedDefinitionScanInputV7
  simp only [List.foldl_nil]
  have hScanner :
      scanTypedDefinitionEvent {
        wmlNamespace := typedWmlNamespace
        idLocalName := typedLiteral [105,100]
        referenceLocalName := typedLiteral []
        definitionLocalName :=
          typedLiteral [99,111,109,109,101,110,116]
        sourceEvents := []
        definitionEvents :=
          typedXmlEventsOfProductionSpecV7 0 events
      } =
      scanTypedDefinitionEvent (typedDefinitionScanInputV7 []) := by
    funext state event
    rfl
  rw [hScanner]
  change
    ((typedXmlEventsOfProductionSpecV7 0 events).foldl
        (scanTypedDefinitionEvent (typedDefinitionScanInputV7 []))
        (typedDefinitionStateOfProduction
          ({} : Tier2.CommentReferenceIntegrity.CommentScanState))).scan = _
  rw [fold_typed_definition_events_of_production]
  rfl

theorem typed_definitions_from_events_of_production
    (events : List XmlEvent) :
    typedDefinitionsFromEventsV7
        (typedXmlEventsOfProduction events) =
      let production :=
        Tier2.CommentReferenceIntegrity.scanCommentEvidence {
          sourceEvents := []
          definitionEvents := events
        }
      production.scan.definitions.map typedDefinitionOfProduction ++
        production.scan.nonDirectDefinitions.map
          typedDefinitionOfProduction := by
  unfold typedDefinitionsFromEventsV7
  rw [typed_definition_scan_of_production]

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
          typedXmlEventsOfProduction source.parseEvidence.parsed.events)
      else []
    definitionEvents := if admittedScan then
      record.commentEvidence.part.map (fun part =>
        typedXmlEventsOfProduction part.parseEvidence.parsed.events) |>.getD []
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
    (record : RunRequestPackageRecord) : TypedPackageView :=
  let sources := record.commentEvidence.sources
  let sourceTail := sources.drop 1
  let noteSources := sourceTail.drop request.relationshipStories.length
  let footnoteSource :=
    if record.noteEvidence.footnotesPart.isSome then
      noteSources.head?
    else none
  let endnoteSources :=
    if record.noteEvidence.footnotesPart.isSome then
      noteSources.drop 1
    else noteSources
  let endnoteSource :=
    if record.noteEvidence.endnotesPart.isSome then
      endnoteSources.head?
    else none
  {
  packageBytes := record.packageBytes
  index := typedIndexOfProduction record.packageIndex
  commentType :=
    typedBoundedBytesOfString
      Tier2.CommentReferenceIntegrity.commentsRelationshipType
  commentsRootNamespace := typedBoundedBytesOfString wmlNamespace
  commentsRootLocalName := typedBoundedBytesOfString "comments"
  relationships := typedRelationshipsOfProduction record.relationships
  mainSource := sources.head?.map
      (typedStorySourceOfProduction side) |>.getD
        (missingTypedMainSource side)
  headerFooterSlots :=
    request.relationshipSlots.map typedHeaderFooterSlotOfProduction
  headerFooterStories := typedHeaderFooterStoriesOfProduction
    side sourceTail request.relationshipStories
  noteSelections :=
    [ typedNoteSelectionOfProduction side record.noteEvidence
        footnoteSource .footnotes
    , typedNoteSelectionOfProduction side record.noteEvidence
        endnoteSource .endnotes
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

theorem canonical_typed_comment_source_slots_of_package_v7
    (side : Side)
    (request : RunRequestCoreRequestV6)
    (record : RunRequestPackageRecord) :
    canonicalTypedCommentSourceSlotsOfPackageV7
        (typedPackageViewOfRecord side request record) =
      typedCommentSourceDomainSlotsOfProduction
        side record.commentEvidence.sources request.relationshipStories
        record.noteEvidence.footnotesPart.isSome
        record.noteEvidence.endnotesPart.isSome := by
  unfold canonicalTypedCommentSourceSlotsOfPackageV7
    typedPackageViewOfRecord typedCommentSourceDomainSlotsOfProduction
  cases record.commentEvidence.sources with
  | nil =>
      dsimp
      rw [typed_header_footer_stories_filter_map_v7]
      simp only [List.drop_nil]
      rw [typed_header_footer_source_slots_empty_v7]
      simp [typed_note_selections_filter_map_v7]
  | cons source rest =>
      dsimp
      rw [typed_header_footer_stories_filter_map_v7,
        typed_header_footer_source_slots_remainder_v7,
        typed_note_selections_filter_map_v7]
      rfl

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


end Tier2.NoteReferenceIntegrity

structure VerifierRequestV7 where
  core : RunRequestCoreRequest
  semanticResponse : VerifierResponseV5

def VerifierRequestV7.packageView (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Tier2.CommentReferenceIntegrity.PackageView :=
  commentPackageViewOfCore request.core side

def VerifierRequestV7.noteEvaluation (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Tier2.CommentReferenceIntegrity.SideNoteEvaluationV5 :=
  let record := request.core.packageRecord (noteSideOfCommentSide side)
  Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
    (packageViewOfRecord record) (noteSideOfCommentSide side)
    (selectedStoriesOfRecord record)

def VerifierRequestV7.retainedSourceScans (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Tier2.CommentReferenceIntegrity.SideScanEvidence :=
  let record := request.core.packageRecord (noteSideOfCommentSide side)
  match record.commentEvidence.markerScanRun with
  | some markerRun => markerRun.scans
  | none => retainedCommentSourceScansOfRecord record

def VerifierRequestV7.retainedCommentRangeScanResult
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Except String ParsedCommentRangeEvidence :=
  match (request.core.packageRecord
      (noteSideOfCommentSide side)).commentEvidence.markerScanRun with
  | some markerRun => markerRun.result
  | none => .error "retained comment marker scan is unavailable"

def VerifierRequestV7.commentRangeScanInvocationCount
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Nat :=
  (request.core.packageRecord
    (noteSideOfCommentSide side)).commentEvidence.markerScanInvocationCount

def VerifierRequestV7.retainedCommentRealization
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Option Tier2.CommentReferenceIntegrity.CommentStoryRealization :=
  (request.packageView side).retainedCommentRealization

def VerifierRequestV7.commentExtractionInvocationCount
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Nat :=
  (request.core.packageRecord (noteSideOfCommentSide side)).commentEvidence.part
    |>.map (·.parseEvidence.extraction.extractionInvocationCount) |>.getD 0

def VerifierRequestV7.commentParseInvocationCount
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Nat :=
  (request.core.packageRecord (noteSideOfCommentSide side)).commentEvidence.part
    |>.map (·.parseEvidence.parseInvocationCount) |>.getD 0

def retainedTypedMarkerKindOfProduction : CommentMarkerKindV7 → TypedMarkerKind
  | .rangeStart => .rangeStart
  | .rangeEnd => .rangeEnd
  | .reference => .reference

def retainedTypedSourceKindOfProductionStory (story : String) : TypedSourceKind :=
  if story == "header" then .header
  else if story == "footer" then .footer
  else if story == "footnotes" then .footnotes
  else if story == "endnotes" then .endnotes
  else .main

def retainedTypedMarkerOccurrenceOfProduction
    (occurrence : CommentMarkerOccurrenceV7) : TypedMarkerOccurrence := {
  kind := retainedTypedMarkerKindOfProduction occurrence.kind
  story := {
    kind := retainedTypedSourceKindOfProductionStory occurrence.sourceStory
    physicalStoryOrdinal := occurrence.sourceStoryOrdinal
  }
  sourceSetOrdinal := occurrence.sourceSetOrdinal
  sourceEventOrdinal := occurrence.sourceEventOrdinal
  markerOccurrenceOrdinal := occurrence.markerOccurrenceOrdinal
  kindOccurrenceOrdinal := occurrence.kindOccurrenceOrdinal
  rawId := occurrence.rawId.map typedBoundedBytesOfString
  canonicalId :=
    Tier2.NoteReferenceIntegrity.typedCanonicalIdOfRaw occurrence.rawId
}

def retainedTypedMarkerCrossingOfProduction :
    CommentMarkerCrossingV7 → Option TypedMarkerScanCrossing
  | .relationshipRequired _ => none
  | .referenceLimit occurrence => some <| .referenceLimit
      occurrence.sourceSetOrdinal occurrence.sourceEventOrdinal
        occurrence.kindOccurrenceOrdinal
  | .rangeStartLimit occurrence => some <| .rangeStartLimit
      occurrence.sourceSetOrdinal occurrence.sourceEventOrdinal
        occurrence.kindOccurrenceOrdinal
  | .rangeEndLimit occurrence => some <| .rangeEndLimit
      occurrence.sourceSetOrdinal occurrence.sourceEventOrdinal
        occurrence.kindOccurrenceOrdinal
  | .uniqueIdLimit occurrence canonical => some <| .uniqueIdLimit
      (retainedTypedMarkerKindOfProduction occurrence.kind)
      occurrence.sourceSetOrdinal occurrence.sourceEventOrdinal
        occurrence.kindOccurrenceOrdinal
        ((Tier2.NoteReferenceIntegrity.typedCanonicalIdOfRaw (some canonical)).getD
          { negative := false, digits := [] })

def retainedTypedMarkerAssociationOfProduction
    (association : CommentMarkerAssociationV7) : TypedMarkerAssociationV7 := {
  referenceCount := association.referenceCount
  rangeStartCount := association.rangeStartCount
  rangeEndCount := association.rangeEndCount
  firstReference := association.firstReference.map
    retainedTypedMarkerOccurrenceOfProduction
  firstRangeStart := association.firstRangeStart.map
    retainedTypedMarkerOccurrenceOfProduction
  firstRangeEnd := association.firstRangeEnd.map
    retainedTypedMarkerOccurrenceOfProduction
  firstDuplicateReference := association.firstDuplicateReference.map
    retainedTypedMarkerOccurrenceOfProduction
  firstDuplicateRangeStart := association.firstDuplicateRangeStart.map
    retainedTypedMarkerOccurrenceOfProduction
  firstDuplicateRangeEnd := association.firstDuplicateRangeEnd.map
    retainedTypedMarkerOccurrenceOfProduction
}

def retainedTypedMarkerAssociationTrieOfProduction
    (evidence : ParsedCommentRangeEvidence) :
    List String → TypedCanonicalIdTrie
  | [] => .empty
  | canonical :: rest =>
      let trie := retainedTypedMarkerAssociationTrieOfProduction evidence rest
      match Tier2.NoteReferenceIntegrity.typedCanonicalIdOfRaw (some canonical),
          evidence.associations[canonical]? with
      | some typedCanonical, some association =>
          typedCanonicalIdTrieSet trie typedCanonical
            (retainedTypedMarkerAssociationOfProduction association)
      | _, _ => trie

def retainedTypedMarkerEvidenceOfProduction
    (evidence : ParsedCommentRangeEvidence) : TypedMarkerScanEvidence :=
  let relationshipOccurrence := evidence.crossing.bind fun crossing =>
    match crossing with
    | .relationshipRequired occurrence =>
        some (retainedTypedMarkerOccurrenceOfProduction occurrence)
    | _ => none
  {
    inputStories := []
    occurrences := relationshipOccurrence.toList ++
      evidence.occurrences.toList.map retainedTypedMarkerOccurrenceOfProduction
    canonicalIds := evidence.canonicalIds.toList.map fun canonical =>
      (Tier2.NoteReferenceIntegrity.typedCanonicalIdOfRaw (some canonical)).getD
        { negative := false, digits := [] }
    referenceOccurrences := evidence.referenceOccurrences
    rangeStartOccurrences := evidence.rangeStartOccurrences
    rangeEndOccurrences := evidence.rangeEndOccurrences
    processedEventCount := evidence.processedEventCount
    processedStoryCount := evidence.processedStoryCount
    crossing := evidence.crossing.bind retainedTypedMarkerCrossingOfProduction
  }

def concurrentTypedMarkerEvidenceV7
    (inputStories : List TypedStorySource)
    (evidence : ParsedCommentRangeEvidence) : TypedMarkerScanEvidence := {
  inputStories
  occurrences := evidence.typedState.occurrences.reverse
  canonicalIds := evidence.typedState.canonicalIds.reverse
  referenceOccurrences := evidence.typedState.referenceOccurrences
  rangeStartOccurrences := evidence.typedState.rangeStartOccurrences
  rangeEndOccurrences := evidence.typedState.rangeEndOccurrences
  processedEventCount := evidence.typedState.processedEventCount
  processedStoryCount := evidence.typedState.processedStoryCount
  crossing := evidence.typedState.crossing
}

def retainedConcurrentTypedMarkerEvidenceCheckV7
    (evidence : ParsedCommentRangeEvidence) : Bool :=
  decide (retainedTypedMarkerEvidenceOfProduction evidence =
    concurrentTypedMarkerEvidenceV7 [] evidence)

def retainedTypedMarkerScanOfRecordV7
    (record : RunRequestPackageRecord) : Option TypedMarkerScanEvidence :=
  some <| record.commentEvidence.markerScan.map
    retainedTypedMarkerEvidenceOfProduction |>.getD {
      inputStories := []
      occurrences := []
      canonicalIds := []
      referenceOccurrences := 0
      rangeStartOccurrences := 0
      rangeEndOccurrences := 0
      processedEventCount := 0
      processedStoryCount := 0
      crossing := none
    }

def typedRequestOfProductionV7
    (request : VerifierRequestV7) : Option TypedRequestV7 :=
  some {
    original := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
      .original request.core request.core.original
    revised := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
      .revised request.core request.core.revised
    compared := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
      .compared request.core request.core.compared
    inherited :=
      Tier2.NoteReferenceIntegrity.typedInheritedV5OfOperationalRequest
        request.core request.semanticResponse
    originalRetainedMarkerScan :=
      retainedTypedMarkerScanOfRecordV7 request.core.original
    revisedRetainedMarkerScan :=
      retainedTypedMarkerScanOfRecordV7 request.core.revised
    comparedRetainedMarkerScan :=
      retainedTypedMarkerScanOfRecordV7 request.core.compared
  }

def typedSideOfVerifierSide :
    Tier2.CommentReferenceIntegrity.VerifierSide → Side
  | .original => .original
  | .revised => .revised
  | .compared => .compared

theorem typed_realization_success_of_production_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (selected : SelectedCommentIdentity)
    (part : LoadedCommentPart)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hSelected :
      Tier2.CommentReferenceIntegrity.selectConventionalMainCommentRecords
        (request.core.packageRecord
          (noteSideOfCommentSide side)).relationships =
        .ok (some selected))
    (hPart :
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.part = some part)
    (hIdentity : part.identity = selected)
    (hFailure :
      (Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
        (typedSideOfVerifierSide side) request.core
          (request.core.packageRecord
            (noteSideOfCommentSide side))).realizationFailure = none)
    (hAdmission :
      typedAdmittedCommentRealizationCheck
        (Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
          (typedSideOfVerifierSide side) request.core
            (request.core.packageRecord
              (noteSideOfCommentSide side)))
        (Tier2.NoteReferenceIntegrity.typedSelectedCommentOfProduction
          selected)
        (Tier2.NoteReferenceIntegrity.typedCommentRealizationOfProduction
          part) = true) :
    realizeTypedCommentV7 typedRequest (typedSideOfVerifierSide side) =
      .ok (some
        (Tier2.NoteReferenceIntegrity.typedCommentRealizationOfProduction
          part)) := by
  unfold typedRequestOfProductionV7 at hTyped
  injection hTyped with hTyped
  subst typedRequest
  let pkg := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
    (typedSideOfVerifierSide side) request.core
      (request.core.packageRecord (noteSideOfCommentSide side))
  have hPackage :
      typedPackageAt {
        original := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
          .original request.core request.core.original
        revised := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
          .revised request.core request.core.revised
        compared := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
          .compared request.core request.core.compared
        inherited :=
          Tier2.NoteReferenceIntegrity.typedInheritedV5OfOperationalRequest
            request.core request.semanticResponse
        originalRetainedMarkerScan :=
          retainedTypedMarkerScanOfRecordV7 request.core.original
        revisedRetainedMarkerScan :=
          retainedTypedMarkerScanOfRecordV7 request.core.revised
        comparedRetainedMarkerScan :=
          retainedTypedMarkerScanOfRecordV7 request.core.compared
      } (typedSideOfVerifierSide side) = pkg := by
    cases side <;> rfl
  have hSelector :
      selectTypedCommentV7 pkg =
        .ok (some
          (Tier2.NoteReferenceIntegrity.typedSelectedCommentOfProduction
            selected)) := by
    unfold selectTypedCommentV7
    change selectTypedComment
        (typedBoundedBytesOfString
          Tier2.CommentReferenceIntegrity.commentsRelationshipType)
        (Tier2.NoteReferenceIntegrity.typedRelationshipsOfProduction
          (request.core.packageRecord
            (noteSideOfCommentSide side)).relationships) =
      .ok (some
        (Tier2.NoteReferenceIntegrity.typedSelectedCommentOfProduction
          selected))
    exact Tier2.NoteReferenceIntegrity.typed_selector_success_of_production
      _ selected hSelected
  have hRealization :
      pkg.realization =
        some
          (Tier2.NoteReferenceIntegrity.typedCommentRealizationOfProduction
            part) := by
    unfold pkg Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
    simp only [hPart, Option.map]
  change typedAdmittedCommentRealizationCheck pkg
      (Tier2.NoteReferenceIntegrity.typedSelectedCommentOfProduction
        selected)
      (Tier2.NoteReferenceIntegrity.typedCommentRealizationOfProduction
        part) = true at hAdmission
  unfold realizeTypedCommentV7
  dsimp only
  rw [hPackage, hSelector, hFailure, hRealization]
  dsimp only
  rw [if_pos hAdmission]

theorem typed_realization_none_of_production_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hSelected :
      Tier2.CommentReferenceIntegrity.selectConventionalMainCommentRecords
        (request.core.packageRecord
          (noteSideOfCommentSide side)).relationships = .ok none) :
    realizeTypedCommentV7 typedRequest (typedSideOfVerifierSide side) =
      .ok none := by
  unfold typedRequestOfProductionV7 at hTyped
  injection hTyped with hTyped
  subst typedRequest
  let pkg := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
    (typedSideOfVerifierSide side) request.core
      (request.core.packageRecord (noteSideOfCommentSide side))
  have hPackage :
      typedPackageAt {
        original := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
          .original request.core request.core.original
        revised := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
          .revised request.core request.core.revised
        compared := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
          .compared request.core request.core.compared
        inherited :=
          Tier2.NoteReferenceIntegrity.typedInheritedV5OfOperationalRequest
            request.core request.semanticResponse
        originalRetainedMarkerScan :=
          retainedTypedMarkerScanOfRecordV7 request.core.original
        revisedRetainedMarkerScan :=
          retainedTypedMarkerScanOfRecordV7 request.core.revised
        comparedRetainedMarkerScan :=
          retainedTypedMarkerScanOfRecordV7 request.core.compared
      } (typedSideOfVerifierSide side) = pkg := by
    cases side <;> rfl
  have hSelector : selectTypedCommentV7 pkg = .ok none := by
    unfold selectTypedCommentV7
    change selectTypedComment
        (typedBoundedBytesOfString
          Tier2.CommentReferenceIntegrity.commentsRelationshipType)
        (Tier2.NoteReferenceIntegrity.typedRelationshipsOfProduction
          (request.core.packageRecord
            (noteSideOfCommentSide side)).relationships) = .ok none
    exact Tier2.NoteReferenceIntegrity.typed_selector_none_of_production
      _ hSelected
  unfold realizeTypedCommentV7
  dsimp only
  rw [hPackage, hSelector]

def protocolV7ResponseJson (evaluation : Bool × Json) : Json :=
  evaluation.2

def canonicalRunRequestEvaluationV7
    (request : VerifierRequestV7) : Bool × Json :=
  buildRunRequestCoreResponse request.core request.semanticResponse

def ProtocolV7JsonProjectionOf
    (response : Json) (typedResponse : TypedProtocolV7Response) : Prop :=
  response.compress.toUTF8.data.toList =
    independentProtocolV7Projection typedResponse

def protocolV7JsonProjectionCheck
    (response : Json) (typedResponse : TypedProtocolV7Response) : Bool :=
  typedByteListEqCheck response.compress.toUTF8.data.toList
    (independentProtocolV7Projection typedResponse)

theorem protocol_v7_json_projection_check_sound
    (response : Json) (typedResponse : TypedProtocolV7Response)
    (hCheck : protocolV7JsonProjectionCheck response typedResponse = true) :
    ProtocolV7JsonProjectionOf response typedResponse := by
  exact typedByteListEqCheck_sound _ _ hCheck

def ProductionXmlEventsExactFrom :
    Nat → List TypedXmlEvent → List XmlEvent → Prop
  | _, [], [] => True
  | ordinal, typed :: typedRest, event :: eventRest =>
      typedXmlEventIdentity typed =
          typedXmlEventIdentity (typedXmlEventOfProduction ordinal event) ∧
        ProductionXmlEventsExactFrom (ordinal + 1) typedRest eventRest
  | _, _, _ => False

def productionXmlEventsExactCheckFrom :
    Nat → List TypedXmlEvent → List XmlEvent → Bool
  | _, [], [] => true
  | ordinal, typed :: typedRest, event :: eventRest =>
      typedXmlEventEqCheck typed (typedXmlEventOfProduction ordinal event) &&
        productionXmlEventsExactCheckFrom
          (ordinal + 1) typedRest eventRest
  | _, _, _ => false

theorem production_xml_events_exact_check_from_spec :
    ∀ ordinal events,
      productionXmlEventsExactCheckFrom ordinal
        (typedXmlEventsOfProductionSpecV7 ordinal events) events = true
  | _, [] => rfl
  | ordinal, event :: rest => by
      unfold typedXmlEventsOfProductionSpecV7
        productionXmlEventsExactCheckFrom
      rw [typedXmlEventEqCheck_complete _ _ rfl,
        production_xml_events_exact_check_from_spec]
      rfl

theorem production_xml_events_exact_check_from_production
    (events : List XmlEvent) :
    productionXmlEventsExactCheckFrom 0
      (Tier2.NoteReferenceIntegrity.typedXmlEventsOfProduction events)
        events = true := by
  rw [Tier2.NoteReferenceIntegrity.typed_xml_events_of_production_eq_spec]
  exact production_xml_events_exact_check_from_spec 0 events

theorem production_xml_events_exact_check_from_sound :
    ∀ ordinal typed events,
      productionXmlEventsExactCheckFrom ordinal typed events = true →
        ProductionXmlEventsExactFrom ordinal typed events
  | _, [], [], _ => trivial
  | _, [], _ :: _, h => nomatch h
  | _, _ :: _, [], h => nomatch h
  | ordinal, typed :: typedRest, event :: eventRest, h => by
      have hParts := Tier2.CommentReferenceIntegrity.Typed.bool_and_eq_true_parts
        _ _ h
      exact ⟨typedXmlEventEqCheck_sound _ _ hParts.1,
        production_xml_events_exact_check_from_sound
          (ordinal + 1) typedRest eventRest hParts.2⟩

def ProductionCommentSourceRealizationsExact :
    List TypedSourceSlot →
      List Tier2.NoteReferenceIntegrity.StoryRealization → Prop
  | [], [] => True
  | typed :: typedRest, realization :: realizationRest =>
      typed.physicalStoryOrdinal = realization.slot.ordinal ∧
      typed.source.partPath.bytes =
        realization.slot.normalizedPartPath.toUTF8.data.toList ∧
      ProductionXmlEventsExactFrom 0 typed.source.parsed.events
        realization.visitedEvents ∧
      ProductionCommentSourceRealizationsExact typedRest realizationRest
  | _, _ => False

def productionCommentSourceRealizationsExactCheck :
    List TypedSourceSlot →
      List Tier2.NoteReferenceIntegrity.StoryRealization → Bool
  | [], [] => true
  | typed :: typedRest, realization :: realizationRest =>
      decide (typed.physicalStoryOrdinal = realization.slot.ordinal) &&
      decide (typed.source.partPath.bytes =
        realization.slot.normalizedPartPath.toUTF8.data.toList) &&
      productionXmlEventsExactCheckFrom 0 typed.source.parsed.events
        realization.visitedEvents &&
      productionCommentSourceRealizationsExactCheck typedRest realizationRest
  | _, _ => false

theorem production_comment_source_realizations_exact_check_sound :
    ∀ typed realizations,
      productionCommentSourceRealizationsExactCheck typed realizations = true →
        ProductionCommentSourceRealizationsExact typed realizations
  | [], [], _ => trivial
  | [], _ :: _, h => nomatch h
  | _ :: _, [], h => nomatch h
  | typed :: typedRest, realization :: realizationRest, h => by
      simp only [productionCommentSourceRealizationsExactCheck,
        Bool.and_eq_true, decide_eq_true_eq] at h
      exact ⟨h.1.1.1, h.1.1.2,
        production_xml_events_exact_check_from_sound
          0 typed.source.parsed.events realization.visitedEvents h.1.2,
        production_comment_source_realizations_exact_check_sound
          typedRest realizationRest h.2⟩

def ExecutableCommentSourceSetV7ValueOf
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (typedRequest : TypedRequestV7) : Prop :=
  let typedSide := typedSideOfVerifierSide side
  let typedPackage := typedPackageAt typedRequest typedSide
  typedPackage.packageBytes = (request.packageView side).packageBytes ∧
  typedPackage.index =
    Tier2.NoteReferenceIntegrity.typedIndexOfProduction
      (request.packageView side).index ∧
  set.sources =
    scans.realizations.map (·.slot) ∧
  ProductionCommentSourceRealizationsExact
    (canonicalTypedCommentSourceSlotsV7 typedRequest typedSide)
    scans.realizations

def ExecutableCommentSourceSetV7RefinesTyped
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (typedRequest : TypedRequestV7) : Prop :=
  Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      (request.packageView side) side (request.noteEvaluation side) = set ∧
  request.retainedSourceScans side = scans ∧
  typedRequestOfProductionV7 request = some typedRequest ∧
  ExecutableCommentSourceSetV7ValueOf
    request side set scans typedRequest

def executableCommentSourceSetV7RefinementCheck
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (typedRequest : TypedRequestV7) : Bool :=
  let typedSide := typedSideOfVerifierSide side
  let typedPackage := typedPackageAt typedRequest typedSide
  decide (typedPackage.packageBytes = (request.packageView side).packageBytes) &&
  decide (typedPackage.index =
    Tier2.NoteReferenceIntegrity.typedIndexOfProduction
      (request.packageView side).index) &&
  decide (set.sources = scans.realizations.map (·.slot)) &&
  productionCommentSourceRealizationsExactCheck
    (canonicalTypedCommentSourceSlotsV7 typedRequest typedSide)
    scans.realizations

theorem executable_comment_source_set_v7_refines_typed
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (typedRequest : TypedRequestV7)
    (hSet :
      Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
        (request.packageView side) side (request.noteEvaluation side) = set)
    (hScans : request.retainedSourceScans side = scans)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hCheck :
      executableCommentSourceSetV7RefinementCheck
        request side set scans typedRequest = true) :
    ExecutableCommentSourceSetV7RefinesTyped
      request side set scans typedRequest := by
  simp only [executableCommentSourceSetV7RefinementCheck,
    Bool.and_eq_true, decide_eq_true_eq] at hCheck
  exact ⟨hSet, hScans, hTyped, hCheck.1.1.1, hCheck.1.1.2,
    hCheck.1.2,
    production_comment_source_realizations_exact_check_sound
      _ _ hCheck.2⟩

abbrev typedMarkerKindOfProduction := retainedTypedMarkerKindOfProduction

abbrev typedSourceKindOfProductionStory :=
  retainedTypedSourceKindOfProductionStory

abbrev typedMarkerOccurrenceOfProduction :=
  retainedTypedMarkerOccurrenceOfProduction

abbrev typedMarkerCrossingOfProduction :=
  retainedTypedMarkerCrossingOfProduction

def typedMarkerEvidenceOfProduction
    (stories : List TypedStorySource)
    (evidence : ParsedCommentRangeEvidence) :
    TypedMarkerScanEvidence :=
  { retainedTypedMarkerEvidenceOfProduction evidence with inputStories := stories }

def ExecutableCommentMarkerScanV7ValueOf
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (evidence : ParsedCommentRangeEvidence)
    (typedRequest : TypedRequestV7) : Prop :=
  let typedSide := typedSideOfVerifierSide side
  set.sources = scans.realizations.map (·.slot) ∧
  request.commentRangeScanInvocationCount side = 1 ∧
  typedMarkerEvidenceOfProduction
      (canonicalTypedCommentSourcesV7 typedRequest typedSide) evidence =
    retainedOrIndependentTypedMarkerScanV7 typedRequest typedSide

def ExecutableCommentMarkerScanV7RefinesTyped
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (evidence : ParsedCommentRangeEvidence)
    (typedRequest : TypedRequestV7) : Prop :=
  Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      (request.packageView side) side (request.noteEvaluation side) = set ∧
  request.retainedSourceScans side = scans ∧
  retainedCommentMarkerScanForRelationshipV7
      ((request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.identity.isSome)
      set scans = .ok evidence ∧
  (request.retainedCommentRangeScanResult side = .ok evidence ∧
    request.commentRangeScanInvocationCount side = 1) ∧
  typedRequestOfProductionV7 request = some typedRequest ∧
  ExecutableCommentMarkerScanV7ValueOf
    request side set scans evidence typedRequest

def executableCommentMarkerScanV7RefinementCheck
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (evidence : ParsedCommentRangeEvidence)
    (typedRequest : TypedRequestV7) : Bool :=
  let typedSide := typedSideOfVerifierSide side
  decide (set.sources = scans.realizations.map (·.slot)) &&
  decide (request.commentRangeScanInvocationCount side = 1) &&
  decide (typedMarkerEvidenceOfProduction
      (canonicalTypedCommentSourcesV7 typedRequest typedSide) evidence =
    retainedOrIndependentTypedMarkerScanV7 typedRequest typedSide)

theorem executable_comment_marker_scan_v7_refines_typed
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (evidence : ParsedCommentRangeEvidence)
    (typedRequest : TypedRequestV7)
    (hSet : Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      (request.packageView side) side (request.noteEvaluation side) = set)
    (hScans : request.retainedSourceScans side = scans)
    (hRun : retainedCommentMarkerScanForRelationshipV7
      ((request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.identity.isSome)
      set scans = .ok evidence)
    (hRetained :
      request.retainedCommentRangeScanResult side = .ok evidence ∧
      request.commentRangeScanInvocationCount side = 1)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hCheck : executableCommentMarkerScanV7RefinementCheck
      request side set scans evidence typedRequest = true) :
    ExecutableCommentMarkerScanV7RefinesTyped
      request side set scans evidence typedRequest := by
  simp only [executableCommentMarkerScanV7RefinementCheck,
    Bool.and_eq_true, decide_eq_true_eq] at hCheck
  exact ⟨hSet, hScans, hRun, hRetained, hTyped,
    hCheck.1.1, hCheck.1.2, hCheck.2⟩

def selectConventionalMainCommentV7 :=
  Tier2.CommentReferenceIntegrity.selectConventionalMainComment

def realizeSelectedCommentV7 (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (selected : Tier2.CommentReferenceIntegrity.SelectedCommentIdentity) :=
  Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
    (request.packageView side) side
      (request.packageView side).resourceUsageBeforeComments selected

def ExecutableCommentDefinitionRealizationV7ValueOf
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (selected : Tier2.CommentReferenceIntegrity.SelectedCommentIdentity)
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typedRequest : TypedRequestV7) : Prop :=
  let typedPackage := typedPackageAt typedRequest (typedSideOfVerifierSide side)
  typedPackage.packageBytes = (request.packageView side).packageBytes ∧
  typedPackage.index = Tier2.NoteReferenceIntegrity.typedIndexOfProduction
    (request.packageView side).index ∧
  typedPackage.realization.map (fun value =>
      (value.selected.relationshipOrdinal,
        value.selected.relationshipId.bytes,
        value.selected.normalizedPartPath.bytes)) =
    some (selected.relationshipRecordOrdinal,
      selected.relationshipId.toUTF8.data.toList,
      selected.normalizedPartPath.toUTF8.data.toList) ∧
  (match typedPackage.realization with
    | none => False
    | some value =>
        ProductionXmlEventsExactFrom 0 value.retainedParsedEvents
          realization.retainedParsedEvidence.events) ∧
  typedDefinitionsV7 typedRequest (typedSideOfVerifierSide side) =
    typedDefinitionsFromEventsV7
      (Tier2.NoteReferenceIntegrity.typedXmlEventsOfProduction
        realization.retainedParsedEvidence.events) ∧
  let record := request.core.packageRecord (noteSideOfCommentSide side)
  ∃ retained,
    record.commentEvidence.retainedScan = some retained ∧
    retained.scanInvocationCount = 1 ∧
    retained.input = productionCommentScanInput record ∧
    retained.output =
      Tier2.CommentReferenceIntegrity.scanCommentEvidence retained.input ∧
    typedDefinitionsV7 typedRequest (typedSideOfVerifierSide side) =
      retained.output.scan.definitions.map
          Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction ++
        retained.output.scan.nonDirectDefinitions.map
          Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction

theorem retained_comment_definitions_refine_typed_v7
    (retained : RetainedCommentScan)
    (events : List XmlEvent)
    (hInput : retained.input = {
      sourceEvents := []
      definitionEvents := events
    })
    (hOutput : retained.output =
      Tier2.CommentReferenceIntegrity.scanCommentEvidence retained.input) :
    typedDefinitionsFromEventsV7
        (Tier2.NoteReferenceIntegrity.typedXmlEventsOfProduction events) =
      retained.output.scan.definitions.map
          Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction ++
      retained.output.scan.nonDirectDefinitions.map
          Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction := by
  rw [hOutput, hInput,
    Tier2.NoteReferenceIntegrity.typed_definitions_from_events_of_production]

def ExecutableCommentDefinitionRealizationV7RefinesTyped
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (selected : Tier2.CommentReferenceIntegrity.SelectedCommentIdentity)
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typedRequest : TypedRequestV7) : Prop :=
  selectConventionalMainCommentV7 (request.packageView side) =
      .ok (some selected) ∧
  realizeSelectedCommentV7 request side selected = .ok realization ∧
  (request.retainedCommentRealization side = some realization ∧
    request.commentExtractionInvocationCount side = 1 ∧
    request.commentParseInvocationCount side = 1) ∧
  typedRequestOfProductionV7 request = some typedRequest ∧
  ExecutableCommentDefinitionRealizationV7ValueOf
    request side selected realization typedRequest

def executableCommentDefinitionRealizationV7RefinementCheck
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (selected : Tier2.CommentReferenceIntegrity.SelectedCommentIdentity)
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typedRequest : TypedRequestV7) : Bool :=
  let typedPackage := typedPackageAt typedRequest (typedSideOfVerifierSide side)
  decide (typedPackage.packageBytes = (request.packageView side).packageBytes) &&
  decide (typedPackage.index = Tier2.NoteReferenceIntegrity.typedIndexOfProduction
    (request.packageView side).index) &&
  decide (typedPackage.realization.map (fun value =>
      (value.selected.relationshipOrdinal,
        value.selected.relationshipId.bytes,
        value.selected.normalizedPartPath.bytes)) =
    some (selected.relationshipRecordOrdinal,
      selected.relationshipId.toUTF8.data.toList,
      selected.normalizedPartPath.toUTF8.data.toList)) &&
  (match typedPackage.realization with
    | none => false
    | some value =>
        productionXmlEventsExactCheckFrom 0 value.retainedParsedEvents
          realization.retainedParsedEvidence.events) &&
  decide (typedDefinitionsV7 typedRequest (typedSideOfVerifierSide side) =
    typedDefinitionsFromEventsV7
      (Tier2.NoteReferenceIntegrity.typedXmlEventsOfProduction
        realization.retainedParsedEvidence.events)) &&
  let record := request.core.packageRecord (noteSideOfCommentSide side)
  match record.commentEvidence.retainedScan with
  | none => false
  | some retained =>
      decide (retained.scanInvocationCount = 1) &&
      decide (retained.input = productionCommentScanInput record) &&
      decide (typedDefinitionsV7 typedRequest
          (typedSideOfVerifierSide side) =
        retained.output.scan.definitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction ++
          retained.output.scan.nonDirectDefinitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction)

theorem executable_comment_definition_realization_v7_refines_typed
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (selected : Tier2.CommentReferenceIntegrity.SelectedCommentIdentity)
    (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
    (typedRequest : TypedRequestV7)
    (hSelected : selectConventionalMainCommentV7 (request.packageView side) =
      .ok (some selected))
    (hRun : realizeSelectedCommentV7 request side selected = .ok realization)
    (hRetained :
      request.retainedCommentRealization side = some realization ∧
      request.commentExtractionInvocationCount side = 1 ∧
      request.commentParseInvocationCount side = 1)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hCheck : executableCommentDefinitionRealizationV7RefinementCheck
      request side selected realization typedRequest = true) :
    ExecutableCommentDefinitionRealizationV7RefinesTyped
      request side selected realization typedRequest := by
  simp only [executableCommentDefinitionRealizationV7RefinementCheck,
    Bool.and_eq_true, decide_eq_true_eq] at hCheck
  have hEvents :
      match (typedPackageAt typedRequest
        (typedSideOfVerifierSide side)).realization with
      | none => False
      | some value =>
          ProductionXmlEventsExactFrom 0 value.retainedParsedEvents
            realization.retainedParsedEvidence.events := by
    cases hRealization :
        (typedPackageAt typedRequest
          (typedSideOfVerifierSide side)).realization with
    | none => simp [hRealization] at hCheck
    | some value =>
        exact production_xml_events_exact_check_from_sound
          0 value.retainedParsedEvents
            realization.retainedParsedEvidence.events
            (by simpa [hRealization] using hCheck.1.1.2)
  let record := request.core.packageRecord (noteSideOfCommentSide side)
  have hRetainedBinding :
      ∃ retained,
        record.commentEvidence.retainedScan = some retained ∧
        retained.scanInvocationCount = 1 ∧
        retained.input = productionCommentScanInput record ∧
        retained.output =
          Tier2.CommentReferenceIntegrity.scanCommentEvidence retained.input ∧
        typedDefinitionsV7 typedRequest (typedSideOfVerifierSide side) =
          retained.output.scan.definitions.map
              Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction ++
            retained.output.scan.nonDirectDefinitions.map
              Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction := by
    have hBinding := hCheck.2
    cases hRetained : record.commentEvidence.retainedScan with
    | none =>
        simp [record, hRetained] at hBinding
    | some retained =>
        simp only [record, hRetained, Bool.and_eq_true,
          decide_eq_true_eq] at hBinding
        exact ⟨retained, rfl, hBinding.1.1,
          hBinding.1.2, retained.outputExact, hBinding.2⟩
  exact ⟨hSelected, hRun, hRetained, hTyped,
    hCheck.1.1.1.1.1, hCheck.1.1.1.1.2, hCheck.1.1.1.2,
    hEvents, hCheck.1.2, hRetainedBinding⟩

abbrev SideCommentEvaluationV7 := CommentSideEvidence

def evaluateCommentSideV7 (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    SideCommentEvaluationV7 :=
  (request.core.packageRecord
    (noteSideOfCommentSide side)).commentEvidence

def ExecutableCommentIncompleteV7ValueOf
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (evaluation : SideCommentEvaluationV7)
    (typedRequest : TypedRequestV7) : Prop :=
  let typedEvaluation :=
    evaluateTypedCommentSideV7 typedRequest (typedSideOfVerifierSide side)
  (typedEvaluation.status = .notEvaluated) =
    (!evaluation.complete ∧ evaluation.markerScan.isNone = true ∧
      evaluation.markerScanInvocationCount = 0 ∧
      evaluation.inventory.referenceOccurrences = 0 ∧
      evaluation.inventory.rangeStartOccurrences = 0 ∧
      evaluation.inventory.rangeEndOccurrences = 0 ∧
      evaluation.inventory.definitions = 0)

def ExecutableCommentIncompleteV7RefinesTyped
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (evaluation : SideCommentEvaluationV7)
    (typedRequest : TypedRequestV7) : Prop :=
  evaluateCommentSideV7 request side = evaluation ∧
  typedRequestOfProductionV7 request = some typedRequest ∧
  ExecutableCommentIncompleteV7ValueOf side evaluation typedRequest

def executableCommentIncompleteV7RefinementCheck
    (_request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (evaluation : SideCommentEvaluationV7)
    (typedRequest : TypedRequestV7) : Bool :=
  decide ((evaluateTypedCommentSideV7 typedRequest
      (typedSideOfVerifierSide side)).status = .notEvaluated) ==
    ((!evaluation.complete) &&
      evaluation.markerScan.isNone &&
      evaluation.markerScanInvocationCount == 0 &&
      evaluation.inventory.referenceOccurrences == 0 &&
      evaluation.inventory.rangeStartOccurrences == 0 &&
      evaluation.inventory.rangeEndOccurrences == 0 &&
      evaluation.inventory.definitions == 0)

theorem executable_comment_incomplete_v7_refines_typed
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (evaluation : SideCommentEvaluationV7)
    (typedRequest : TypedRequestV7)
    (hEvaluation : evaluateCommentSideV7 request side = evaluation)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hCheck : executableCommentIncompleteV7RefinementCheck
      request side evaluation typedRequest = true) :
    ExecutableCommentIncompleteV7RefinesTyped
      request side evaluation typedRequest := by
  unfold executableCommentIncompleteV7RefinementCheck at hCheck
  refine ⟨hEvaluation, hTyped, ?_⟩
  unfold ExecutableCommentIncompleteV7ValueOf
  let incomplete :=
    (!evaluation.complete) &&
      evaluation.markerScan.isNone &&
      evaluation.markerScanInvocationCount == 0 &&
      evaluation.inventory.referenceOccurrences == 0 &&
      evaluation.inventory.rangeStartOccurrences == 0 &&
      evaluation.inventory.rangeEndOccurrences == 0 &&
      evaluation.inventory.definitions == 0
  have hDecision :
      decide ((evaluateTypedCommentSideV7 typedRequest
        (typedSideOfVerifierSide side)).status = .notEvaluated) =
        incomplete := by
    simpa only [beq_iff_eq] using hCheck
  apply propext
  constructor
  · intro hStatus
    have hDecide :
        decide ((evaluateTypedCommentSideV7 typedRequest
          (typedSideOfVerifierSide side)).status = .notEvaluated) = true :=
      decide_eq_true hStatus
    have hIncomplete : incomplete = true := hDecision ▸ hDecide
    have hParts := hIncomplete
    simp only [incomplete, Bool.and_eq_true, Bool.not_eq_true,
      beq_iff_eq] at hParts
    rcases hParts with
      ⟨⟨⟨⟨⟨⟨hComplete, hMarker⟩, hInvocation⟩, hReferences⟩,
        hStarts⟩, hEnds⟩, hDefinitions⟩
    exact ⟨hComplete, hMarker, hInvocation, hReferences, hStarts,
      hEnds, hDefinitions⟩
  · intro hIncomplete
    rcases hIncomplete with
      ⟨hComplete, hMarker, hInvocation, hReferences, hStarts,
        hEnds, hDefinitions⟩
    have hIncompleteBool : incomplete = true := by
      simp only [incomplete, Bool.and_eq_true, Bool.not_eq_true,
        beq_iff_eq]
      exact ⟨⟨⟨⟨⟨⟨hComplete, hMarker⟩, hInvocation⟩, hReferences⟩,
        hStarts⟩, hEnds⟩, hDefinitions⟩
    exact of_decide_eq_true (hDecision.trans hIncompleteBool)

def actualExecutableCommentSourceSetV7RefinementOf
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Prop :=
  ∃ set scans,
    ExecutableCommentSourceSetV7RefinesTyped
      request side set scans typedRequest

def actualExecutableCommentMarkerScanV7RefinementOf
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Prop :=
  ∃ set scans evidence,
    ExecutableCommentMarkerScanV7RefinesTyped
      request side set scans evidence typedRequest

def actualExecutableCommentDefinitionV7RefinementOf
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Prop :=
  match selectConventionalMainCommentV7 (request.packageView side) with
  | .error _ => False
  | .ok none => True
  | .ok (some selected) =>
      ∃ realization,
        ExecutableCommentDefinitionRealizationV7RefinesTyped
          request side selected realization typedRequest

def actualExecutableCommentIncompleteV7RefinementOf
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Prop :=
  ∃ evaluation,
    ExecutableCommentIncompleteV7RefinesTyped
      request side evaluation typedRequest

def actualExecutableProtocolV7Utf8JsonRefinementOf
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7)
    (response : Json) : Prop :=
  response = protocolV7ResponseJson
      (canonicalRunRequestEvaluationV7 request) ∧
    ProtocolV7JsonProjectionOf response
      (canonicalTypedResponseV7 typedRequest) ∧
    response.compress.toUTF8.data.toList =
      independentProtocolV7Projection
        (canonicalTypedResponseV7 typedRequest)

theorem retained_marker_scan_run_result_substitution_rejected
    (relationshipPresent : Bool) (side : VerifierSide)
    (run : RetainedCommentMarkerScanRun relationshipPresent side)
    (forged : Except String ParsedCommentRangeEvidence)
    (hDifferent : forged ≠
      retainedCommentMarkerScanForRelationshipV7
        relationshipPresent run.set run.scans) :
    run.result ≠ forged := by
  intro hForged
  exact hDifferent (hForged ▸ run.resultExact)

theorem executable_marker_scan_invocation_substitution_rejected
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (evidence : ParsedCommentRangeEvidence)
    (typedRequest : TypedRequestV7)
    (hRefines : ExecutableCommentMarkerScanV7RefinesTyped
      request side set scans evidence typedRequest)
    (hForged : request.commentRangeScanInvocationCount side ≠ 1) : False :=
  hForged hRefines.2.2.2.1.2

theorem executable_marker_scan_retained_evidence_substitution_rejected
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
    (evidence : ParsedCommentRangeEvidence)
    (typedRequest : TypedRequestV7)
    (hRefines : ExecutableCommentMarkerScanV7RefinesTyped
      request side set scans evidence typedRequest)
    (hForged :
      request.retainedCommentRangeScanResult side ≠ .ok evidence) : False :=
  hForged hRefines.2.2.2.1.1

def productionActualMarkerRefinementChecksV7
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7) : Bool :=
  let sides : List Tier2.CommentReferenceIntegrity.VerifierSide :=
    [.original, .revised, .compared]
  sides.all fun side =>
    let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      (request.packageView side) side (request.noteEvaluation side)
    let scans := request.retainedSourceScans side
    match request.retainedCommentRangeScanResult side with
    | .error _ => false
    | .ok evidence =>
        executableCommentMarkerScanV7RefinementCheck
          request side set scans evidence typedRequest

def productionActualBridgeRefinementCheckAtV7
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Bool :=
  let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
    (request.packageView side) side (request.noteEvaluation side)
  let scans := request.retainedSourceScans side
  let sourceCheck := executableCommentSourceSetV7RefinementCheck
    request side set scans typedRequest
  let markerCheck := match request.retainedCommentRangeScanResult side with
    | .error _ => false
    | .ok evidence =>
        executableCommentMarkerScanV7RefinementCheck
          request side set scans evidence typedRequest
  let definitionCheck :=
    match selectConventionalMainCommentV7 (request.packageView side) with
    | .error _ => false
    | .ok none => true
    | .ok (some selected) =>
        match realizeSelectedCommentV7 request side selected with
        | .error _ => false
        | .ok realization =>
            executableCommentDefinitionRealizationV7RefinementCheck
              request side selected realization typedRequest
  let incompleteCheck := executableCommentIncompleteV7RefinementCheck
    request side (evaluateCommentSideV7 request side) typedRequest
  sourceCheck && markerCheck && definitionCheck && incompleteCheck

def productionActualBridgeRefinementChecksV7
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7) : Bool :=
  let sides : List Tier2.CommentReferenceIntegrity.VerifierSide :=
    [.original, .revised, .compared]
  sides.all (productionActualBridgeRefinementCheckAtV7 request typedRequest)

theorem production_actual_bridge_refinement_checks_v7_at
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7)
    (hChecks :
      productionActualBridgeRefinementChecksV7 request typedRequest = true)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      (request.packageView side) side (request.noteEvaluation side)
    let scans := request.retainedSourceScans side
    executableCommentSourceSetV7RefinementCheck
        request side set scans typedRequest = true ∧
    (match request.retainedCommentRangeScanResult side with
      | .error _ => false
      | .ok evidence =>
          executableCommentMarkerScanV7RefinementCheck
            request side set scans evidence typedRequest) = true ∧
    (match selectConventionalMainCommentV7 (request.packageView side) with
      | .error _ => false
      | .ok none => true
      | .ok (some selected) =>
          match realizeSelectedCommentV7 request side selected with
          | .error _ => false
          | .ok realization =>
              executableCommentDefinitionRealizationV7RefinementCheck
                request side selected realization typedRequest) = true ∧
    executableCommentIncompleteV7RefinementCheck request side
      (evaluateCommentSideV7 request side) typedRequest = true := by
  unfold productionActualBridgeRefinementChecksV7
    productionActualBridgeRefinementCheckAtV7 at hChecks
  simp only [List.all_cons, List.all_nil, Bool.and_true,
    Bool.and_eq_true] at hChecks
  cases side with
  | original =>
      exact ⟨hChecks.1.1.1.1, hChecks.1.1.1.2,
        hChecks.1.1.2, hChecks.1.2⟩
  | revised =>
      exact ⟨hChecks.2.1.1.1.1, hChecks.2.1.1.1.2,
        hChecks.2.1.1.2, hChecks.2.1.2⟩
  | compared =>
      exact ⟨hChecks.2.2.1.1.1, hChecks.2.2.1.1.2,
        hChecks.2.2.1.2, hChecks.2.2.2⟩

theorem production_actual_bridge_refinements_v7_sound
    (request : VerifierRequestV7) (typedRequest : TypedRequestV7)
    (packageEvidence :
      ProductionPackageRecordOf request.core.original ∧
      ProductionPackageRecordOf request.core.revised ∧
      ProductionPackageRecordOf request.core.compared)
    (commentEvidence :
      ProductionCommentEvidenceOf request.core.original ∧
      ProductionCommentEvidenceOf request.core.revised ∧
      ProductionCommentEvidenceOf request.core.compared)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hChecks :
      productionActualBridgeRefinementChecksV7 request typedRequest = true) :
    (∀ side, actualExecutableCommentSourceSetV7RefinementOf
      request typedRequest side) ∧
    (∀ side, actualExecutableCommentMarkerScanV7RefinementOf
      request typedRequest side) ∧
    (∀ side, actualExecutableCommentDefinitionV7RefinementOf
      request typedRequest side) ∧
    (∀ side, actualExecutableCommentIncompleteV7RefinementOf
      request typedRequest side) := by
  have hAt := production_actual_bridge_refinement_checks_v7_at
    request typedRequest hChecks
  constructor
  · intro side
    let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      (request.packageView side) side (request.noteEvaluation side)
    let scans := request.retainedSourceScans side
    exact ⟨set, scans,
      executable_comment_source_set_v7_refines_typed
        request side set scans typedRequest rfl rfl hTyped (hAt side).1⟩
  constructor
  · intro side
    let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      (request.packageView side) side (request.noteEvaluation side)
    let scans := request.retainedSourceScans side
    have hMarkerCheck := (hAt side).2.1
    cases hRetained :
        request.retainedCommentRangeScanResult side with
    | error detail => simp [hRetained] at hMarkerCheck
    | ok evidence =>
      simp only [hRetained] at hMarkerCheck
      have hComment := Tier2.NoteReferenceIntegrity.productionCommentEvidenceAt
        request.core
        commentEvidence side
      rcases hComment with
        ⟨_, _, _, hMarkerEvidence, _⟩
      rcases hMarkerEvidence with
        ⟨markerRun, markerEvidence, hMarkerRun, hMarkerResult,
          _hMarkerExact, hNoCrossing, hInvocation, _hStoredEvidence⟩
      have hEvidence : evidence = markerEvidence := by
        unfold VerifierRequestV7.retainedCommentRangeScanResult at hRetained
        simp only [hMarkerRun] at hRetained
        exact Except.ok.inj (hRetained.symm.trans hMarkerResult)
      subst evidence
      have hScans : scans = markerRun.scans := by
        unfold scans VerifierRequestV7.retainedSourceScans
        simp [hMarkerRun]
      have hMarkerCheckParts := hMarkerCheck
      simp only [executableCommentMarkerScanV7RefinementCheck,
        Bool.and_eq_true, decide_eq_true_eq] at hMarkerCheckParts
      have hRun : retainedCommentMarkerScanForRelationshipV7
          ((request.core.packageRecord
            (noteSideOfCommentSide side)).commentEvidence.identity.isSome)
          set scans = .ok markerEvidence := by
        rw [hScans]
        apply retained_comment_marker_scan_run_for_matching_set
          _ _ markerRun set markerEvidence
        · simpa [set, scans, hScans] using hMarkerCheckParts.1.1
        · exact hMarkerResult
      exact ⟨set, scans, markerEvidence,
        executable_comment_marker_scan_v7_refines_typed
          request side set scans markerEvidence typedRequest
          rfl rfl hRun ⟨by simpa [hRetained], hInvocation⟩
          hTyped hMarkerCheck⟩
  constructor
  · intro side
    have hDefinitionCheck := (hAt side).2.2.1
    unfold actualExecutableCommentDefinitionV7RefinementOf
    cases hSelected :
        selectConventionalMainCommentV7 (request.packageView side) with
    | error failure => simp [hSelected] at hDefinitionCheck
    | ok selected? =>
      cases selected? with
      | none =>
          trivial
      | some selected =>
        simp only [hSelected] at hDefinitionCheck
        cases hRealize : realizeSelectedCommentV7 request side selected with
        | error failure => simp [hRealize] at hDefinitionCheck
        | ok realization =>
          simp only [hRealize] at hDefinitionCheck
          have hRetained :=
            Tier2.CommentReferenceIntegrity.realize_selected_comment_v6_success
              (request.packageView side) side
              (request.packageView side).resourceUsageBeforeComments
              selected realization hRealize
          let record := request.core.packageRecord (noteSideOfCommentSide side)
          have hPackage := Tier2.NoteReferenceIntegrity.productionPackageRecordAt
            request.core
            packageEvidence side
          cases hPart : record.commentEvidence.part with
          | none =>
              simp [VerifierRequestV7.retainedCommentRealization,
                VerifierRequestV7.packageView, commentPackageViewOfCore,
                record, hPart] at hRetained
          | some loaded =>
            have hRealization :
                semanticCommentRealizationOfProduction loaded = realization := by
              simpa [VerifierRequestV7.retainedCommentRealization,
                VerifierRequestV7.packageView, commentPackageViewOfCore,
                record, hPart] using hRetained.1
            subst realization
            have hParse : ProductionParseEvidenceOf record loaded.parseEvidence := by
              apply hPackage.2.2.2.1
              simp [productionParseEvidencesOfRecord, record, hPart]
            rcases hParse with
              ⟨_, _, hExtraction, _, _, _, _, _, hParseCount, _⟩
            rcases hExtraction with
              ⟨_, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
                hExtractionCount, _⟩
            have hCounts :
                request.retainedCommentRealization side =
                    some (semanticCommentRealizationOfProduction loaded) ∧
                  request.commentExtractionInvocationCount side = 1 ∧
                  request.commentParseInvocationCount side = 1 := by
              refine ⟨?_, ?_, ?_⟩
              · simpa [record, hPart] using hRetained.1
              · simp [VerifierRequestV7.commentExtractionInvocationCount,
                  record, hPart, hExtractionCount]
              · simp [VerifierRequestV7.commentParseInvocationCount,
                  record, hPart, hParseCount]
            exact ⟨semanticCommentRealizationOfProduction loaded,
              executable_comment_definition_realization_v7_refines_typed
                request side selected
                  (semanticCommentRealizationOfProduction loaded)
                  typedRequest hSelected hRealize hCounts hTyped
                  hDefinitionCheck⟩
  · intro side
    let evaluation := evaluateCommentSideV7 request side
    exact ⟨evaluation,
      executable_comment_incomplete_v7_refines_typed
        request side evaluation typedRequest rfl hTyped (hAt side).2.2.2⟩

theorem executable_protocol_v7_utf8_json_refines_typed
    (request : VerifierRequestV7) (response : Json)
    (typedRequest : TypedRequestV7)
    (_hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (_hResponse : response = protocolV7ResponseJson
      (canonicalRunRequestEvaluationV7 request))
    (hCheck : protocolV7JsonProjectionCheck response
      (canonicalTypedResponseV7 typedRequest) = true) :
    ProtocolV7JsonProjectionOf response
        (canonicalTypedResponseV7 typedRequest) ∧
      response.compress.toUTF8.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest) := by
  let h := protocol_v7_json_projection_check_sound _ _ hCheck
  exact ⟨h, h⟩

abbrev RunRequestCoreRequestV7 := RunRequestCoreRequest
abbrev RunRequestCoreResultV7 := RunRequestCoreResult

def verifierRequestV7OfRunRequestCore
    (request : RunRequestCoreRequestV7)
    (result : RunRequestCoreResultV7) : VerifierRequestV7 := {
  core := request
  semanticResponse := result.semanticResponse
}

def typedRequestOfRunRequestCoreV7
    (request : RunRequestCoreRequestV7)
    (result : RunRequestCoreResultV7) : Option TypedRequestV7 :=
  typedRequestOfProductionV7 (verifierRequestV7OfRunRequestCore request result)

def productionXmlEventListExactCheckV7 :
    List XmlEvent → List XmlEvent → Bool
  | [], [] => true
  | left :: leftRest, right :: rightRest =>
      decide (left = right) &&
        productionXmlEventListExactCheckV7 leftRest rightRest
  | _, _ => false

theorem production_xml_event_list_exact_check_v7_sound :
    ∀ left right,
      productionXmlEventListExactCheckV7 left right = true →
        left = right
  | [], [], _ => rfl
  | [], _ :: _, h => nomatch h
  | _ :: _, [], h => nomatch h
  | left :: leftRest, right :: rightRest, h => by
      simp only [productionXmlEventListExactCheckV7,
        Bool.and_eq_true, decide_eq_true_eq] at h
      rw [h.1, production_xml_event_list_exact_check_v7_sound
        leftRest rightRest h.2]

inductive ProductionCommentSourceEventsExactFromV7 :
    Nat → List NoteSource →
      List Tier2.NoteReferenceIntegrity.StoryRealization → Prop
  | nil (sourceOrdinal : Nat) :
      ProductionCommentSourceEventsExactFromV7 sourceOrdinal [] []
  | cons (sourceOrdinal : Nat) (source : NoteSource)
      (realization : Tier2.NoteReferenceIntegrity.StoryRealization)
      (sources : List NoteSource)
      (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization)
      (sourceOrdinalExact : source.sourceOrdinal = sourceOrdinal)
      (storyExact :
        source.sourceStory =
          commentMarkerSourceStoryName realization.slot.story)
      (storyOrdinalExact :
        source.sourceStoryOrdinal = realization.slot.ordinal)
      (pathExact :
        source.normalizedPartPath = realization.slot.normalizedPartPath)
      (eventsExact :
        source.parseEvidence.parsed.events = realization.visitedEvents)
      (restExact :
        ProductionCommentSourceEventsExactFromV7
          (sourceOrdinal + 1) sources realizations) :
      ProductionCommentSourceEventsExactFromV7 sourceOrdinal
        (source :: sources) (realization :: realizations)

abbrev ProductionCommentSourceEventsExactV7 :=
  ProductionCommentSourceEventsExactFromV7 0

def productionCommentSourceEventsExactCheckFromV7 :
    Nat → List NoteSource →
      List Tier2.NoteReferenceIntegrity.StoryRealization → Bool
  | _, [], [] => true
  | sourceOrdinal, source :: sources, realization :: realizations =>
      decide (source.sourceOrdinal = sourceOrdinal) &&
      decide (source.sourceStory =
        commentMarkerSourceStoryName realization.slot.story) &&
      decide (source.sourceStoryOrdinal = realization.slot.ordinal) &&
      decide (source.normalizedPartPath =
        realization.slot.normalizedPartPath) &&
      productionXmlEventListExactCheckV7
        source.parseEvidence.parsed.events realization.visitedEvents &&
      productionCommentSourceEventsExactCheckFromV7
        (sourceOrdinal + 1) sources realizations
  | _, _, _ => false

theorem production_comment_source_events_exact_check_from_v7_sound :
    ∀ sourceOrdinal sources realizations,
      productionCommentSourceEventsExactCheckFromV7
          sourceOrdinal sources realizations = true →
        ProductionCommentSourceEventsExactFromV7
          sourceOrdinal sources realizations
  | sourceOrdinal, [], [], _ => .nil sourceOrdinal
  | _, [], _ :: _, h => nomatch h
  | _, _ :: _, [], h => nomatch h
  | sourceOrdinal, source :: sources, realization :: realizations, h => by
      simp only [productionCommentSourceEventsExactCheckFromV7,
        Bool.and_eq_true, decide_eq_true_eq] at h
      exact .cons sourceOrdinal source realization sources realizations
        h.1.1.1.1.1 h.1.1.1.1.2 h.1.1.1.2 h.1.1.2
        (production_xml_event_list_exact_check_v7_sound _ _ h.1.2)
        (production_comment_source_events_exact_check_from_v7_sound
          (sourceOrdinal + 1) sources realizations h.2)

def productionCommentSourceEventsExactCheckV7
    (sources : List NoteSource)
    (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization) : Bool :=
  productionCommentSourceEventsExactCheckFromV7 0 sources realizations

theorem production_comment_source_events_exact_check_v7_sound
    (sources : List NoteSource)
    (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization)
    (hCheck :
      productionCommentSourceEventsExactCheckV7 sources realizations = true) :
    ProductionCommentSourceEventsExactV7 sources realizations :=
  production_comment_source_events_exact_check_from_v7_sound
    0 sources realizations hCheck

theorem production_comment_source_events_exact_from_v7_to_concurrent
    (side : Side) (sourceOrdinal : Nat) (sources : List NoteSource)
    (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization)
    (hExact :
      ProductionCommentSourceEventsExactFromV7
        sourceOrdinal sources realizations) :
    ConcurrentTypedStoryEventsV7
      (sources.map
        (Tier2.NoteReferenceIntegrity.typedStorySourceOfProduction side))
      realizations := by
  induction hExact with
  | nil => exact ConcurrentTypedStoryEventsV7.nil
  | cons sourceOrdinal source realization sources realizations _ _ _ _
      eventsExact
      _ hInduction =>
      apply ConcurrentTypedStoryEventsV7.cons
      · dsimp only [Tier2.NoteReferenceIntegrity.typedStorySourceOfProduction,
          Tier2.NoteReferenceIntegrity.typedParsedPartOfProduction]
        rw [Tier2.NoteReferenceIntegrity.typed_xml_events_of_production_eq_spec,
          eventsExact]
      · exact hInduction

theorem production_comment_source_events_exact_v7_to_concurrent
    (side : Side) (sources : List NoteSource)
    (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization)
    (hExact :
      ProductionCommentSourceEventsExactV7 sources realizations) :
    ConcurrentTypedStoryEventsV7
      (sources.map
        (Tier2.NoteReferenceIntegrity.typedStorySourceOfProduction side))
      realizations :=
  production_comment_source_events_exact_from_v7_to_concurrent
    side 0 sources realizations hExact

theorem production_comment_source_events_exact_from_v7_to_realizations :
    ∀ (side : Side) (sourceOrdinal : Nat) (sources : List NoteSource)
      (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization),
      ProductionCommentSourceEventsExactFromV7
          sourceOrdinal sources realizations →
        ProductionCommentSourceRealizationsExact
          (sources.map
            (Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction side))
          realizations
  | _, _, [], [], .nil _ => trivial
  | side, _, source :: sources, realization :: realizations,
      .cons _ _ _ _ _ _ _ storyOrdinalExact pathExact eventsExact
        restExact => by
      simp only [List.map_cons]
      refine ⟨?_, ?_, ?_, ?_⟩
      · simpa [Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction]
          using storyOrdinalExact
      · dsimp only [Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction,
          Tier2.NoteReferenceIntegrity.typedStorySourceOfProduction,
          typedBoundedBytesOfString]
        rw [pathExact]
      · dsimp only [Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction,
          Tier2.NoteReferenceIntegrity.typedStorySourceOfProduction,
          Tier2.NoteReferenceIntegrity.typedParsedPartOfProduction]
        rw [eventsExact]
        exact production_xml_events_exact_check_from_sound 0 _ _
          (production_xml_events_exact_check_from_production _)
      · exact
          production_comment_source_events_exact_from_v7_to_realizations
            side _ sources realizations restExact

def physicalStoryPartPathForVerifierSideV7
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (story : PhysicalStory) : String :=
  match side with
  | .original => story.originalPartPath
  | .revised => story.revisedPartPath
  | .compared => story.comparedPartPath

def canonicalHeaderFooterCommentSourceIdentitiesFromV7
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    Nat → List PhysicalStory → List CommentSourceIdentity
  | _, [] => []
  | sourceOrdinal, story :: rest =>
      { sourceOrdinal
        sourceStory := story.kind.toString
        sourceStoryOrdinal := story.physicalStoryOrdinal
        normalizedPartPath :=
          physicalStoryPartPathForVerifierSideV7 side story } ::
      canonicalHeaderFooterCommentSourceIdentitiesFromV7
        side (sourceOrdinal + 1) rest

theorem canonical_header_footer_comment_source_identities_length_v7 :
    ∀ (side : Tier2.CommentReferenceIntegrity.VerifierSide)
      (sourceOrdinal : Nat) (stories : List PhysicalStory),
      (canonicalHeaderFooterCommentSourceIdentitiesFromV7
        side sourceOrdinal stories).length = stories.length
  | _, _, [] => rfl
  | side, sourceOrdinal, _ :: rest => by
      unfold canonicalHeaderFooterCommentSourceIdentitiesFromV7
      simp only [List.length_cons]
      rw [canonical_header_footer_comment_source_identities_length_v7
        side (sourceOrdinal + 1) rest]

def canonicalCommentNoteSourceIdentitiesFromV7
    (sourceOrdinal : Nat)
    (footnotesPart endnotesPart : Option LoadedNotePart) :
    List CommentSourceIdentity :=
  let footnotes := match footnotesPart with
    | none => []
    | some part => [{
        sourceOrdinal
        sourceStory := "footnotes"
        sourceStoryOrdinal := 0
        normalizedPartPath := part.identity.normalizedPartPath
      }]
  let endnoteOrdinal := sourceOrdinal + footnotes.length
  let endnotes := match endnotesPart with
    | none => []
    | some part => [{
        sourceOrdinal := endnoteOrdinal
        sourceStory := "endnotes"
        sourceStoryOrdinal := 0
        normalizedPartPath := part.identity.normalizedPartPath
      }]
  footnotes ++ endnotes

def canonicalCommentSourceDomainIdentitiesV7
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) :
    List CommentSourceIdentity :=
  let record := request.packageRecord (noteSideOfCommentSide side)
  let main : CommentSourceIdentity := {
    sourceOrdinal := 0
    sourceStory := "main"
    sourceStoryOrdinal := 0
    normalizedPartPath := "word/document.xml"
  }
  let headerFooter :=
    canonicalHeaderFooterCommentSourceIdentitiesFromV7
      side 1 request.relationshipStories
  main :: headerFooter ++
    canonicalCommentNoteSourceIdentitiesFromV7
      (1 + request.relationshipStories.length)
      record.noteEvidence.footnotesPart
      record.noteEvidence.endnotesPart

theorem typed_source_slot_of_header_identity_v7
    (side : Side) (source : NoteSource)
    (story : Tier2.RelationshipStorySelector.PhysicalStory)
    (sourceOrdinal : Nat) (partPath : String)
    (hIdentity : commentSourceIdentityProjection source = {
      sourceOrdinal
      sourceStory := story.kind.toString
      sourceStoryOrdinal := story.physicalStoryOrdinal
      normalizedPartPath := partPath
    }) :
    Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction side source = {
      kind := Tier2.NoteReferenceIntegrity.typedHeaderFooterKindOfProduction
        story.kind
      physicalStoryOrdinal := story.physicalStoryOrdinal
      source :=
        Tier2.NoteReferenceIntegrity.typedStorySourceOfProduction side source
    } := by
  cases hStoryKind : story.kind
  all_goals
    have hStory := congrArg CommentSourceIdentity.sourceStory hIdentity
    have hOrdinal :=
      congrArg CommentSourceIdentity.sourceStoryOrdinal hIdentity
    simp [commentSourceIdentityProjection, hStoryKind] at hStory hOrdinal
    simp [Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction,
      Tier2.NoteReferenceIntegrity.typedSourceKindOfProduction,
      Tier2.NoteReferenceIntegrity.typedHeaderFooterKindOfProduction,
      Tier2.RelationshipStorySelector.StoryKind.toString,
      hStory, hOrdinal]

theorem typed_source_slot_of_canonical_kind_v7
    (side : Side) (source : NoteSource)
    (kind : TypedSourceKind) (story : String)
    (hKind :
      (kind = .main ∧ story = "main") ∨
      (kind = .footnotes ∧ story = "footnotes") ∨
      (kind = .endnotes ∧ story = "endnotes"))
    (hStory : source.sourceStory = story)
    (hOrdinal : source.sourceStoryOrdinal = 0) :
    Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction side source = {
      kind
      physicalStoryOrdinal := 0
      source :=
        Tier2.NoteReferenceIntegrity.typedStorySourceOfProduction side source
    } := by
  rcases hKind with hKind | hKind | hKind <;>
    rcases hKind with ⟨rfl, rfl⟩ <;>
    simp [Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction,
      Tier2.NoteReferenceIntegrity.typedSourceKindOfProduction,
      hStory, hOrdinal]

theorem typed_note_source_slots_of_identity_map_v7
    (side : Side) (sourceOrdinal : Nat)
    (sources : List NoteSource)
    (footnotesPart endnotesPart : Option LoadedNotePart)
    (hSources :
      sources.map commentSourceIdentityProjection =
        canonicalCommentNoteSourceIdentitiesFromV7 sourceOrdinal
          footnotesPart endnotesPart) :
    Tier2.NoteReferenceIntegrity.typedNoteSourceSlotsOfProduction
        side sources footnotesPart.isSome endnotesPart.isSome =
      sources.map
        (Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction side) := by
  cases footnotesPart with
  | none =>
      cases endnotesPart with
      | none =>
          simp [canonicalCommentNoteSourceIdentitiesFromV7] at hSources
          subst sources
          rfl
      | some endnotes =>
          cases sources with
          | nil =>
              simp [canonicalCommentNoteSourceIdentitiesFromV7] at hSources
          | cons source rest =>
              cases rest with
              | nil =>
                  simp [canonicalCommentNoteSourceIdentitiesFromV7,
                    commentSourceIdentityProjection] at hSources
                  simp [Tier2.NoteReferenceIntegrity.typedNoteSourceSlotsOfProduction,
                    Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction,
                    Tier2.NoteReferenceIntegrity.typedSourceKindOfProduction,
                    hSources]
              | cons next tail =>
                  simp [canonicalCommentNoteSourceIdentitiesFromV7] at hSources
  | some footnotes =>
      cases endnotesPart with
      | none =>
          cases sources with
          | nil =>
              simp [canonicalCommentNoteSourceIdentitiesFromV7] at hSources
          | cons source rest =>
              cases rest with
              | nil =>
                  simp [canonicalCommentNoteSourceIdentitiesFromV7,
                    commentSourceIdentityProjection] at hSources
                  simp [Tier2.NoteReferenceIntegrity.typedNoteSourceSlotsOfProduction,
                    Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction,
                    Tier2.NoteReferenceIntegrity.typedSourceKindOfProduction,
                    hSources]
              | cons next tail =>
                  simp [canonicalCommentNoteSourceIdentitiesFromV7] at hSources
      | some endnotes =>
          cases sources with
          | nil =>
              simp [canonicalCommentNoteSourceIdentitiesFromV7] at hSources
          | cons footSource rest =>
              cases rest with
              | nil =>
                  simp [canonicalCommentNoteSourceIdentitiesFromV7] at hSources
              | cons endSource tail =>
                  cases tail with
                  | nil =>
                      simp [canonicalCommentNoteSourceIdentitiesFromV7,
                        commentSourceIdentityProjection] at hSources
                      simp [
                        Tier2.NoteReferenceIntegrity.typedNoteSourceSlotsOfProduction,
                        Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction,
                        Tier2.NoteReferenceIntegrity.typedSourceKindOfProduction,
                        hSources]
                  | cons extra extras =>
                      simp [canonicalCommentNoteSourceIdentitiesFromV7] at hSources

theorem typed_comment_source_domain_tail_slots_v7 :
    ∀ (side : Side)
      (verifierSide : Tier2.CommentReferenceIntegrity.VerifierSide)
      (sourceOrdinal : Nat) (sources : List NoteSource)
      (stories : List Tier2.RelationshipStorySelector.PhysicalStory)
      (footnotesPart endnotesPart : Option LoadedNotePart),
      sources.map commentSourceIdentityProjection =
          canonicalHeaderFooterCommentSourceIdentitiesFromV7
            verifierSide sourceOrdinal stories ++
          canonicalCommentNoteSourceIdentitiesFromV7
            (sourceOrdinal + stories.length) footnotesPart endnotesPart →
      let headerFooter :=
        Tier2.NoteReferenceIntegrity.typedHeaderFooterSourceSlotsOfProduction
          side sources stories
      headerFooter.1 ++
          Tier2.NoteReferenceIntegrity.typedNoteSourceSlotsOfProduction
            side headerFooter.2 footnotesPart.isSome endnotesPart.isSome =
        sources.map
          (Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction side)
  | side, verifierSide, sourceOrdinal, sources, [], footnotesPart,
      endnotesPart, hSources => by
      unfold canonicalHeaderFooterCommentSourceIdentitiesFromV7 at hSources
      simp only [List.length_nil, Nat.add_zero, List.nil_append] at hSources
      unfold Tier2.NoteReferenceIntegrity.typedHeaderFooterSourceSlotsOfProduction
      exact typed_note_source_slots_of_identity_map_v7
        side sourceOrdinal sources footnotesPart endnotesPart hSources
  | side, verifierSide, sourceOrdinal, [], _ :: _, footnotesPart,
      endnotesPart, hSources => by
      simp [canonicalHeaderFooterCommentSourceIdentitiesFromV7] at hSources
  | side, verifierSide, sourceOrdinal, source :: sourceRest, story :: rest,
      footnotesPart, endnotesPart, hSources => by
      unfold canonicalHeaderFooterCommentSourceIdentitiesFromV7 at hSources
      simp only [List.map_cons, List.cons_append, List.cons.injEq] at hSources
      have hHead := hSources.1
      have hTail := hSources.2
      have hSourceSlot :=
        typed_source_slot_of_header_identity_v7
          side source story sourceOrdinal
          (physicalStoryPartPathForVerifierSideV7 verifierSide story) hHead
      unfold Tier2.NoteReferenceIntegrity.typedHeaderFooterSourceSlotsOfProduction
      dsimp
      rw [← hSourceSlot]
      simp only [List.cons.injEq, true_and]
      apply typed_comment_source_domain_tail_slots_v7
        side verifierSide (sourceOrdinal + 1)
        sourceRest rest footnotesPart endnotesPart
      simpa only [List.length_cons, Nat.add_assoc, Nat.add_left_comm,
        Nat.add_comm] using hTail

theorem typed_comment_source_domain_slots_v7
    (request : RunRequestCoreRequestV7)
    (verifierSide : Tier2.CommentReferenceIntegrity.VerifierSide)
    (side : Side) (sources : List NoteSource)
    (hSources :
      sources.map commentSourceIdentityProjection =
        canonicalCommentSourceDomainIdentitiesV7 request verifierSide) :
    Tier2.NoteReferenceIntegrity.typedCommentSourceDomainSlotsOfProduction
        side sources request.relationshipStories
        (request.packageRecord
          (noteSideOfCommentSide verifierSide)).noteEvidence.footnotesPart.isSome
        (request.packageRecord
          (noteSideOfCommentSide verifierSide)).noteEvidence.endnotesPart.isSome =
      sources.map
        (Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction side) := by
  unfold canonicalCommentSourceDomainIdentitiesV7 at hSources
  cases sources with
  | nil => simp at hSources
  | cons mainSource sourceTail =>
      simp only [List.map_cons] at hSources
      injection hSources with hMainIdentity hTailIdentity
      have hMainStory :=
        congrArg CommentSourceIdentity.sourceStory hMainIdentity
      have hMainOrdinal :=
        congrArg CommentSourceIdentity.sourceStoryOrdinal hMainIdentity
      unfold
        Tier2.NoteReferenceIntegrity.typedCommentSourceDomainSlotsOfProduction
      dsimp
      have hMainSlot :=
        typed_source_slot_of_canonical_kind_v7
          side mainSource .main "main" (Or.inl ⟨rfl, rfl⟩)
          (by simpa [commentSourceIdentityProjection] using hMainStory)
          (by simpa [commentSourceIdentityProjection] using hMainOrdinal)
      rw [← hMainSlot]
      simp only [List.cons.injEq, true_and]
      apply typed_comment_source_domain_tail_slots_v7
        side verifierSide 1 sourceTail request.relationshipStories
        (request.packageRecord
          (noteSideOfCommentSide verifierSide)).noteEvidence.footnotesPart
        (request.packageRecord
          (noteSideOfCommentSide verifierSide)).noteEvidence.endnotesPart
      exact hTailIdentity

def commentSourceDomainLocatorV7
    (identity : CommentSourceIdentity) : String × Nat :=
  (identity.sourceStory, identity.sourceStoryOrdinal)

def ProductionCommentSourceDomainMetadataV7Of
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Prop :=
  let record := request.packageRecord (noteSideOfCommentSide side)
  let actual := retainedCommentSourceIdentities record
  let expected := canonicalCommentSourceDomainIdentitiesV7 request side
  actual = expected ∧
  expected.length ≤ 387 ∧
  (expected.map commentSourceDomainLocatorV7).Nodup ∧
  record.noteEvidence.footnotesPartPresent =
    record.noteEvidence.footnotesPart.isSome ∧
  record.noteEvidence.endnotesPartPresent =
    record.noteEvidence.endnotesPart.isSome

def productionCommentSourceDomainMetadataCheckAtV7
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide) : Bool :=
  let record := request.packageRecord (noteSideOfCommentSide side)
  let actual := retainedCommentSourceIdentities record
  let expected := canonicalCommentSourceDomainIdentitiesV7 request side
  decide (actual = expected) &&
  decide (expected.length ≤ 387) &&
  decide (expected.map commentSourceDomainLocatorV7).Nodup &&
  decide (record.noteEvidence.footnotesPartPresent =
    record.noteEvidence.footnotesPart.isSome) &&
  decide (record.noteEvidence.endnotesPartPresent =
    record.noteEvidence.endnotesPart.isSome)

theorem production_comment_source_domain_metadata_check_at_v7_sound
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hCheck :
      productionCommentSourceDomainMetadataCheckAtV7 request side = true) :
    ProductionCommentSourceDomainMetadataV7Of request side := by
  unfold productionCommentSourceDomainMetadataCheckAtV7 at hCheck
  unfold ProductionCommentSourceDomainMetadataV7Of
  simp only [Bool.and_eq_true, decide_eq_true_eq] at hCheck
  exact ⟨hCheck.1.1.1.1, hCheck.1.1.1.2, hCheck.1.1.2,
    hCheck.1.2, hCheck.2⟩

theorem typed_request_canonical_source_slots_of_production_v7
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (typedRequest : TypedRequestV7)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hDomain : ProductionCommentSourceDomainMetadataV7Of request.core side) :
    canonicalTypedCommentSourceSlotsV7 typedRequest
        (typedSideOfVerifierSide side) =
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.sources.map
        (Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction
          (typedSideOfVerifierSide side)) := by
  unfold typedRequestOfProductionV7 at hTyped
  simp only [Option.some.injEq] at hTyped
  subst typedRequest
  unfold ProductionCommentSourceDomainMetadataV7Of at hDomain
  have hSources := hDomain.1
  unfold retainedCommentSourceIdentities at hSources
  cases side <;>
    simp only [canonicalTypedCommentSourceSlotsV7, typedPackageAt,
      typedSideOfVerifierSide, noteSideOfCommentSide]
  all_goals
    rw [
      Tier2.NoteReferenceIntegrity.canonical_typed_comment_source_slots_of_package_v7]
    apply typed_comment_source_domain_slots_v7 request.core _ _ _ hSources

theorem typed_request_canonical_sources_of_production_v7
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (typedRequest : TypedRequestV7)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hDomain : ProductionCommentSourceDomainMetadataV7Of request.core side) :
    canonicalTypedCommentSourcesV7 typedRequest
        (typedSideOfVerifierSide side) =
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.sources.map
        (Tier2.NoteReferenceIntegrity.typedStorySourceOfProduction
          (typedSideOfVerifierSide side)) := by
  unfold canonicalTypedCommentSourcesV7
  rw [typed_request_canonical_source_slots_of_production_v7
    request side typedRequest hTyped hDomain]
  simp [List.map_map, Function.comp_apply,
    Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction]

theorem production_comment_source_events_exact_v7_to_realizations
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (typedRequest : TypedRequestV7)
    (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hDomain : ProductionCommentSourceDomainMetadataV7Of request.core side)
    (hExact : ProductionCommentSourceEventsExactV7
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.sources
      realizations) :
    ProductionCommentSourceRealizationsExact
      (canonicalTypedCommentSourceSlotsV7 typedRequest
        (typedSideOfVerifierSide side))
      realizations := by
  rw [typed_request_canonical_source_slots_of_production_v7
    request side typedRequest hTyped hDomain]
  exact production_comment_source_events_exact_from_v7_to_realizations
    (typedSideOfVerifierSide side) 0 _ _ hExact

def productionCommentSourceBindingCheckV7
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (record : RunRequestPackageRecord) : Bool :=
  commentSelectionResultEq
    (Tier2.CommentReferenceIntegrity.selectConventionalMainComment
      (commentPackageViewOfCore request side))
    (selectConventionalMainCommentRecords record.relationships) &&
  productionCommentSourceDomainMetadataCheckAtV7 request side &&
  record.commentEvidence.markerScanRun.any fun run =>
    decide ((Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
      (commentPackageViewOfCore request side) side
      (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
        (packageViewOfRecord record) (noteSideOfCommentSide side)
        (selectedStoriesOfRecord record))).sources =
      run.scans.realizations.map (·.slot)) &&
    productionCommentSourceEventsExactCheckV7
      record.commentEvidence.sources run.scans.realizations

theorem production_comment_source_binding_check_v7_sound
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (record : RunRequestPackageRecord)
    (hCheck : productionCommentSourceBindingCheckV7
      request side record = true) :
    Tier2.CommentReferenceIntegrity.selectConventionalMainComment
        (commentPackageViewOfCore request side) =
      selectConventionalMainCommentRecords record.relationships ∧
    ProductionCommentSourceDomainMetadataV7Of request side ∧
    ∃ run, record.commentEvidence.markerScanRun = some run ∧
      (Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
        (commentPackageViewOfCore request side) side
        (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
          (packageViewOfRecord record) (noteSideOfCommentSide side)
          (selectedStoriesOfRecord record))).sources =
        run.scans.realizations.map (·.slot) ∧
      ProductionCommentSourceEventsExactV7
        record.commentEvidence.sources run.scans.realizations := by
  unfold productionCommentSourceBindingCheckV7 at hCheck
  simp only [Bool.and_eq_true] at hCheck
  refine ⟨comment_selection_result_eq_sound _ _ hCheck.1.1,
    production_comment_source_domain_metadata_check_at_v7_sound
      request side hCheck.1.2, ?_⟩
  cases hRun : record.commentEvidence.markerScanRun with
  | none => simp [hRun] at hCheck
  | some run =>
      have hRunChecks := hCheck.2
      simp [hRun] at hRunChecks
      refine ⟨run, rfl, ?_, ?_⟩
      exact hRunChecks.1
      exact production_comment_source_events_exact_check_v7_sound
        _ _ hRunChecks.2

def productionTypedCommentAdmissionCheckAtV7
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (record : RunRequestPackageRecord) : Bool :=
  let pkg := Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
    (typedSideOfVerifierSide side) request record
  match Tier2.CommentReferenceIntegrity.selectConventionalMainCommentRecords
      record.relationships with
  | .error _ => false
  | .ok none => true
  | .ok (some selected) =>
      record.commentEvidence.part.any fun part =>
        decide (part.identity = selected) &&
        pkg.realizationFailure.isNone &&
        typedAdmittedCommentRealizationCheck pkg
          (Tier2.NoteReferenceIntegrity.typedSelectedCommentOfProduction
            selected)
          (Tier2.NoteReferenceIntegrity.typedCommentRealizationOfProduction
            part) &&
        match Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
            (commentPackageViewOfCore request side) side
            (commentResourceUsageOfCore request) selected with
        | .ok _ => true
        | .error _ => false

theorem production_typed_comment_admission_check_at_v7_sound
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (record : RunRequestPackageRecord)
    (selected : SelectedCommentIdentity)
    (hSelected :
      Tier2.CommentReferenceIntegrity.selectConventionalMainCommentRecords
        record.relationships = .ok (some selected))
    (hCheck :
      productionTypedCommentAdmissionCheckAtV7 request side record = true) :
    ∃ part realization,
      record.commentEvidence.part = some part ∧
      part.identity = selected ∧
      (Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
        (typedSideOfVerifierSide side) request record).realizationFailure =
          none ∧
      typedAdmittedCommentRealizationCheck
        (Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
          (typedSideOfVerifierSide side) request record)
        (Tier2.NoteReferenceIntegrity.typedSelectedCommentOfProduction
          selected)
        (Tier2.NoteReferenceIntegrity.typedCommentRealizationOfProduction
          part) = true ∧
      Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
        (commentPackageViewOfCore request side) side
        (commentResourceUsageOfCore request) selected =
          .ok realization := by
  unfold productionTypedCommentAdmissionCheckAtV7 at hCheck
  rw [hSelected] at hCheck
  cases hPart : record.commentEvidence.part with
  | none => simp [hPart] at hCheck
  | some part =>
      simp only [hPart, Option.any, Bool.and_eq_true,
        decide_eq_true_eq, Option.isNone_iff_eq_none] at hCheck
      cases hRealize :
          Tier2.CommentReferenceIntegrity.realizeSelectedCommentV6
            (commentPackageViewOfCore request side) side
            (commentResourceUsageOfCore request) selected with
      | error failure => simp [hRealize] at hCheck
      | ok realization =>
          refine ⟨part, realization, rfl, hCheck.1.1.1,
            hCheck.1.1.2, ?_, rfl⟩
          simpa only [hCheck.1.1.1, hRealize] using hCheck.1.2

theorem production_typed_definitions_retained_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hAdmissionCheck :
      productionTypedCommentAdmissionCheckAtV7 request.core side
        (request.core.packageRecord
          (noteSideOfCommentSide side)) = true) :
    ∃ retained,
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.retainedScan =
          some retained ∧
      typedDefinitionsV7 typedRequest (typedSideOfVerifierSide side) =
        retained.output.scan.definitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction ++
          retained.output.scan.nonDirectDefinitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction := by
  let record :=
    request.core.packageRecord (noteSideOfCommentSide side)
  change ProductionCommentEvidenceOf record at hComment
  change productionTypedCommentAdmissionCheckAtV7
      request.core side record = true at hAdmissionCheck
  have hSelection := hComment.2.2.1
  rcases hComment.2.2.2.2 with
    ⟨retained, hRetained, _hCount, hInput, hOutput, _hCrossing,
      _hIntegrity, _hInventory, _hComplete, _hLimit, _hIssues⟩
  refine ⟨retained, hRetained, ?_⟩
  cases hSelected :
      selectConventionalMainCommentRecords record.relationships with
  | error failure =>
      simp only [hSelected] at hSelection
  | ok selected? =>
      cases selected? with
      | none =>
          simp only [hSelected] at hSelection
          have hRealize := typed_realization_none_of_production_v7
            request typedRequest side hTyped hSelected
          have hInputEmpty : retained.input = {
              sourceEvents := []
              definitionEvents := []
            } := by
            rw [hInput]
            unfold productionCommentScanInput
            rw [hSelection.2.1]
            rfl
          have hRef := retained_comment_definitions_refine_typed_v7
            retained [] hInputEmpty hOutput
          unfold typedDefinitionsV7
          rw [hRealize]
          exact hRef
      | some selected =>
          simp only [hSelected] at hSelection
          rcases production_typed_comment_admission_check_at_v7_sound
              request.core side record selected hSelected hAdmissionCheck with
            ⟨part, realization, hPart, hIdentity, hFailure,
              hAdmission, hOperationalRealization⟩
          have hRealize := typed_realization_success_of_production_v7
            request typedRequest side selected part hTyped hSelected hPart
              hIdentity hFailure hAdmission
          have hInputPart : retained.input = {
              sourceEvents := []
              definitionEvents := part.parseEvidence.parsed.events
            } := by
            rw [hInput]
            unfold productionCommentScanInput
            rw [hPart]
            rfl
          have hRef := retained_comment_definitions_refine_typed_v7
            retained part.parseEvidence.parsed.events hInputPart hOutput
          unfold typedDefinitionsV7
          rw [hRealize]
          exact hRef

def productionCommentOutcomeCheckAtV7
    (evidence : CommentSideEvidence) : Bool :=
  let inventoryZero :=
    evidence.inventory.referenceOccurrences == 0 &&
    evidence.inventory.rangeStartOccurrences == 0 &&
    evidence.inventory.rangeEndOccurrences == 0 &&
    evidence.inventory.uniqueReferenceIds == 0 &&
    evidence.inventory.definitions == 0 &&
    evidence.inventory.unreferencedDefinitions == 0 &&
    evidence.inventory.nonDirectDefinitions == 0
  let retainedTopology :=
    match evidence.retainedScan, evidence.markerScan with
    | some retained, some marker =>
        checkTypedPackageCommentRangeIntegrity
          (retained.output.scan.definitions.map
              Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction ++
            retained.output.scan.nonDirectDefinitions.map
              Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction)
          (concurrentTypedMarkerEvidenceV7 [] marker)
    | _, _ => false
  if evidence.complete then
    (evidence.markerScanInvocationCount == 1 &&
      !evidence.semanticLimitCrossed &&
      (evidence.productionIntegrityPassed == evidence.issues.isEmpty)) &&
    (if evidence.productionIntegrityPassed then
      evidence.markerScan.any retainedConcurrentTypedMarkerEvidenceCheckV7 &&
      retainedTopology &&
      evidence.inventory.status == "passed"
    else
      evidence.inventory.status == "failed")
  else
    !evidence.productionIntegrityPassed &&
    evidence.inventory.status == "not_evaluated" &&
    inventoryZero &&
    ((evidence.markerScanInvocationCount == 0 &&
        evidence.markerScan.isNone) ||
      (evidence.markerScanInvocationCount == 1 &&
        (evidence.semanticLimitCrossed ||
          evidence.markerScan.any (·.crossing.isSome))))

def productionTypedPriorSourceAdmissionCheckV7
    (request : RunRequestCoreRequestV7)
    (record : RunRequestPackageRecord) : Bool :=
  request.selectionIssues.isEmpty &&
  record.noteEvidence.retainedScan.isSome &&
  !record.noteEvidence.semanticLimitCrossed &&
  record.noteEvidence.complete &&
  (!record.commentEvidence.identity.isNone ||
    record.commentEvidence.markerScan.any (·.occurrences.isEmpty))

def productionCommentOutcomeChecksV7
    (request : RunRequestCoreRequestV7) : Bool :=
  (if request.original.commentEvidence.issues.isEmpty then
    ((productionCommentOutcomeCheckAtV7 request.original.commentEvidence &&
        productionCommentSourceBindingCheckV7
          request .original request.original &&
        productionTypedCommentAdmissionCheckAtV7
          request .original request.original) &&
      productionTypedPriorSourceAdmissionCheckV7 request request.original)
  else productionCommentOutcomeCheckAtV7 request.original.commentEvidence) &&
  (if request.revised.commentEvidence.issues.isEmpty then
    ((productionCommentOutcomeCheckAtV7 request.revised.commentEvidence &&
        productionCommentSourceBindingCheckV7
          request .revised request.revised &&
        productionTypedCommentAdmissionCheckAtV7
          request .revised request.revised) &&
      productionTypedPriorSourceAdmissionCheckV7 request request.revised)
  else productionCommentOutcomeCheckAtV7 request.revised.commentEvidence) &&
  (if request.compared.commentEvidence.issues.isEmpty then
    ((productionCommentOutcomeCheckAtV7 request.compared.commentEvidence &&
        productionCommentSourceBindingCheckV7
          request .compared request.compared &&
        productionTypedCommentAdmissionCheckAtV7
          request .compared request.compared) &&
      productionTypedPriorSourceAdmissionCheckV7 request request.compared)
  else productionCommentOutcomeCheckAtV7 request.compared.commentEvidence)

def productionFailedCommentOutcomeChecksV7
    (request : RunRequestCoreRequestV7) : Bool :=
  productionCommentOutcomeCheckAtV7 request.original.commentEvidence &&
  productionCommentOutcomeCheckAtV7 request.revised.commentEvidence &&
  productionCommentOutcomeCheckAtV7 request.compared.commentEvidence

theorem production_comment_outcome_check_v7_complete_topology
    (evidence : CommentSideEvidence)
    (hCheck : productionCommentOutcomeCheckAtV7 evidence = true)
    (hComplete : evidence.complete = true)
    (hPassed : evidence.productionIntegrityPassed = true) :
    ∃ retained marker,
      evidence.retainedScan = some retained ∧
      evidence.markerScan = some marker ∧
      retainedConcurrentTypedMarkerEvidenceCheckV7 marker = true ∧
      checkTypedPackageCommentRangeIntegrity
        (retained.output.scan.definitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction ++
          retained.output.scan.nonDirectDefinitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction)
        (concurrentTypedMarkerEvidenceV7 [] marker) = true := by
  unfold productionCommentOutcomeCheckAtV7 at hCheck
  simp only [hComplete, if_true, hPassed, Bool.and_eq_true] at hCheck
  cases hRetained : evidence.retainedScan with
  | none =>
      simp [hRetained] at hCheck
  | some retained =>
      cases hMarker : evidence.markerScan with
      | none =>
          simp [hRetained, hMarker] at hCheck
      | some marker =>
          refine ⟨retained, marker, rfl, rfl, ?_, ?_⟩
          · have hConcurrent := hCheck.2.1.1
            simpa [hMarker] using hConcurrent
          · have hTopology := hCheck.2.1.2
            simpa [hRetained, hMarker] using hTopology

theorem production_comment_outcome_check_v7_passed_of_no_issues
    (evidence : CommentSideEvidence)
    (hCheck : productionCommentOutcomeCheckAtV7 evidence = true)
    (hComplete : evidence.complete = true)
    (hIssues : evidence.issues = []) :
    evidence.productionIntegrityPassed = true := by
  cases hPassed : evidence.productionIntegrityPassed with
  | false =>
      unfold productionCommentOutcomeCheckAtV7 at hCheck
      simp [hComplete, hIssues, hPassed] at hCheck
  | true => rfl

theorem production_comment_outcome_checks_v7_at
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hEvidence : ProductionCommentEvidenceOf
      (request.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request = true) :
    productionCommentOutcomeCheckAtV7
        (request.packageRecord
          (noteSideOfCommentSide side)).commentEvidence = true ∧
      Tier2.CommentReferenceIntegrity.selectConventionalMainComment
          (commentPackageViewOfCore request side) =
        selectConventionalMainCommentRecords
          (request.packageRecord
            (noteSideOfCommentSide side)).relationships ∧
      ProductionCommentSourceDomainMetadataV7Of request side ∧
      ∃ run,
        (request.packageRecord
          (noteSideOfCommentSide side)).commentEvidence.markerScanRun =
            some run ∧
        (Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
          (commentPackageViewOfCore request side) side
          (Tier2.NoteReferenceIntegrity.evaluateNoteSideV5
            (packageViewOfRecord (request.packageRecord
              (noteSideOfCommentSide side)))
            (noteSideOfCommentSide side)
            (selectedStoriesOfRecord (request.packageRecord
              (noteSideOfCommentSide side))))).sources =
          run.scans.realizations.map (·.slot) ∧
        ProductionCommentSourceEventsExactV7
          (request.packageRecord
            (noteSideOfCommentSide side)).commentEvidence.sources
          run.scans.realizations := by
  rcases hEvidence.2.2.2.2 with
    ⟨retained, hRetained, hRetainedInvocation, hInput, hOutput,
      hCrossing, hIntegrity, hInventory, hComplete, hLimit, hIssues⟩
  unfold productionCommentOutcomeChecksV7 at hChecks
  cases side with
  | original =>
      simp only [noteSideOfCommentSide,
        RunRequestCoreRequest.packageRecord] at hIssues ⊢
      simp only [hIssues, List.isEmpty, ↓reduceIte,
        Bool.and_eq_true] at hChecks
      refine ⟨hChecks.1.1.1.1.1, ?_⟩
      exact production_comment_source_binding_check_v7_sound
        request .original request.original hChecks.1.1.1.1.2
  | revised =>
      simp only [noteSideOfCommentSide,
        RunRequestCoreRequest.packageRecord] at hIssues ⊢
      simp only [hIssues, List.isEmpty, ↓reduceIte,
        Bool.and_eq_true] at hChecks
      refine ⟨hChecks.1.2.1.1.1, ?_⟩
      exact production_comment_source_binding_check_v7_sound
        request .revised request.revised hChecks.1.2.1.1.2
  | compared =>
      simp only [noteSideOfCommentSide,
        RunRequestCoreRequest.packageRecord] at hIssues ⊢
      simp only [hIssues, List.isEmpty, ↓reduceIte,
        Bool.and_eq_true] at hChecks
      refine ⟨hChecks.2.1.1.1, ?_⟩
      exact production_comment_source_binding_check_v7_sound
        request .compared request.compared hChecks.2.1.1.2

theorem production_comment_admission_checks_v7_at
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hEvidence : ProductionCommentEvidenceOf
      (request.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request = true) :
    productionTypedCommentAdmissionCheckAtV7 request side
      (request.packageRecord (noteSideOfCommentSide side)) = true := by
  rcases hEvidence.2.2.2.2 with
    ⟨retained, hRetained, hRetainedInvocation, hInput, hOutput,
      hCrossing, hIntegrity, hInventory, hComplete, hLimit, hIssues⟩
  unfold productionCommentOutcomeChecksV7 at hChecks
  cases side with
  | original =>
      simp only [noteSideOfCommentSide,
        RunRequestCoreRequest.packageRecord] at hIssues ⊢
      simp only [hIssues, List.isEmpty, ↓reduceIte,
        Bool.and_eq_true] at hChecks
      exact hChecks.1.1.1.2
  | revised =>
      simp only [noteSideOfCommentSide,
        RunRequestCoreRequest.packageRecord] at hIssues ⊢
      simp only [hIssues, List.isEmpty, ↓reduceIte,
        Bool.and_eq_true] at hChecks
      exact hChecks.1.2.1.2
  | compared =>
      simp only [noteSideOfCommentSide,
        RunRequestCoreRequest.packageRecord] at hIssues ⊢
      simp only [hIssues, List.isEmpty, ↓reduceIte,
        Bool.and_eq_true] at hChecks
      exact hChecks.2.1.2

theorem production_typed_prior_source_admission_checks_v7_at
    (request : RunRequestCoreRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hEvidence : ProductionCommentEvidenceOf
      (request.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request = true) :
    productionTypedPriorSourceAdmissionCheckV7 request
      (request.packageRecord (noteSideOfCommentSide side)) = true := by
  rcases hEvidence.2.2.2.2 with
    ⟨retained, hRetained, hRetainedInvocation, hInput, hOutput,
      hCrossing, hIntegrity, hInventory, hComplete, hLimit, hIssues⟩
  unfold productionCommentOutcomeChecksV7 at hChecks
  cases side with
  | original =>
      simp only [noteSideOfCommentSide,
        RunRequestCoreRequest.packageRecord] at hIssues ⊢
      simp only [hIssues, List.isEmpty, ↓reduceIte,
        Bool.and_eq_true] at hChecks
      exact hChecks.1.1.2
  | revised =>
      simp only [noteSideOfCommentSide,
        RunRequestCoreRequest.packageRecord] at hIssues ⊢
      simp only [hIssues, List.isEmpty, ↓reduceIte,
        Bool.and_eq_true] at hChecks
      exact hChecks.1.2.2
  | compared =>
      simp only [noteSideOfCommentSide,
        RunRequestCoreRequest.packageRecord] at hIssues ⊢
      simp only [hIssues, List.isEmpty, ↓reduceIte,
        Bool.and_eq_true] at hChecks
      exact hChecks.2.2

theorem production_typed_prior_source_admitted_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hCheck : productionTypedPriorSourceAdmissionCheckV7 request.core
      (request.core.packageRecord
        (noteSideOfCommentSide side)) = true) :
    typedPriorSourceAdmittedV7
      (typedPackageAt typedRequest
        (typedSideOfVerifierSide side)).priorSourceAdmission = true := by
  unfold typedRequestOfProductionV7 at hTyped
  simp only [Option.some.injEq] at hTyped
  subst typedRequest
  unfold productionTypedPriorSourceAdmissionCheckV7 at hCheck
  simp only [Bool.and_eq_true, Bool.not_eq_true] at hCheck
  rcases hCheck with
    ⟨⟨⟨⟨hSelection, hRetained⟩, hLimit⟩, hComplete⟩,
      _hMarkerCompatible⟩
  have hRetainedNe :
      (request.core.packageRecord
        (noteSideOfCommentSide side)).noteEvidence.retainedScan ≠ none :=
    Option.isSome_iff_ne_none.mp hRetained
  have hLimitFalse :
      (request.core.packageRecord
        (noteSideOfCommentSide side)).noteEvidence.semanticLimitCrossed =
          false := by
    cases hValue :
        (request.core.packageRecord
          (noteSideOfCommentSide side)).noteEvidence.semanticLimitCrossed
    · rfl
    · simp [hValue] at hLimit
  have hAdmission :
      Tier2.NoteReferenceIntegrity.typedPriorSourceAdmissionOfProduction
        request.core
        (request.core.packageRecord
          (noteSideOfCommentSide side)).noteEvidence =
        .admitted := by
    unfold Tier2.NoteReferenceIntegrity.typedPriorSourceAdmissionOfProduction
    simp [hSelection, hRetainedNe, hLimitFalse, hComplete]
  cases side <;>
    simp only [typedPackageAt, typedSideOfVerifierSide,
      noteSideOfCommentSide, RunRequestCoreRequest.packageRecord,
      Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord]
      at hAdmission ⊢ <;>
    rw [hAdmission] <;> rfl

theorem typed_package_at_of_production_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest) :
    typedPackageAt typedRequest (typedSideOfVerifierSide side) =
      Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord
        (typedSideOfVerifierSide side) request.core
        (request.core.packageRecord (noteSideOfCommentSide side)) := by
  unfold typedRequestOfProductionV7 at hTyped
  simp only [Option.some.injEq] at hTyped
  subst typedRequest
  cases side <;> rfl

def productionTypedMarkerSlotIdentityV7 (slot : TypedSourceSlot) :
    TypedPhysicalStoryIdentity := {
  kind := slot.kind
  physicalStoryOrdinal := slot.physicalStoryOrdinal
}

theorem typed_marker_story_at_slot_identity_ext_v7 :
    ∀ (left right : List TypedSourceSlot),
      left.map productionTypedMarkerSlotIdentityV7 =
          right.map productionTypedMarkerSlotIdentityV7 →
      ∀ ordinal,
        typedMarkerStoryAt {
          stories := []
          slots := left
          wmlNamespace := typedLiteral []
          idLocalName := typedLiteral []
          rangeStartLocalName := typedLiteral []
          rangeEndLocalName := typedLiteral []
          referenceLocalName := typedLiteral []
        } ordinal =
        typedMarkerStoryAt {
          stories := []
          slots := right
          wmlNamespace := typedLiteral []
          idLocalName := typedLiteral []
          rangeStartLocalName := typedLiteral []
          rangeEndLocalName := typedLiteral []
          referenceLocalName := typedLiteral []
        } ordinal
  | [], [], _, _ => rfl
  | [], _ :: _, h, _ => by simp at h
  | _ :: _, [], h, _ => by simp at h
  | left :: leftRest, right :: rightRest, h, 0 => by
      have hHead := (List.cons.inj h).1
      simpa [typedMarkerStoryAt, typedListGet?,
        productionTypedMarkerSlotIdentityV7] using hHead
  | left :: leftRest, right :: rightRest, h, ordinal + 1 => by
      have hTail := (List.cons.inj h).2
      exact typed_marker_story_at_slot_identity_ext_v7
        leftRest rightRest hTail ordinal

theorem production_comment_source_events_exact_v7_slot_identities
    (side : Side) (sourceOrdinal : Nat) (sources : List NoteSource)
    (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization)
    (hExact :
      ProductionCommentSourceEventsExactFromV7
        sourceOrdinal sources realizations) :
    (sources.map
      (Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction side)).map
        productionTypedMarkerSlotIdentityV7 =
      (realizations.map concurrentTypedMarkerSlotV7).map
        productionTypedMarkerSlotIdentityV7 := by
  induction hExact with
  | nil => rfl
  | cons sourceOrdinal source realization sources realizations
      _ storyExact storyOrdinalExact _ _ _ hInduction =>
      simp only [List.map_cons, List.cons.injEq]
      refine ⟨?_, hInduction⟩
      unfold productionTypedMarkerSlotIdentityV7
        Tier2.NoteReferenceIntegrity.typedSourceSlotOfProduction
        concurrentTypedMarkerSlotV7
      dsimp
      cases hStory : realization.slot.story <;>
        simp [concurrentTypedMarkerSourceKindV7,
          Tier2.NoteReferenceIntegrity.typedSourceKindOfProduction,
          commentMarkerSourceStoryName, hStory] at storyExact ⊢
      all_goals simp_all

theorem typed_marker_story_at_input_slot_identity_ext_v7
    (left right : TypedMarkerScanInput)
    (hSlots :
      left.slots.map productionTypedMarkerSlotIdentityV7 =
        right.slots.map productionTypedMarkerSlotIdentityV7)
    (ordinal : Nat) :
    typedMarkerStoryAt left ordinal =
      typedMarkerStoryAt right ordinal := by
  simpa [typedMarkerStoryAt] using
    typed_marker_story_at_slot_identity_ext_v7
      left.slots right.slots hSlots ordinal

theorem concurrent_typed_marker_input_observational_v7
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (typedRequest : TypedRequestV7)
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hDomain : ProductionCommentSourceDomainMetadataV7Of request.core side)
    (hExact : ProductionCommentSourceEventsExactV7
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.sources
      scans.realizations) :
    TypedMarkerScanInputObservationalEqV7
      (concurrentTypedMarkerInputV7 scans)
      (typedMarkerScanInputV7 typedRequest
        (typedSideOfVerifierSide side)) := by
  have hCanonical :=
    typed_request_canonical_source_slots_of_production_v7
      request side typedRequest hTyped hDomain
  have hExactSlots :=
    production_comment_source_events_exact_v7_slot_identities
      (typedSideOfVerifierSide side) 0
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.sources
      scans.realizations hExact
  unfold TypedMarkerScanInputObservationalEqV7
  refine ⟨rfl, rfl, rfl, rfl, rfl, ?_⟩
  intro ordinal
  apply typed_marker_story_at_input_slot_identity_ext_v7
  unfold concurrentTypedMarkerInputV7 typedMarkerScanInputV7
  dsimp
  rw [hCanonical]
  exact hExactSlots.symm

theorem concurrent_typed_marker_evidence_scan_v7
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (stories : List TypedStorySource)
    (evidence : ParsedCommentRangeEvidence)
    (hMatch : Tier2.CommentReferenceIntegrity.storySlotListsMatch
      set.sources (scans.realizations.map (·.slot)) = true)
    (hEvents : ConcurrentTypedStoryEventsV7 stories scans.realizations)
    (hRun : retainedCommentMarkerScanForRelationshipV7
      true set scans = .ok evidence) :
    concurrentTypedMarkerEvidenceV7 stories evidence =
      scanTypedCommentMarkersV7
        { concurrentTypedMarkerInputV7 scans with stories } := by
  unfold retainedCommentMarkerScanForRelationshipV7
    scanRetainedCommentMarkersForRelationshipV7 at hRun
  rw [hMatch] at hRun
  simp only [if_true, Except.ok.injEq] at hRun
  subst evidence
  have hState :=
    scan_retained_comment_stories_loop_v7_typed_state
      (concurrentTypedMarkerInputV7 scans) 0 {}
      stories scans.realizations hEvents
  unfold concurrentTypedMarkerEvidenceV7 scanTypedCommentMarkersV7
  dsimp
  rw [hState]
  have hInput :
      TypedMarkerScanInputObservationalEqV7
        (concurrentTypedMarkerInputV7 scans)
        { concurrentTypedMarkerInputV7 scans with stories } := by
    exact ⟨rfl, rfl, rfl, rfl, rfl, fun _ => rfl⟩
  rw [scan_typed_stories_v7_input_observational_ext
    (concurrentTypedMarkerInputV7 scans)
    { concurrentTypedMarkerInputV7 scans with stories } hInput]

theorem canonical_typed_marker_scan_observational_v7
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (typedRequest : TypedRequestV7)
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hDomain : ProductionCommentSourceDomainMetadataV7Of request.core side)
    (hExact : ProductionCommentSourceEventsExactV7
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.sources
      scans.realizations) :
    scanTypedCommentMarkersV7 {
        concurrentTypedMarkerInputV7 scans with
        stories := canonicalTypedCommentSourcesV7 typedRequest
          (typedSideOfVerifierSide side)
      } =
      retainedOrIndependentTypedMarkerScanV7 typedRequest
        (typedSideOfVerifierSide side) := by
  have hInput :=
    concurrent_typed_marker_input_observational_v7
      request side typedRequest scans hTyped hDomain hExact
  have hUpdatedInput :
      TypedMarkerScanInputObservationalEqV7
        { concurrentTypedMarkerInputV7 scans with
          stories := canonicalTypedCommentSourcesV7 typedRequest
            (typedSideOfVerifierSide side) }
        (typedMarkerScanInputV7 typedRequest
          (typedSideOfVerifierSide side)) := by
    exact hInput
  unfold scanTypedCommentMarkersV7
    retainedOrIndependentTypedMarkerScanV7 typedMarkerScanInputV7
  dsimp
  rw [scan_typed_stories_v7_input_observational_ext _ _ hUpdatedInput]
  rfl

theorem retained_concurrent_typed_marker_evidence_rebind_v7
    (stories : List TypedStorySource)
    (evidence : ParsedCommentRangeEvidence)
    (hCheck : retainedConcurrentTypedMarkerEvidenceCheckV7 evidence = true) :
    typedMarkerEvidenceOfProduction stories evidence =
      concurrentTypedMarkerEvidenceV7 stories evidence := by
  unfold retainedConcurrentTypedMarkerEvidenceCheckV7 at hCheck
  have hEvidence :
      retainedTypedMarkerEvidenceOfProduction evidence =
        concurrentTypedMarkerEvidenceV7 [] evidence :=
    of_decide_eq_true hCheck
  exact congrArg (fun marker => { marker with inputStories := stories })
    hEvidence

theorem comment_marker_candidate_none_of_kind_none_v7
    (event : Tier2.XmlTripleChecker.XmlEvent)
    (hNone : commentMarkerKindCandidateV7 event = none) :
    commentMarkerCandidateV7 event = none := by
  cases event with
  | startElement uri localName attributes depth selfClosing =>
      by_cases hUri : uri = Tier2.XmlTripleChecker.wmlNamespace
      · by_cases hStart : localName = "commentRangeStart"
        · simp [commentMarkerKindCandidateV7, hUri, hStart] at hNone
        · by_cases hEnd : localName = "commentRangeEnd"
          · simp [commentMarkerKindCandidateV7, hUri, hStart, hEnd] at hNone
          · by_cases hReference : localName = "commentReference"
            · simp [commentMarkerKindCandidateV7, hUri, hStart, hEnd,
                hReference] at hNone
            · simp [commentMarkerCandidateV7, hUri, hStart, hEnd,
                hReference]
      · simp [commentMarkerCandidateV7, hUri]
  | endElement => rfl
  | text => rfl

theorem typed_marker_candidate_none_of_production_kind_none_v7
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (event : Tier2.XmlTripleChecker.XmlEvent)
    (eventOrdinal : Nat)
    (hNone : commentMarkerKindCandidateV7 event = none) :
    typedMarkerCandidateV7 (concurrentTypedMarkerInputV7 scans)
      (typedXmlEventOfProduction
        eventOrdinal event) = none := by
  cases event with
  | startElement uri localName attributes depth selfClosing =>
      unfold commentMarkerKindCandidateV7 at hNone
      unfold typedMarkerCandidateV7
        typedXmlEventOfProduction
        concurrentTypedMarkerInputV7
      by_cases hUri : uri = Tier2.XmlTripleChecker.wmlNamespace
      · by_cases hStart : localName = "commentRangeStart"
        · simp [hUri, hStart] at hNone
        · by_cases hEnd : localName = "commentRangeEnd"
          · simp [hUri, hStart, hEnd] at hNone
          · by_cases hReference : localName = "commentReference"
            · simp [hUri, hStart, hEnd, hReference] at hNone
            · have hNamespace :
                  (typedXmlNameOfProduction uri).bytes =
                    typedWmlNamespace.bytes := by
                subst uri
                decide
              have hStartBytes :
                  (typedXmlNameOfProduction localName).bytes ≠
                    (typedLiteral
                      [99,111,109,109,101,110,116,82,97,110,103,101,83,
                        116,97,114,116]).bytes := by
                intro h
                apply hStart
                apply (typed_xml_name_of_production_reflects_equality
                  localName "commentRangeStart").mp
                exact h.trans (by decide)
              have hEndBytes :
                  (typedXmlNameOfProduction localName).bytes ≠
                    (typedLiteral
                      [99,111,109,109,101,110,116,82,97,110,103,101,69,
                        110,100]).bytes := by
                intro h
                apply hEnd
                apply (typed_xml_name_of_production_reflects_equality
                  localName "commentRangeEnd").mp
                exact h.trans (by decide)
              have hReferenceBytes :
                  (typedXmlNameOfProduction localName).bytes ≠
                    (typedLiteral
                      [99,111,109,109,101,110,116,82,101,102,101,114,101,
                        110,99,101]).bytes := by
                intro h
                apply hReference
                apply (typed_xml_name_of_production_reflects_equality
                  localName "commentReference").mp
                exact h.trans (by decide)
              simpa [hNamespace,
                hStartBytes, hEndBytes, hReferenceBytes]
      · have hNamespace :
            (typedXmlNameOfProduction uri).bytes ≠
              typedWmlNamespace.bytes := by
          intro hEqual
          apply hUri
          apply (typed_xml_name_of_production_reflects_equality
            uri Tier2.XmlTripleChecker.wmlNamespace).mp
          have hWml :
              typedWmlNamespace =
                typedXmlNameOfProduction
                  Tier2.XmlTripleChecker.wmlNamespace := by
            decide
          simpa only [hWml] using hEqual
        simp [hNamespace]
  | endElement => rfl
  | text => rfl

theorem scan_retained_comment_marker_event_false_eq_true_v7
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (sourceSetOrdinal : Nat) (sourceStory : String)
    (sourceStoryOrdinal eventOrdinal : Nat)
    (state : ParsedCommentRangeEvidence)
    (event : Tier2.XmlTripleChecker.XmlEvent)
    (hTypedNoCross : state.typedState.crossing = none)
    (hNoCross :
      (scanRetainedCommentMarkerEventV7
        (concurrentTypedMarkerInputV7 scans) false
        sourceSetOrdinal sourceStory sourceStoryOrdinal eventOrdinal
        state event).crossing = none) :
    scanRetainedCommentMarkerEventV7
        (concurrentTypedMarkerInputV7 scans) false
        sourceSetOrdinal sourceStory sourceStoryOrdinal eventOrdinal
        state event =
      scanRetainedCommentMarkerEventV7
        (concurrentTypedMarkerInputV7 scans) true
        sourceSetOrdinal sourceStory sourceStoryOrdinal eventOrdinal
        state event ∧
    (scanRetainedCommentMarkerEventV7
      (concurrentTypedMarkerInputV7 scans) false
      sourceSetOrdinal sourceStory sourceStoryOrdinal eventOrdinal
      state event).typedState.crossing = none := by
  unfold scanRetainedCommentMarkerEventV7
    retainedCommentMarkerStoppedV7 at hNoCross ⊢
  by_cases hStateCross : state.crossing.isSome = true
  · simp only [hStateCross, Bool.false_or, if_true] at hNoCross
    have hSome : state.crossing ≠ none := Option.isSome_iff_ne_none.mp hStateCross
    contradiction
  · have hStateCrossFalse : state.crossing.isSome = false :=
      Bool.eq_false_iff.mpr hStateCross
    have hTypedCross : state.typedState.crossing.isSome = false := by
      rw [hTypedNoCross]
      rfl
    simp only [hStateCrossFalse, Bool.false_or, Bool.true_and,
      hTypedCross, if_false] at hNoCross ⊢
    cases hKind : commentMarkerKindCandidateV7 event with
    | none =>
        have hCandidate :=
          comment_marker_candidate_none_of_kind_none_v7 event hKind
        have hTypedCandidate :=
          typed_marker_candidate_none_of_production_kind_none_v7
            scans event eventOrdinal hKind
        simp [hKind, hCandidate, hTypedCandidate, hTypedNoCross]
        unfold scanTypedMarkerEventV7
        rw [hTypedCross, hTypedCandidate]
        exact hTypedNoCross
    | some kind =>
        simp [hKind] at hNoCross

theorem scan_retained_comment_story_events_loop_false_eq_true_v7 :
    ∀ (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
      (sourceSetOrdinal : Nat) (sourceStory : String)
      (sourceStoryOrdinal eventOrdinal : Nat)
      (state : ParsedCommentRangeEvidence)
      (events : List Tier2.XmlTripleChecker.XmlEvent),
    state.crossing = none →
    state.typedState.crossing = none →
    (scanRetainedCommentStoryEventsLoopV7
      (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
      sourceStory sourceStoryOrdinal eventOrdinal state events).crossing =
        none →
    scanRetainedCommentStoryEventsLoopV7
        (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
        sourceStory sourceStoryOrdinal eventOrdinal state events =
      scanRetainedCommentStoryEventsLoopV7
        (concurrentTypedMarkerInputV7 scans) true sourceSetOrdinal
        sourceStory sourceStoryOrdinal eventOrdinal state events ∧
    (scanRetainedCommentStoryEventsLoopV7
      (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
      sourceStory sourceStoryOrdinal eventOrdinal state events).typedState.crossing =
        none
  | _, _, _, _, _, _, [], _, hTyped, _ => ⟨rfl, hTyped⟩
  | scans, sourceSetOrdinal, sourceStory, sourceStoryOrdinal,
      eventOrdinal, state, event :: rest, hState, hTyped, hFinal => by
      unfold scanRetainedCommentStoryEventsLoopV7 at hFinal ⊢
      have hStateSome : state.crossing.isSome = false := by
        rw [hState]
        rfl
      have hTypedSome : state.typedState.crossing.isSome = false := by
        rw [hTyped]
        rfl
      simp only [retainedCommentMarkerStoppedV7, hStateSome,
        hTypedSome, Bool.false_or, Bool.true_and, if_false] at hFinal ⊢
      let before : ParsedCommentRangeEvidence := {
        state with
        processedEventCount := state.processedEventCount + 1
        typedState := { state.typedState with
          processedEventCount :=
            state.typedState.processedEventCount + 1 }
      }
      let after :=
        scanRetainedCommentMarkerEventV7
          (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
          sourceStory sourceStoryOrdinal eventOrdinal before event
      let afterTrue :=
        scanRetainedCommentMarkerEventV7
          (concurrentTypedMarkerInputV7 scans) true sourceSetOrdinal
          sourceStory sourceStoryOrdinal eventOrdinal before event
      change
        (if retainedCommentMarkerStoppedV7 false after then after
          else scanRetainedCommentStoryEventsLoopV7
            (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
            sourceStory sourceStoryOrdinal (eventOrdinal + 1) after rest
        ).crossing = none at hFinal
      have hAfter : after.crossing = none := by
        cases hCross : after.crossing with
        | none => rfl
        | some crossing =>
            have hSome : after.crossing.isSome = true := by
              rw [hCross]
              rfl
            simp [retainedCommentMarkerStoppedV7, hSome] at hFinal
            exact hCross.symm.trans hFinal
      have hBefore : before.crossing = none := hState
      have hBeforeTyped : before.typedState.crossing = none := hTyped
      have hEvent :=
        scan_retained_comment_marker_event_false_eq_true_v7
          scans sourceSetOrdinal sourceStory sourceStoryOrdinal eventOrdinal
            before event hBeforeTyped hAfter
      have hAfterSome : after.crossing.isSome = false := by
        rw [hAfter]
        rfl
      have hAfterTypedSome : after.typedState.crossing.isSome = false := by
        rw [hEvent.2]
        rfl
      have hRestFinal :
          (scanRetainedCommentStoryEventsLoopV7
            (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
            sourceStory sourceStoryOrdinal (eventOrdinal + 1)
            after rest).crossing = none := by
        simpa [retainedCommentMarkerStoppedV7, hAfterSome] using hFinal
      change
        (if retainedCommentMarkerStoppedV7 false after then after
          else scanRetainedCommentStoryEventsLoopV7
            (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
            sourceStory sourceStoryOrdinal (eventOrdinal + 1) after rest) =
        (if retainedCommentMarkerStoppedV7 true afterTrue then afterTrue
          else scanRetainedCommentStoryEventsLoopV7
            (concurrentTypedMarkerInputV7 scans) true sourceSetOrdinal
            sourceStory sourceStoryOrdinal (eventOrdinal + 1) afterTrue rest) ∧
        (if retainedCommentMarkerStoppedV7 false after then after
          else scanRetainedCommentStoryEventsLoopV7
            (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
            sourceStory sourceStoryOrdinal (eventOrdinal + 1)
              after rest).typedState.crossing = none
      rw [show afterTrue = after from hEvent.1.symm]
      simp only [retainedCommentMarkerStoppedV7, hAfterSome,
        Bool.false_or, hAfterTypedSome, Bool.true_and, if_false]
      have hInduction :=
        scan_retained_comment_story_events_loop_false_eq_true_v7
          scans sourceSetOrdinal sourceStory sourceStoryOrdinal
            (eventOrdinal + 1) after rest hAfter hEvent.2 hRestFinal
      exact ⟨hInduction.1, hInduction.2⟩

theorem scan_retained_comment_stories_loop_false_eq_true_v7
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence) :
    ∀ (sourceSetOrdinal : Nat) (state : ParsedCommentRangeEvidence)
      (realizations : List Tier2.NoteReferenceIntegrity.StoryRealization),
    state.crossing = none →
    state.typedState.crossing = none →
    (scanRetainedCommentStoriesLoopV7
      (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
      state realizations).crossing = none →
    scanRetainedCommentStoriesLoopV7
        (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
        state realizations =
      scanRetainedCommentStoriesLoopV7
        (concurrentTypedMarkerInputV7 scans) true sourceSetOrdinal
        state realizations ∧
    (scanRetainedCommentStoriesLoopV7
      (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
      state realizations).typedState.crossing = none
  | _, _, [], _, hTyped, _ => ⟨rfl, hTyped⟩
  | sourceSetOrdinal, state, realization :: rest,
      hState, hTyped, hFinal => by
      unfold scanRetainedCommentStoriesLoopV7 at hFinal ⊢
      have hStateSome : state.crossing.isSome = false := by
        rw [hState]
        rfl
      have hTypedSome : state.typedState.crossing.isSome = false := by
        rw [hTyped]
        rfl
      simp only [retainedCommentMarkerStoppedV7, hStateSome,
        hTypedSome, Bool.false_or, Bool.true_and, if_false] at hFinal ⊢
      let before : ParsedCommentRangeEvidence := {
        state with
        processedStoryCount := state.processedStoryCount + 1
        typedState := { state.typedState with
          processedStoryCount :=
            state.typedState.processedStoryCount + 1 }
      }
      let after :=
        scanRetainedCommentStoryEventsV7
          (concurrentTypedMarkerInputV7 scans) false sourceSetOrdinal
          realization before
      let afterTrue :=
        scanRetainedCommentStoryEventsV7
          (concurrentTypedMarkerInputV7 scans) true sourceSetOrdinal
          realization before
      change
        (if retainedCommentMarkerStoppedV7 false after then after
          else scanRetainedCommentStoriesLoopV7
            (concurrentTypedMarkerInputV7 scans) false
            (sourceSetOrdinal + 1) after rest).crossing = none at hFinal
      have hAfter : after.crossing = none := by
        cases hCross : after.crossing with
        | none => rfl
        | some crossing =>
            have hSome : after.crossing.isSome = true := by
              rw [hCross]
              rfl
            simp [retainedCommentMarkerStoppedV7, hSome] at hFinal
            exact hCross.symm.trans hFinal
      have hBefore : before.crossing = none := hState
      have hBeforeTyped : before.typedState.crossing = none := hTyped
      have hStory :=
        scan_retained_comment_story_events_loop_false_eq_true_v7
          scans sourceSetOrdinal
          (commentMarkerSourceStoryName realization.slot.story)
          realization.slot.ordinal 0 before realization.visitedEvents
          hBefore hBeforeTyped hAfter
      have hAfterSome : after.crossing.isSome = false := by
        rw [hAfter]
        rfl
      have hAfterTyped : after.typedState.crossing = none := by
        unfold after scanRetainedCommentStoryEventsV7
        exact hStory.2
      have hAfterTypedSome : after.typedState.crossing.isSome = false := by
        rw [hAfterTyped]
        rfl
      have hRestFinal :
          (scanRetainedCommentStoriesLoopV7
            (concurrentTypedMarkerInputV7 scans) false
            (sourceSetOrdinal + 1) after rest).crossing = none := by
        simpa [retainedCommentMarkerStoppedV7, hAfterSome] using hFinal
      change
        (if retainedCommentMarkerStoppedV7 false after then after
          else scanRetainedCommentStoriesLoopV7
            (concurrentTypedMarkerInputV7 scans) false
            (sourceSetOrdinal + 1) after rest) =
        (if retainedCommentMarkerStoppedV7 true afterTrue then afterTrue
          else scanRetainedCommentStoriesLoopV7
            (concurrentTypedMarkerInputV7 scans) true
            (sourceSetOrdinal + 1) afterTrue rest) ∧
        (if retainedCommentMarkerStoppedV7 false after then after
          else scanRetainedCommentStoriesLoopV7
            (concurrentTypedMarkerInputV7 scans) false
            (sourceSetOrdinal + 1) after rest).typedState.crossing = none
      rw [show afterTrue = after from hStory.1.symm]
      simp only [retainedCommentMarkerStoppedV7, hAfterSome,
        Bool.false_or, hAfterTypedSome, Bool.true_and, if_false]
      have hInduction :=
        scan_retained_comment_stories_loop_false_eq_true_v7
          scans (sourceSetOrdinal + 1) after rest hAfter hAfterTyped
            hRestFinal
      exact ⟨hInduction.1, hInduction.2⟩

theorem concurrent_typed_marker_evidence_scan_for_relationship_v7
    (relationshipPresent : Bool)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (stories : List TypedStorySource)
    (evidence : ParsedCommentRangeEvidence)
    (hMatch : Tier2.CommentReferenceIntegrity.storySlotListsMatch
      set.sources (scans.realizations.map (·.slot)) = true)
    (hEvents : ConcurrentTypedStoryEventsV7 stories scans.realizations)
    (hRun : retainedCommentMarkerScanForRelationshipV7
      relationshipPresent set scans = .ok evidence)
    (hNoCross : evidence.crossing = none) :
    concurrentTypedMarkerEvidenceV7 stories evidence =
      scanTypedCommentMarkersV7
        { concurrentTypedMarkerInputV7 scans with stories } := by
  cases relationshipPresent with
  | true =>
      exact concurrent_typed_marker_evidence_scan_v7
        set scans stories evidence hMatch hEvents hRun
  | false =>
      unfold retainedCommentMarkerScanForRelationshipV7
        scanRetainedCommentMarkersForRelationshipV7 at hRun
      rw [hMatch] at hRun
      simp only [if_true, Except.ok.injEq] at hRun
      let falseResult :=
        scanRetainedCommentStoriesLoopV7
          (concurrentTypedMarkerInputV7 scans) false 0 {}
            scans.realizations
      change falseResult = evidence at hRun
      have hFalseNoCross : falseResult.crossing = none := by
        rw [hRun]
        exact hNoCross
      have hLoops :=
        scan_retained_comment_stories_loop_false_eq_true_v7
          scans 0 {} scans.realizations rfl rfl hFalseNoCross
      have hRunTrue :
          retainedCommentMarkerScanForRelationshipV7
            true set scans = .ok evidence := by
        unfold retainedCommentMarkerScanForRelationshipV7
          scanRetainedCommentMarkersForRelationshipV7
        rw [hMatch]
        simp only [if_true]
        apply congrArg Except.ok
        exact hLoops.1.symm.trans hRun
      exact concurrent_typed_marker_evidence_scan_v7
        set scans stories evidence hMatch hEvents hRunTrue

theorem production_typed_marker_evidence_independent_v7
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (typedRequest : TypedRequestV7)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (evidence : ParsedCommentRangeEvidence)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hDomain : ProductionCommentSourceDomainMetadataV7Of request.core side)
    (hExact : ProductionCommentSourceEventsExactV7
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.sources
      scans.realizations)
    (hSet :
      Tier2.CommentReferenceIntegrity.storySlotListsMatch
        set.sources (scans.realizations.map (·.slot)) = true)
    (hRun : retainedCommentMarkerScanForRelationshipV7
      true set scans = .ok evidence)
    (hConcurrent :
      retainedConcurrentTypedMarkerEvidenceCheckV7 evidence = true) :
    typedMarkerEvidenceOfProduction
        (canonicalTypedCommentSourcesV7 typedRequest
          (typedSideOfVerifierSide side)) evidence =
      retainedOrIndependentTypedMarkerScanV7 typedRequest
        (typedSideOfVerifierSide side) := by
  rw [retained_concurrent_typed_marker_evidence_rebind_v7
    _ evidence hConcurrent]
  rw [concurrent_typed_marker_evidence_scan_v7 set scans
    (canonicalTypedCommentSourcesV7 typedRequest
      (typedSideOfVerifierSide side)) evidence hSet
    (by
      rw [typed_request_canonical_sources_of_production_v7
        request side typedRequest hTyped hDomain]
      exact production_comment_source_events_exact_v7_to_concurrent
        _ _ _ hExact)
    hRun]
  exact canonical_typed_marker_scan_observational_v7
    request side typedRequest scans hTyped hDomain hExact

theorem production_typed_marker_evidence_independent_for_relationship_v7
    (request : VerifierRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (typedRequest : TypedRequestV7)
    (relationshipPresent : Bool)
    (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
    (scans : Tier2.NoteReferenceIntegrity.SideScanEvidence)
    (evidence : ParsedCommentRangeEvidence)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hDomain : ProductionCommentSourceDomainMetadataV7Of request.core side)
    (hExact : ProductionCommentSourceEventsExactV7
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.sources
      scans.realizations)
    (hSet :
      Tier2.CommentReferenceIntegrity.storySlotListsMatch
        set.sources (scans.realizations.map (·.slot)) = true)
    (hRun : retainedCommentMarkerScanForRelationshipV7
      relationshipPresent set scans = .ok evidence)
    (hNoCross : evidence.crossing = none)
    (hConcurrent :
      retainedConcurrentTypedMarkerEvidenceCheckV7 evidence = true) :
    typedMarkerEvidenceOfProduction
        (canonicalTypedCommentSourcesV7 typedRequest
          (typedSideOfVerifierSide side)) evidence =
      retainedOrIndependentTypedMarkerScanV7 typedRequest
        (typedSideOfVerifierSide side) := by
  rw [retained_concurrent_typed_marker_evidence_rebind_v7
    _ evidence hConcurrent]
  rw [concurrent_typed_marker_evidence_scan_for_relationship_v7
    relationshipPresent set scans
    (canonicalTypedCommentSourcesV7 typedRequest
      (typedSideOfVerifierSide side)) evidence hSet
    (by
      rw [typed_request_canonical_sources_of_production_v7
        request side typedRequest hTyped hDomain]
      exact production_comment_source_events_exact_v7_to_concurrent
        _ _ _ hExact)
    hRun hNoCross]
  exact canonical_typed_marker_scan_observational_v7
    request side typedRequest scans hTyped hDomain hExact

theorem retained_topology_refines_canonical_typed_v7
    (typedRequest : TypedRequestV7) (side : Side)
    (retained : RetainedCommentScan)
    (marker : ParsedCommentRangeEvidence)
    (hDefinitions :
      typedDefinitionsV7 typedRequest side =
        retained.output.scan.definitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction ++
          retained.output.scan.nonDirectDefinitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction)
    (hMarker :
      typedMarkerEvidenceOfProduction
          (canonicalTypedCommentSourcesV7 typedRequest side) marker =
        retainedOrIndependentTypedMarkerScanV7 typedRequest side)
    (hConcurrent :
      retainedConcurrentTypedMarkerEvidenceCheckV7 marker = true)
    (hTopology :
      checkTypedPackageCommentRangeIntegrity
        (retained.output.scan.definitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction ++
          retained.output.scan.nonDirectDefinitions.map
            Tier2.NoteReferenceIntegrity.typedDefinitionOfProduction)
        (concurrentTypedMarkerEvidenceV7 [] marker) = true) :
    checkTypedPackageCommentRangeIntegrity
        (typedDefinitionsV7 typedRequest side)
        (retainedOrIndependentTypedMarkerScanV7 typedRequest side) = true := by
  rw [hDefinitions, ← hMarker,
    retained_concurrent_typed_marker_evidence_rebind_v7
      (canonicalTypedCommentSourcesV7 typedRequest side)
      marker hConcurrent]
  simpa [concurrentTypedMarkerEvidenceV7] using hTopology

theorem story_slot_lists_match_self_v7
    (slots : List Tier2.NoteReferenceIntegrity.StorySlot) :
    Tier2.CommentReferenceIntegrity.storySlotListsMatch slots slots = true := by
  induction slots with
  | nil => rfl
  | cons slot rest ih =>
      unfold Tier2.CommentReferenceIntegrity.storySlotListsMatch at ih ⊢
      simp only [List.length_cons, beq_self_eq_true, Bool.true_and,
        List.zip_cons_cons, List.all_cons, Bool.and_eq_true] at ih ⊢
      exact ⟨by
        rcases slot with ⟨story, ordinal, path⟩
        simp only [Tier2.NoteReferenceIntegrity.storySlotEq,
          beq_self_eq_true, Bool.true_and]
        cases story <;> rfl, ih⟩

theorem production_canonical_typed_marker_scan_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    ∃ marker,
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.markerScan =
          some marker ∧
      typedMarkerEvidenceOfProduction
          (canonicalTypedCommentSourcesV7 typedRequest
            (typedSideOfVerifierSide side)) marker =
        retainedOrIndependentTypedMarkerScanV7
          typedRequest (typedSideOfVerifierSide side) := by
  have hAt :=
    production_comment_outcome_checks_v7_at
      request.core side hComment hChecks
  rcases hAt with
    ⟨hOutcome, hSelector, hDomain, run, hRunStored, hSourceSlots, hExact⟩
  rcases hComment with
    ⟨hSources, hIdentities, hSelection,
      ⟨markerRun, markerEvidence, hMarkerRun, hMarkerResult,
        hMarkerExact, hMarkerNoCross, hMarkerInvocation,
        hMarkerStored⟩,
      ⟨retained, hRetained, hRetainedInvocation, hInput,
        hOutput, hDefinitionCrossing, hIntegrity, hInventory,
        hComplete, hLimit, hIssues⟩⟩
  have hRunEq : run = markerRun := by
    exact Option.some.inj (hRunStored.symm.trans hMarkerRun)
  subst run
  have hProductionPassed :=
    production_comment_outcome_check_v7_passed_of_no_issues
      _ hOutcome hComplete hIssues
  rcases production_comment_outcome_check_v7_complete_topology
      _ hOutcome hComplete hProductionPassed with
    ⟨topologyRetained, topologyMarker, hTopologyRetained,
      hTopologyMarker, hConcurrent, hTopology⟩
  have hTopologyMarkerEq : topologyMarker = markerEvidence := by
    exact Option.some.inj (hTopologyMarker.symm.trans hMarkerStored)
  subst topologyMarker
  have hSet :
      Tier2.CommentReferenceIntegrity.storySlotListsMatch
        markerRun.set.sources
        (markerRun.scans.realizations.map (·.slot)) = true := by
    rw [markerRun.setExact]
    exact story_slot_lists_match_self_v7 _
  have hMarkerRunExact :=
    retained_comment_marker_scan_run_exact
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.identity.isSome
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.side
      markerRun markerEvidence hMarkerResult
  have hMarker :=
    production_typed_marker_evidence_independent_for_relationship_v7
      request side typedRequest
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.identity.isSome
      markerRun.set markerRun.scans markerEvidence hTyped hDomain hExact
      hSet hMarkerRunExact hMarkerNoCross hConcurrent
  exact ⟨markerEvidence, hMarkerStored, hMarker⟩

theorem production_canonical_typed_topology_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    checkTypedPackageCommentRangeIntegrity
      (typedDefinitionsV7 typedRequest (typedSideOfVerifierSide side))
      (retainedOrIndependentTypedMarkerScanV7
        typedRequest (typedSideOfVerifierSide side)) = true := by
  have hAt :=
    production_comment_outcome_checks_v7_at
      request.core side hComment hChecks
  have hAdmission :=
    production_comment_admission_checks_v7_at
      request.core side hComment hChecks
  rcases hAt with
    ⟨hOutcome, hSelector, hDomain, run, hRunStored, hSourceSlots, hExact⟩
  rcases hComment with
    ⟨hSources, hIdentities, hSelection,
      ⟨markerRun, markerEvidence, hMarkerRun, hMarkerResult,
        hMarkerExact, hMarkerNoCross, hMarkerInvocation,
        hMarkerStored⟩,
      ⟨retained, hRetained, hRetainedInvocation, hInput,
        hOutput, hDefinitionCrossing, hIntegrity, hInventory,
        hComplete, hLimit, hIssues⟩⟩
  have hRunEq : run = markerRun := by
    exact Option.some.inj (hRunStored.symm.trans hMarkerRun)
  subst run
  rcases production_typed_definitions_retained_v7
      request typedRequest side hTyped
      ⟨hSources, hIdentities, hSelection,
        ⟨markerRun, markerEvidence, hMarkerRun, hMarkerResult,
          hMarkerExact, hMarkerNoCross, hMarkerInvocation,
          hMarkerStored⟩,
        ⟨retained, hRetained, hRetainedInvocation, hInput,
          hOutput, hDefinitionCrossing, hIntegrity, hInventory,
          hComplete, hLimit, hIssues⟩⟩
      hAdmission with
    ⟨definitionRetained, hDefinitionRetained, hDefinitions⟩
  have hRetainedEq : definitionRetained = retained := by
    exact Option.some.inj (hDefinitionRetained.symm.trans hRetained)
  subst definitionRetained
  have hProductionPassed :=
    production_comment_outcome_check_v7_passed_of_no_issues
      _ hOutcome hComplete hIssues
  rcases production_comment_outcome_check_v7_complete_topology
      _ hOutcome hComplete hProductionPassed with
    ⟨topologyRetained, topologyMarker, hTopologyRetained,
      hTopologyMarker, hConcurrent, hTopology⟩
  have hTopologyRetainedEq : topologyRetained = retained := by
    exact Option.some.inj (hTopologyRetained.symm.trans hRetained)
  subst topologyRetained
  have hTopologyMarkerEq : topologyMarker = markerEvidence := by
    exact Option.some.inj (hTopologyMarker.symm.trans hMarkerStored)
  subst topologyMarker
  have hSet :
      Tier2.CommentReferenceIntegrity.storySlotListsMatch
        markerRun.set.sources
        (markerRun.scans.realizations.map (·.slot)) = true := by
    rw [markerRun.setExact]
    exact story_slot_lists_match_self_v7 _
  have hMarkerRunExact :=
    retained_comment_marker_scan_run_exact
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.identity.isSome
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.side
      markerRun markerEvidence hMarkerResult
  have hMarker :=
    production_typed_marker_evidence_independent_for_relationship_v7
      request side typedRequest
      (request.core.packageRecord
        (noteSideOfCommentSide side)).commentEvidence.identity.isSome
      markerRun.set markerRun.scans markerEvidence hTyped hDomain hExact
      hSet hMarkerRunExact hMarkerNoCross hConcurrent
  exact retained_topology_refines_canonical_typed_v7
    typedRequest (typedSideOfVerifierSide side) retained markerEvidence
      hDefinitions hMarker hConcurrent hTopology

theorem production_typed_selection_and_realization_resolved_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    typedSelectionResolvedV7
        (selectTypedCommentV7
          (typedPackageAt typedRequest
            (typedSideOfVerifierSide side))) = true ∧
      typedRealizationResolvedV7
        (realizeTypedCommentV7 typedRequest
          (typedSideOfVerifierSide side)) = true := by
  let record :=
    request.core.packageRecord (noteSideOfCommentSide side)
  have hPackage :=
    typed_package_at_of_production_v7 request typedRequest side hTyped
  have hSelection := hComment.2.2.1
  cases hSelected :
      selectConventionalMainCommentRecords record.relationships with
  | error failure =>
      simp only [record, hSelected] at hSelection
  | ok selected? =>
      cases selected? with
      | none =>
          have hTypedSelection :
              selectTypedCommentV7
                  (typedPackageAt typedRequest
                    (typedSideOfVerifierSide side)) =
                .ok none := by
            rw [hPackage]
            unfold selectTypedCommentV7
            exact Tier2.NoteReferenceIntegrity.typed_selector_none_of_production
              record.relationships hSelected
          have hTypedRealization :=
            typed_realization_none_of_production_v7
              request typedRequest side hTyped hSelected
          simp [hTypedSelection, hTypedRealization,
            typedSelectionResolvedV7, typedRealizationResolvedV7]
      | some selected =>
          have hAdmission :=
            production_comment_admission_checks_v7_at
              request.core side hComment hChecks
          rcases production_typed_comment_admission_check_at_v7_sound
              request.core side record selected hSelected hAdmission with
            ⟨part, realization, hPart, hIdentity, hFailure,
              hAdmitted, hOperationalRealization⟩
          have hTypedSelection :
              selectTypedCommentV7
                  (typedPackageAt typedRequest
                    (typedSideOfVerifierSide side)) =
                .ok (some
                  (Tier2.NoteReferenceIntegrity.typedSelectedCommentOfProduction
                    selected)) := by
            rw [hPackage]
            unfold selectTypedCommentV7
            exact
              Tier2.NoteReferenceIntegrity.typed_selector_success_of_production
                record.relationships selected hSelected
          have hTypedRealization :=
            typed_realization_success_of_production_v7
              request typedRequest side selected part hTyped hSelected hPart
                hIdentity hFailure hAdmitted
          simp [hTypedSelection, hTypedRealization,
            typedSelectionResolvedV7, typedRealizationResolvedV7]

theorem production_typed_marker_prerequisites_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    let typedSide := typedSideOfVerifierSide side
    let selection :=
      selectTypedCommentV7 (typedPackageAt typedRequest typedSide)
    let markerScan :=
      retainedOrIndependentTypedMarkerScanV7 typedRequest typedSide
    (match selection with
      | .ok none => markerScan.occurrences.isEmpty
      | .ok (some _) => true
      | .error _ => false) = true ∧
    markerScan.crossing.isNone = true ∧
    (canonicalTypedCommentSourcesV7 typedRequest typedSide).length ≤ 387 := by
  dsimp only
  let record :=
    request.core.packageRecord (noteSideOfCommentSide side)
  have hAt :=
    production_comment_outcome_checks_v7_at
      request.core side hComment hChecks
  have hDomain := hAt.2.2.1
  have hSourceLength :
      (canonicalTypedCommentSourcesV7 typedRequest
        (typedSideOfVerifierSide side)).length ≤ 387 := by
    have hSources :=
      typed_request_canonical_sources_of_production_v7
        request side typedRequest hTyped hDomain
    unfold ProductionCommentSourceDomainMetadataV7Of at hDomain
    have hExpectedLength := hDomain.2.1
    rw [← hDomain.1] at hExpectedLength
    unfold retainedCommentSourceIdentities at hExpectedLength
    rw [hSources]
    simpa only [List.length_map] using hExpectedLength
  rcases hComment.2.2.2.1 with
    ⟨markerRun, markerEvidence, hMarkerRun, hMarkerResult,
      hMarkerExact, hMarkerNoCross, hMarkerInvocation,
      hMarkerStored⟩
  rcases production_canonical_typed_marker_scan_v7
      request typedRequest side hTyped hComment hChecks with
    ⟨canonicalMarker, hCanonicalStored, hCanonicalMarker⟩
  have hCanonicalEq : canonicalMarker = markerEvidence := by
    exact Option.some.inj (hCanonicalStored.symm.trans hMarkerStored)
  subst canonicalMarker
  have hTypedNoCross :
      (retainedOrIndependentTypedMarkerScanV7 typedRequest
        (typedSideOfVerifierSide side)).crossing.isNone = true := by
    rw [← hCanonicalMarker]
    unfold typedMarkerEvidenceOfProduction
      retainedTypedMarkerEvidenceOfProduction
    simp [hMarkerNoCross]
  have hFlag :=
    production_typed_prior_source_admission_checks_v7_at
      request.core side hComment hChecks
  unfold productionTypedPriorSourceAdmissionCheckV7 at hFlag
  simp only [Bool.and_eq_true] at hFlag
  have hMarkerCompatible := hFlag.2
  have hPackage :=
    typed_package_at_of_production_v7 request typedRequest side hTyped
  have hSelection := hComment.2.2.1
  cases hSelected :
      selectConventionalMainCommentRecords record.relationships with
  | error failure =>
      simp only [record, hSelected] at hSelection
  | ok selected? =>
      cases selected? with
      | none =>
          simp only [record, hSelected] at hSelection
          have hTypedSelection :
              selectTypedCommentV7
                  (typedPackageAt typedRequest
                    (typedSideOfVerifierSide side)) =
                .ok none := by
            rw [hPackage]
            unfold selectTypedCommentV7
            exact Tier2.NoteReferenceIntegrity.typed_selector_none_of_production
              record.relationships hSelected
          have hOccurrences : markerEvidence.occurrences.isEmpty = true := by
            simpa [record, hSelection.1, hMarkerStored] using hMarkerCompatible
          have hTypedOccurrences :
              (retainedOrIndependentTypedMarkerScanV7 typedRequest
                (typedSideOfVerifierSide side)).occurrences.isEmpty = true := by
            rw [← hCanonicalMarker]
            unfold typedMarkerEvidenceOfProduction
              retainedTypedMarkerEvidenceOfProduction
            simp [hMarkerNoCross, hOccurrences]
          exact ⟨by simpa [hTypedSelection] using hTypedOccurrences,
            hTypedNoCross, hSourceLength⟩
      | some selected =>
          have hTypedSelection :
              selectTypedCommentV7
                  (typedPackageAt typedRequest
                    (typedSideOfVerifierSide side)) =
                .ok (some
                  (Tier2.NoteReferenceIntegrity.typedSelectedCommentOfProduction
                    selected)) := by
            rw [hPackage]
            unfold selectTypedCommentV7
            exact
              Tier2.NoteReferenceIntegrity.typed_selector_success_of_production
                record.relationships selected hSelected
          exact ⟨by simp [hTypedSelection], hTypedNoCross, hSourceLength⟩

theorem production_typed_comment_prerequisites_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    typedCommentPrerequisitesV7 typedRequest
      (typedSideOfVerifierSide side) = true := by
  have hPrior :=
    production_typed_prior_source_admitted_v7
      request typedRequest side hTyped
        (production_typed_prior_source_admission_checks_v7_at
          request.core side hComment hChecks)
  have hResolved :=
    production_typed_selection_and_realization_resolved_v7
      request typedRequest side hTyped hComment hChecks
  have hMarker :=
    production_typed_marker_prerequisites_v7
      request typedRequest side hTyped hComment hChecks
  dsimp only at hMarker
  unfold typedCommentPrerequisitesV7
  dsimp only
  simp only [Bool.and_eq_true]
  exact ⟨⟨⟨⟨⟨hPrior, hResolved.1⟩, hResolved.2⟩, hMarker.1⟩,
    hMarker.2.1⟩,
    typed_nat_le_check_true_of_le _ _ hMarker.2.2⟩

theorem production_typed_all_comment_range_sides_pass_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (commentEvidence :
      ProductionCommentEvidenceOf request.core.original ∧
      ProductionCommentEvidenceOf request.core.revised ∧
      ProductionCommentEvidenceOf request.core.compared)
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    typedAllCommentRangeSidesPassV7 typedRequest = true := by
  apply typed_all_comment_range_sides_pass_v7_of_checks
  · intro side
    cases side with
    | original =>
        exact production_typed_comment_prerequisites_v7
          request typedRequest .original hTyped commentEvidence.1 hChecks
    | revised =>
        exact production_typed_comment_prerequisites_v7
          request typedRequest .revised hTyped commentEvidence.2.1 hChecks
    | compared =>
        exact production_typed_comment_prerequisites_v7
          request typedRequest .compared hTyped commentEvidence.2.2 hChecks
  · intro side
    cases side with
    | original =>
        exact production_canonical_typed_topology_v7
          request typedRequest .original hTyped commentEvidence.1 hChecks
    | revised =>
        exact production_canonical_typed_topology_v7
          request typedRequest .revised hTyped commentEvidence.2.1 hChecks
    | compared =>
        exact production_canonical_typed_topology_v7
          request typedRequest .compared hTyped commentEvidence.2.2 hChecks

theorem production_actual_comment_source_set_refinement_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    actualExecutableCommentSourceSetV7RefinementOf
      request typedRequest side := by
  have hAt :=
    production_comment_outcome_checks_v7_at
      request.core side hComment hChecks
  rcases hAt with
    ⟨hOutcome, hSelector, hDomain, run, hRunStored, hSourceSlots, hExact⟩
  rcases hComment.2.2.2.1 with
    ⟨markerRun, markerEvidence, hMarkerRun, hMarkerResult,
      hMarkerExact, hMarkerNoCross, hMarkerInvocation,
      hMarkerStored⟩
  have hRunEq : run = markerRun := by
    exact Option.some.inj (hRunStored.symm.trans hMarkerRun)
  subst run
  let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
    (request.packageView side) side (request.noteEvaluation side)
  let scans := markerRun.scans
  refine ⟨set, scans, rfl, ?_, hTyped, ?_⟩
  · unfold VerifierRequestV7.retainedSourceScans
    simp [hMarkerRun, scans]
  · have hPackage :=
      typed_package_at_of_production_v7 request typedRequest side hTyped
    unfold ExecutableCommentSourceSetV7ValueOf
    dsimp only
    refine ⟨?_, ?_, ?_, ?_⟩
    · rw [hPackage]
      rfl
    · rw [hPackage]
      rfl
    · unfold set scans
      simpa [VerifierRequestV7.packageView,
        VerifierRequestV7.noteEvaluation] using hSourceSlots
    · exact production_comment_source_events_exact_v7_to_realizations
        request side typedRequest markerRun.scans.realizations
          hTyped hDomain hExact

theorem production_actual_comment_marker_scan_refinement_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    actualExecutableCommentMarkerScanV7RefinementOf
      request typedRequest side := by
  have hAt :=
    production_comment_outcome_checks_v7_at
      request.core side hComment hChecks
  rcases hAt with
    ⟨hOutcome, hSelector, hDomain, run, hRunStored, hSourceSlots, hExact⟩
  rcases hComment.2.2.2.1 with
    ⟨markerRun, markerEvidence, hMarkerRun, hMarkerResult,
      hMarkerExact, hMarkerNoCross, hMarkerInvocation,
      hMarkerStored⟩
  have hRunEq : run = markerRun := by
    exact Option.some.inj (hRunStored.symm.trans hMarkerRun)
  subst run
  rcases production_canonical_typed_marker_scan_v7
      request typedRequest side hTyped hComment hChecks with
    ⟨typedMarker, hTypedMarkerStored, hTypedMarker⟩
  have hMarkerEq : typedMarker = markerEvidence := by
    exact Option.some.inj (hTypedMarkerStored.symm.trans hMarkerStored)
  subst typedMarker
  let set := Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
    (request.packageView side) side (request.noteEvaluation side)
  let scans := markerRun.scans
  refine ⟨set, scans, markerEvidence, rfl, ?_, ?_, ?_, hTyped, ?_⟩
  · unfold VerifierRequestV7.retainedSourceScans
    simp [hMarkerRun, scans]
  · apply retained_comment_marker_scan_run_for_matching_set
      _ _ markerRun set markerEvidence
    · simpa [set, VerifierRequestV7.packageView,
        VerifierRequestV7.noteEvaluation] using hSourceSlots
    · exact hMarkerResult
  · constructor
    · unfold VerifierRequestV7.retainedCommentRangeScanResult
      simp [hMarkerRun, hMarkerResult]
    · exact hMarkerInvocation
  · unfold ExecutableCommentMarkerScanV7ValueOf
    dsimp only
    refine ⟨?_, hMarkerInvocation, hTypedMarker⟩
    simpa [set, scans, VerifierRequestV7.packageView,
      VerifierRequestV7.noteEvaluation] using hSourceSlots

theorem production_actual_comment_definition_refinement_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hPackage : ProductionPackageRecordOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    actualExecutableCommentDefinitionV7RefinementOf
      request typedRequest side := by
  let record :=
    request.core.packageRecord (noteSideOfCommentSide side)
  have hAt :=
    production_comment_outcome_checks_v7_at
      request.core side hComment hChecks
  have hSelector :
      selectConventionalMainCommentV7 (request.packageView side) =
        selectConventionalMainCommentRecords record.relationships := by
    simpa [selectConventionalMainCommentV7,
      VerifierRequestV7.packageView, record] using hAt.2.1
  unfold actualExecutableCommentDefinitionV7RefinementOf
  rw [hSelector]
  have hSelection := hComment.2.2.1
  cases hSelected :
      selectConventionalMainCommentRecords record.relationships with
  | error failure =>
      simp only [record, hSelected] at hSelection
  | ok selected? =>
      cases selected? with
      | none => trivial
      | some selected =>
          have hAdmission :=
            production_comment_admission_checks_v7_at
              request.core side hComment hChecks
          rcases production_typed_comment_admission_check_at_v7_sound
              request.core side record selected hSelected hAdmission with
            ⟨part, realization, hPart, hIdentity, hFailure,
              hTypedAdmission, hRun⟩
          have hRetained :=
            Tier2.CommentReferenceIntegrity.realize_selected_comment_v6_success
              (request.packageView side) side
              (commentResourceUsageOfCore request.core)
              selected realization hRun
          have hRealization :
              realization = semanticCommentRealizationOfProduction part := by
            have hStored :
                (request.packageView side).retainedCommentRealization =
                  some (semanticCommentRealizationOfProduction part) := by
              simp [VerifierRequestV7.packageView, commentPackageViewOfCore,
                record, hPart]
            exact Option.some.inj (hRetained.1.symm.trans hStored)
          subst realization
          have hParse : ProductionParseEvidenceOf record part.parseEvidence := by
            apply hPackage.2.2.2.1
            simp [productionParseEvidencesOfRecord, record, hPart]
          rcases hParse with
            ⟨_, _, hExtraction, _, _, _, _, _, hParseCount, _⟩
          rcases hExtraction with
            ⟨_, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
              hExtractionCount, _⟩
          have hCounts :
              request.retainedCommentRealization side =
                  some (semanticCommentRealizationOfProduction part) ∧
                request.commentExtractionInvocationCount side = 1 ∧
                request.commentParseInvocationCount side = 1 := by
            refine ⟨?_, ?_, ?_⟩
            · simpa [record, hPart] using hRetained.1
            · simp [VerifierRequestV7.commentExtractionInvocationCount,
                record, hPart, hExtractionCount]
            · simp [VerifierRequestV7.commentParseInvocationCount,
                record, hPart, hParseCount]
          refine ⟨semanticCommentRealizationOfProduction part,
            hSelector.trans hSelected, hRun, hCounts, hTyped, ?_⟩
          unfold ExecutableCommentDefinitionRealizationV7ValueOf
          dsimp only
          have hTypedPackage :=
            typed_package_at_of_production_v7
              request typedRequest side hTyped
          rcases hComment.2.2.2.2 with
            ⟨retained, hRetainedScan, hScanCount, hInput, hOutput,
              hCrossing, hIntegrity, hInventory, hComplete, hLimit,
              hIssues⟩
          have hInputPart : retained.input = {
              sourceEvents := []
              definitionEvents := part.parseEvidence.parsed.events
            } := by
            rw [hInput]
            unfold productionCommentScanInput
            rw [hPart]
            rfl
          have hDefinitionEvents :=
            retained_comment_definitions_refine_typed_v7
              retained part.parseEvidence.parsed.events hInputPart hOutput
          rcases production_typed_definitions_retained_v7
              request typedRequest side hTyped hComment hAdmission with
            ⟨definitionRetained, hDefinitionRetained, hTypedDefinitions⟩
          have hRetainedEq : definitionRetained = retained := by
            exact Option.some.inj
              (hDefinitionRetained.symm.trans hRetainedScan)
          subst definitionRetained
          refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩
          · rw [hTypedPackage]
            rfl
          · rw [hTypedPackage]
            rfl
          · rw [hTypedPackage]
            simp [Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord,
              record, hPart, hIdentity,
              Tier2.NoteReferenceIntegrity.typedCommentRealizationOfProduction,
              Tier2.NoteReferenceIntegrity.typedSelectedCommentOfProduction,
              typedBoundedBytesOfString]
          · rw [hTypedPackage]
            simp only [Tier2.NoteReferenceIntegrity.typedPackageViewOfRecord,
              record, hPart, Option.map]
            exact production_xml_events_exact_check_from_sound 0 _ _
              (production_xml_events_exact_check_from_production _)
          · exact hTypedDefinitions.trans hDefinitionEvents.symm
          · exact ⟨retained, hRetainedScan, hScanCount, hInput, hOutput,
              hTypedDefinitions⟩

theorem production_actual_comment_incomplete_refinement_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (side : Tier2.CommentReferenceIntegrity.VerifierSide)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (hComment : ProductionCommentEvidenceOf
      (request.core.packageRecord (noteSideOfCommentSide side)))
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    actualExecutableCommentIncompleteV7RefinementOf
      request typedRequest side := by
  have hPrerequisites :=
    production_typed_comment_prerequisites_v7
      request typedRequest side hTyped hComment hChecks
  have hTopology :=
    production_canonical_typed_topology_v7
      request typedRequest side hTyped hComment hChecks
  have hStatus :=
    typed_comment_side_pass_v7_of_checks
      typedRequest (typedSideOfVerifierSide side)
        hPrerequisites hTopology
  rcases hComment.2.2.2.2 with
    ⟨retained, hRetained, hScanCount, hInput, hOutput, hCrossing,
      hIntegrity, hInventory, hComplete, hLimit, hIssues⟩
  let evaluation := evaluateCommentSideV7 request side
  refine ⟨evaluation, rfl, hTyped, ?_⟩
  unfold ExecutableCommentIncompleteV7ValueOf
  dsimp only
  rw [hStatus]
  simp [evaluation, evaluateCommentSideV7, hComplete]

theorem production_actual_comment_refinements_v7
    (request : VerifierRequestV7)
    (typedRequest : TypedRequestV7)
    (hTyped : typedRequestOfProductionV7 request = some typedRequest)
    (packageEvidence :
      ProductionPackageRecordOf request.core.original ∧
      ProductionPackageRecordOf request.core.revised ∧
      ProductionPackageRecordOf request.core.compared)
    (commentEvidence :
      ProductionCommentEvidenceOf request.core.original ∧
      ProductionCommentEvidenceOf request.core.revised ∧
      ProductionCommentEvidenceOf request.core.compared)
    (hChecks : productionCommentOutcomeChecksV7 request.core = true) :
    (∀ side, actualExecutableCommentSourceSetV7RefinementOf
      request typedRequest side) ∧
    (∀ side, actualExecutableCommentMarkerScanV7RefinementOf
      request typedRequest side) ∧
    (∀ side, actualExecutableCommentDefinitionV7RefinementOf
      request typedRequest side) ∧
    (∀ side, actualExecutableCommentIncompleteV7RefinementOf
      request typedRequest side) := by
  constructor
  · intro side
    exact production_actual_comment_source_set_refinement_v7
      request typedRequest side hTyped
        (Tier2.NoteReferenceIntegrity.productionCommentEvidenceAt
          request.core commentEvidence side) hChecks
  constructor
  · intro side
    exact production_actual_comment_marker_scan_refinement_v7
      request typedRequest side hTyped
        (Tier2.NoteReferenceIntegrity.productionCommentEvidenceAt
          request.core commentEvidence side) hChecks
  constructor
  · intro side
    exact production_actual_comment_definition_refinement_v7
      request typedRequest side hTyped
        (Tier2.NoteReferenceIntegrity.productionPackageRecordAt
          request.core packageEvidence side)
        (Tier2.NoteReferenceIntegrity.productionCommentEvidenceAt
          request.core commentEvidence side) hChecks
  · intro side
    exact production_actual_comment_incomplete_refinement_v7
      request typedRequest side hTyped
        (Tier2.NoteReferenceIntegrity.productionCommentEvidenceAt
          request.core commentEvidence side) hChecks

def productionPassingProtocolV7ProjectionCheck
    (request : RunRequestCoreRequestV7)
    (result : RunRequestCoreResultV7) : Bool :=
  if result.responsePassed then
    match typedRequestOfRunRequestCoreV7 request result with
    | none => false
    | some typedRequest =>
        protocolV7JsonProjectionCheck result.response
          (canonicalTypedResponseV7 typedRequest)
  else true

theorem production_passing_protocol_v7_projection_check_sound
    (request : RunRequestCoreRequestV7)
    (result : RunRequestCoreResultV7)
    (hPass : result.responsePassed = true)
    (hCheck :
      productionPassingProtocolV7ProjectionCheck request result = true) :
    ∃ typedRequest,
      typedRequestOfRunRequestCoreV7 request result = some typedRequest ∧
      ProtocolV7JsonProjectionOf result.response
        (canonicalTypedResponseV7 typedRequest) := by
  unfold productionPassingProtocolV7ProjectionCheck at hCheck
  simp only [hPass, ↓reduceIte] at hCheck
  cases hTyped :
      typedRequestOfRunRequestCoreV7 request result with
  | none => simp [hTyped] at hCheck
  | some typedRequest =>
      refine ⟨typedRequest, rfl, ?_⟩
      simp only [hTyped] at hCheck
      exact protocol_v7_json_projection_check_sound _ _ hCheck

def productionTypedCommentChecksV7
    (request : RunRequestCoreRequestV7)
    (result : RunRequestCoreResultV7) : Bool :=
  (if result.responsePassed then
    productionCommentOutcomeChecksV7 request
  else
    productionFailedCommentOutcomeChecksV7 request) &&
  result.typedProjectionCheck &&
  protocolV6JsonProjectionCheck result.response result.responsePassed &&
  productionPassingProtocolV7ProjectionCheck request result &&
  decide (result.stdout.data.toList =
    result.response.compress.toUTF8.data.toList ++ [UInt8.ofNat 10])

def runRequestCoreV7 (request : RunRequestCoreRequestV7) :
    Except String RunRequestCoreResultV7 :=
  match runRequestCore request with
  | .error detail => .error detail
  | .ok result =>
      if productionTypedCommentChecksV7 request result then .ok result
      else .error "protocol-v7 production refinement failed"

def ProductionRunRequestV7RefinesSemanticOf
    (request : RunRequestCoreRequestV7)
    (result : RunRequestCoreResultV7)
    (typedRequest : TypedRequestV7)
    (typedResponse : TypedProtocolV7Response)
    (canonicalBytes : List UInt8) : Prop :=
  ProductionRunRequestRefinesSemanticOf request result ∧
  typedRequestOfRunRequestCoreV7 request result = some typedRequest ∧
  typedResponse = canonicalTypedResponseV7 typedRequest ∧
  canonicalBytes = independentProtocolV7Projection typedResponse ∧
  ProtocolV7JsonProjectionOf result.response typedResponse ∧
  result.response.compress.toUTF8.data.toList = canonicalBytes ∧
  result.stdout.data.toList = canonicalBytes ++ [UInt8.ofNat 10] ∧
  (∀ side, actualExecutableCommentSourceSetV7RefinementOf
    (verifierRequestV7OfRunRequestCore request result) typedRequest side) ∧
  (∀ side, actualExecutableCommentMarkerScanV7RefinementOf
    (verifierRequestV7OfRunRequestCore request result) typedRequest side) ∧
  (∀ side, actualExecutableCommentDefinitionV7RefinementOf
    (verifierRequestV7OfRunRequestCore request result) typedRequest side) ∧
  (∀ side, actualExecutableCommentIncompleteV7RefinementOf
    (verifierRequestV7OfRunRequestCore request result) typedRequest side) ∧
  actualExecutableProtocolV7Utf8JsonRefinementOf
    (verifierRequestV7OfRunRequestCore request result) typedRequest
      result.response

theorem production_run_request_core_v7_refinement_sound
    (request : RunRequestCoreRequestV7)
    (result : RunRequestCoreResultV7)
    (hRun : runRequestCoreV7 request = .ok result)
    (hPass : result.responsePassed = true) :
    ∃ typedRequest : TypedRequestV7,
      typedRequestOfRunRequestCoreV7 request result = some typedRequest ∧
      ProductionRunRequestV7RefinesSemanticOf
        request result typedRequest
          (canonicalTypedResponseV7 typedRequest)
          (independentProtocolV7Projection
            (canonicalTypedResponseV7 typedRequest)) ∧
      TypedCommentRangeAggregatePassOf typedRequest
        (canonicalTypedResponseV7 typedRequest) ∧
      ProtocolV7JsonProjectionOf result.response
        (canonicalTypedResponseV7 typedRequest) ∧
      result.response.compress.toUTF8.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest) ∧
      result.stdout.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest) ++ [10] := by
  unfold runRequestCoreV7 at hRun
  cases hCore : runRequestCore request with
  | error detail => simp [hCore] at hRun
  | ok coreResult =>
      simp only [hCore] at hRun
      split at hRun
      · rename_i hChecks
        cases hRun
        unfold productionTypedCommentChecksV7 at hChecks
        simp only [hPass, ↓reduceIte, Bool.and_eq_true,
          decide_eq_true_eq] at hChecks
        have hBase :=
          Tier2.NoteReferenceIntegrity.production_run_request_core_refinement_sound
            request result hCore hPass
        obtain ⟨typedRequest, hTyped, hProjection⟩ :=
          production_passing_protocol_v7_projection_check_sound
            request result hPass hChecks.1.2
        have hTypedProduction :
            typedRequestOfProductionV7
              (verifierRequestV7OfRunRequestCore request result) =
                some typedRequest := by
          exact hTyped
        have hPackages :
            ProductionPackageRecordOf request.original ∧
            ProductionPackageRecordOf request.revised ∧
            ProductionPackageRecordOf request.compared :=
          ⟨hBase.1, hBase.2.1, hBase.2.2.1⟩
        have hComments :
            ProductionCommentEvidenceOf request.original ∧
            ProductionCommentEvidenceOf request.revised ∧
            ProductionCommentEvidenceOf request.compared :=
          ⟨hBase.2.2.2.1, hBase.2.2.2.2.1,
            hBase.2.2.2.2.2.1⟩
        have hTypedPass :=
          production_typed_all_comment_range_sides_pass_v7
            (verifierRequestV7OfRunRequestCore request result)
              typedRequest hTypedProduction hComments hChecks.1.1.1.1
        have hAggregate :=
          (typed_comment_range_aggregate_pass_sound
            typedRequest hTypedPass).1
        have hActual :=
          production_actual_comment_refinements_v7
            (verifierRequestV7OfRunRequestCore request result)
              typedRequest hTypedProduction hPackages hComments
                hChecks.1.1.1.1
        have hStdoutV7 :
            result.stdout.data.toList =
              independentProtocolV7Projection
                (canonicalTypedResponseV7 typedRequest) ++ [10] := by
          rw [← hProjection]
          exact hChecks.2
        have hProtocolActual :
            actualExecutableProtocolV7Utf8JsonRefinementOf
              (verifierRequestV7OfRunRequestCore request result)
              typedRequest result.response := by
          refine ⟨?_, hProjection, hProjection⟩
          unfold protocolV7ResponseJson canonicalRunRequestEvaluationV7
            verifierRequestV7OfRunRequestCore
          exact run_request_core_response_exact request result hCore
        refine ⟨typedRequest, hTyped, ?_, hAggregate, hProjection,
          hProjection, hStdoutV7⟩
        exact ⟨hBase, hTyped, rfl, rfl, hProjection,
          hProjection, hStdoutV7, hActual.1, hActual.2.1,
          hActual.2.2.1, hActual.2.2.2, hProtocolActual⟩
      · contradiction

def executableCommentSourceSetV7RefinementSignature : Prop :=
  ∀ (request : VerifierRequestV7)
      (side : Tier2.CommentReferenceIntegrity.VerifierSide)
      (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
      (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
      (typedRequest : TypedRequestV7),
    Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
        (request.packageView side) side (request.noteEvaluation side) = set →
    request.retainedSourceScans side = scans →
    typedRequestOfProductionV7 request = some typedRequest →
    executableCommentSourceSetV7RefinementCheck
      request side set scans typedRequest = true →
    ExecutableCommentSourceSetV7RefinesTyped
      request side set scans typedRequest

def executableCommentMarkerScanV7RefinementSignature : Prop :=
  ∀ (request : VerifierRequestV7)
      (side : Tier2.CommentReferenceIntegrity.VerifierSide)
      (set : Tier2.CommentReferenceIntegrity.CommentSourceSet)
      (scans : Tier2.CommentReferenceIntegrity.SideScanEvidence)
      (evidence : ParsedCommentRangeEvidence)
      (typedRequest : TypedRequestV7),
    Tier2.CommentReferenceIntegrity.canonicalCommentSourceSet
        (request.packageView side) side (request.noteEvaluation side) = set →
    request.retainedSourceScans side = scans →
    retainedCommentMarkerScanForRelationshipV7
        ((request.core.packageRecord
          (noteSideOfCommentSide side)).commentEvidence.identity.isSome)
        set scans = .ok evidence →
    (request.retainedCommentRangeScanResult side = .ok evidence ∧
      request.commentRangeScanInvocationCount side = 1) →
    typedRequestOfProductionV7 request = some typedRequest →
    executableCommentMarkerScanV7RefinementCheck
      request side set scans evidence typedRequest = true →
    ExecutableCommentMarkerScanV7RefinesTyped
      request side set scans evidence typedRequest

def executableCommentDefinitionRealizationV7RefinementSignature : Prop :=
  ∀ (request : VerifierRequestV7)
      (side : Tier2.CommentReferenceIntegrity.VerifierSide)
      (selected : Tier2.CommentReferenceIntegrity.SelectedCommentIdentity)
      (realization : Tier2.CommentReferenceIntegrity.CommentStoryRealization)
      (typedRequest : TypedRequestV7),
    selectConventionalMainCommentV7 (request.packageView side) =
      .ok (some selected) →
    realizeSelectedCommentV7 request side selected = .ok realization →
    (request.retainedCommentRealization side = some realization ∧
      request.commentExtractionInvocationCount side = 1 ∧
      request.commentParseInvocationCount side = 1) →
    typedRequestOfProductionV7 request = some typedRequest →
    executableCommentDefinitionRealizationV7RefinementCheck
      request side selected realization typedRequest = true →
    ExecutableCommentDefinitionRealizationV7RefinesTyped
      request side selected realization typedRequest

def executableCommentIncompleteV7RefinementSignature : Prop :=
  ∀ (request : VerifierRequestV7)
      (side : Tier2.CommentReferenceIntegrity.VerifierSide)
      (evaluation : SideCommentEvaluationV7)
      (typedRequest : TypedRequestV7),
    evaluateCommentSideV7 request side = evaluation →
    typedRequestOfProductionV7 request = some typedRequest →
    executableCommentIncompleteV7RefinementCheck
      request side evaluation typedRequest = true →
    ExecutableCommentIncompleteV7RefinesTyped
      request side evaluation typedRequest

def executableProtocolV7Utf8JsonRefinementSignature : Prop :=
  ∀ (request : VerifierRequestV7) (response : Json)
      (typedRequest : TypedRequestV7),
    typedRequestOfProductionV7 request = some typedRequest →
    response = protocolV7ResponseJson
      (canonicalRunRequestEvaluationV7 request) →
    protocolV7JsonProjectionCheck response
      (canonicalTypedResponseV7 typedRequest) = true →
    ProtocolV7JsonProjectionOf response
        (canonicalTypedResponseV7 typedRequest) ∧
      response.compress.toUTF8.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest)

def productionRunRequestCoreV7RefinementSignature : Prop :=
  ∀ (request : RunRequestCoreRequestV7)
      (result : RunRequestCoreResultV7),
    runRequestCoreV7 request = .ok result →
    result.responsePassed = true →
    ∃ typedRequest : TypedRequestV7,
      typedRequestOfRunRequestCoreV7 request result = some typedRequest ∧
      ProductionRunRequestV7RefinesSemanticOf
        request result typedRequest
          (canonicalTypedResponseV7 typedRequest)
          (independentProtocolV7Projection
            (canonicalTypedResponseV7 typedRequest)) ∧
      TypedCommentRangeAggregatePassOf typedRequest
        (canonicalTypedResponseV7 typedRequest) ∧
      ProtocolV7JsonProjectionOf result.response
        (canonicalTypedResponseV7 typedRequest) ∧
      result.response.compress.toUTF8.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest) ∧
      result.stdout.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest) ++ [10]

namespace Tier2.NoteReferenceIntegrity

theorem production_run_request_core_v7_refinement_sound
    (request : RunRequestCoreRequestV7)
    (result : RunRequestCoreResultV7)
    (hRun : runRequestCoreV7 request = .ok result)
    (hPass : result.responsePassed = true) :
    ∃ typedRequest : TypedRequestV7,
      typedRequestOfRunRequestCoreV7 request result = some typedRequest ∧
      ProductionRunRequestV7RefinesSemanticOf
        request result typedRequest
          (canonicalTypedResponseV7 typedRequest)
          (independentProtocolV7Projection
            (canonicalTypedResponseV7 typedRequest)) ∧
      TypedCommentRangeAggregatePassOf typedRequest
        (canonicalTypedResponseV7 typedRequest) ∧
      ProtocolV7JsonProjectionOf result.response
        (canonicalTypedResponseV7 typedRequest) ∧
      result.response.compress.toUTF8.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest) ∧
      result.stdout.data.toList =
        independentProtocolV7Projection
          (canonicalTypedResponseV7 typedRequest) ++ [10] :=
  _root_.production_run_request_core_v7_refinement_sound
    request result hRun hPass

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
  let originalCommentMarkerScans :=
    retainedCommentSourceScansOfEvidence
      originalRelationships originalNoteEvidence
  let revisedCommentMarkerScans :=
    retainedCommentSourceScansOfEvidence
      revisedRelationships revisedNoteEvidence
  let comparedCommentMarkerScans :=
    retainedCommentSourceScansOfEvidence
      comparedRelationships comparedNoteEvidence
  let originalCommentEvidence ←
    buildCommentSideEvidence originalPackage .original originalRelationships
      originalNoteEvidence commentTripleUsage originalCommentMarkerScans
  let revisedCommentEvidence ←
    if !originalCommentEvidence.semanticLimitCrossed then
      buildCommentSideEvidence revisedPackage .revised revisedRelationships
        revisedNoteEvidence originalCommentEvidence.tripleUsage
        revisedCommentMarkerScans
    else
      pure <| skippedCommentSideEvidence .revised revisedNoteEvidence
        originalCommentEvidence.tripleUsage
  let comparedCommentEvidence ←
    if !originalCommentEvidence.semanticLimitCrossed &&
        !revisedCommentEvidence.semanticLimitCrossed then
      buildCommentSideEvidence comparedPackage .compared comparedRelationships
        comparedNoteEvidence revisedCommentEvidence.tripleUsage
        comparedCommentMarkerScans
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
    runRequestCoreV7 coreRequest
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
