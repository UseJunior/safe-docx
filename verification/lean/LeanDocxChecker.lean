import Lean.Data.Json
import Tier2.RelationshipStorySelector

open Lean Tier2.XmlTripleChecker Tier2.RelationshipStorySelector

structure Request where
  originalDocxPath : String
  revisedDocxPath : String
  comparedDocxPath : String

def requestFromJson (j : Json) : Except String Request := do
  let object ← j.getObj?
  if object.keys != ["comparedDocxPath", "originalDocxPath", "protocolVersion",
      "revisedDocxPath"] then
    throw "protocol v4 request has unknown or missing keys"
  let protocolVersion ← j.getObjValAs? Nat "protocolVersion"
  if protocolVersion != 4 then throw s!"unsupported protocolVersion: {protocolVersion}"
  return {
    originalDocxPath := (← j.getObjValAs? String "originalDocxPath")
    revisedDocxPath := (← j.getObjValAs? String "revisedDocxPath")
    comparedDocxPath := (← j.getObjValAs? String "comparedDocxPath")
  }

def maxDiagnosticBytes : Nat := 64 * 1024
def maxResponseBytes : Nat := 8 * 1024 * 1024
def maxRequestBytes : Nat := 64 * 1024
def maxCumulativeCompressedBytes : Nat := 16 * 1024 * 1024
def maxCumulativeExpandedBytes : Nat := 32 * 1024 * 1024
def maxCumulativeXmlEvents : Nat := 1000000
def maxTripleCumulativeCompressedBytes : Nat := 3 * maxCumulativeCompressedBytes
def maxTripleCumulativeExpandedBytes : Nat := 3 * maxCumulativeExpandedBytes
def maxTripleSelectedParts : Nat := 3 * maxSelectedParts
def maxIssues : Nat := 1536
def maxEvidenceStringBytes : Nat := 1024 * 1024
def terminalIssueReserveBytes : Nat := 512

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

structure Package where
  path : String
  bytes : ByteArray
  index : ZipIndex

def loadPackage (path : String) : IO Package := do
  let bytes ← IO.FS.readBinFile path
  let index ← match buildZipIndex bytes with
    | .ok index => pure index
    | .error detail => throw (IO.userError s!"package index failed for {path}: {detail}")
  return { path, bytes, index }

inductive ExtractedPart where
  | missing
  | present (bytes : ByteArray) (entry : ZipEntry)

def decodeDiagnostics (bytes : ByteArray) : String :=
  (String.fromUTF8? bytes).getD "<non-UTF-8 diagnostics>"

def extractPart (package : Package) (partPath : String) : IO ExtractedPart := do
  let some entry := package.index.find? partPath | return .missing
  let output ← runBounded "unzip" #["-p", "--", package.path, entry.name]
    entry.expandedSize
  if output.exitCode != 0 then
    throw (IO.userError s!"archive extraction failed for {partPath}: {decodeDiagnostics output.stderr}")
  if output.stdout.size != entry.expandedSize then
    throw (IO.userError s!"archive extraction size mismatch for {partPath}")
  if crc32 output.stdout != entry.crc32 then
    throw (IO.userError s!"archive extraction CRC mismatch for {partPath}")
  return .present output.stdout entry

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

def selectionIssueStringBytes (issue : SelectionIssue) : Nat :=
  utf8Bytes issue.code + utf8Bytes (boundUtf8 issue.detail 256) +
    (issue.side.map (utf8Bytes ∘ VerifierSide.toString)).getD 0 +
    (issue.kind.map (utf8Bytes ∘ StoryKind.toString)).getD 0 +
    (issue.role.map (utf8Bytes ∘ StoryRole.toString)).getD 0 +
    (issue.relationshipId.map utf8Bytes).getD 0 +
    (issue.rawTarget.map utf8Bytes).getD 0 +
    (issue.normalizedPartPath.map utf8Bytes).getD 0

def slotStringBytes (slot : AlignedSlot) : Nat :=
  utf8Bytes slot.kind.toString + utf8Bytes slot.role.toString +
    utf8Bytes slot.original.relationshipId + utf8Bytes slot.original.normalizedPartPath +
    utf8Bytes slot.revised.relationshipId + utf8Bytes slot.revised.normalizedPartPath +
    utf8Bytes slot.compared.relationshipId + utf8Bytes slot.compared.normalizedPartPath

def physicalStoryStringBytes (story : PhysicalStory) : Nat :=
  utf8Bytes story.kind.toString + utf8Bytes story.originalPartPath +
    utf8Bytes story.revisedPartPath + utf8Bytes story.comparedPartPath

def evidenceStringBytes (fixedIssues : List Json) (selectionIssues : List SelectionIssue)
    (slots : List AlignedSlot) (stories : List PhysicalStory) : Nat :=
  -- Fixed issue JSON has bounded fields and at most six records. Counting its complete
  -- encoding is conservative for the variable-string budget.
  (fixedIssues.map (utf8Bytes ∘ Json.compress)).sum +
    (selectionIssues.map selectionIssueStringBytes).sum +
    (slots.map slotStringBytes).sum +
    (stories.map physicalStoryStringBytes).sum

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
  | .present bytes _ =>
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

structure LoadedPhysicalStory where
  work : LoadedPhysicalWork
  usage : ResourceUsage

structure SelectedSideLoad where
  result : Except SelectionIssue (List XmlTok × Nat)
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
  | .present bytes _ =>
    let some xml := String.fromUTF8? bytes |
      return {
        result := .error (selectedPartIssue side story "INVALID_UTF8"
          "selected relationship target bytes are not valid UTF-8" path)
        aggregateStopped := false
      }
    let remaining := maxCumulativeXmlEvents - min maxCumulativeXmlEvents usedEvents
    let eventLimit := min maxXmlEventsPerPart remaining
    match parseXmlEventsForRootBoundedTyped xml wmlNamespace story.kind.rootName
        eventLimit maxXmlDepth with
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
    | .ok parsed =>
      return {
        result := .ok (tokensFromXmlEvents parsed.events, parsed.eventCount)
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
    | .ok parsed => addEventUsage initialUsage .original parsed.2
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
    | .ok parsed => addEventUsage usageAfterOriginal .revised parsed.2
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
    | .ok parsed => addEventUsage usageAfterRevised .compared parsed.2
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
        original := originalParsed.1
        revised := revisedParsed.1
        combined := combinedParsed.1
      }
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
  | .present bytes _ =>
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
  let .present originalBytes _ := originalPart |
    throw (IO.userError "required original word/document.xml is missing")
  let .present revisedBytes _ := revisedPart |
    throw (IO.userError "required revised word/document.xml is missing")
  let .present comparedBytes _ := comparedPart |
    throw (IO.userError "required compared word/document.xml is missing")
  let some originalXml := String.fromUTF8? originalBytes |
    throw (IO.userError "required original word/document.xml is not valid UTF-8")
  let some revisedXml := String.fromUTF8? revisedBytes |
    throw (IO.userError "required revised word/document.xml is not valid UTF-8")
  let some comparedXml := String.fromUTF8? comparedBytes |
    throw (IO.userError "required compared word/document.xml is not valid UTF-8")
  let originalTokens ← IO.ofExcept (mainTokens originalXml)
  let revisedTokens ← IO.ofExcept (mainTokens revisedXml)
  let comparedTokens ← IO.ofExcept (mainTokens comparedXml)
  let originalInventory ← IO.ofExcept (parseDocumentInventory .original originalXml)
  let revisedInventory ← IO.ofExcept (parseDocumentInventory .revised revisedXml)
  let comparedInventory ← IO.ofExcept (parseDocumentInventory .compared comparedXml)
  return {
    story := {
      name := "main"
      original := originalTokens
      revised := revisedTokens
      combined := comparedTokens
    }
    originalInventory
    revisedInventory
    comparedInventory
  }

def runRequest (request : Request) : IO Json := do
  let originalPackage ← loadPackage request.originalDocxPath
  let revisedPackage ← loadPackage request.revisedDocxPath
  let comparedPackage ← loadPackage request.comparedDocxPath
  let packages := (originalPackage, revisedPackage, comparedPackage)
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
  let mut loadedPhysicalWorks : List LoadedPhysicalWork := []
  let mut usage := metadataPlan.usage
  let mut selectedAggregateStopped := false
  if metadataPlan.mayExtractSelected then
    for story in selector.physicalStories do
      if selectedAggregateStopped then break
      let attempt ← loadPhysicalStory packages story usage
      usage := attempt.usage
      selectionIssues := selectionIssues ++ attempt.issues
      if let some loaded := attempt.loaded then
        loadedPhysicalWorks := loadedPhysicalWorks ++ [loaded.work]
      if attempt.aggregateStopped then selectedAggregateStopped := true
  let optional ← loadOptionalStories packages usage selectedAggregateStopped
  let mut fixedStoryIssues := optional.issues
  selectionIssues := selectionIssues.eraseDups.mergeSort issueLess
  fixedStoryIssues := fixedStoryIssues.mergeSort fixedIssueLess
  let failedFixedNames := uniqueStrings <|
    fixedStoryIssues.map fun issue => jsonStringField issue "name"
  let fixedTriples := ([main.story] ++ optional.stories).filter fun story =>
    story.name == "main" || !failedFixedNames.contains story.name
  let fixedReports := checkStoryCollection fixedTriples
  let (evidenceSlots, projectedLoadedWorks) ←
    IO.ofExcept <| projectLoadedSelection selector.alignedSlots loadedPhysicalWorks
  let projectedPhysicalStories := projectedLoadedWorks.map (·.story)
  let selectedTriples := projectedLoadedWorks.map LoadedPhysicalWork.triple
  let selectedReports := checkStoryCollection selectedTriples
  let completePhysicalSelection :=
    loadedPhysicalWorks.length == selector.physicalStories.length
  if completePhysicalSelection then
    IO.ofExcept <| validateAggregateSelection selector.candidateOutcomes selector.alignedSlots
      selector.physicalStories loadedPhysicalWorks selectedTriples
  let mut terminalIssue := false
  if selectionIssues.length + fixedStoryIssues.length > maxIssues then
    selectionIssues := [{
      code := "ISSUE_LIMIT_EXCEEDED"
      detail := "structured issue count exceeds the protocol-v4 evidence limit"
    }]
    fixedStoryIssues := []
    terminalIssue := true
  if !terminalIssue && evidenceStringBytes fixedStoryIssues selectionIssues evidenceSlots
      projectedPhysicalStories > maxEvidenceStringBytes - terminalIssueReserveBytes then
    selectionIssues := [{
      code := "EVIDENCE_STRING_BUDGET_EXCEEDED"
      detail := "aggregate emitted identifier, path, and detail strings exceed the evidence limit"
    }]
    fixedStoryIssues := []
    terminalIssue := true
  let emittedEvidenceSlots := if terminalIssue then [] else evidenceSlots
  let physicalJson := if terminalIssue then []
    else
    (List.zip projectedPhysicalStories selectedReports).map fun pair =>
      physicalStoryJson pair.1 pair.2
  let emittedFixedReports := if terminalIssue then fixedReports.take 1 else fixedReports
  let passed := selectionIssues.isEmpty && fixedStoryIssues.isEmpty &&
    storyCollectionPassed emittedFixedReports && storyCollectionPassed selectedReports
  return protocolV4ResponseJson passed
    (emittedFixedReports.map storyReportJson)
    fixedStoryIssues
    (emittedEvidenceSlots.map slotJson)
    physicalJson
    (selectionIssues.map selectionIssueJson)

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
      let response := (← runRequest request).compress
      if response.toUTF8.size > maxResponseBytes then
        throw (IO.userError "protocol response exceeds 8 MiB")
      IO.println response
