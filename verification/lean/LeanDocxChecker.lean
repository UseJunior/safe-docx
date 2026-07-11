import Lean.Data.Json
import Tier2.XmlTripleChecker

open Lean Tier2.XmlTripleChecker

structure Request where
  originalDocxPath : String
  revisedDocxPath : String
  comparedDocxPath : String

structure FixedStory where
  name : String
  packagePart : String
  rootLocalName : String
  required : Bool
  noteProjection : Bool

def fixedStories : List FixedStory :=
  [ { name := "main", packagePart := "word/document.xml", rootLocalName := "document", required := true,
      noteProjection := false }
  , { name := "footnotes", packagePart := "word/footnotes.xml", rootLocalName := "footnotes", required := false,
      noteProjection := true }
  , { name := "endnotes", packagePart := "word/endnotes.xml", rootLocalName := "endnotes", required := false,
      noteProjection := true }
  ]

def requestFromJson (j : Json) : Except String Request := do
  let protocolVersion ← j.getObjValAs? Nat "protocolVersion"
  if protocolVersion != 2 then
    throw s!"unsupported protocolVersion: {protocolVersion}"
  return {
    originalDocxPath := (← j.getObjValAs? String "originalDocxPath")
    revisedDocxPath := (← j.getObjValAs? String "revisedDocxPath")
    comparedDocxPath := (← j.getObjValAs? String "comparedDocxPath")
  }

def maxPackageBytes : Nat := 100 * 1024 * 1024
def maxPartCompressedBytes : Nat := 16 * 1024 * 1024
def maxPartExpandedBytes : Nat := 16 * 1024 * 1024
def maxCompressionRatio : Nat := 100
def maxDiagnosticBytes : Nat := 16 * 1024

structure BoundedOutput where
  exitCode : UInt32
  stdout : String
  stderr : String

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
    let stdoutBytes ← readBounded child.stdout stdoutLimit
    let exitCode ← child.wait
    let stderrBytes ← IO.ofExcept stderrTask.get
    let some stdout := String.fromUTF8? stdoutBytes |
      throw (IO.userError "archive extractor emitted non-UTF-8 output")
    let some stderr := String.fromUTF8? stderrBytes |
      throw (IO.userError "archive extractor emitted non-UTF-8 diagnostics")
    return { exitCode, stdout, stderr }
  catch error =>
    child.kill
    discard child.wait
    throw error

structure EntryInfo where
  compressedBytes : Nat
  expandedBytes : Nat

inductive ExtractedPart where
  | missing
  | present (xml : String)

def parseEntryInfo (line : String) : Except String EntryInfo := do
  let words := (line.replace "\n" " ").splitOn " " |>.filter (· != "")
  if words.length != 10 then throw "unexpected archive metadata shape"
  let expanded ← match (List.getD words 3 "").toNat? with
    | some value => pure value
    | none => throw "invalid expanded entry size"
  let compressed ← match (List.getD words 5 "").toNat? with
    | some value => pure value
    | none => throw "invalid compressed entry size"
  return { compressedBytes := compressed, expandedBytes := expanded }

def validateEntryLimits (partPath : String) (info : EntryInfo) : Except String Unit := do
  if info.compressedBytes > maxPartCompressedBytes then
    throw s!"{partPath} compressed size exceeds {maxPartCompressedBytes} bytes"
  if info.expandedBytes > maxPartExpandedBytes then
    throw s!"{partPath} expanded size exceeds {maxPartExpandedBytes} bytes"
  if info.compressedBytes == 0 && info.expandedBytes > 0 then
    throw s!"{partPath} has an invalid zero compressed size"
  if info.expandedBytes > info.compressedBytes * maxCompressionRatio then
    throw s!"{partPath} compression ratio exceeds {maxCompressionRatio}"

def extractPart (packagePath partPath : String) : IO ExtractedPart := do
  let metadata ← (System.FilePath.mk packagePath).metadata
  if metadata.byteSize > maxPackageBytes.toUInt64 then
    throw (IO.userError s!"DOCX package exceeds {maxPackageBytes} bytes")
  let listing ← runBounded "unzip" #["-Z", "-l", packagePath, partPath] maxDiagnosticBytes
  if listing.exitCode == 11 then return .missing
  if listing.exitCode != 0 then
    throw (IO.userError s!"archive metadata failed for {partPath}: {listing.stderr.trimAscii}")
  let info ← IO.ofExcept (parseEntryInfo listing.stdout.trimAscii.toString)
  IO.ofExcept (validateEntryLimits partPath info)
  let extracted ← runBounded "unzip" #["-p", packagePath, partPath] maxPartExpandedBytes
  if extracted.exitCode != 0 then
    throw (IO.userError s!"archive extraction failed for {partPath}: {extracted.stderr.trimAscii}")
  if extracted.stdout.toUTF8.size != info.expandedBytes then
    throw (IO.userError s!"archive extraction size mismatch for {partPath}")
  return .present extracted.stdout

def tokensForStory (story : FixedStory) (xml : String) : Except String (List XmlTok) := do
  let tokens ← parseXmlTokensForRoot xml story.rootLocalName
  return if story.noteProjection then projectUserNoteTokens tokens else tokens

def presenceJson (original revised combined : Bool) : Json :=
  Json.mkObj
    [ ("original", toJson original)
    , ("revised", toJson revised)
    , ("combined", toJson combined)
    ]

def mismatchJson (story : FixedStory) (original revised combined : Bool) : Json :=
  Json.mkObj
    [ ("name", toJson story.name)
    , ("packagePart", toJson story.packagePart)
    , ("required", toJson story.required)
    , ("presence", presenceJson original revised combined)
    ]

structure LoadedStories where
  stories : List NamedStoryTriple
  mismatches : List Json

def loadFixedStories (req : Request) : IO LoadedStories := do
  let mut stories := []
  let mut mismatches := []
  for story in fixedStories do
    let original ← extractPart req.originalDocxPath story.packagePart
    let revised ← extractPart req.revisedDocxPath story.packagePart
    let combined ← extractPart req.comparedDocxPath story.packagePart
    match original, revised, combined with
    | .missing, .missing, .missing =>
      if story.required then
        mismatches := mismatches ++ [mismatchJson story false false false]
        stories := stories ++
          [{ name := story.name, original := [], revised := [], combined := [],
             originalPresent := false, revisedPresent := false, combinedPresent := false }]
    | _, _, _ =>
      let originalPresent := match original with | .present _ => true | .missing => false
      let revisedPresent := match revised with | .present _ => true | .missing => false
      let combinedPresent := match combined with | .present _ => true | .missing => false
      if story.required && !(originalPresent && revisedPresent && combinedPresent) then
        mismatches := mismatches ++
          [mismatchJson story originalPresent revisedPresent combinedPresent]
      let originalTokens ← match original with
        | .present xml => IO.ofExcept (tokensForStory story xml)
        | .missing => pure []
      let revisedTokens ← match revised with
        | .present xml => IO.ofExcept (tokensForStory story xml)
        | .missing => pure []
      let combinedTokens ← match combined with
        | .present xml => IO.ofExcept (tokensForStory story xml)
        | .missing => pure []
      stories := stories ++
        [{ name := story.name, original := originalTokens, revised := revisedTokens,
           combined := combinedTokens, originalPresent, revisedPresent, combinedPresent }]
  return { stories, mismatches }

def runRequest (req : Request) : IO Json := do
  let loaded ← loadFixedStories req
  let reports := checkStoryCollection loaded.stories
  let passed := loaded.mismatches.isEmpty && storyCollectionPassed reports
  return Json.mkObj
    [ ("protocolVersion", toJson (2 : Nat))
    , ("checker", toJson "safe-docx-lean-fixed-story-checker")
    , ("passed", toJson passed)
    , ("stories", Json.arr (reports.map storyReportToJson).toArray)
    , ("presenceMismatches", Json.arr loaded.mismatches.toArray)
    ]

def main : IO Unit := do
  let stdin ← IO.getStdin
  let raw ← stdin.readToEnd
  match Json.parse raw with
  | .error e => throw (IO.userError s!"JSON parse error: {e}")
  | .ok j =>
    match requestFromJson j with
    | .error e => throw (IO.userError s!"request parse error: {e}")
    | .ok req => IO.println (← runRequest req).compress
