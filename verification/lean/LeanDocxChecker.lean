import Lean.Data.Json
import Tier2.NoteReferenceIntegrity
import Tier2.RelationshipStorySelector

open Lean Tier2.XmlTripleChecker Tier2.RelationshipStorySelector
  Tier2.ConventionalMainNoteSelector

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

structure Request where
  originalDocxPath : String
  revisedDocxPath : String
  comparedDocxPath : String

def requestFromJson (j : Json) : Except String Request := do
  let object ← j.getObj?
  if object.keys != ["comparedDocxPath", "originalDocxPath", "protocolVersion",
      "revisedDocxPath"] then
    throw "protocol v5 request has unknown or missing keys"
  let protocolVersion ← j.getObjValAs? Nat "protocolVersion"
  if protocolVersion != 5 then throw s!"unsupported protocolVersion: {protocolVersion}"
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
  snapshotDirectory : String
  snapshotPath : String
  snapshotBytes : ByteArray
  snapshotWriteCount : Nat
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
    let (snapshotDirectory, snapshotPath) ← createPrivateSnapshot root bytes
    return {
      path, bytes, index
      packageReadCount := 1
      indexExact := hIndex
      snapshotDirectory
      snapshotPath
      snapshotBytes := bytes
      snapshotWriteCount := 1
      snapshotBytesExact := rfl
    }

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

structure RunRequestPackageRecord where
  packagePath : String
  packageBytes : ByteArray
  packageReadCount : Nat
  relationships : List RelationshipRecord
  noteEvidence : NoteSideEvidence

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

def packageViewOfRecord (record : RunRequestPackageRecord) : PackageView :=
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
  parseXmlEventsForRootBoundedTyped evidence.text evidence.expectedRootUri
      evidence.expectedRootLocalName evidence.eventLimit evidence.depthLimit =
    .ok evidence.parsed

def productionParseEvidencesOfRecord (record : RunRequestPackageRecord) :
    List ProductionParseEvidence :=
  record.noteEvidence.sources.map (·.parseEvidence) ++
  (record.noteEvidence.footnotesPart.map (·.parseEvidence)).toList ++
  (record.noteEvidence.endnotesPart.map (·.parseEvidence)).toList

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
    evidence.parsed.eventCount = evidence.parsed.events.length := by
  unfold productionParseEvidenceCheck at hCheck
  simp only [Bool.and_eq_true, decide_eq_true_eq, List.isEmpty_iff] at hCheck
  rcases hCheck with
    ⟨⟨⟨⟨⟨⟨hExtracted, hParserBytes⟩, hInvocation⟩,
      hRootSeen⟩, hStack⟩, hCompleted⟩, _hRoot⟩
  exact ⟨hExtracted, hParserBytes, hInvocation, hRootSeen, hStack, hCompleted⟩

theorem production_package_record_of_checks (record : RunRequestPackageRecord)
    (hRead : record.packageReadCount = 1)
    (hParser : productionPackageParserEvidencePass record = true)
    (hSelector : productionSelectorEvidencePass record = true)
    (hIntegrity : productionRecordIntegrityPass record = true)
    (hInventory : productionInventoryEvidencePass record = true) :
    ProductionPackageRecordOf record := by
  unfold ProductionPackageRecordOf
  refine ⟨?_, ?_, ?_, ?_, ?_⟩
  · exact hRead
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
      hParsed.2.2.2.1, hParsed.2.2.2.2.1, hParsed.2.2.2.2.2,
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

def runRequestOperationalChecks (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : ProductionAggregateChecks :=
  let fixedReports := checkStoryCollection request.fixedTriples
  let selectedReports := checkStoryCollection request.relationshipTriples
  let noteEvidence :=
    [request.original.noteEvidence, request.revised.noteEvidence,
      request.compared.noteEvidence]
  let selectionIssues := request.selectionIssues.eraseDups.mergeSort issueLess
  let noteIssues :=
    coalesceNoteIssues (noteEvidence.flatMap (·.issues)) |>.mergeSort noteIssueLess
  let ordinaryPartitions := noteEvidence.map partitionJson
  let ordinaryNoteStories :=
    [noteStoryJson .footnotes noteEvidence, noteStoryJson .endnotes noteEvidence]
  let ordinaryInventories := noteEvidence.flatMap fun evidence =>
    [inventoryJson evidence.footnotesInventory,
      inventoryJson evidence.endnotesInventory]
  let ordinaryOtherEvidence :=
    (fixedReports.map storyReportJson) ++ ordinaryPartitions ++ ordinaryNoteStories ++
      ordinaryInventories
  let nonIssueStringBytes :=
    evidenceStringBytes [] [] request.relationshipSlots request.relationshipStories
      ordinaryOtherEvidence []
  let terminalIssue := (firstAggregateIssueCrossing nonIssueStringBytes
    (selectionIssues.map selectionIssueStringBytes)
    (noteIssues.map jsonEvidenceStringBytes)).isSome
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
    noNoteIssues := !terminalIssue && noteIssues.isEmpty
    fixedStoriesPass := storyCollectionPassed
      (if terminalIssue then fixedReports.take 1 else fixedReports)
    relationshipStoriesPass := storyCollectionPassed selectedReports
    semanticPartitionsComplete := noteEvidence.all (·.complete)
    semanticNoteStoriesPass := emittedNoteStories.all fun story =>
      jsonStringField story "status" == "passed"
    inventoriesPass := emittedInventories.all fun inventory =>
      jsonStringField inventory "status" == "passed"
    productionNoteIntegrityPass :=
      productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised &&
      productionRecordIntegrityPass request.compared &&
      productionSemanticInventoriesPass request semanticResponse
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
  Json.mkObj
    [ ("code", toJson code)
    , ("side", toJson "original")
    , ("kind", toJson "footnotes")
    , ("detail", toJson <| if code == "NOTE_ISSUE_LIMIT_EXCEEDED" then
        "protocol v5 aggregate ordinary issue limit exceeded"
      else "protocol v5 escaped evidence string budget exceeded")
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

def fields (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) : Fields :=
  let fixed := semanticResponse.genericStoryReports.take request.fixedTriples.length
  let selected := semanticResponse.genericStoryReports.drop request.fixedTriples.length
  let sides := [request.original.noteEvidence, request.revised.noteEvidence,
    request.compared.noteEvidence]
  let selections := request.selectionIssues.eraseDups.mergeSort selectionIssueBefore
  let notes := coalesceIssues (sides.flatMap (·.issues)) |>.mergeSort issueBefore
  let nonIssueJson :=
    (fixed.map fixedStoryJson) ++
    (sides.map partitionJsonSpec) ++
    [noteStoryJsonSpec .footnotes sides, noteStoryJsonSpec .endnotes sides] ++
    (sides.flatMap fun side =>
      [inventoryJsonSpec side.footnotesInventory,
        inventoryJsonSpec side.endnotesInventory])
  let crossing := firstCrossing
    ((nonIssueJson.map escapedEvidenceBytes |>.sum) +
      (request.relationshipSlots.map slotEvidenceBytes |>.sum) +
      (request.relationshipStories.map storyEvidenceBytes |>.sum))
    selections notes
  { passed := semanticResponse.passed && crossing.isNone &&
      selections.isEmpty && notes.isEmpty
    fixedStories := fixed
    relationshipSlots := request.relationshipSlots
    relationshipStories := List.zip request.relationshipStories selected
    selectionIssues := selections
    noteSides := sides
    noteIssues := notes
    terminalCode := crossing }

def encode (fields : Fields) : Json :=
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
    | some code => [terminalIssue code]
    | none => fields.noteIssues
  Json.mkObj
    [ ("protocolVersion", toJson (5 : Nat))
    , ("checker", toJson "safe-docx-lean-conventional-main-note-integrity-checker")
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
    ]

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

def semanticProtocolV5Projection (request : RunRequestCoreRequest)
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
  let selectionIssues := request.selectionIssues.eraseDups.mergeSort issueLess
  let noteIssues :=
    coalesceNoteIssues (noteEvidence.flatMap (·.issues)) |>.mergeSort noteIssueLess
  let ordinaryPartitions := noteEvidence.map partitionJson
  let ordinaryNoteStories :=
    [noteStoryJson .footnotes noteEvidence, noteStoryJson .endnotes noteEvidence]
  let ordinaryInventories := noteEvidence.flatMap fun evidence =>
    [inventoryJson evidence.footnotesInventory,
      inventoryJson evidence.endnotesInventory]
  let ordinaryOtherEvidence :=
    (fixedReports.map storyReportJson) ++ ordinaryPartitions ++ ordinaryNoteStories ++
      ordinaryInventories
  let nonIssueStringBytes :=
    evidenceStringBytes [] [] request.relationshipSlots request.relationshipStories
      ordinaryOtherEvidence []
  let crossing := firstAggregateIssueCrossing nonIssueStringBytes
    (selectionIssues.map selectionIssueStringBytes)
    (noteIssues.map jsonEvidenceStringBytes)
  let terminalIssue := crossing.isSome
  let emittedSelectionIssues := if terminalIssue then [] else selectionIssues
  let emittedNoteIssues := match crossing with
    | some terminalCode =>
      let detail := if terminalCode == "NOTE_ISSUE_LIMIT_EXCEEDED" then
        "protocol v5 aggregate ordinary issue limit exceeded"
      else "protocol v5 escaped evidence string budget exceeded"
      [Json.mkObj
        [ ("code", toJson terminalCode)
        , ("side", toJson "original")
        , ("kind", toJson "footnotes")
        , ("detail", toJson detail)
        , ("ordinalSpace", toJson "aggregate")
        , ("firstOccurrenceOrdinal", toJson (0 : Nat))
        , ("occurrenceCount", toJson (1 : Nat))
        ]]
    | none => noteIssues
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
  protocolV5ResponseJson passed
    (emittedFixedReports.map storyReportJson)
    (emittedSlots.map slotJson)
    physicalJson
    (emittedSelectionIssues.map selectionIssueJson)
    emittedPartitions
    emittedNoteStories
    emittedInventories
    emittedNoteIssues

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
      semanticProtocolV5Projection request semanticResponse := by
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
  unfold buildRunRequestCoreJson semanticProtocolV5Projection
  rw [hPassed]
  unfold SemanticProtocolSpec.fields SemanticProtocolSpec.encode
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
      List.flatMap_cons, List.flatMap_nil] using hNoNotes.2
  unfold SemanticProtocolSpec.fields
  rw [hFixed]
  simp only [hSemantic, Bool.true_and, Bool.and_eq_true,
    Option.isNone_iff_eq_none]
  exact ⟨⟨hTerminalConcrete, hSelectionEmpty⟩, hNoteEmpty⟩

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
    change (((productionRecordIntegrityPass request.original &&
      productionRecordIntegrityPass request.revised) &&
      productionRecordIntegrityPass request.compared) &&
      productionSemanticInventoriesPass request semanticResponse) = true at hProduction
    exact
      (Tier2.NoteReferenceIntegrity.and_true_components _ _ hProduction).2

def coreSemanticAdmissionReady (request : RunRequestCoreRequest) : Bool :=
  request.selectionIssues.isEmpty &&
  request.original.noteEvidence.complete &&
  request.revised.noteEvidence.complete &&
  request.compared.noteEvidence.complete &&
  request.original.noteEvidence.issues.isEmpty &&
  request.revised.noteEvidence.issues.isEmpty &&
  request.compared.noteEvidence.issues.isEmpty &&
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
  match finalizeProtocolV5Response built.2 with
  | .error detail => .error detail
  | .ok stdout => .ok {
      responsePassed := built.1
      response := built.2
      stdout
      semanticRequest
      semanticResponse
      semanticStdout
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

def protocolV5FieldNames : List String :=
  [ "protocolVersion", "checker", "passed", "fixedStories",
    "presenceMismatches", "fixedStoryIssues", "relationshipSlots",
    "relationshipStories", "selectionIssues", "referenceSourcePartitions",
    "noteStories", "noteInventories", "noteIntegrityIssues" ]

def ProtocolV5EveryFieldOf (expected actual : Json) : Prop :=
  actual = expected ∧
  ∀ field, field ∈ protocolV5FieldNames →
    actual.getObjVal? field = expected.getObjVal? field

def SemanticProtocolV5ProjectionOf (request : RunRequestCoreRequest)
    (semanticResponse : VerifierResponseV5) (actual : Json) : Prop :=
  ProtocolV5EveryFieldOf
    (semanticProtocolV5Projection request semanticResponse) actual

theorem protocol_v5_every_field_exact (expected actual : Json)
    (hExact : actual = expected) : ProtocolV5EveryFieldOf expected actual := by
  subst actual
  exact ⟨rfl, fun _ _ => rfl⟩

def ProductionRunRequestRefinesSemanticOf (request : RunRequestCoreRequest)
    (result : RunRequestCoreResult) : Prop :=
  ProductionPackageRecordOf request.original ∧
  ProductionPackageRecordOf request.revised ∧
  ProductionPackageRecordOf request.compared ∧
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
  SemanticProtocolV5ProjectionOf
    request result.semanticResponse result.response ∧
  Tier2.NoteReferenceIntegrity.FinalizedProductionResponseOf
    result.response result.stdout

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
    cases hFinalize : _root_.finalizeProtocolV5Response
        (buildRunRequestCoreResponse request semanticResponse).2 with
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
      cases hFinalize : _root_.finalizeProtocolV5Response
          (buildRunRequestCoreResponse request semanticResponse).2 with
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
          rfl, rfl, rfl, rfl, hVerify, hSemantic.1,
          hFields.1, hFields.2, hProductionInventories, ?_, ?_, ?_⟩
        · exact hPass.trans hSemanticPass.symm
        · unfold SemanticProtocolV5ProjectionOf
          apply protocol_v5_every_field_exact
          exact build_run_request_core_json_refines_semantic_projection
            request semanticResponse hReportExact
            (hPass.trans
              (semantic_protocol_fields_pass_of_core_pass
                request semanticResponse hReportExact hPass).symm)
            hSides.1 hSides.2.1 hSides.2.2
        · exact
            Tier2.NoteReferenceIntegrity.production_protocol_v5_serialization_exact
              _ _ hFinalize

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
  let originalCorePackage : RunRequestPackageRecord := {
    packagePath := originalPackage.path
    packageBytes := originalPackage.bytes
    packageReadCount := originalPackage.packageReadCount
    relationships := originalRelationships
    noteEvidence := originalNoteEvidence
  }
  let revisedCorePackage : RunRequestPackageRecord := {
    packagePath := revisedPackage.path
    packageBytes := revisedPackage.bytes
    packageReadCount := revisedPackage.packageReadCount
    relationships := revisedRelationships
    noteEvidence := revisedNoteEvidence
  }
  let comparedCorePackage : RunRequestPackageRecord := {
    packagePath := comparedPackage.path
    packageBytes := comparedPackage.bytes
    packageReadCount := comparedPackage.packageReadCount
    relationships := comparedRelationships
    noteEvidence := comparedNoteEvidence
  }
  let core ← IO.ofExcept <| runRequestCore {
    fixedTriples
    relationshipSlots := evidenceSlots
    relationshipStories := projectedPhysicalStories
    relationshipTriples := selectedTriples
    selectionIssues
    original := originalCorePackage
    revised := revisedCorePackage
    compared := comparedCorePackage
  }
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
