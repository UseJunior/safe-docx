import Tier2.RelationshipStorySelector

namespace Tier2.SelectorTheoremAudit

open Tier2.XmlTripleChecker Tier2.RelationshipStorySelector

def binding : DirectBinding :=
  { sectionOrdinal := 0, kind := .header, role := .default, relationshipId := "rId1" }

def candidate : AlignedBindingCandidate :=
  { candidateOrdinal := 0, original := binding, revised := binding, compared := binding }

def headerRecord : RelationshipRecord :=
  {
    id := "rId1"
    relationshipType := headerRelationshipType
    rawTarget := "header1.xml"
    targetMode := none
  }

def partialOutcome : CandidateOutcome :=
  resolveCandidate [headerRecord] [] [headerRecord] candidate

example : partialOutcome.issues.length = 3 := by native_decide

example : partialOutcome.resolvedBindings.length = 2 := by native_decide

def inventory : DocumentInventory :=
  { sectionCount := 1, bindings := [binding], issues := [], eventCount := 0, maxDepthSeen := 0 }

example :
    (resolveCandidatesChecked inventory inventory inventory [headerRecord] [] [headerRecord]).toOption.map
      (fun result => (result.1.length, result.2.length)) = some (1, 0) := by
  native_decide

example :
    ∀ outcomes slots,
      resolveCandidatesChecked inventory inventory inventory [headerRecord] [] [headerRecord] =
          .ok (outcomes, slots) →
      ∀ outcome ∈ outcomes, ∀ side ∈ [.original, .revised, .compared],
        sideBindingCompleteB outcome slots side = true := by
  intro outcomes slots h
  exact direct_binding_selection_complete _ _ _ _ _ _ _ _ h

def identity : RelationshipIdentity :=
  { relationshipId := "rId1", normalizedPartPath := "word/header1.xml" }

def slot (ordinal : Nat) : AlignedSlot :=
  {
    slotOrdinal := ordinal
    sourceCandidateOrdinal := ordinal
    sectionOrdinal := ordinal
    kind := .header
    role := .default
    original := identity
    revised := identity
    compared := identity
  }

example :
    (assignPhysicalStoriesChecked [slot 0, slot 1]).toOption.map
      (fun result => result.2.map (·.selectingSlotOrdinals)) = some [[0, 1]] := by
  native_decide

example :
    ∀ assigned stories,
      assignPhysicalStoriesChecked [slot 0, slot 1] = .ok (assigned, stories) →
      alignedSlotUniqueWorkB assigned stories = true := by
  intro assigned stories h
  exact aligned_slot_unique_work_item _ _ _ h

example :
    ∀ assigned stories,
      assignPhysicalStoriesChecked [slot 0, slot 1] = .ok (assigned, stories) →
      selectorLocatorPartitionB assigned stories = true := by
  intro assigned stories h
  exact dedup_preserves_selector_locators _ _ _ h

def noncanonicalPhysicalStory : PhysicalStory :=
  {
    physicalStoryOrdinal := 0
    kind := .header
    originalPartPath := "word/header1.xml"
    revisedPartPath := "word/header1.xml"
    comparedPartPath := "word/header1.xml"
    selectingSlotOrdinals := [1, 0]
  }

example :
    selectorLocatorPartitionB [slot 0, slot 1] [noncanonicalPhysicalStory] = false := by
  native_decide

def physicalStory : PhysicalStory :=
  {
    physicalStoryOrdinal := 0
    kind := .header
    originalPartPath := "word/header1.xml"
    revisedPartPath := "word/header1.xml"
    comparedPartPath := "word/header1.xml"
    selectingSlotOrdinals := [0]
  }

def selectedTriple : NamedStoryTriple :=
  namedStoryTripleForPhysicalStory physicalStory [.text "original"] [.text "revised"]
    [.text "combined"]

def loadedWork : LoadedPhysicalWork :=
  {
    story := physicalStory
    original := [.text "original"]
    revised := [.text "revised"]
    combined := [.text "combined"]
  }

example :
    selectedStoryIdentityCorrespondsB [physicalStory] [loadedWork] [selectedTriple] = true := by
  native_decide

def wrongTokenTriple : NamedStoryTriple :=
  namedStoryTripleForPhysicalStory physicalStory [.text "wrong"] [.text "revised"]
    [.text "combined"]

example :
    selectedStoryIdentityCorrespondsB [physicalStory] [loadedWork] [wrongTokenTriple] = false := by
  native_decide

def successfulOutcome : CandidateOutcome :=
  resolveCandidate [headerRecord] [headerRecord] [headerRecord] candidate

example :
    aggregateSelectionValidB [successfulOutcome] [slot 0] [physicalStory] [loadedWork]
      [selectedTriple] = true := by
  native_decide

def footerIdentity : RelationshipIdentity :=
  { relationshipId := "rIdF", normalizedPartPath := "word/footer1.xml" }

def footerSlot : AlignedSlot :=
  {
    slotOrdinal := 1
    sourceCandidateOrdinal := 1
    sectionOrdinal := 0
    kind := .footer
    role := .default
    original := footerIdentity
    revised := footerIdentity
    compared := footerIdentity
  }

example :
    (projectLoadedSelection [slot 0, footerSlot] [loadedWork]).toOption.map
      (fun result => (result.1.map (·.kind), result.2.map (·.story.kind))) =
      some ([.header], [.header]) := by
  native_decide

end Tier2.SelectorTheoremAudit
