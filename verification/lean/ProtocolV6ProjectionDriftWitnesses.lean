import LeanDocxChecker

open Lean Tier2.XmlTripleChecker Tier2.RelationshipStorySelector
  Tier2.NoteReferenceIntegrity Tier2.CommentReferenceIntegrity

namespace ProtocolV6ProjectionDriftWitnesses

def fixturePackageBytes : ByteArray := ByteArray.mk #[
  80,75,3,4,10,0,0,0,0,0,166,88,251,92,76,215,97,195,105,0,0,0,105,0,0,0,
  17,0,0,0,119,111,114,100,47,100,111,99,117,109,101,
  110,116,46,120,109,108,60,119,58,100,111,99,117,109,101,110,116,32,120,109,
  108,110,115,58,119,61,34,104,116,116,112,58,47,47,115,99,104,101,109,97,115,
  46,111,112,101,110,120,109,108,102,111,114,109,97,116,115,46,111,114,103,47,
  119,111,114,100,112,114,111,99,101,115,115,105,110,103,109,108,47,50,48,48,
  54,47,109,97,105,110,34,62,60,119,58,98,111,100,121,47,62,60,47,119,58,100,
  111,99,117,109,101,110,116,62,80,75,1,2,20,0,10,0,0,0,0,0,166,88,251,92,
  76,215,97,195,105,0,0,0,105,0,0,0,17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  119,111,114,100,47,100,111,99,117,109,101,110,116,46,120,109,108,80,75,5,6,
  0,0,0,0,1,0,1,0,63,0,0,0,152,0,0,0,0,0]

def fixtureXml : String :=
  "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body/></w:document>"

def fixtureExtraction : Except String SnapshotExtractionEvidence :=
  match hIndex : buildZipIndex fixturePackageBytes with
  | .error detail => .error detail
  | .ok index =>
    match hFind : index.find? "word/document.xml" with
    | none => .error "fixture lacks word/document.xml"
    | some entry =>
      if hSize : fixtureXml.toUTF8.size = entry.expandedSize then
        if hCrc : crc32 fixtureXml.toUTF8 = entry.crc32 then
          .ok {
            packageBytes := fixturePackageBytes
            snapshotBytes := fixturePackageBytes
            snapshotPath := "/supervisor-owned/package-fixture/package.docx"
            snapshotWriteCount := 1
            zipIndex := index
            zipIndexExact := hIndex
            selectedPartPath := "word/document.xml"
            entry
            selectedEntryExact := hFind
            centralOffset := index.centralOffset
            centralSize := index.centralSize
            compressedPayload :=
              fixturePackageBytes.extract entry.dataOffset entry.localSpanEnd
            decompressedBytes := fixtureXml.toUTF8
            extractionInvocationCount := 1
            externalDecompressionTrusted := true
            snapshotBytesExact := rfl
            compressedPayloadExact := rfl
            decompressedSizeExact := hSize
            decompressedCrcExact := hCrc
          }
        else .error "fixture CRC mismatch"
      else .error "fixture size mismatch"

def fixtureParseEvidence : Except String ProductionParseEvidence := do
  let extraction ← fixtureExtraction
  match hParse :
      parseXmlEventsForRootBoundedTyped fixtureXml wmlNamespace "document" 100 32 with
  | .error _ => .error "fixture XML parse failed"
  | .ok parsed =>
    .ok {
      packagePath := "/request-bound/fixture.docx"
      packageBytes := fixturePackageBytes
      extraction
      normalizedPartPath := "word/document.xml"
      entryName := extraction.entry.name
      entryCompressedSize := extraction.entry.compressedSize
      entryExpandedSize := extraction.entry.expandedSize
      entryCrc32 := extraction.entry.crc32
      extractedBytes := fixtureXml.toUTF8
      bytes := fixtureXml.toUTF8
      text := fixtureXml
      expectedRootUri := wmlNamespace
      expectedRootLocalName := "document"
      eventLimit := 100
      depthLimit := 32
      parsed
      parseInvocationCount := 1
      parseResultExact := hParse
    }

def passedInventory (side : Tier2.RelationshipStorySelector.VerifierSide)
    (kind : Tier2.ConventionalMainNoteSelector.NoteKind) : NoteInventoryEvidence :=
  inventoryEvidence side kind "passed" none 0 0 (0, 0, 0, 0) 0

def fixtureSide (side : Tier2.RelationshipStorySelector.VerifierSide)
    (parseEvidence : ProductionParseEvidence)
    (issues : List Json := []) : NoteSideEvidence := {
  side
  sources := [{
    sourceOrdinal := 0
    sourceStory := "main"
    sourceStoryOrdinal := 0
    normalizedPartPath := "word/document.xml"
    parseEvidence
  }]
  footnotesIdentity := none
  endnotesIdentity := none
  footnotesPartPresent := false
  endnotesPartPresent := false
  footnotesPart := none
  endnotesPart := none
  retainedScan := some (retainProductionNoteScan {
    validSourceEvents := [(0, parseEvidence.parsed.events)]
    footnoteDefinitionEvents := []
    endnoteDefinitionEvents := []
  })
  complete := true
  semanticLimitCrossed := false
  productionIntegrityPassed := true
  usage := { xmlEvents := parseEvidence.parsed.events.length }
  issues
  footnotesInventory := passedInventory side
    Tier2.ConventionalMainNoteSelector.NoteKind.footnotes
  endnotesInventory := passedInventory side
    Tier2.ConventionalMainNoteSelector.NoteKind.endnotes
}

def fixtureRecord (side : Tier2.RelationshipStorySelector.VerifierSide)
    (parseEvidence : ProductionParseEvidence)
    (packageIndexExact :
      IndependentBinaryIndexOf fixturePackageBytes parseEvidence.extraction.zipIndex)
    (issues : List Json := []) :
    RunRequestPackageRecord := {
  packagePath := "/request-bound/fixture.docx"
  packageBytes := fixturePackageBytes
  packageReadCount := 1
  packageIndex := parseEvidence.extraction.zipIndex
  packageIndexExact
  snapshotPath := parseEvidence.extraction.snapshotPath
  snapshotBytes := fixturePackageBytes
  snapshotWriteCount := 1
  snapshotWriteCountExact := rfl
  snapshotBytesExact := rfl
  relationships := []
  noteEvidence := fixtureSide side parseEvidence issues
  commentEvidence := {
    side
    sources := (fixtureSide side parseEvidence issues).sources
    sourcePartitionAdmitted := true
    realizationFailureCode := none
    realizationFailureDetail := none
    identity := none
    partPresent := false
    part := none
    retainedScan := some (Tier2.CommentReferenceIntegrity.retainCommentScanEvidence {
      sourceEvents := [(0, parseEvidence.parsed.events)]
      definitionEvents := []
    })
    complete := true
    semanticLimitCrossed := false
    productionIntegrityPassed := true
    usage := (fixtureSide side parseEvidence issues).usage
    tripleUsage := {}
    issues := []
    inventory := {
      side
      status := "passed"
      identity := none
      referenceOccurrences := 0
      uniqueReferenceIds := 0
      definitions := 0
      unreferencedDefinitions := 0
      nonDirectDefinitions := 0
    }
  }
}

def mainTriple (parseEvidence : ProductionParseEvidence) : NamedStoryTriple := {
  name := "main"
  original := tokensFromXmlEvents parseEvidence.parsed.events
  revised := tokensFromXmlEvents parseEvidence.parsed.events
  combined := tokensFromXmlEvents parseEvidence.parsed.events
}

def issue (ordinal : Nat) : SelectionIssue := {
  code := "AGGREGATE_COMPRESSED_LIMIT_EXCEEDED"
  side := some .original
  detail := s!"aggregate compressed limit witness {ordinal}"
}

def fixtureRequest (selectionIssues : List SelectionIssue := []) :
    Except String RunRequestCoreRequest := do
  let parseEvidence ← fixtureParseEvidence
  if hIndependent :
      independentBinaryIndexCheck fixturePackageBytes
        parseEvidence.extraction.zipIndex = true then
    let packageIndexExact :=
      independent_binary_index_check_sound fixturePackageBytes
        parseEvidence.extraction.zipIndex hIndependent
    return {
      fixedTriples := [mainTriple parseEvidence]
      relationshipSlots := []
      relationshipStories := []
      relationshipTriples := []
      selectionIssues
      original := fixtureRecord .original parseEvidence packageIndexExact
      revised := fixtureRecord .revised parseEvidence packageIndexExact
      compared := fixtureRecord .compared parseEvidence packageIndexExact
    }
  else
    throw "fixture package index failed independent validation"

def evaluateProductionCase (request : RunRequestCoreRequest) :
    Except String RunRequestCoreResult := do
  let semanticRequest := semanticRequestOfCore request
  let (semanticResponse, semanticStdout) ← canonicalSemanticResponse semanticRequest
  let result ← finishRunRequestCore request semanticRequest semanticResponse
    semanticStdout
  if protocolV6JsonProjectionCheck result.response result.responsePassed then
    return result
  else
    throw "production response diverges from typed protocol-v6 projection"

def fieldValue (value : Json) (field : String) : Json :=
  (value.getObjVal? field).toOption.getD Json.null

def rebuildFields (value : Json) (replace : String → String × Json) : Json :=
  Json.mkObj <| protocolV6FieldNames.map fun field =>
    let replacement := replace field
    (replacement.1, if replacement.2 == Json.null then fieldValue value field else replacement.2)

def replaceField (value : Json) (field : String) (replacement : Json) : Json :=
  rebuildFields value fun current =>
    if current == field then (current, replacement) else (current, Json.null)

def renameField (value : Json) (field renamed : String) : Json :=
  rebuildFields value fun current =>
    if current == field then (renamed, fieldValue value current) else (current, Json.null)

def omitField (value : Json) (field : String) : Json :=
  Json.mkObj <| (protocolV6FieldNames.filter (· != field)).map fun current =>
    (current, fieldValue value current)

def reverseArrayField (value : Json) (field : String) : Json :=
  match fieldValue value field with
  | .arr values => replaceField value field (.arr values.reverse)
  | _ => value

def allProtocolFieldsPresent (value : Json) : Bool :=
  match value.getObj? with
  | .error _ => false
  | .ok object =>
    object.keys.length == protocolV6FieldNames.length &&
      protocolV6FieldNames.all fun field => (value.getObjVal? field).isOk

def baselineAgrees (requestResult : Except String RunRequestCoreRequest) : Bool :=
  match requestResult with
  | .error _ => false
  | .ok request => match evaluateProductionCase request with
  | .error _ => false
  | .ok result =>
    result.responsePassed &&
    result.response == semanticProtocolV6Projection request result.semanticResponse &&
    allProtocolFieldsPresent result.response &&
    fieldValue result.response "protocolVersion" == toJson (6 : Nat) &&
    fieldValue result.response "checker" ==
      toJson "safe-docx-lean-conventional-main-comment-integrity-checker" &&
    fieldValue result.response "passed" == toJson true &&
    (fieldValue result.response "fixedStories").getArr?.toOption.any (·.size == 1) &&
    (fieldValue result.response "referenceSourcePartitions").getArr?.toOption.any (·.size == 3) &&
    (fieldValue result.response "noteStories").getArr?.toOption.any (·.size == 2) &&
    (fieldValue result.response "noteInventories").getArr?.toOption.any (·.size == 6) &&
    (fieldValue result.response "commentInventories").getArr?.toOption.any (·.size == 3)

def ordinaryRequest : Except String RunRequestCoreRequest := fixtureRequest
def duplicateIssueRequest : Except String RunRequestCoreRequest :=
  fixtureRequest [issue 0, issue 0]
def budgetRequest : Except String RunRequestCoreRequest :=
  fixtureRequest ((List.range 512).map issue)

def mutationDisagrees (requestResult : Except String RunRequestCoreRequest)
    (mutate : RunRequestCoreRequest → RunRequestCoreResult → Json) : Bool :=
  match requestResult with
  | .error _ => false
  | .ok request => match evaluateProductionCase request with
  | .error _ => false
  | .ok result =>
    let expected := semanticProtocolV6Projection request result.semanticResponse
    result.response == expected && mutate request result != expected

def coalescingMutation (_request : RunRequestCoreRequest)
    (result : RunRequestCoreResult) : Json :=
  replaceField result.response "selectionIssues"
    (.arr #[selectionIssueJson (issue 0), selectionIssueJson (issue 0)])

def budgetMutation (request : RunRequestCoreRequest)
    (result : RunRequestCoreResult) : Json :=
  buildRunRequestCoreJson
    { request with selectionIssues := request.selectionIssues.take 511 }
    result.semanticResponse

def terminalShapeMutation (_request : RunRequestCoreRequest)
    (result : RunRequestCoreResult) : Json :=
  replaceField result.response "selectionIssues" (.arr #[selectionIssueJson (issue 0)])

def witnessResults : List (String × Bool) :=
  [ ("baseline", baselineAgrees ordinaryRequest)
  , ("field-name", mutationDisagrees ordinaryRequest fun _ result =>
      renameField result.response "checker" "checkerName")
  , ("field-value", mutationDisagrees ordinaryRequest fun _ result =>
      replaceField result.response "checker" "mutant-checker")
  , ("inherited-field-omitted", mutationDisagrees ordinaryRequest fun _ result =>
      omitField result.response "fixedStories")
  , ("inherited-field-mutated", mutationDisagrees ordinaryRequest fun _ result =>
      replaceField result.response "fixedStories" (.arr #[]))
  , ("array-order", mutationDisagrees ordinaryRequest fun _ result =>
      reverseArrayField result.response "noteStories")
  , ("comment-story", mutationDisagrees ordinaryRequest fun _ result =>
      replaceField result.response "commentStory" (toJson false))
  , ("comment-inventory-order", mutationDisagrees ordinaryRequest fun _ result =>
      reverseArrayField result.response "commentInventories")
  , ("comment-issues", mutationDisagrees ordinaryRequest fun _ result =>
      replaceField result.response "commentIntegrityIssues"
        (.arr #[commentIssueJson "COMMENT_DEFINITION_MISSING"
          "drift witness" .original "reference" 0 "main" 0]))
  , ("comment-issues-omitted", mutationDisagrees ordinaryRequest fun _ result =>
      omitField result.response "commentIntegrityIssues")
  , ("issue-coalescing", mutationDisagrees duplicateIssueRequest coalescingMutation)
  , ("issue-budget", mutationDisagrees budgetRequest budgetMutation)
  , ("terminal-shape", mutationDisagrees budgetRequest terminalShapeMutation)
  ]

def run : IO Unit := do
  for (name, passed) in witnessResults do
    unless passed do
      throw (IO.userError s!"realizable protocol-v6 production drift witness failed: {name}")
  IO.println s!"realizable protocol-v6 production drift witnesses passed: {witnessResults.length - 1}"

end ProtocolV6ProjectionDriftWitnesses

#eval ProtocolV6ProjectionDriftWitnesses.run
