import Tier2.NoteReferenceIntegrity

namespace Tier2.NoteReferenceIntegrityWitnesses

open XmlTripleChecker ConventionalMainNoteSelector NoteReferenceIntegrity

example :
    noteStoryEventCountAdmitted 10 0 6 = true ∧
    noteStoryEventCountAdmitted 10 6 6 = false := by
  decide

#guard canonicalDecimalKey? " \t+001\r\n" =
  some { negative := false, digits := [0x31] }
#guard canonicalDecimalKey? "-0" =
  some { negative := false, digits := [0x30] }
#guard canonicalDecimalKey? "-0010" =
  some { negative := true, digits := [0x31, 0x30] }
#guard canonicalDecimalKey? "1 0" = none
#guard canonicalDecimalKey? (String.ofList (List.replicate 65 '7')) = none

def footnoteRecord (ordinal : Nat) (internal : Bool) : TypedNoteRelationshipRecord :=
  { relationshipRecordOrdinal := ordinal
    kind := .footnotes
    relationshipId := "rId"
    normalizedPartPath := "word/footnotes.xml"
    internal }

def internalExternalPackage : PackageView :=
  { relationshipRecords := [footnoteRecord 0 true, footnoteRecord 1 false] }

#guard selectedNoteIdentitySpec internalExternalPackage .footnotes = none

def forgedSelectedIdentity : SelectedNoteIdentity :=
  { relationshipRecordOrdinal := 0
    relationshipId := "rId"
    normalizedPartPath := "word/footnotes.xml" }

example :
    ¬SelectedNoteIdentityOf internalExternalPackage .footnotes
      forgedSelectedIdentity := by
  unfold SelectedNoteIdentityOf
  native_decide

def mainText : String :=
  "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>"

def mainPart : ProofPart :=
  { normalizedPartPath := "word/document.xml"
    regularEntryCount := 1
    loadedBytes := some mainText.toUTF8
    decodedText := some mainText
    parsedRoot := some {
      sourceText := mainText
      namespaceUri := wmlNamespace
      localName := "document"
    }
    events := [
      .startElement wmlNamespace "document" [] 0 true
    ]
    fullyScanned := true }

def emptyPackage : PackageView :=
  { relationshipRecords := [], parts := [mainPart] }

def forgedStory : StorySlot :=
  { story := .header, ordinal := 99, normalizedPartPath := "word/orphan.xml" }

def emptyInventory : PackageNoteInventory :=
  { references := [], definitions := [], forbiddenDefinitionStoryReferences := [] }

def forgedRequest : VerifierRequestV5 :=
  { packageView := fun _ => emptyPackage
    selectedStories := fun _ =>
      { physical := [forgedStory], footnotes := none, endnotes := none }
    incompleteCause := fun _ =>
      some (.intrinsicStoryFailure forgedStory .xmlParse)
    genericStories := []
    genericStoryReports := [] }

#guard (canonicalSelectedStoriesSpec forgedRequest .original).physical = []
#guard admittedIncompleteCause forgedRequest .original = none

def forgedGlobalContext : GlobalAdmissionContext :=
  { packageView := forgedRequest.packageView
    selectedStories := forgedRequest.selectedStories
    sideOrder := [.original, .revised, .compared]
    admissionEvents := canonicalAdmissionEvents forgedRequest
    firstLocalSemanticCrossing := (canonicalAdmissionEvents forgedRequest).head? }

example : ¬GlobalAdmissionContextOf forgedRequest forgedGlobalContext := by
  intro hContext
  have hSelected := hContext.2.2.1 .original
  have hPhysical := congrArg SelectedStories.physical hSelected
  change [forgedStory] = [] at hPhysical
  contradiction

def cleanRequest : VerifierRequestV5 :=
  { packageView := fun _ => emptyPackage
    selectedStories := fun _ =>
      { physical := [], footnotes := none, endnotes := none }
    incompleteCause := fun _ => none
    genericStories := []
    genericStoryReports := [] }

def validAggregateWitness : Bool :=
  match canonicalSemanticResponse cleanRequest with
  | .ok (response, stdout) =>
      response.passed && response.noteStoryCount == 2 &&
        response.inventoryCount == 6 && stdout.size > 0
  | .error _ => false

#guard validAggregateWitness
#guard (parseDecimalId "+001").toOption.map (·.text) = some "1"
#guard (parseDecimalId "-0").toOption.map (·.text) = some "0"
def overlongRejected : Bool :=
  match parseDecimalId (String.ofList (List.replicate 65 '7')) with
  | .error "lexical_limit" => true
  | _ => false

#guard overlongRejected

def missingMainPackage : PackageView := { relationshipRecords := [] }

#guard firstIntrinsicFailureStage missingMainPackage fixedMainSource = some .load

def undecodedMainPart : ProofPart :=
  { mainPart with decodedText := none, parsedRoot := none }

#guard firstIntrinsicFailureStage
  { relationshipRecords := [], parts := [undecodedMainPart] }
  fixedMainSource = some .utf8Decode

def unparsedMainPart : ProofPart :=
  { mainPart with parsedRoot := none }

#guard firstIntrinsicFailureStage
  { relationshipRecords := [], parts := [unparsedMainPart] }
  fixedMainSource = some .xmlParse

def partialMainPart : ProofPart :=
  { mainPart with fullyScanned := false }

#guard firstIntrinsicFailureStage
  { relationshipRecords := [], parts := [partialMainPart] }
  fixedMainSource = some .fullScan

def absentWithReferenceScans : SideScanEvidence :=
  { realizations := []
    parsedReferences := [{
      kind := .footnotes, rawId := some "1",
      sourceOrdinal := 0, occurrenceOrdinal := 0
    }]
    parsedDefinitions := []
    parsedPoison := [] }

#guard !optionalNoteSlotSatisfiedCheck emptyPackage .footnotes
  { physical := [], footnotes := none, endnotes := none }
  absentWithReferenceScans

example :
    ¬OptionalNoteSlotSatisfiedOf emptyPackage .footnotes
      { physical := [], footnotes := none, endnotes := none }
      absentWithReferenceScans := by
  unfold OptionalNoteSlotSatisfiedOf
  simp [selectedNoteForKind, emptyPackage, typedRecordsOfKind,
    hasReferenceOfKind, absentWithReferenceScans, sameNoteKind]

def missingSelectedPartPackage : PackageView :=
  { relationshipRecords := [footnoteRecord 0 true], parts := [mainPart] }

#guard !optionalNoteSlotSatisfiedCheck missingSelectedPartPackage .footnotes
  { physical := [], footnotes := none, endnotes := none }
  { realizations := [], parsedReferences := [], parsedDefinitions := [], parsedPoison := [] }

def stoppedScanState : ProductionScanState :=
  { crossing := some (.references .footnotes 0 maxReferenceOccurrences)
    processedCandidates := 17 }

example (events : List XmlEvent) :
    foldProductionEvents (admitSourceCandidate · 0 ·) events stoppedScanState =
      stoppedScanState :=
  fold_production_events_stops_at_first_crossing _ _ _ (by rfl)

def omittedPhysicalPackage : PackageView :=
  { relationshipRecords := []
    parts := [mainPart]
    physicalStories := [{
      story := "header", ordinal := 0, normalizedPartPath := "word/header1.xml"
    }] }

def omittedPhysicalRequest : VerifierRequestV5 :=
  { cleanRequest with packageView := fun _ => omittedPhysicalPackage }

#guard (evaluateNoteSideV5 omittedPhysicalPackage .original
  (canonicalSelectedStoriesSpec omittedPhysicalRequest .original)).partition.status =
    .incomplete

#guard admittedIncompleteCause forgedRequest .original = none

def forgedLocalRequest : VerifierRequestV5 :=
  { cleanRequest with incompleteCause := (fun _ =>
      some (IncompleteCauseV5.localSemanticLimitCrossing
        .references maxReferenceOccurrences)) }

#guard admittedIncompleteCause forgedLocalRequest .original = none

def forgedSkippedRequest : VerifierRequestV5 :=
  { cleanRequest with incompleteCause := (fun _ =>
      some (IncompleteCauseV5.skippedAfterPriorCrossing .original .references
        maxReferenceOccurrences)) }

#guard admittedIncompleteCause forgedSkippedRequest .revised = none

def duplicateInventory : PackageNoteInventory :=
  { references := []
    definitions := [
      { kind := .footnotes, classification := .user,
        id := { negative := false, digits := [0x31] } },
      { kind := .footnotes, classification := .user,
        id := { negative := false, digits := [0x31] } }
    ]
    forbiddenDefinitionStoryReferences := [] }

#guard !checkPackageNoteIntegrity duplicateInventory

def failedGenericReport : StoryReport :=
  { name := "main"
    report := {
      acceptPreservesFieldStructure := false
      rejectPreservesFieldStructure := true
      acceptTextMatchesRevised := true
      rejectTextMatchesOriginal := true
      combinedHasNoFldCharInsideDel := true
      combinedHasValidMoveRanges := true
    }
    originalTokenCount := 0
    revisedTokenCount := 0
    combinedTokenCount := 0
    originalPresent := true
    revisedPresent := true
    combinedPresent := true }

def failedGenericRequest : VerifierRequestV5 :=
  { cleanRequest with genericStoryReports := [failedGenericReport] }

#guard !(aggregateRequestPass failedGenericRequest)

end Tier2.NoteReferenceIntegrityWitnesses
