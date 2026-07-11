import Lean.Data.Json

namespace Tier2.XmlTripleChecker

open Lean

inductive Wrapper
  | ins
  | del
  | moveFrom
  | moveTo
  deriving DecidableEq, Repr, Inhabited

inductive FldCharKind
  | begin
  | separate
  | endf
  deriving DecidableEq, Repr, Inhabited

inductive XmlTok
  | pBreak
  | enter (w : Wrapper)
  | exit (w : Wrapper)
  | text (s : String)
  | delText (s : String)
  | instrText (s : String)
  | delInstrText (s : String)
  | fldChar (k : FldCharKind)
  | enterReservedNote
  | exitReservedNote
  deriving DecidableEq, Repr, Inhabited

def decodeXmlText (s : String) : String :=
  let quote := String.ofList [Char.ofNat 34]
  let apostrophe := String.ofList [Char.ofNat 39]
  let s := s.replace "&lt;" "<"
  let s := s.replace "&gt;" ">"
  let s := s.replace "&quot;" quote
  let s := s.replace "&apos;" apostrophe
  s.replace "&amp;" "&"

def tagName (tag : String) : String :=
  let first := List.getD (tag.splitOn " ") 0 tag
  first.replace "/" ""

def isStartTag (tag name : String) : Bool :=
  !tag.startsWith "/" && tagName tag == name

def isEndTag (tag name : String) : Bool :=
  tag.startsWith ("/" ++ name)

def tagPayload (segment : String) : String × String :=
  match segment.splitOn ">" with
  | [] => ("", "")
  | tag :: rest => (tag, String.intercalate ">" rest)

def tagToken (tag payload : String) : List XmlTok :=
  if (isStartTag tag "w:footnote" || isStartTag tag "w:endnote") &&
      (tag.contains "w:id=\"-1\"" || tag.contains "w:id=\"0\"") then [.enterReservedNote]
  else if isEndTag tag "w:footnote" || isEndTag tag "w:endnote" then [.exitReservedNote]
  else if isStartTag tag "w:p" then [.pBreak]
  else if isStartTag tag "w:ins" then [.enter .ins]
  else if isEndTag tag "w:ins" then [.exit .ins]
  else if isStartTag tag "w:del" then [.enter .del]
  else if isEndTag tag "w:del" then [.exit .del]
  else if isStartTag tag "w:moveFrom" then [.enter .moveFrom]
  else if isEndTag tag "w:moveFrom" then [.exit .moveFrom]
  else if isStartTag tag "w:moveTo" then [.enter .moveTo]
  else if isEndTag tag "w:moveTo" then [.exit .moveTo]
  else if isStartTag tag "w:fldChar" then
    if tag.contains "w:fldCharType=\"begin\"" then [.fldChar .begin]
    else if tag.contains "w:fldCharType=\"separate\"" then [.fldChar .separate]
    else if tag.contains "w:fldCharType=\"end\"" then [.fldChar .endf]
    else []
  else if isStartTag tag "w:t" then [.text (decodeXmlText payload)]
  else if isStartTag tag "w:delText" then [.delText (decodeXmlText payload)]
  else if isStartTag tag "w:instrText" then [.instrText (decodeXmlText payload)]
  else if isStartTag tag "w:delInstrText" then [.delInstrText (decodeXmlText payload)]
  else []

def parseXmlTokens (xml : String) : List XmlTok :=
  (((xml.splitOn "<").drop 1).map fun segment =>
    let (tag, payload) := tagPayload segment
    tagToken tag payload).flatten

def projectUserNoteTokensAux : Bool → List XmlTok → List XmlTok
  | _, [] => []
  | _, .enterReservedNote :: rest => projectUserNoteTokensAux true rest
  | _, .exitReservedNote :: rest => projectUserNoteTokensAux false rest
  | true, _ :: rest => projectUserNoteTokensAux true rest
  | false, tok :: rest => tok :: projectUserNoteTokensAux false rest

def projectUserNoteTokens (toks : List XmlTok) : List XmlTok :=
  projectUserNoteTokensAux false toks

theorem projectUserNoteTokensAux_no_reserved (inside : Bool) (toks : List XmlTok) :
    (projectUserNoteTokensAux inside toks).all (fun tok =>
      tok != .enterReservedNote && tok != .exitReservedNote) = true := by
  induction toks generalizing inside with
  | nil => simp [projectUserNoteTokensAux]
  | cons tok rest ih =>
    cases inside <;> cases tok <;> simp_all [projectUserNoteTokensAux]

theorem projectUserNoteTokens_no_reserved (toks : List XmlTok) :
    (projectUserNoteTokens toks).all (fun tok =>
      tok != .enterReservedNote && tok != .exitReservedNote) = true := by
  exact projectUserNoteTokensAux_no_reserved false toks

def popWrapper (w : Wrapper) : List Wrapper → List Wrapper
  | [] => []
  | x :: xs => if x == w then xs else x :: popWrapper w xs

def inStack (w : Wrapper) (stack : List Wrapper) : Bool :=
  stack.any (· == w)

def excludedForAccept (stack : List Wrapper) : Bool :=
  inStack .del stack || inStack .moveFrom stack

def excludedForReject (stack : List Wrapper) : Bool :=
  inStack .ins stack || inStack .moveTo stack

def acceptTokensAux : List Wrapper → List XmlTok → List XmlTok
  | _, [] => []
  | stack, .pBreak :: rest => .pBreak :: acceptTokensAux stack rest
  | stack, .enter w :: rest => acceptTokensAux (w :: stack) rest
  | stack, .exit w :: rest => acceptTokensAux (popWrapper w stack) rest
  | stack, tok :: rest =>
    if excludedForAccept stack then acceptTokensAux stack rest
    else tok :: acceptTokensAux stack rest

def acceptTokens (toks : List XmlTok) : List XmlTok :=
  acceptTokensAux [] toks

def rejectToken (tok : XmlTok) : XmlTok :=
  match tok with
  | .delText s => .text s
  | .delInstrText s => .instrText s
  | other => other

def rejectTokensAux : List Wrapper → List XmlTok → List XmlTok
  | _, [] => []
  | stack, .pBreak :: rest => .pBreak :: rejectTokensAux stack rest
  | stack, .enter w :: rest => rejectTokensAux (w :: stack) rest
  | stack, .exit w :: rest => rejectTokensAux (popWrapper w stack) rest
  | stack, tok :: rest =>
    if excludedForReject stack then rejectTokensAux stack rest
    else rejectToken tok :: rejectTokensAux stack rest

def rejectTokens (toks : List XmlTok) : List XmlTok :=
  rejectTokensAux [] toks

def hasFldCharInsideDelAux : List Wrapper → List XmlTok → Bool
  | _, [] => false
  | stack, .enter w :: rest => hasFldCharInsideDelAux (w :: stack) rest
  | stack, .exit w :: rest => hasFldCharInsideDelAux (popWrapper w stack) rest
  | stack, .fldChar _ :: rest => inStack .del stack || hasFldCharInsideDelAux stack rest
  | stack, _ :: rest => hasFldCharInsideDelAux stack rest

def hasFldCharInsideDel (toks : List XmlTok) : Bool :=
  hasFldCharInsideDelAux [] toks

abbrev FieldCtx := List Bool

inductive WalkResult
  | ok (ctx : FieldCtx)
  | invalid
  deriving DecidableEq, Repr, Inhabited

def WalkResult.isValid : WalkResult → Bool
  | .ok _ => true
  | .invalid => false

def stepField (r : WalkResult) : XmlTok → WalkResult
  | .fldChar .begin =>
    match r with
    | .ok ctx => .ok (false :: ctx)
    | .invalid => .invalid
  | .fldChar .separate =>
    match r with
    | .ok [] => .ok []
    | .ok (_ :: rest) => .ok (true :: rest)
    | .invalid => .invalid
  | .fldChar .endf =>
    match r with
    | .ok [] => .ok []
    | .ok (_ :: rest) => .ok rest
    | .invalid => .invalid
  | .instrText _ =>
    match r with
    | .ok (false :: _) => r
    | _ => .invalid
  | .delInstrText _ => .invalid
  | _ => r

def isBegin : XmlTok → Bool
  | .fldChar .begin => true
  | _ => false

def isEnd : XmlTok → Bool
  | .fldChar .endf => true
  | _ => false

def validateFieldStructureTokens (toks : List XmlTok) : Bool :=
  toks.countP isBegin == toks.countP isEnd && (toks.foldl stepField (.ok [])).isValid

def tokenText : XmlTok → List Char
  | .text s => s.toList
  | .delText s => s.toList
  | _ => []

def normLine (s : List Char) : List Char :=
  ((s.dropWhile fun c => c == ' ' || c == '\t' || c == '\n' || c == '\r').reverse.dropWhile
    fun c => c == ' ' || c == '\t' || c == '\n' || c == '\r').reverse

def normalizeText (xs : List (List Char)) : List (List Char) :=
  (xs.map normLine).filter (· != [])

def extractTextAux (seen : Bool) (current : List Char) (acc : List (List Char)) :
    List XmlTok → List (List Char)
  | [] => if seen then acc ++ [current] else []
  | .pBreak :: rest =>
    if seen then extractTextAux true [] (acc ++ [current]) rest
    else extractTextAux true [] acc rest
  | tok :: rest => extractTextAux seen (current ++ tokenText tok) acc rest

def extractText (toks : List XmlTok) : List (List Char) :=
  extractTextAux false [] [] toks

structure CheckReport where
  acceptPreservesFieldStructure : Bool
  rejectPreservesFieldStructure : Bool
  acceptTextMatchesRevised : Bool
  rejectTextMatchesOriginal : Bool
  combinedHasNoFldCharInsideDel : Bool
  deriving Repr, Inhabited

def CheckReport.passed (r : CheckReport) : Bool :=
  r.acceptPreservesFieldStructure &&
  r.rejectPreservesFieldStructure &&
  r.acceptTextMatchesRevised &&
  r.rejectTextMatchesOriginal &&
  r.combinedHasNoFldCharInsideDel

def comparisonCheckerB (original revised combined : List XmlTok) : CheckReport :=
  let acceptedCombined := acceptTokens combined
  let rejectedCombined := rejectTokens combined
  let acceptedRevised := acceptTokens revised
  let rejectedOriginal := rejectTokens original
  {
    acceptPreservesFieldStructure := validateFieldStructureTokens acceptedCombined
    rejectPreservesFieldStructure := validateFieldStructureTokens rejectedCombined
    acceptTextMatchesRevised :=
      normalizeText (extractText acceptedCombined) == normalizeText (extractText acceptedRevised)
    rejectTextMatchesOriginal :=
      normalizeText (extractText rejectedCombined) == normalizeText (extractText rejectedOriginal)
    combinedHasNoFldCharInsideDel := !hasFldCharInsideDel combined
  }

structure NamedStoryTriple where
  name : String
  original : List XmlTok
  revised : List XmlTok
  combined : List XmlTok
  deriving Repr, Inhabited

structure StoryReport where
  name : String
  report : CheckReport
  originalTokenCount : Nat
  revisedTokenCount : Nat
  combinedTokenCount : Nat
  deriving Repr, Inhabited

def checkNamedStory (story : NamedStoryTriple) : StoryReport :=
  { name := story.name
    report := comparisonCheckerB story.original story.revised story.combined
    originalTokenCount := story.original.length
    revisedTokenCount := story.revised.length
    combinedTokenCount := story.combined.length }

def checkStoryCollection (stories : List NamedStoryTriple) : List StoryReport :=
  stories.map checkNamedStory

def storyCollectionPassed (reports : List StoryReport) : Bool :=
  reports.all (fun report => report.report.passed)

theorem story_collection_sound (stories : List NamedStoryTriple)
    (h : storyCollectionPassed (checkStoryCollection stories) = true) :
    ∀ report ∈ checkStoryCollection stories, report.report.passed = true := by
  intro report hReport
  simpa [storyCollectionPassed] using List.all_eq_true.mp h report hReport

theorem checker_sound (original revised combined : List XmlTok)
    (h : (comparisonCheckerB original revised combined).passed = true) :
    (comparisonCheckerB original revised combined).acceptPreservesFieldStructure = true ∧
    (comparisonCheckerB original revised combined).rejectPreservesFieldStructure = true ∧
    (comparisonCheckerB original revised combined).acceptTextMatchesRevised = true ∧
    (comparisonCheckerB original revised combined).rejectTextMatchesOriginal = true ∧
    (comparisonCheckerB original revised combined).combinedHasNoFldCharInsideDel = true := by
  simp only [CheckReport.passed, Bool.and_eq_true] at h
  rcases h with ⟨⟨⟨⟨hAccept, hReject⟩, hAcceptText⟩, hRejectText⟩, hNoDelField⟩
  exact ⟨hAccept, hReject, hAcceptText, hRejectText, hNoDelField⟩

theorem story_collection_checker_sound (stories : List NamedStoryTriple)
    (h : storyCollectionPassed (checkStoryCollection stories) = true) :
    ∀ story ∈ stories,
      let report := comparisonCheckerB story.original story.revised story.combined
      report.acceptPreservesFieldStructure = true ∧
      report.rejectPreservesFieldStructure = true ∧
      report.acceptTextMatchesRevised = true ∧
      report.rejectTextMatchesOriginal = true ∧
      report.combinedHasNoFldCharInsideDel = true := by
  intro story hStory
  have hMember : checkNamedStory story ∈ checkStoryCollection stories := by
    exact List.mem_map.mpr ⟨story, hStory, rfl⟩
  have hPassed := story_collection_sound stories h (checkNamedStory story) hMember
  exact checker_sound story.original story.revised story.combined hPassed

def boolJson (b : Bool) : Json := toJson b

def reportToJson (r : CheckReport) : Json :=
  Json.mkObj
    [ ("passed", boolJson r.passed)
    , ("checks", Json.mkObj
        [ ("acceptPreservesFieldStructure", boolJson r.acceptPreservesFieldStructure)
        , ("rejectPreservesFieldStructure", boolJson r.rejectPreservesFieldStructure)
        , ("acceptTextMatchesRevised", boolJson r.acceptTextMatchesRevised)
        , ("rejectTextMatchesOriginal", boolJson r.rejectTextMatchesOriginal)
        , ("combinedHasNoFldCharInsideDel", boolJson r.combinedHasNoFldCharInsideDel)
        ])
    ]

def storyReportToJson (r : StoryReport) : Json :=
  Json.mkObj
    [ ("name", toJson r.name)
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson r.originalTokenCount)
        , ("revised", toJson r.revisedTokenCount)
        , ("combined", toJson r.combinedTokenCount)
        ])
    , ("report", reportToJson r.report)
    ]

end Tier2.XmlTripleChecker
