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
  required : Bool
  noteProjection : Bool

def fixedStories : List FixedStory :=
  [ { name := "main", packagePart := "word/document.xml", required := true,
      noteProjection := false }
  , { name := "footnotes", packagePart := "word/footnotes.xml", required := false,
      noteProjection := true }
  , { name := "endnotes", packagePart := "word/endnotes.xml", required := false,
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

def extractPart (packagePath partPath : String) : IO (Option String) := do
  let listing ← IO.Process.output { cmd := "unzip", args := #["-Z1", packagePath, partPath] }
  if listing.exitCode != 0 then return none
  let extracted ← IO.Process.output { cmd := "unzip", args := #["-p", packagePath, partPath] }
  if extracted.exitCode != 0 then
    throw (IO.userError s!"failed to extract {partPath} from {packagePath}: {extracted.stderr.trimAscii}")
  return some extracted.stdout

def tokensForStory (story : FixedStory) (xml : String) : List XmlTok :=
  let tokens := parseXmlTokens xml
  if story.noteProjection then projectUserNoteTokens tokens else tokens

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
    | some a, some b, some c =>
      stories := stories ++
        [{ name := story.name, original := tokensForStory story a,
           revised := tokensForStory story b, combined := tokensForStory story c }]
    | none, none, none =>
      if story.required then
        mismatches := mismatches ++ [mismatchJson story false false false]
    | _, _, _ =>
      mismatches := mismatches ++
        [mismatchJson story original.isSome revised.isSome combined.isSome]
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
