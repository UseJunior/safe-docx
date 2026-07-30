import Tier2.XmlTripleChecker

namespace Tier2

open XmlTripleChecker

namespace ConventionalMainNoteSelector

def officeRelationshipsNamespace : String :=
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

inductive NoteKind
  | footnotes
  | endnotes
  deriving BEq, DecidableEq, Repr, Inhabited

def NoteKind.relationshipType : NoteKind → String
  | .footnotes => officeRelationshipsNamespace ++ "/footnotes"
  | .endnotes => officeRelationshipsNamespace ++ "/endnotes"

def NoteKind.rootLocalName : NoteKind → String
  | .footnotes => "footnotes"
  | .endnotes => "endnotes"

def NoteKind.referenceLocalName : NoteKind → String
  | .footnotes => "footnoteReference"
  | .endnotes => "endnoteReference"

def NoteKind.definitionLocalName : NoteKind → String
  | .footnotes => "footnote"
  | .endnotes => "endnote"

def NoteKind.toString : NoteKind → String
  | .footnotes => "footnotes"
  | .endnotes => "endnotes"

structure SelectedNoteIdentity where
  relationshipRecordOrdinal : Nat
  relationshipId : String
  normalizedPartPath : String
  deriving BEq, DecidableEq, Repr, Inhabited

structure TypedNoteRelationshipRecord where
  relationshipRecordOrdinal : Nat
  kind : NoteKind
  relationshipId : String
  normalizedPartPath : String
  internal : Bool
  deriving BEq, DecidableEq, Repr, Inhabited

structure ProofXmlRoot where
  sourceText : String
  namespaceUri : String
  localName : String
  deriving BEq, DecidableEq, Repr, Inhabited

structure ProofPart where
  normalizedPartPath : String
  regularEntryCount : Nat
  loadedBytes : Option ByteArray
  decodedText : Option String
  parsedRoot : Option ProofXmlRoot
  events : List XmlEvent
  fullyScanned : Bool
  deriving BEq, Inhabited

structure ProofPhysicalStory where
  story : String
  ordinal : Nat
  normalizedPartPath : String
  deriving Repr, Inhabited

structure PackageView where
  relationshipRecords : List TypedNoteRelationshipRecord
  parts : List ProofPart := []
  physicalStories : List ProofPhysicalStory := []
  deriving Inhabited

def partsAtPath (path : String) : List ProofPart → List ProofPart
  | [] => []
  | part :: parts =>
      if part.normalizedPartPath == path then
        part :: partsAtPath path parts
      else partsAtPath path parts

def expandedAttributeEq (left right : ExpandedXmlAttribute) : Bool :=
  left.uri == right.uri &&
  left.localName == right.localName &&
  left.value == right.value

def expandedAttributeListEq (left right : List ExpandedXmlAttribute) : Bool :=
  left.length == right.length &&
  (left.zip right).all fun pair => expandedAttributeEq pair.1 pair.2

def xmlEventTag : XmlEvent → Nat
  | .startElement .. => 0
  | .endElement .. => 1
  | .text .. => 2

def xmlEventUri : XmlEvent → String
  | .startElement uri .. => uri
  | .endElement uri .. => uri
  | .text .. => ""

def xmlEventLocalName : XmlEvent → String
  | .startElement _ localName .. => localName
  | .endElement _ localName .. => localName
  | .text .. => ""

def xmlEventAttributes : XmlEvent → List ExpandedXmlAttribute
  | .startElement _ _ attributes .. => attributes
  | .endElement .. => []
  | .text .. => []

def xmlEventDepth : XmlEvent → Nat
  | .startElement _ _ _ depth _ => depth
  | .endElement _ _ depth => depth
  | .text _ depth => depth

def xmlEventSelfClosing : XmlEvent → Bool
  | .startElement _ _ _ _ selfClosing => selfClosing
  | .endElement .. => false
  | .text .. => false

def xmlEventText : XmlEvent → String
  | .text value _ => value
  | .startElement .. => ""
  | .endElement .. => ""

def xmlEventEq (left right : XmlEvent) : Bool :=
  xmlEventTag left == xmlEventTag right &&
  xmlEventUri left == xmlEventUri right &&
  xmlEventLocalName left == xmlEventLocalName right &&
  expandedAttributeListEq (xmlEventAttributes left) (xmlEventAttributes right) &&
  xmlEventDepth left == xmlEventDepth right &&
  xmlEventSelfClosing left == xmlEventSelfClosing right &&
  xmlEventText left == xmlEventText right

def xmlEventListEq : List XmlEvent → List XmlEvent → Bool
  | [], right => right.isEmpty
  | left :: leftRest, right =>
      match right with
      | [] => false
      | right :: rightRest =>
        if xmlEventEq left right then xmlEventListEq leftRest rightRest
        else false

def byteArrayByte? (bytes : ByteArray) (offset : Nat) : Option UInt8 :=
  if h : offset < bytes.size then some bytes[offset] else none

def byteArrayEqLoop (left right : ByteArray) : Nat → Nat → Bool
  | _, 0 => true
  | offset, fuel + 1 =>
      if byteArrayByte? left offset == byteArrayByte? right offset then
        byteArrayEqLoop left right (offset + 1) fuel
      else false

def byteArrayEq (left right : ByteArray) : Bool :=
  left.size == right.size && byteArrayEqLoop left right 0 left.size

inductive SelectionFailure
  | ambiguous (firstOrdinal : Nat)
  | external (ordinal : Nat)
  | invalidTargetMode (ordinal : Nat)
  | targetLimit (ordinal : Nat)
  | unsafeTarget (ordinal : Nat)
  | missingPart (ordinal : Nat)
  | wrongRoot (ordinal : Nat)
  deriving BEq, Repr, Inhabited

def sameNoteKind : NoteKind → NoteKind → Bool
  | .footnotes, right =>
    match right with
    | .footnotes => true
    | .endnotes => false
  | .endnotes, right =>
    match right with
    | .footnotes => false
    | .endnotes => true

def typedRecordsOfKind (kind : NoteKind) :
    List TypedNoteRelationshipRecord → List TypedNoteRelationshipRecord
  | [] => []
  | record :: records =>
    if sameNoteKind record.kind kind then
      record :: typedRecordsOfKind kind records
    else typedRecordsOfKind kind records

def selectedPartAdmissible (kind : NoteKind) (part : ProofPart) : Bool :=
  match part.loadedBytes with
  | none => false
  | some _ =>
    match part.decodedText with
    | none => false
    | some _ =>
      match part.parsedRoot with
      | none => false
      | some root =>
        part.regularEntryCount == 1 &&
        root.namespaceUri == wmlNamespace &&
        root.localName == kind.rootLocalName

def selectedIdentityFromRecord (record : TypedNoteRelationshipRecord) :
    SelectedNoteIdentity :=
  { relationshipRecordOrdinal := record.relationshipRecordOrdinal
    relationshipId := record.relationshipId
    normalizedPartPath := record.normalizedPartPath }

def onlyTypedRecord? : List TypedNoteRelationshipRecord →
    Option TypedNoteRelationshipRecord
  | [record] => some record
  | _ => none

def onlyProofPart? : List ProofPart → Option ProofPart
  | [part] => some part
  | _ => none

def selectedNoteIdentitySpec (pkg : PackageView) (kind : NoteKind) :
    Option SelectedNoteIdentity :=
  match typedRecordsOfKind kind pkg.relationshipRecords with
  | [] => none
  | record :: records =>
    if !records.isEmpty then none
    else
      match record.internal with
      | false => none
      | true =>
        match partsAtPath record.normalizedPartPath pkg.parts with
        | [] => none
        | part :: parts =>
          if !parts.isEmpty then none
          else
          if selectedPartAdmissible kind part then
            some (selectedIdentityFromRecord record)
          else none

def selectConventionalMainNote (pkg : PackageView) (kind : NoteKind) :
    Except SelectionFailure (Option SelectedNoteIdentity) :=
  .ok (selectedNoteIdentitySpec pkg kind)

def SelectedNoteIdentityOf (pkg : PackageView) (kind : NoteKind)
    (selected : SelectedNoteIdentity) : Prop :=
  selectedNoteIdentitySpec pkg kind = some selected

theorem except_ok_none_ne_some {ε α : Type} (value : α) :
    (Except.ok none : Except ε (Option α)) = .ok (some value) → False := by
  intro h
  cases h

theorem except_ok_some_injective {ε α : Type} (left right : α)
    (h : (Except.ok (some left) : Except ε (Option α)) = .ok (some right)) :
    left = right := by
  cases h
  rfl

theorem selected_note_identity_sound
    (pkg : PackageView) (kind : NoteKind)
    (selected : SelectedNoteIdentity)
    (hSelect :
      selectConventionalMainNote pkg kind = .ok (some selected)) :
    SelectedNoteIdentityOf pkg kind selected := by
  unfold selectConventionalMainNote at hSelect
  exact congrArg (fun result =>
    match result with
    | Except.ok identity => identity
    | Except.error _ => none) hSelect

end ConventionalMainNoteSelector

namespace NoteReferenceIntegrity

open ConventionalMainNoteSelector
open Lean

def maxRawDecimalBytes : Nat := 64
def maxReferenceOccurrences : Nat := 8192
def maxUniqueReferenceIds : Nat := 4096
def maxDefinitions : Nat := 4096
def maxPoisonReferences : Nat := 4096
def maxSourceEventsPerSide : Nat := 1000000

def remainingNoteEventBudget (limit used : Nat) : Nat :=
  limit - min limit used

def noteStoryEventCountAdmitted (limit used storyEvents : Nat) : Bool :=
  storyEvents.ble (remainingNoteEventBudget limit used)

inductive NoteDefinitionType
  | user
  | separator
  | continuationSeparator
  | continuationNotice
  deriving BEq, DecidableEq, Repr, Inhabited

structure CanonicalDecimal where
  value : Int
  text : String
  deriving BEq, DecidableEq, Repr, Inhabited

def collapseDecimalWhitespace (raw : String) : String :=
  String.ofList (raw.toList.dropWhile isXmlSpace |>.reverse.dropWhile isXmlSpace |>.reverse)

def canonicalIntString (value : Int) : String :=
  if value == 0 then "0" else toString value

def parseDecimalId (raw : String) : Except String CanonicalDecimal := do
  if raw.toUTF8.size > maxRawDecimalBytes then throw "lexical_limit"
  let collapsed := collapseDecimalWhitespace raw
  let lexical := if collapsed.startsWith "+" then collapsed.drop 1 else collapsed
  if lexical.isEmpty then throw "invalid_decimal"
  let some value := lexical.toInt? | throw "invalid_decimal"
  return { value, text := canonicalIntString value }

def expandedWmlAttribute? (attributes : List ExpandedXmlAttribute) (localName : String) :
    Option String :=
  let rec loop : List ExpandedXmlAttribute → Option String
    | [] => none
    | item :: rest =>
        if item.uri == wmlNamespace && item.localName == localName then
          some item.value
        else loop rest
  loop attributes

def classifyDefinitionType (attributes : List ExpandedXmlAttribute) :
    Except String NoteDefinitionType :=
  match expandedWmlAttribute? attributes "type" with
  | none => pure .user
  | some "normal" => pure .user
  | some "separator" => pure .separator
  | some "continuationSeparator" => pure .continuationSeparator
  | some "continuationNotice" => pure .continuationNotice
  | some _ => throw "invalid_type"

structure ReferenceOccurrence where
  kind : NoteKind
  rawId : Option String
  sourceOrdinal : Nat
  occurrenceOrdinal : Nat
  deriving BEq, DecidableEq, Repr, Inhabited

def referenceOccurrenceEq (left right : ReferenceOccurrence) : Bool :=
  left.kind == right.kind &&
  left.rawId == right.rawId &&
  left.sourceOrdinal == right.sourceOrdinal &&
  left.occurrenceOrdinal == right.occurrenceOrdinal

structure DefinitionOccurrence where
  kind : NoteKind
  rawId : Option String
  definitionType : Except String NoteDefinitionType
  occurrenceOrdinal : Nat
  deriving Repr, Inhabited

structure ScannedStory where
  events : List XmlEvent
  references : List ReferenceOccurrence
  definitions : List DefinitionOccurrence
  poisonReferences : List ReferenceOccurrence
  fullyScanned : Bool
  deriving Repr, Inhabited

def referenceCandidate? (event : XmlEvent) :
    Option (NoteKind × Option String) :=
    match event with
    | .startElement uri localName attributes _ _ =>
      if uri != wmlNamespace then none
      else if localName == NoteKind.footnotes.referenceLocalName then
        some (NoteKind.footnotes, expandedWmlAttribute? attributes "id")
      else if localName == NoteKind.endnotes.referenceLocalName then
        some (NoteKind.endnotes, expandedWmlAttribute? attributes "id")
      else none
    | .endElement .. => none
    | .text .. => none

def scanReferenceEvents (sourceOrdinal : Nat) (events : List XmlEvent) :
    List ReferenceOccurrence :=
  let rec loop (ordinal : Nat) : List XmlEvent → List ReferenceOccurrence
    | [] => []
    | event :: rest =>
        match referenceCandidate? event with
        | none => loop ordinal rest
        | some candidate =>
            { kind := candidate.1, rawId := candidate.2, sourceOrdinal,
              occurrenceOrdinal := ordinal } :: loop (ordinal + 1) rest
  loop 0 events

def definitionCandidate? (kind : NoteKind) (event : XmlEvent) :
    Option (Option String × Except String NoteDefinitionType) :=
  match event with
  | .startElement uri localName attributes depth _ =>
    if uri == wmlNamespace && localName == kind.definitionLocalName && depth == 1 then
      some (expandedWmlAttribute? attributes "id", classifyDefinitionType attributes)
    else none
  | .endElement .. => none
  | .text .. => none

def scanDefinitionEvents (kind : NoteKind) (events : List XmlEvent) :
    List DefinitionOccurrence :=
  let rec loop (ordinal : Nat) : List XmlEvent → List DefinitionOccurrence
    | [] => []
    | event :: rest =>
        match definitionCandidate? kind event with
        | none => loop ordinal rest
        | some candidate =>
            { kind, rawId := candidate.1, definitionType := candidate.2,
              occurrenceOrdinal := ordinal } :: loop (ordinal + 1) rest
  loop 0 events

structure ProductionNoteScanInput where
  validSourceEvents : List (Nat × List XmlEvent)
  footnoteDefinitionEvents : List XmlEvent
  endnoteDefinitionEvents : List XmlEvent
  deriving DecidableEq, Repr, Inhabited

structure ProductionNoteScan where
  references : List ReferenceOccurrence
  footnoteDefinitions : List DefinitionOccurrence
  endnoteDefinitions : List DefinitionOccurrence
  footnotePoison : List ReferenceOccurrence
  endnotePoison : List ReferenceOccurrence
  deriving Repr, Inhabited

inductive ProductionScanCrossing
  | references (kind : NoteKind) (sourceOrdinal occurrenceOrdinal : Nat)
  | uniqueIds (kind : NoteKind) (sourceOrdinal occurrenceOrdinal : Nat)
      (canonicalId : String)
  | definitions (kind : NoteKind) (occurrenceOrdinal : Nat)
  | poison (containingKind referencedKind : NoteKind) (occurrenceOrdinal : Nat)
  deriving Repr, Inhabited

structure BoundedProductionNoteScan where
  scan : ProductionNoteScan
  crossing : Option ProductionScanCrossing
  processedCandidates : Nat
  deriving Repr, Inhabited

def emptyProductionNoteScan : ProductionNoteScan :=
  { references := []
    footnoteDefinitions := []
    endnoteDefinitions := []
    footnotePoison := []
    endnotePoison := [] }

structure ProductionScanState where
  scan : ProductionNoteScan := emptyProductionNoteScan
  footnoteIds : List String := []
  endnoteIds : List String := []
  crossing : Option ProductionScanCrossing := none
  processedCandidates : Nat := 0
  deriving Repr, Inhabited

def referenceKindAt? : XmlEvent → Option NoteKind
  | .startElement uri localName _ _ _ =>
    if uri != wmlNamespace then none
    else if localName == NoteKind.footnotes.referenceLocalName then some .footnotes
    else if localName == NoteKind.endnotes.referenceLocalName then some .endnotes
    else none
  | .endElement .. | .text .. => none

def definitionAt (kind : NoteKind) : XmlEvent → Bool
  | .startElement uri localName _ depth _ =>
    uri == wmlNamespace && localName == kind.definitionLocalName && depth == 1
  | .endElement .. | .text .. => false

def ProductionScanState.stopped (state : ProductionScanState) : Bool :=
  state.crossing.isSome

def admitSourceCandidate (state : ProductionScanState) (sourceOrdinal : Nat)
    (event : XmlEvent) : ProductionScanState :=
  match referenceKindAt? event with
  | none => state
  | some kind =>
    let ordinal := state.scan.references.length
    if ordinal == maxReferenceOccurrences then
      { state with crossing := some (.references kind sourceOrdinal ordinal) }
    else
      match referenceCandidate? event with
      | none => state
      | some (_, rawId) =>
        let occurrence : ReferenceOccurrence :=
          { kind, rawId, sourceOrdinal, occurrenceOrdinal := ordinal }
        let canonical := rawId.bind fun raw =>
          (parseDecimalId raw).toOption.map (·.text)
        let ids := if kind == .footnotes then state.footnoteIds else state.endnoteIds
        match canonical with
        | some canonicalId =>
          if !ids.contains canonicalId && ids.length == maxUniqueReferenceIds then
            { state with
              crossing := some (.uniqueIds kind sourceOrdinal ordinal canonicalId) }
          else
            { state with
              scan := { state.scan with
                references := state.scan.references ++ [occurrence] }
              footnoteIds := if kind == .footnotes && !ids.contains canonicalId then
                ids ++ [canonicalId] else state.footnoteIds
              endnoteIds := if kind == .endnotes && !ids.contains canonicalId then
                ids ++ [canonicalId] else state.endnoteIds
              processedCandidates := state.processedCandidates + 1 }
        | none =>
          { state with
            scan := { state.scan with
              references := state.scan.references ++ [occurrence] }
            processedCandidates := state.processedCandidates + 1 }

def admitDefinitionCandidate (state : ProductionScanState)
    (containingKind : NoteKind) (event : XmlEvent) : ProductionScanState :=
  if definitionAt containingKind event then
    let definitions := if containingKind == .footnotes then
      state.scan.footnoteDefinitions else state.scan.endnoteDefinitions
    let ordinal := definitions.length
    if ordinal == maxDefinitions then
      { state with crossing := some (.definitions containingKind ordinal) }
    else
      match definitionCandidate? containingKind event with
      | none => state
      | some (rawId, definitionType) =>
        let occurrence : DefinitionOccurrence :=
          { kind := containingKind, rawId, definitionType,
            occurrenceOrdinal := ordinal }
        { state with
          scan := if containingKind == .footnotes then
            { state.scan with
              footnoteDefinitions := state.scan.footnoteDefinitions ++ [occurrence] }
          else
            { state.scan with
              endnoteDefinitions := state.scan.endnoteDefinitions ++ [occurrence] }
          processedCandidates := state.processedCandidates + 1 }
  else
    match referenceKindAt? event with
    | none => state
    | some referencedKind =>
      let ordinal :=
        state.scan.footnotePoison.length + state.scan.endnotePoison.length
      if ordinal == maxPoisonReferences then
        let crossing :=
          ProductionScanCrossing.poison containingKind referencedKind ordinal
        { state with crossing := some crossing }
      else
        match referenceCandidate? event with
        | none => state
        | some (_, rawId) =>
          let occurrence : ReferenceOccurrence :=
            { kind := referencedKind, rawId, sourceOrdinal := 0,
              occurrenceOrdinal := ordinal }
          { state with
            scan := if containingKind == .footnotes then
              { state.scan with
                footnotePoison := state.scan.footnotePoison ++ [occurrence] }
            else
              { state.scan with
                endnotePoison := state.scan.endnotePoison ++ [occurrence] }
            processedCandidates := state.processedCandidates + 1 }

def foldProductionEvents (admit : ProductionScanState → XmlEvent → ProductionScanState)
    (events : List XmlEvent) (initial : ProductionScanState) : ProductionScanState :=
  events.foldl (fun state event =>
    if state.stopped then state else admit state event) initial

theorem fold_production_events_stops_at_first_crossing
    (admit : ProductionScanState → XmlEvent → ProductionScanState)
    (events : List XmlEvent) (initial : ProductionScanState)
    (hStopped : initial.stopped = true) :
    foldProductionEvents admit events initial = initial := by
  unfold foldProductionEvents
  induction events generalizing initial with
  | nil => rfl
  | cons event rest ih =>
    simp only [List.foldl_cons]
    rw [if_pos hStopped]
    exact ih initial hStopped

def productionNoteScanBounded (input : ProductionNoteScanInput) :
    BoundedProductionNoteScan :=
  let afterSources := input.validSourceEvents.foldl (fun state source =>
    if state.stopped then state
    else foldProductionEvents (admitSourceCandidate · source.1 ·) source.2 state) {}
  let afterFootnotes :=
    if afterSources.stopped then afterSources
    else foldProductionEvents (admitDefinitionCandidate · .footnotes ·)
      input.footnoteDefinitionEvents afterSources
  let afterEndnotes :=
    if afterFootnotes.stopped then afterFootnotes
    else foldProductionEvents (admitDefinitionCandidate · .endnotes ·)
      input.endnoteDefinitionEvents afterFootnotes
  { scan := afterEndnotes.scan
    crossing := afterEndnotes.crossing
    processedCandidates := afterEndnotes.processedCandidates }

def productionNoteScan (input : ProductionNoteScanInput) : ProductionNoteScan :=
  (productionNoteScanBounded input).scan

structure RetainedBoundedProductionNoteScan where
  input : ProductionNoteScanInput
  output : BoundedProductionNoteScan
  scanInvocationCount : Nat
  outputExact : output = productionNoteScanBounded input

def ProductionNoteScanOf (input : ProductionNoteScanInput)
    (scan : ProductionNoteScan) : Prop :=
  scan = (productionNoteScanBounded input).scan

theorem production_note_scan_exact (input : ProductionNoteScanInput) :
    ProductionNoteScanOf input (productionNoteScan input) := by
  rfl

def scanValidSource (sourceOrdinal : Nat) (events : List XmlEvent) : ScannedStory :=
  { events
    references := scanReferenceEvents sourceOrdinal events
    definitions := []
    poisonReferences := []
    fullyScanned := true }

def scanDefinitionStory (kind : NoteKind) (sourceOrdinal : Nat)
    (events : List XmlEvent) : ScannedStory :=
  { events
    references := []
    definitions := scanDefinitionEvents kind events
    poisonReferences := scanReferenceEvents sourceOrdinal events
    fullyScanned := true }

inductive VerifierSide
  | original
  | revised
  | compared
  deriving BEq, DecidableEq, Repr, Inhabited

inductive PartitionStatus
  | complete
  | incomplete
  deriving BEq, DecidableEq, Repr, Inhabited

inductive EvaluationStatus
  | passed
  | failed
  | notEvaluated
  deriving BEq, DecidableEq, Repr, Inhabited

inductive SourceStory
  | main
  | header
  | footer
  | footnotes
  | endnotes
  deriving BEq, DecidableEq, Repr, Inhabited

structure StorySlot where
  story : SourceStory
  ordinal : Nat
  normalizedPartPath : String
  deriving BEq, DecidableEq, Repr, Inhabited

def storySlotEq (left right : StorySlot) : Bool :=
  left.story == right.story &&
  left.ordinal == right.ordinal &&
  left.normalizedPartPath == right.normalizedPartPath

def storySlotListEq (left right : List StorySlot) : Bool :=
  left.length == right.length &&
  (left.zip right).all fun pair => storySlotEq pair.1 pair.2

def storySlotContains (needle : StorySlot) : List StorySlot → Bool
  | [] => false
  | value :: values => storySlotEq needle value || storySlotContains needle values

def eraseStorySlotDups (values : List StorySlot) : List StorySlot :=
  values.foldl (fun retained value =>
    if storySlotContains value retained then retained else retained ++ [value]) []

def selectedNoteIdentityEq (left right : SelectedNoteIdentity) : Bool :=
  left.relationshipRecordOrdinal == right.relationshipRecordOrdinal &&
  left.relationshipId == right.relationshipId &&
  left.normalizedPartPath == right.normalizedPartPath

structure SelectedStories where
  physical : List StorySlot
  footnotes : Option SelectedNoteIdentity
  endnotes : Option SelectedNoteIdentity
  deriving BEq, Repr, Inhabited

def selectedNoteForKind (selected : SelectedStories) : NoteKind →
    Option SelectedNoteIdentity
  | .footnotes => selected.footnotes
  | .endnotes => selected.endnotes

structure ReferenceSourcePartition where
  side : VerifierSide
  status : PartitionStatus
  sources : List StorySlot
  definitionStories : List StorySlot
  deriving BEq, Repr, Inhabited

def partitionEq (left right : ReferenceSourcePartition) : Bool :=
  left.side == right.side &&
  left.status == right.status &&
  storySlotListEq left.sources right.sources &&
  storySlotListEq left.definitionStories right.definitionStories

def optionalSelectedIdentityEq :
    Option SelectedNoteIdentity → Option SelectedNoteIdentity → Bool
  | none, none => true
  | some left, some right => selectedNoteIdentityEq left right
  | _, _ => false

def selectedIdentityMatches (actual : Option SelectedNoteIdentity)
    (expected : SelectedNoteIdentity) : Bool :=
  match actual with
  | some value => selectedNoteIdentityEq value expected
  | none => false

structure StoryRealization where
  slot : StorySlot
  bytes : ByteArray
  text : String
  root : ProofXmlRoot
  visitedEvents : List XmlEvent
  completed : Bool
  deriving Inhabited

structure SideScanEvidence where
  realizations : List StoryRealization
  parsedReferences : List ReferenceOccurrence
  parsedDefinitions : List DefinitionOccurrence
  parsedPoison : List ReferenceOccurrence
  deriving Inhabited

def partLoadedAtCheck (pkg : PackageView) (path : String) (bytes : ByteArray) : Bool :=
  match partsAtPath path pkg.parts with
  | [] => false
  | part :: parts =>
      parts.isEmpty &&
      part.regularEntryCount == 1 &&
        match part.loadedBytes with
        | some loaded => byteArrayEq loaded bytes
        | none => false

def PartLoadedAt (pkg : PackageView) (path : String) (bytes : ByteArray) : Prop :=
  partLoadedAtCheck pkg path bytes = true

def Utf8DecodedPartAs (bytes : ByteArray) (text : String) : Prop :=
  byteArrayEq bytes text.toUTF8 = true

def firstRootEventMatches (root : ProofXmlRoot) : List XmlEvent → Bool
  | [] => false
  | event :: _ =>
    ConventionalMainNoteSelector.xmlEventTag event == 0 &&
    ConventionalMainNoteSelector.xmlEventDepth event == 0 &&
    ConventionalMainNoteSelector.xmlEventUri event == root.namespaceUri &&
    ConventionalMainNoteSelector.xmlEventLocalName event == root.localName

def xmlParsedPartCheck (text : String) (root : ProofXmlRoot)
    (events : List XmlEvent) : Bool :=
  root.sourceText == text &&
  firstRootEventMatches root events

def XmlParsedPartAs (text : String) (root : ProofXmlRoot)
    (events : List XmlEvent) : Prop :=
  xmlParsedPartCheck text root events = true

def fullyScannedStoryCheck (pkg : PackageView) (source : StorySlot)
    (realization : StoryRealization) : Bool :=
  storySlotEq realization.slot source &&
  partLoadedAtCheck pkg source.normalizedPartPath realization.bytes &&
  byteArrayEq realization.bytes realization.text.toUTF8 &&
  xmlParsedPartCheck realization.text realization.root realization.visitedEvents &&
  xmlEventListEq realization.visitedEvents
    (((partsAtPath source.normalizedPartPath pkg.parts).head?.map
      (·.events)).getD []) &&
  decide (realization.visitedEvents.length ≤ 500000) &&
  realization.completed

def FullyScannedStoryOf (pkg : PackageView) (source : StorySlot)
    (realization : StoryRealization) : Prop :=
  fullyScannedStoryCheck pkg source realization = true

instance fullyScannedStoryOfDecidable (pkg : PackageView) (source : StorySlot)
    (realization : StoryRealization) :
    Decidable (FullyScannedStoryOf pkg source realization) :=
  instDecidableEqBool (fullyScannedStoryCheck pkg source realization) true

def fixedMainSource : StorySlot :=
  { story := .main, ordinal := 0, normalizedPartPath := "word/document.xml" }

def definitionSlot (kind : NoteKind) (selected : Option SelectedNoteIdentity) : StorySlot :=
  { story := if kind == .footnotes then .footnotes else .endnotes
    ordinal := 0
    normalizedPartPath := selected.map (·.normalizedPartPath) |>.getD "" }

def canonicalSources (selected : SelectedStories) : List StorySlot :=
  eraseStorySlotDups
    (fixedMainSource :: selected.physical.filter fun source =>
      !storySlotEq source fixedMainSource)

def canonicalDefinitionStories (selected : SelectedStories) : List StorySlot :=
  [definitionSlot .footnotes selected.footnotes, definitionSlot .endnotes selected.endnotes]

def expectedPresentDefinitionStories (selected : SelectedStories) : List StorySlot :=
  [(.footnotes, selected.footnotes), (.endnotes, selected.endnotes)].filterMap
    fun (kind, identity) => identity.map fun _ => definitionSlot kind identity

def canonicalPartition (side : VerifierSide) (selected : SelectedStories) :
    ReferenceSourcePartition :=
  { side, status := .complete, sources := canonicalSources selected,
    definitionStories := canonicalDefinitionStories selected }

def realizationForPart (slot : StorySlot) (part : ProofPart) : Option StoryRealization := do
  let bytes ← part.loadedBytes
  let text ← part.decodedText
  let root ← part.parsedRoot
  return {
    slot, bytes, text, root, visitedEvents := part.events,
    completed := part.fullyScanned
  }

def canonicalRealization (pkg : PackageView) (slot : StorySlot) :
    Option StoryRealization :=
  match partsAtPath slot.normalizedPartPath pkg.parts with
  | [] => none
  | part :: parts =>
      if parts.isEmpty then realizationForPart slot part else none

def canonicalRealizations (pkg : PackageView) : List StorySlot →
    List StoryRealization
  | [] => []
  | slot :: slots =>
      match canonicalRealization pkg slot with
      | some realization => realization :: canonicalRealizations pkg slots
      | none => canonicalRealizations pkg slots

def referencesForSources (sources : List StorySlot) :
    List StoryRealization → List ReferenceOccurrence
  | [] => []
  | realization :: realizations =>
      let current := if storySlotContains realization.slot sources then
        scanReferenceEvents realization.slot.ordinal realization.visitedEvents
      else []
      current ++ referencesForSources sources realizations

def definitionsForStories (stories : List StorySlot) :
    List StoryRealization → List DefinitionOccurrence
  | [] => []
  | realization :: realizations =>
      let current := if storySlotContains realization.slot stories then
        match realization.slot.story with
        | .footnotes => scanDefinitionEvents .footnotes realization.visitedEvents
        | .endnotes => scanDefinitionEvents .endnotes realization.visitedEvents
        | .main | .header | .footer => []
      else []
      current ++ definitionsForStories stories realizations

def poisonForStories (stories : List StorySlot) :
    List StoryRealization → List ReferenceOccurrence
  | [] => []
  | realization :: realizations =>
      let current := if storySlotContains realization.slot stories then
        scanReferenceEvents realization.slot.ordinal realization.visitedEvents
      else []
      current ++ poisonForStories stories realizations

def canonicalScans (pkg : PackageView) (selected : SelectedStories) : SideScanEvidence :=
  let slots := canonicalSources selected ++ canonicalDefinitionStories selected
  let realizations := canonicalRealizations pkg slots
  let partition := canonicalPartition .original selected
  { realizations
    parsedReferences := referencesForSources partition.sources realizations
    parsedDefinitions := definitionsForStories partition.definitionStories realizations
    parsedPoison := poisonForStories partition.definitionStories realizations }

def scanEventCount (scans : SideScanEvidence) : Nat :=
  let rec loop : List StoryRealization → Nat
    | [] => 0
    | realization :: realizations =>
        realization.visitedEvents.length + loop realizations
  loop scans.realizations

def noDuplicateSlots (slots : List StorySlot) : Prop :=
  slots.Nodup

def hasFullyScannedRealization (pkg : PackageView) (source : StorySlot) :
    List StoryRealization → Bool
  | [] => false
  | realization :: realizations =>
      (storySlotEq realization.slot source &&
        fullyScannedStoryCheck pkg source realization) ||
      hasFullyScannedRealization pkg source realizations

def everySourceFullyScanned (pkg : PackageView)
    (realizations : List StoryRealization) : List StorySlot → Bool
  | [] => true
  | source :: sources =>
      hasFullyScannedRealization pkg source realizations &&
      everySourceFullyScanned pkg realizations sources

def hasReferenceOfKind (kind : NoteKind) : List ReferenceOccurrence → Bool
  | [] => false
  | reference :: references =>
      sameNoteKind reference.kind kind || hasReferenceOfKind kind references

def definitionTypeResultTag : Except String NoteDefinitionType → Bool
  | .ok _ => true
  | .error _ => false

def definitionTypeResultError : Except String NoteDefinitionType → String
  | .error value => value
  | .ok _ => ""

def definitionTypeResultValue : Except String NoteDefinitionType →
    NoteDefinitionType
  | .ok value => value
  | .error _ => .user

def definitionTypeResultEq (left right : Except String NoteDefinitionType) : Bool :=
  definitionTypeResultTag left == definitionTypeResultTag right &&
  definitionTypeResultError left == definitionTypeResultError right &&
  definitionTypeResultValue left == definitionTypeResultValue right

def definitionOccurrenceEq (left right : DefinitionOccurrence) : Bool :=
  left.kind == right.kind &&
  left.rawId == right.rawId &&
  definitionTypeResultEq left.definitionType right.definitionType &&
  left.occurrenceOrdinal == right.occurrenceOrdinal

def storyRealizationEq (left right : StoryRealization) : Bool :=
  storySlotEq left.slot right.slot &&
  byteArrayEq left.bytes right.bytes &&
  left.text == right.text &&
  left.root.sourceText == right.root.sourceText &&
  left.root.namespaceUri == right.root.namespaceUri &&
  left.root.localName == right.root.localName &&
  xmlEventListEq left.visitedEvents right.visitedEvents &&
  left.completed == right.completed

def storyRealizationListEq (left right : List StoryRealization) : Bool :=
  left.length == right.length &&
  (left.zip right).all fun pair => storyRealizationEq pair.1 pair.2

def referenceOccurrenceListEq (left right : List ReferenceOccurrence) : Bool :=
  left.length == right.length &&
  (left.zip right).all fun pair => referenceOccurrenceEq pair.1 pair.2

def definitionOccurrenceListEq (left right : List DefinitionOccurrence) : Bool :=
  left.length == right.length &&
  (left.zip right).all fun pair => definitionOccurrenceEq pair.1 pair.2

def sideScanEvidenceEq (left right : SideScanEvidence) : Bool :=
  storyRealizationListEq left.realizations right.realizations &&
  referenceOccurrenceListEq left.parsedReferences right.parsedReferences &&
  definitionOccurrenceListEq left.parsedDefinitions right.parsedDefinitions &&
  referenceOccurrenceListEq left.parsedPoison right.parsedPoison

def OptionalNoteSlotSatisfiedOf (pkg : PackageView) (kind : NoteKind)
    (selected : SelectedStories) (scans : SideScanEvidence) : Prop :=
  let identity := selectedNoteForKind selected kind
  match identity with
  | some noteIdentity =>
      SelectedNoteIdentityOf pkg kind noteIdentity ∧
      hasFullyScannedRealization pkg (definitionSlot kind identity)
        scans.realizations = true
  | none =>
      (typedRecordsOfKind kind pkg.relationshipRecords).isEmpty = true ∧
      hasReferenceOfKind kind scans.parsedReferences = false

def optionalNoteSlotSatisfiedCheck (pkg : PackageView) (kind : NoteKind)
    (selected : SelectedStories) (scans : SideScanEvidence) : Bool :=
  let identity := selectedNoteForKind selected kind
  match identity with
  | some noteIdentity =>
      selectedIdentityMatches (selectedNoteIdentitySpec pkg kind) noteIdentity &&
      hasFullyScannedRealization pkg (definitionSlot kind identity)
        scans.realizations
  | none =>
      (typedRecordsOfKind kind pkg.relationshipRecords).isEmpty &&
      !hasReferenceOfKind kind scans.parsedReferences

def completeAdmittedPartitionCheck (pkg : PackageView) (side : VerifierSide)
    (selected : SelectedStories) (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence) : Bool :=
  partitionEq partition (canonicalPartition side selected) &&
  sideScanEvidenceEq scans (canonicalScans pkg selected) &&
  (eraseStorySlotDups partition.sources).length == partition.sources.length &&
  everySourceFullyScanned pkg scans.realizations
    (partition.sources ++ expectedPresentDefinitionStories selected) &&
  decide (scanEventCount scans ≤ maxSourceEventsPerSide) &&
  optionalNoteSlotSatisfiedCheck pkg .footnotes selected scans &&
  optionalNoteSlotSatisfiedCheck pkg .endnotes selected scans

def CompleteAdmittedPartitionOf (pkg : PackageView) (side : VerifierSide)
    (selected : SelectedStories) (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence) : Prop :=
  completeAdmittedPartitionCheck pkg side selected partition scans = true

instance completeAdmittedPartitionOfDecidable (pkg : PackageView)
    (side : VerifierSide) (selected : SelectedStories)
    (partition : ReferenceSourcePartition) (scans : SideScanEvidence) :
    Decidable (CompleteAdmittedPartitionOf pkg side selected partition scans) :=
  instDecidableEqBool
    (completeAdmittedPartitionCheck pkg side selected partition scans) true

structure ParsedNoteEvidence where
  references : List ReferenceOccurrence
  definitions : List DefinitionOccurrence
  poison : List ReferenceOccurrence
  wireCounts : List Nat
  issues : List String
  deriving Repr, Inhabited

def referencesFromScans (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence) : List ReferenceOccurrence :=
  scans.realizations.flatMap fun realization =>
    if storySlotContains realization.slot partition.sources then
      scanReferenceEvents realization.slot.ordinal realization.visitedEvents
    else []

def definitionsFromScans (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence) : List DefinitionOccurrence :=
  scans.realizations.flatMap fun realization =>
    match storySlotContains realization.slot partition.definitionStories with
    | false => []
    | true =>
      match realization.slot.story with
      | .footnotes => scanDefinitionEvents .footnotes realization.visitedEvents
      | .endnotes => scanDefinitionEvents .endnotes realization.visitedEvents
      | .main | .header | .footer => []

def poisonFromScans (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence) : List ReferenceOccurrence :=
  scans.realizations.flatMap fun realization =>
    if storySlotContains realization.slot partition.definitionStories then
      scanReferenceEvents 0 realization.visitedEvents
    else []

def projectWireCounts (references : List ReferenceOccurrence)
    (definitions : List DefinitionOccurrence) (poison : List ReferenceOccurrence) :
    List Nat :=
  [references.length, definitions.length, poison.length]

def canonicalIssuesSpec (references : List ReferenceOccurrence)
    (definitions : List DefinitionOccurrence) (poison : List ReferenceOccurrence) :
    List String :=
  (if references.length > maxReferenceOccurrences then ["reference_limit"] else []) ++
  (if definitions.length > maxDefinitions then ["definition_limit"] else []) ++
  (if poison.isEmpty then [] else ["poison"])

def evidenceFromScans (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence) : ParsedNoteEvidence :=
  let references := referencesFromScans partition scans
  let definitions := definitionsFromScans partition scans
  let poison := poisonFromScans partition scans
  { references, definitions, poison
    wireCounts := projectWireCounts references definitions poison
    issues := canonicalIssuesSpec references definitions poison }

def ParsedInventoryEvidenceOf (_pkg : PackageView) (_side : VerifierSide)
    (partition : ReferenceSourcePartition) (evidence : ParsedNoteEvidence) : Prop :=
  ∃ scans, evidence = evidenceFromScans partition scans

def scanNoteEvidence (_pkg : PackageView) (_side : VerifierSide)
    (partition : ReferenceSourcePartition) (scans : SideScanEvidence) :
    Except String ParsedNoteEvidence :=
  .ok (evidenceFromScans partition scans)

structure InventoryCounts where
  referenceOccurrences : Nat := 0
  uniqueReferenceIds : Nat := 0
  userDefinitions : Nat := 0
  separatorDefinitions : Nat := 0
  continuationSeparatorDefinitions : Nat := 0
  continuationNoticeDefinitions : Nat := 0
  forbiddenDefinitionStoryReferences : Nat := 0
  deriving BEq, Repr, Inhabited

def zeroCounts : InventoryCounts := {}

inductive IntrinsicStage
  | selection | load | utf8Decode | xmlParse | rootMismatch | fullScan
  deriving BEq, DecidableEq, Repr, Inhabited

inductive SemanticLimit
  | references | uniqueIds | definitions | poison
  deriving BEq, DecidableEq, Repr, Inhabited

structure SideNoteEvaluationV5 where
  partition : ReferenceSourcePartition
  scanEvidence : SideScanEvidence
  parsedEvidence : Option ParsedNoteEvidence
  internalReferences : List ReferenceOccurrence
  internalDefinitions : List DefinitionOccurrence
  internalPoisonReferences : List ReferenceOccurrence
  footnotesInventory : InventoryCounts
  endnotesInventory : InventoryCounts
  footnotesStatus : EvaluationStatus
  endnotesStatus : EvaluationStatus
  scanStarted : Bool
  intrinsicFailure : Option (StorySlot × IntrinsicStage)
  localSemanticCrossing : Option (SemanticLimit × Nat)
  deriving Inhabited

def completeSideEvaluation (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence) : SideNoteEvaluationV5 :=
  { partition
    scanEvidence := scans
    parsedEvidence := some (evidenceFromScans partition scans)
    internalReferences := scans.parsedReferences
    internalDefinitions := scans.parsedDefinitions
    internalPoisonReferences := scans.parsedPoison
    footnotesInventory := zeroCounts
    endnotesInventory := zeroCounts
    footnotesStatus := .passed
    endnotesStatus := .passed
    scanStarted := true
    intrinsicFailure := none
    localSemanticCrossing := none }

def incompleteSideEvaluation
    (partition : ReferenceSourcePartition) : SideNoteEvaluationV5 :=
  { partition := { partition with status := .incomplete }
    scanEvidence := {
      realizations := [], parsedReferences := [],
      parsedDefinitions := [], parsedPoison := [] }
    parsedEvidence := none
    internalReferences := []
    internalDefinitions := []
    internalPoisonReferences := []
    footnotesInventory := zeroCounts
    endnotesInventory := zeroCounts
    footnotesStatus := .notEvaluated
    endnotesStatus := .notEvaluated
    scanStarted := false
    intrinsicFailure := none
    localSemanticCrossing := none }

def selectSideEvaluation (condition : Bool)
    (complete incomplete : SideNoteEvaluationV5) : SideNoteEvaluationV5 :=
  match condition with
  | true => complete
  | false => incomplete

def evaluateNoteSideV5 (pkg : PackageView) (side : VerifierSide)
    (selected : SelectedStories) : SideNoteEvaluationV5 :=
  let scans := canonicalScans pkg selected
  let partition := canonicalPartition side selected
  selectSideEvaluation
    (completeAdmittedPartitionCheck pkg side selected partition scans)
    (completeSideEvaluation partition scans)
    (incompleteSideEvaluation partition)

theorem selected_complete_side_exact (condition : Bool)
    (complete incomplete evaluation : SideNoteEvaluationV5)
    (hSelect :
      selectSideEvaluation condition complete incomplete = evaluation)
    (hIncompleteStatus : incomplete.partition.status = .incomplete)
    (hStatus : evaluation.partition.status = .complete) :
    condition = true ∧ evaluation = complete := by
  cases hCondition : condition
  · have hChoice :
        selectSideEvaluation condition complete incomplete = incomplete :=
      congrArg (fun value =>
        selectSideEvaluation value complete incomplete) hCondition
    have hEvaluation : incomplete = evaluation := hChoice.symm.trans hSelect
    have hStatus' : incomplete.partition.status = .complete :=
      congrArg (fun value => value.partition.status) hEvaluation |>.trans hStatus
    exact nomatch hIncompleteStatus.symm.trans hStatus'
  · have hChoice :
        selectSideEvaluation condition complete incomplete = complete :=
      congrArg (fun value =>
        selectSideEvaluation value complete incomplete) hCondition
    exact ⟨rfl, hSelect.symm.trans hChoice⟩

def canonicalIds (kind : NoteKind) (references : List ReferenceOccurrence) : List String :=
  references.filterMap fun reference =>
    if reference.kind != kind then none
    else reference.rawId.bind fun raw => (parseDecimalId raw).toOption.map (·.text)

structure CanonicalDecimalKey where
  negative : Bool
  digits : List UInt8
  deriving BEq, DecidableEq, Repr, Inhabited

def byteArrayListFrom (bytes : ByteArray) : Nat → Nat → List UInt8
  | _, 0 => []
  | offset, fuel + 1 =>
    match byteArrayByte? bytes offset with
    | none => []
    | some byte => byte :: byteArrayListFrom bytes (offset + 1) fuel

def byteArrayList (bytes : ByteArray) : List UInt8 :=
  byteArrayListFrom bytes 0 bytes.size

def isDecimalXmlSpace (byte : UInt8) : Bool :=
  byte == 0x09 || byte == 0x0a || byte == 0x0d || byte == 0x20

def dropDecimalSpace : List UInt8 → List UInt8
  | [] => []
  | byte :: bytes =>
    match isDecimalXmlSpace byte with
    | true => dropDecimalSpace bytes
    | false => byte :: bytes

def trimDecimalSpace (bytes : List UInt8) : List UInt8 :=
  dropDecimalSpace (dropDecimalSpace bytes |>.reverse) |>.reverse

def decimalDigit (byte : UInt8) : Bool :=
  (0x30 : Nat).ble byte.toNat && byte.toNat.ble 0x39

def dropLeadingDecimalZeroes : List UInt8 → List UInt8
  | [] => []
  | byte :: bytes =>
    match byte == 0x30 with
    | true => dropLeadingDecimalZeroes bytes
    | false => byte :: bytes

def canonicalDecimalBytes? (encoded : ByteArray) : Option CanonicalDecimalKey :=
  match encoded.size.ble maxRawDecimalBytes with
  | false => none
  | true =>
    let trimmed := trimDecimalSpace (byteArrayList encoded)
    let (negative, unsigned) :=
      match trimmed with
      | [] => (false, [])
      | byte :: bytes =>
        match byte == 0x2b with
        | true => (false, bytes)
        | false =>
          match byte == 0x2d with
          | true => (true, bytes)
          | false => (false, byte :: bytes)
    match unsigned.isEmpty || !unsigned.all decimalDigit with
    | true => none
    | false =>
      let magnitude := dropLeadingDecimalZeroes unsigned
      let digits := match magnitude.isEmpty with
        | true => [0x30]
        | false => magnitude
      some { negative := negative && !magnitude.isEmpty, digits }

def canonicalDecimalKey? (raw : String) : Option CanonicalDecimalKey :=
  canonicalDecimalBytes? raw.toUTF8

structure IntegrityDefinition where
  kind : NoteKind
  classification : NoteDefinitionType
  id : CanonicalDecimalKey
  deriving BEq, DecidableEq, Repr, Inhabited

structure IntegrityReference where
  kind : NoteKind
  id : CanonicalDecimalKey
  deriving BEq, DecidableEq, Repr, Inhabited

structure PackageNoteInventory where
  references : List IntegrityReference
  definitions : List IntegrityDefinition
  forbiddenDefinitionStoryReferences : List IntegrityReference
  deriving Repr, Inhabited

def integrityReference? (reference : ReferenceOccurrence) :
    Option IntegrityReference := do
  let raw ← reference.rawId
  let parsed ← canonicalDecimalKey? raw
  return { kind := reference.kind, id := parsed }

def integrityDefinition? (definition : DefinitionOccurrence) :
    Option IntegrityDefinition := do
  let classification ← definition.definitionType.toOption
  let raw ← definition.rawId
  let parsed ← canonicalDecimalKey? raw
  return { kind := definition.kind, classification, id := parsed }

def poisonIntegrityReference (reference : ReferenceOccurrence) :
    IntegrityReference :=
  { kind := reference.kind
    id := reference.rawId.bind canonicalDecimalKey? |>.getD
      { negative := false, digits := [0x30] } }

def packageInventoryFromScans (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence) : PackageNoteInventory :=
  { references := (referencesFromScans partition scans).filterMap integrityReference?
    definitions := (definitionsFromScans partition scans).filterMap integrityDefinition?
    forbiddenDefinitionStoryReferences :=
      (poisonFromScans partition scans).map poisonIntegrityReference }

def packageInventoryFromProductionScan
    (scan : ProductionNoteScan) : PackageNoteInventory :=
  { references := scan.references.filterMap integrityReference?
    definitions :=
      (scan.footnoteDefinitions ++ scan.endnoteDefinitions).filterMap
        integrityDefinition?
    forbiddenDefinitionStoryReferences :=
      (scan.footnotePoison ++ scan.endnotePoison).map poisonIntegrityReference }

def integrityReferenceEq (left right : IntegrityReference) : Bool :=
  left.kind == right.kind && left.id == right.id

def integrityDefinitionEq (left right : IntegrityDefinition) : Bool :=
  left.kind == right.kind &&
  left.classification == right.classification &&
  left.id == right.id

def packageNoteInventoryEq (left right : PackageNoteInventory) : Bool :=
  left.references.length == right.references.length &&
  (left.references.zip right.references).all fun pair =>
    integrityReferenceEq pair.1 pair.2 &&
  left.definitions.length == right.definitions.length &&
  (left.definitions.zip right.definitions).all fun pair =>
    integrityDefinitionEq pair.1 pair.2 &&
  left.forbiddenDefinitionStoryReferences.length ==
    right.forbiddenDefinitionStoryReferences.length &&
  (left.forbiddenDefinitionStoryReferences.zip
    right.forbiddenDefinitionStoryReferences).all fun pair =>
      integrityReferenceEq pair.1 pair.2

def UserDefinitionsUnique (inventory : PackageNoteInventory) : Prop :=
  inventory.definitions.all (fun definition =>
    definition.classification != .user ||
    (inventory.definitions.filter fun candidate =>
      candidate.classification == .user &&
      candidate.kind == definition.kind &&
      candidate.id == definition.id).length == 1) = true

def PackageNoteIntegrity (inventory : PackageNoteInventory) : Prop :=
  UserDefinitionsUnique inventory ∧
  inventory.forbiddenDefinitionStoryReferences = [] ∧
  inventory.references.all (fun reference =>
    (inventory.definitions.filter fun definition =>
      definition.classification == .user &&
      definition.kind == reference.kind &&
      definition.id == reference.id).length == 1) = true

instance packageNoteIntegrityDecidable (inventory : PackageNoteInventory) :
    Decidable (PackageNoteIntegrity inventory) := by
  unfold PackageNoteIntegrity UserDefinitionsUnique
  infer_instance

def checkPackageNoteIntegrity (inventory : PackageNoteInventory) : Bool :=
  decide (PackageNoteIntegrity inventory)

def checkProductionNoteIntegrity (scan : ProductionNoteScan) : Bool :=
  checkPackageNoteIntegrity (packageInventoryFromProductionScan scan)

theorem production_note_integrity_sound (input : ProductionNoteScanInput)
    (scan : ProductionNoteScan)
    (hScan : productionNoteScan input = scan)
    (hPass : checkProductionNoteIntegrity scan = true) :
    ProductionNoteScanOf input scan ∧
    PackageNoteIntegrity (packageInventoryFromProductionScan scan) := by
  subst scan
  exact ⟨production_note_scan_exact input,
    of_decide_eq_true hPass⟩

theorem admitted_source_partition_complete
    (pkg : PackageView) (side : VerifierSide)
    (selected : SelectedStories) (evaluation : SideNoteEvaluationV5)
    (hEvaluate :
      evaluateNoteSideV5 pkg side selected = evaluation)
    (_hComplete : evaluation.partition.status = .complete) :
    CompleteAdmittedPartitionOf
      pkg side selected evaluation.partition evaluation.scanEvidence := by
  let partition := canonicalPartition side selected
  let scans := canonicalScans pkg selected
  let condition :=
    completeAdmittedPartitionCheck pkg side selected partition scans
  have hExact := selected_complete_side_exact condition
    (completeSideEvaluation partition scans)
    (incompleteSideEvaluation partition) evaluation hEvaluate
    (by rfl) _hComplete
  have hCondition := hExact.1
  cases hExact.2
  unfold CompleteAdmittedPartitionOf
  exact hCondition

theorem parsed_inventory_evidence_exact
    (pkg : PackageView) (side : VerifierSide)
    (selected : SelectedStories) (partition : ReferenceSourcePartition)
    (scans : SideScanEvidence)
    (evidence : ParsedNoteEvidence)
    (_hPartition :
      CompleteAdmittedPartitionOf pkg side selected partition scans)
    (hScan :
      scanNoteEvidence pkg side partition scans = .ok evidence) :
    ParsedInventoryEvidenceOf pkg side partition evidence := by
  change Except.ok (evidenceFromScans partition scans) =
    Except.ok evidence at hScan
  cases hScan
  exact ⟨scans, rfl⟩

theorem package_note_reference_integrity_sound
    (inventory : PackageNoteInventory)
    (h : checkPackageNoteIntegrity inventory = true) :
    PackageNoteIntegrity inventory := by
  exact of_decide_eq_true h

inductive IncompleteCauseV5
  | intrinsicStoryFailure (slot : StorySlot) (stage : IntrinsicStage)
  | localSemanticLimitCrossing (limit : SemanticLimit) (sentinel : Nat)
  | skippedAfterPriorCrossing (priorSide : VerifierSide)
      (limit : SemanticLimit) (sentinel : Nat)
  deriving Repr, Inhabited

def causeScanStarted : IncompleteCauseV5 → Bool
  | .intrinsicStoryFailure _ _ => false
  | .localSemanticLimitCrossing _ _ => true
  | .skippedAfterPriorCrossing _ _ _ => false

def causeIntrinsicFailure : IncompleteCauseV5 →
    Option (StorySlot × IntrinsicStage)
  | .intrinsicStoryFailure slot stage => some (slot, stage)
  | .localSemanticLimitCrossing _ _ => none
  | .skippedAfterPriorCrossing _ _ _ => none

def causeLocalCrossing : IncompleteCauseV5 → Option (SemanticLimit × Nat)
  | .intrinsicStoryFailure _ _ => none
  | .localSemanticLimitCrossing limit sentinel => some (limit, sentinel)
  | .skippedAfterPriorCrossing _ _ _ => none

structure GlobalAdmissionContext where
  packageView : VerifierSide → PackageView
  selectedStories : VerifierSide → SelectedStories
  sideOrder : List VerifierSide
  admissionEvents : List (VerifierSide × SemanticLimit × Nat)
  firstLocalSemanticCrossing : Option (VerifierSide × SemanticLimit × Nat)

structure VerifierRequestV5 where
  packageView : VerifierSide → PackageView
  selectedStories : VerifierSide → SelectedStories
  incompleteCause : VerifierSide → Option IncompleteCauseV5
  genericStories : List NamedStoryTriple
  genericStoryReports : List StoryReport

def physicalStorySlot? (story : ProofPhysicalStory) : Option StorySlot :=
  if story.story == "header" then
    some ⟨SourceStory.header, story.ordinal, story.normalizedPartPath⟩
  else if story.story == "footer" then
    some ⟨SourceStory.footer, story.ordinal, story.normalizedPartPath⟩
  else none

structure GlobalNoteEvaluationV5 where
  admissionContext : GlobalAdmissionContext
  sideEvaluation : VerifierSide → SideNoteEvaluationV5
  incompleteCause : VerifierSide → Option IncompleteCauseV5

def canonicalSelectedStoriesSpec (request : VerifierRequestV5)
    (side : VerifierSide) : SelectedStories :=
  let pkg := request.packageView side
  let selected := fun kind =>
    match selectConventionalMainNote pkg kind with
    | .ok identity => identity
    | .error _ => none
  { physical := pkg.physicalStories.filterMap physicalStorySlot?
    footnotes := selected .footnotes
    endnotes := selected .endnotes }

def derivedPackageInventory (request : VerifierRequestV5)
    (side : VerifierSide) : PackageNoteInventory :=
  let selected := canonicalSelectedStoriesSpec request side
  packageInventoryFromScans (canonicalPartition side selected)
    (canonicalScans (request.packageView side) selected)

theorem canonical_selected_note_sound (request : VerifierRequestV5)
    (side : VerifierSide) (kind : NoteKind) (selected : SelectedNoteIdentity)
    (hSelected :
      selectedNoteForKind (canonicalSelectedStoriesSpec request side) kind =
        some selected) :
    SelectedNoteIdentityOf (request.packageView side) kind selected := by
  apply ConventionalMainNoteSelector.selected_note_identity_sound
  unfold canonicalSelectedStoriesSpec selectedNoteForKind at hSelected
  cases kind <;> simp only at hSelected
  all_goals
    unfold selectConventionalMainNote
    exact congrArg Except.ok hSelected

def sideOrder : List VerifierSide := [.original, .revised, .compared]

def noteIdPairEq (left right : NoteKind × CanonicalDecimalKey) : Bool :=
  left.1 == right.1 && left.2 == right.2

def noteIdPairContains (needle : NoteKind × CanonicalDecimalKey) :
    List (NoteKind × CanonicalDecimalKey) → Bool
  | [] => false
  | value :: values =>
      noteIdPairEq needle value || noteIdPairContains needle values

def eraseNoteIdPairDups (values : List (NoteKind × CanonicalDecimalKey)) :
    List (NoteKind × CanonicalDecimalKey) :=
  values.foldl (fun retained value =>
    match noteIdPairContains value retained with
    | true => retained
    | false => retained ++ [value]) []

def inventoryCrossings (request : VerifierRequestV5)
    (side : VerifierSide) : List (VerifierSide × SemanticLimit × Nat) :=
  let inventory := derivedPackageInventory request side
  let uniqueIds := eraseNoteIdPairDups
    (inventory.references.map fun reference =>
      (reference.kind, reference.id)) |>.length
  (match inventory.references.length.ble maxReferenceOccurrences with
    | false => [(side, .references, maxReferenceOccurrences)]
    | true => []) ++
  (match uniqueIds.ble maxUniqueReferenceIds with
    | false => [(side, .uniqueIds, maxUniqueReferenceIds)]
    | true => []) ++
  (match inventory.definitions.length.ble maxDefinitions with
    | false => [(side, .definitions, maxDefinitions)]
    | true => []) ++
  (match inventory.forbiddenDefinitionStoryReferences.length.ble
      maxPoisonReferences with
    | false => [(side, .poison, maxPoisonReferences)]
    | true => [])

def canonicalAdmissionEvents (request : VerifierRequestV5) :
    List (VerifierSide × SemanticLimit × Nat) :=
  sideOrder.flatMap (inventoryCrossings request)

def verifierSideRank : VerifierSide → Nat
  | .original => 0
  | .revised => 1
  | .compared => 2

def GlobalAdmissionContextOf (request : VerifierRequestV5)
    (context : GlobalAdmissionContext) : Prop :=
  context.sideOrder = [.original, .revised, .compared] ∧
  (∀ side, context.packageView side = request.packageView side) ∧
  (∀ side, context.selectedStories side =
    canonicalSelectedStoriesSpec request side) ∧
  context.admissionEvents = canonicalAdmissionEvents request ∧
  context.firstLocalSemanticCrossing =
    (canonicalAdmissionEvents request).head?

def zeroIncompleteEvaluation (side : VerifierSide)
    (cause : IncompleteCauseV5) : SideNoteEvaluationV5 :=
  { partition := { side, status := .incomplete, sources := [], definitionStories := [] }
    scanEvidence := {
      realizations := [], parsedReferences := [],
      parsedDefinitions := [], parsedPoison := [] }
    parsedEvidence := none
    internalReferences := []
    internalDefinitions := []
    internalPoisonReferences := []
    footnotesInventory := zeroCounts
    endnotesInventory := zeroCounts
    footnotesStatus := .notEvaluated
    endnotesStatus := .notEvaluated
    scanStarted := causeScanStarted cause
    intrinsicFailure := causeIntrinsicFailure cause
    localSemanticCrossing := causeLocalCrossing cause }

def sanitizeSide (side : VerifierSide) (evaluation : SideNoteEvaluationV5)
    (cause : Option IncompleteCauseV5) : SideNoteEvaluationV5 :=
  match cause with
  | none => evaluation
  | some value => zeroIncompleteEvaluation side value

def expectedStorySlots (request : VerifierRequestV5)
    (side : VerifierSide) : List StorySlot :=
  let selected := canonicalSelectedStoriesSpec request side
  canonicalSources selected ++ expectedPresentDefinitionStories selected

def expectedRootForSlot (slot : StorySlot) : Option String :=
  match slot.story with
  | .footnotes => some "footnotes"
  | .endnotes => some "endnotes"
  | .main => some "document"
  | .header => some "hdr"
  | .footer => some "ftr"

def firstIntrinsicFailureStage (pkg : PackageView) (slot : StorySlot) :
    Option IntrinsicStage :=
  match partsAtPath slot.normalizedPartPath pkg.parts with
  | [] => some .load
  | part :: parts =>
      if !parts.isEmpty then some .load
      else
      if part.regularEntryCount != 1 || part.loadedBytes.isNone then some .load
      else if part.decodedText.isNone then some .utf8Decode
      else if part.parsedRoot.isNone then some .xmlParse
      else if part.parsedRoot.any (fun root =>
          root.namespaceUri == wmlNamespace &&
          expectedRootForSlot slot == some root.localName) == false then
        some .rootMismatch
      else if !part.fullyScanned || part.events.length > 500000 then some .fullScan
      else none

def causeContextAdmitted (context : GlobalAdmissionContext)
    (side : VerifierSide) : IncompleteCauseV5 → Bool
  | .intrinsicStoryFailure slot stage =>
      storySlotContains slot
        (canonicalSources (context.selectedStories side) ++
          expectedPresentDefinitionStories (context.selectedStories side)) &&
      decide (firstIntrinsicFailureStage (context.packageView side) slot = some stage) &&
      decide (context.firstLocalSemanticCrossing = none)
  | .localSemanticLimitCrossing limit sentinel =>
      decide (context.firstLocalSemanticCrossing =
        some (side, limit, sentinel))
  | .skippedAfterPriorCrossing prior limit sentinel =>
      decide (context.firstLocalSemanticCrossing =
        some (prior, limit, sentinel)) &&
      decide (verifierSideRank prior < verifierSideRank side)

def canonicalGlobalContext (request : VerifierRequestV5) : GlobalAdmissionContext := {
  packageView := request.packageView
  selectedStories := canonicalSelectedStoriesSpec request
  sideOrder
  admissionEvents := canonicalAdmissionEvents request
  firstLocalSemanticCrossing := (canonicalAdmissionEvents request).head?
}

theorem canonical_global_context_exact (request : VerifierRequestV5) :
    GlobalAdmissionContextOf request (canonicalGlobalContext request) :=
  ⟨rfl, fun _ => rfl, fun _ => rfl, rfl, rfl⟩

def causeAdmittedByCanonicalContext (request : VerifierRequestV5)
    (side : VerifierSide) (cause : IncompleteCauseV5) : Bool :=
  causeContextAdmitted (canonicalGlobalContext request) side cause

def selectIncompleteCause (accepted : Bool)
    (cause : IncompleteCauseV5) : Option IncompleteCauseV5 :=
  match accepted with
  | true => some cause
  | false => none

def admitIncompleteCause (requested : Option IncompleteCauseV5)
    (admitted : IncompleteCauseV5 → Bool) : Option IncompleteCauseV5 :=
  match requested with
  | none => none
  | some cause => selectIncompleteCause (admitted cause) cause

theorem admitted_incomplete_cause_exact
    (requested : Option IncompleteCauseV5)
    (admitted : IncompleteCauseV5 → Bool) (cause : IncompleteCauseV5)
    (hAdmit : admitIncompleteCause requested admitted = some cause) :
    admitted cause = true := by
  cases requested with
  | none => exact nomatch hAdmit
  | some requestedCause =>
    change selectIncompleteCause (admitted requestedCause) requestedCause =
      some cause at hAdmit
    cases hAccepted : admitted requestedCause
    · have hChoice :
          selectIncompleteCause (admitted requestedCause) requestedCause = none :=
        congrArg (fun accepted =>
          selectIncompleteCause accepted requestedCause) hAccepted
      exact nomatch hChoice.symm.trans hAdmit
    · have hChoice :
          selectIncompleteCause (admitted requestedCause) requestedCause =
            some requestedCause :=
        congrArg (fun accepted =>
          selectIncompleteCause accepted requestedCause) hAccepted
      have hCause : requestedCause = cause :=
        Option.some.inj (hChoice.symm.trans hAdmit)
      cases hCause
      exact hAccepted

def admittedIncompleteCause (request : VerifierRequestV5)
    (side : VerifierSide) : Option IncompleteCauseV5 :=
  admitIncompleteCause (request.incompleteCause side)
    (causeAdmittedByCanonicalContext request side)

def evaluateAllNoteSidesV5 (request : VerifierRequestV5) : GlobalNoteEvaluationV5 :=
  let context := canonicalGlobalContext request
  { admissionContext := context
    sideEvaluation := fun side =>
      sanitizeSide side
        (evaluateNoteSideV5 (request.packageView side) side
          (canonicalSelectedStoriesSpec request side))
        (admittedIncompleteCause request side)
    incompleteCause := admittedIncompleteCause request }

def IncompleteCauseOf (context : GlobalAdmissionContext) (side : VerifierSide)
    (evaluation : SideNoteEvaluationV5) (cause : IncompleteCauseV5) : Prop :=
  causeContextAdmitted context side cause = true ∧
  evaluation.intrinsicFailure = causeIntrinsicFailure cause ∧
  evaluation.localSemanticCrossing = causeLocalCrossing cause ∧
  evaluation.scanStarted = causeScanStarted cause

def IncompleteSideZeroEvidenceOf (request : VerifierRequestV5)
    (context : GlobalAdmissionContext) (side : VerifierSide)
    (evaluation : SideNoteEvaluationV5) (cause : IncompleteCauseV5) : Prop :=
  GlobalAdmissionContextOf request context ∧
  evaluation.partition.side = side ∧
  evaluation.partition.status = .incomplete ∧
  IncompleteCauseOf context side evaluation cause ∧
  evaluation.internalReferences = [] ∧
  evaluation.internalDefinitions = [] ∧
  evaluation.internalPoisonReferences = [] ∧
  evaluation.parsedEvidence = none ∧
  evaluation.footnotesInventory = zeroCounts ∧
  evaluation.endnotesInventory = zeroCounts ∧
  evaluation.footnotesStatus = .notEvaluated ∧
  evaluation.endnotesStatus = .notEvaluated

theorem sanitize_side_with_admitted_cause
    (side : VerifierSide) (base : SideNoteEvaluationV5)
    (candidate : Option IncompleteCauseV5) (cause : IncompleteCauseV5)
    (hCause : candidate = some cause) :
    sanitizeSide side base candidate = zeroIncompleteEvaluation side cause := by
  cases hCause
  rfl

theorem incomplete_partition_zero_evidence_sound
    (request : VerifierRequestV5) (global : GlobalNoteEvaluationV5)
    (side : VerifierSide) (evaluation : SideNoteEvaluationV5)
    (cause : IncompleteCauseV5)
    (hEvaluateAll :
      evaluateAllNoteSidesV5 request = global)
    (hSide : global.sideEvaluation side = evaluation)
    (hIncomplete : evaluation.partition.status = .incomplete)
    (_hCause : global.incompleteCause side = some cause) :
    IncompleteSideZeroEvidenceOf
      request global.admissionContext side evaluation cause := by
  cases hEvaluateAll
  have hZero := sanitize_side_with_admitted_cause side
    (evaluateNoteSideV5 (request.packageView side) side
      (canonicalSelectedStoriesSpec request side))
    (admittedIncompleteCause request side) cause _hCause
  have hEvaluation :
      zeroIncompleteEvaluation side cause = evaluation :=
    hZero.symm.trans hSide
  cases hEvaluation
  have hAdmitted :
      causeAdmittedByCanonicalContext request side cause = true :=
    admitted_incomplete_cause_exact
      (request.incompleteCause side)
      (causeAdmittedByCanonicalContext request side) cause _hCause
  refine ⟨⟨rfl, fun _ => rfl, fun _ => rfl, rfl, rfl⟩,
      rfl, rfl, ?_, rfl, rfl, rfl, rfl,
      rfl, rfl, rfl, rfl⟩
  exact ⟨hAdmitted, rfl, rfl, rfl⟩

structure VerifierResponseV5 where
  passed : Bool
  globalEvaluation : GlobalNoteEvaluationV5
  genericStoryReports : List StoryReport
  genericStoryReportsPassed : Bool
  noteStoryCount : Nat
  inventoryCount : Nat
  noteInventory : VerifierSide → PackageNoteInventory
  serializedPass : Bool
  serializedBytes : ByteArray

def maxLegalJsonResponseBytes : Nat := 2621440
def maxLegalResponseBytes : Nat := 2621441

def protocolV5ResponseJson (passed : Bool) (fixedStories relationshipSlots
    relationshipStories selectionIssues partitions noteStories inventories
    noteIssues : List Lean.Json) : Lean.Json :=
  Lean.Json.mkObj
    [ ("protocolVersion", toJson (5 : Nat))
    , ("checker", toJson "safe-docx-lean-conventional-main-note-integrity-checker")
    , ("passed", toJson passed)
    , ("fixedStories", Lean.Json.arr fixedStories.toArray)
    , ("presenceMismatches", Lean.Json.arr #[])
    , ("fixedStoryIssues", Lean.Json.arr #[])
    , ("relationshipSlots", Lean.Json.arr relationshipSlots.toArray)
    , ("relationshipStories", Lean.Json.arr relationshipStories.toArray)
    , ("selectionIssues", Lean.Json.arr selectionIssues.toArray)
    , ("referenceSourcePartitions", Lean.Json.arr partitions.toArray)
    , ("noteStories", Lean.Json.arr noteStories.toArray)
    , ("noteInventories", Lean.Json.arr inventories.toArray)
    , ("noteIntegrityIssues", Lean.Json.arr noteIssues.toArray)
    ]

def finalizeProtocolV5Response (response : Lean.Json) : Except String ByteArray :=
  let jsonBytes := response.compress.toUTF8
  let stdout := jsonBytes ++ "\n".toUTF8
  if jsonBytes.size > maxLegalJsonResponseBytes ||
      stdout.size > maxLegalResponseBytes then
    .error "protocol response exceeds the protocol-v5 legal envelope"
  else .ok stdout

def FinalizedProductionResponseOf (response : Lean.Json)
    (stdout : ByteArray) : Prop :=
  stdout = response.compress.toUTF8 ++ "\n".toUTF8 ∧
  response.compress.toUTF8.size ≤ maxLegalJsonResponseBytes ∧
  stdout.size ≤ maxLegalResponseBytes

theorem production_protocol_v5_serialization_exact
    (response : Lean.Json) (stdout : ByteArray)
    (hFinalize : finalizeProtocolV5Response response = .ok stdout) :
    FinalizedProductionResponseOf response stdout := by
  unfold finalizeProtocolV5Response at hFinalize
  let jsonBytes := response.compress.toUTF8
  let expected := jsonBytes ++ "\n".toUTF8
  change (if jsonBytes.size > maxLegalJsonResponseBytes ||
      expected.size > maxLegalResponseBytes then
      Except.error _ else Except.ok expected) = Except.ok stdout at hFinalize
  by_cases h : jsonBytes.size > maxLegalJsonResponseBytes ||
      expected.size > maxLegalResponseBytes
  · rw [if_pos h] at hFinalize
    contradiction
  · rw [if_neg h] at hFinalize
    have hEq : expected = stdout := Except.ok.inj hFinalize
    subst stdout
    simp only [Bool.or_eq_true, decide_eq_true_eq] at h
    have hJson : jsonBytes.size ≤ maxLegalJsonResponseBytes :=
      Nat.le_of_not_gt (fun over => h (Or.inl over))
    have hStdout : expected.size ≤ maxLegalResponseBytes :=
      Nat.le_of_not_gt (fun over => h (Or.inr over))
    exact ⟨rfl, hJson, hStdout⟩

def genericReportFieldsPass (report : StoryReport) : Bool :=
  report.report.acceptPreservesFieldStructure &&
  report.report.rejectPreservesFieldStructure &&
  report.report.acceptTextMatchesRevised &&
  report.report.rejectTextMatchesOriginal &&
  report.report.combinedHasNoFldCharInsideDel &&
  report.report.combinedHasValidMoveRanges

def genericReportsStructurallyPass : List StoryReport → Bool
  | [] => true
  | report :: reports =>
      genericReportFieldsPass report && genericReportsStructurallyPass reports

def AggregatePassOf (request : VerifierRequestV5)
    (response : VerifierResponseV5) : Prop :=
  GlobalAdmissionContextOf request response.globalEvaluation.admissionContext ∧
  response.genericStoryReports = request.genericStoryReports ∧
  response.genericStoryReportsPassed = true ∧
  genericReportsStructurallyPass response.genericStoryReports = true ∧
  response.noteStoryCount = 2 ∧
  response.inventoryCount = 6 ∧
  (∀ side kind selected,
    selectedNoteForKind
      (response.globalEvaluation.admissionContext.selectedStories side) kind =
        some selected →
    SelectedNoteIdentityOf (request.packageView side) kind selected) ∧
  (∀ side,
    (response.globalEvaluation.sideEvaluation side).partition.status = .complete ∧
    (response.globalEvaluation.sideEvaluation side).footnotesStatus = .passed ∧
    (response.globalEvaluation.sideEvaluation side).endnotesStatus = .passed ∧
    (response.globalEvaluation.sideEvaluation side).parsedEvidence.isSome = true) ∧
  (∀ side, response.noteInventory side = derivedPackageInventory request side) ∧
  PackageNoteIntegrity (response.noteInventory .original) ∧
  PackageNoteIntegrity (response.noteInventory .revised) ∧
  PackageNoteIntegrity (response.noteInventory .compared)

def boolText : Bool → String
  | true => "true"
  | false => "false"

def partitionStatusText : PartitionStatus → String
  | .complete => "complete"
  | .incomplete => "incomplete"

def evaluationStatusText : EvaluationStatus → String
  | .passed => "passed"
  | .failed => "failed"
  | .notEvaluated => "not_evaluated"

def emptinessEvidenceText (values : List α) : String :=
  boolText values.isEmpty

def natIsTwo : Nat → Bool
  | 2 => true
  | _ => false

def natIsSix : Nat → Bool
  | 6 => true
  | _ => false

def boolByte : Bool → UInt8
  | true => 1
  | false => 0

def canonicalResponseBytes (response : VerifierResponseV5) : ByteArray :=
  let bytes := ByteArray.empty.push 5
  let bytes := bytes.push (boolByte response.serializedPass)
  let bytes := bytes.push (boolByte response.genericStoryReportsPassed)
  let bytes := bytes.push (boolByte response.genericStoryReports.isEmpty)
  let bytes := bytes.push (boolByte (natIsTwo response.noteStoryCount))
  bytes.push (boolByte (natIsSix response.inventoryCount))

theorem canonical_response_bytes_ignores_serialized_bytes
    (response : VerifierResponseV5) (bytes : ByteArray) :
    canonicalResponseBytes { response with serializedBytes := bytes } =
      canonicalResponseBytes response := by
  rfl

def SerializedResponseOf (response : VerifierResponseV5)
    (stdout : ByteArray) : Prop :=
  stdout = response.serializedBytes ∧
  stdout = canonicalResponseBytes response ∧
  response.serializedPass = response.passed ∧
  stdout.size ≤ 2621440

def SideEvaluationPassed (evaluation : SideNoteEvaluationV5) : Prop :=
  evaluation.partition.status = .complete ∧
  evaluation.footnotesStatus = .passed ∧
  evaluation.endnotesStatus = .passed ∧
  evaluation.parsedEvidence.isSome = true

instance sideEvaluationPassedDecidable (evaluation : SideNoteEvaluationV5) :
    Decidable (SideEvaluationPassed evaluation) := by
  unfold SideEvaluationPassed
  infer_instance

def sideEvaluationPassed (evaluation : SideNoteEvaluationV5) : Bool :=
  decide (SideEvaluationPassed evaluation)

def aggregateRequestPass (request : VerifierRequestV5) : Bool :=
  let global := evaluateAllNoteSidesV5 request
  let inventory := derivedPackageInventory request
  genericReportsStructurallyPass request.genericStoryReports &&
  sideEvaluationPassed (global.sideEvaluation .original) &&
  sideEvaluationPassed (global.sideEvaluation .revised) &&
  sideEvaluationPassed (global.sideEvaluation .compared) &&
  checkPackageNoteIntegrity (inventory .original) &&
  checkPackageNoteIntegrity (inventory .revised) &&
  checkPackageNoteIntegrity (inventory .compared)

theorem and_true_components (left right : Bool)
    (h : (left && right) = true) : left = true ∧ right = true := by
  cases left <;> cases right <;> first | exact ⟨rfl, rfl⟩ | exact nomatch h

structure ProductionAggregateChecks where
  noTerminalIssue : Bool
  noSelectionIssues : Bool
  noNoteIssues : Bool
  fixedStoriesPass : Bool
  relationshipStoriesPass : Bool
  semanticPartitionsComplete : Bool
  semanticNoteStoriesPass : Bool
  inventoriesPass : Bool
  productionNoteIntegrityPass : Bool
  semanticModelPass : Bool
  deriving Repr, Inhabited

def productionAggregatePass (checks : ProductionAggregateChecks) : Bool :=
  checks.semanticModelPass &&
  (checks.noTerminalIssue &&
  (checks.noSelectionIssues &&
  (checks.noNoteIssues &&
  (checks.fixedStoriesPass &&
  (checks.relationshipStoriesPass &&
  (checks.semanticPartitionsComplete &&
  (checks.semanticNoteStoriesPass &&
  (checks.inventoriesPass &&
  checks.productionNoteIntegrityPass))))))))

def ProductionAggregatePassOf (checks : ProductionAggregateChecks) : Prop :=
  checks.noTerminalIssue = true ∧
  checks.noSelectionIssues = true ∧
  checks.noNoteIssues = true ∧
  checks.fixedStoriesPass = true ∧
  checks.relationshipStoriesPass = true ∧
  checks.semanticPartitionsComplete = true ∧
  checks.semanticNoteStoriesPass = true ∧
  checks.inventoriesPass = true ∧
  checks.productionNoteIntegrityPass = true ∧
  checks.semanticModelPass = true

theorem production_aggregate_pass_exact (checks : ProductionAggregateChecks)
    (hPass : productionAggregatePass checks = true) :
    ProductionAggregatePassOf checks := by
  unfold productionAggregatePass at hPass
  have h1 := and_true_components _ _ hPass
  have h2 := and_true_components _ _ h1.2
  have h3 := and_true_components _ _ h2.2
  have h4 := and_true_components _ _ h3.2
  have h5 := and_true_components _ _ h4.2
  have h6 := and_true_components _ _ h5.2
  have h7 := and_true_components _ _ h6.2
  have h8 := and_true_components _ _ h7.2
  have h9 := and_true_components _ _ h8.2
  exact ⟨h2.1, h3.1, h4.1, h5.1, h6.1, h7.1, h8.1, h9.1, h9.2, h1.1⟩

def finalizeVerifierResponseV5 (response : VerifierResponseV5)
    (bytes : ByteArray) :
    Except String (VerifierResponseV5 × ByteArray) :=
  match decide (bytes.size ≤ 2621440) with
  | true => .ok (response, bytes)
  | false => .error "serialized response exceeds protocol-v5 limit"

theorem finalize_verifier_response_v5_exact
    (response actual : VerifierResponseV5) (bytes stdout : ByteArray)
    (hFinalize :
      finalizeVerifierResponseV5 response bytes = .ok (actual, stdout)) :
    actual = response ∧ stdout = bytes ∧ bytes.size ≤ 2621440 := by
  unfold finalizeVerifierResponseV5 at hFinalize
  cases hBound : decide (bytes.size ≤ 2621440)
  · simp only [hBound] at hFinalize
    exact nomatch hFinalize
  · simp only [hBound] at hFinalize
    cases hFinalize
    exact ⟨rfl, rfl, of_decide_eq_true hBound⟩

def canonicalSemanticResponse (request : VerifierRequestV5) :
    Except String (VerifierResponseV5 × ByteArray) :=
  let global := evaluateAllNoteSidesV5 request
  let genericReports := request.genericStoryReports
  let inventory := derivedPackageInventory request
  let passed := aggregateRequestPass request
  let provisional : VerifierResponseV5 := {
    passed
    globalEvaluation := global
    genericStoryReports := genericReports
    genericStoryReportsPassed := genericReportsStructurallyPass genericReports
    noteStoryCount := 2
    inventoryCount := 6
    noteInventory := inventory
    serializedPass := passed
    serializedBytes := ByteArray.empty
  }
  let bytes := canonicalResponseBytes provisional
  let response := { provisional with serializedBytes := bytes }
  finalizeVerifierResponseV5 response bytes

def executeRequestV5 (request : VerifierRequestV5) :
    Except String (VerifierResponseV5 × ByteArray) :=
  let reports := checkStoryCollection request.genericStories
  canonicalSemanticResponse { request with genericStoryReports := reports }

theorem canonical_semantic_response_fields_exact
    (request : VerifierRequestV5) (response : VerifierResponseV5)
    (stdout : ByteArray)
    (hRun : canonicalSemanticResponse request = .ok (response, stdout)) :
    response.globalEvaluation = evaluateAllNoteSidesV5 request ∧
    (∀ side, response.noteInventory side = derivedPackageInventory request side) := by
  unfold canonicalSemanticResponse at hRun
  dsimp only at hRun
  have hFinal := finalize_verifier_response_v5_exact _ _ _ _ hRun
  rcases hFinal with ⟨rfl, rfl, _⟩
  exact ⟨rfl, fun _ => rfl⟩

set_option maxHeartbeats 1000000 in
set_option maxRecDepth 10000 in
theorem note_integrity_aggregate_pass_sound
    (request : VerifierRequestV5) (response : VerifierResponseV5)
    (stdout : ByteArray)
    (hRun :
      canonicalSemanticResponse request = .ok (response, stdout))
    (_hPass : response.passed = true) :
    AggregatePassOf request response ∧
    SerializedResponseOf response stdout := by
  unfold canonicalSemanticResponse at hRun
  dsimp only at hRun
  have hFinal := finalize_verifier_response_v5_exact _ _ _ _ hRun
  rcases hFinal with ⟨rfl, rfl, hBound⟩
  have hAggregate := _hPass
  change aggregateRequestPass request = true at hAggregate
  unfold aggregateRequestPass at hAggregate
  let global := evaluateAllNoteSidesV5 request
  let originalSide := sideEvaluationPassed (global.sideEvaluation .original)
  let revisedSide := sideEvaluationPassed (global.sideEvaluation .revised)
  let comparedSide := sideEvaluationPassed (global.sideEvaluation .compared)
  let genericB := genericReportsStructurallyPass request.genericStoryReports
  let originalB := checkPackageNoteIntegrity (derivedPackageInventory request .original)
  let revisedB := checkPackageNoteIntegrity (derivedPackageInventory request .revised)
  let comparedB := checkPackageNoteIntegrity (derivedPackageInventory request .compared)
  change ((((((genericB && originalSide) && revisedSide) &&
    comparedSide) && originalB) && revisedB) && comparedB) = true at hAggregate
  have h1 := and_true_components _ _ hAggregate
  have hCompared := h1.2
  have h2 := and_true_components _ _ h1.1
  have hRevised := h2.2
  have h3 := and_true_components _ _ h2.1
  have hOriginal := h3.2
  have h4 := and_true_components _ _ h3.1
  have hComparedSide := h4.2
  have h5 := and_true_components _ _ h4.1
  have hRevisedSide := h5.2
  have h6 := and_true_components _ _ h5.1
  have hOriginalSide := h6.2
  have hGeneric := h6.1
  have hOriginalFields : let evaluation := global.sideEvaluation .original
      evaluation.partition.status = .complete ∧
      evaluation.footnotesStatus = .passed ∧
      evaluation.endnotesStatus = .passed ∧
      evaluation.parsedEvidence.isSome = true := by
    exact of_decide_eq_true hOriginalSide
  have hRevisedFields : let evaluation := global.sideEvaluation .revised
      evaluation.partition.status = .complete ∧
      evaluation.footnotesStatus = .passed ∧
      evaluation.endnotesStatus = .passed ∧
      evaluation.parsedEvidence.isSome = true := by
    exact of_decide_eq_true hRevisedSide
  have hComparedFields : let evaluation := global.sideEvaluation .compared
      evaluation.partition.status = .complete ∧
      evaluation.footnotesStatus = .passed ∧
      evaluation.endnotesStatus = .passed ∧
      evaluation.parsedEvidence.isSome = true := by
    exact of_decide_eq_true hComparedSide
  refine ⟨?_, ?_⟩
  · refine ⟨?_, rfl, hGeneric, ?_, rfl, rfl, ?_, ?_, fun _ => rfl,
      package_note_reference_integrity_sound _ hOriginal,
      package_note_reference_integrity_sound _ hRevised,
      package_note_reference_integrity_sound _ hCompared⟩
    · exact ⟨rfl, fun _ => rfl, fun _ => rfl, rfl, rfl⟩
    · exact hGeneric
    · intro side kind selected hSelected
      exact canonical_selected_note_sound request side kind selected hSelected
    · intro side
      cases side
      · exact hOriginalFields
      · exact hRevisedFields
      · exact hComparedFields
  · refine ⟨rfl, ?_, rfl, hBound⟩
    exact (canonical_response_bytes_ignores_serialized_bytes _ _).symm

end NoteReferenceIntegrity
end Tier2
