import LeanSpike.Lcs
import Tier2.XmlTripleChecker

/-!
Independent, bounded emitted-redline minimality evidence.

This module deliberately consumes only the checker-owned `XmlTok` stream.  It
does not import the comparison generator or its intermediate representation.
Paragraphs are aligned from the same accept/reject text projections used by the
compiled checker.  A physical paragraph is used only when its own accept and
reject projections uniquely identify that logical pair. If an aligned logical
pair has common tokens but cannot be identified in a physical compared
paragraph, those tokens are charged as lost: a delete-paragraph/insert-
paragraph replacement cannot evade the authored-redline policy.
-/

namespace EmittedRedlineMinimality

open Lean LeanSpike Tier2.XmlTripleChecker

def maxParagraphDiagnostics : Nat := 64
def maxTokensPerParagraph : Nat := 4096

structure ParagraphPair where
  originalIndex : Nat
  revisedIndex : Nat
  originalText : String
  revisedText : String
  deriving Repr, Inhabited

structure ParagraphEvidence where
  originalParagraphIndex : Nat
  revisedParagraphIndex : Nat
  comparedParagraphIndex : Option Nat
  availableTokens : Nat
  preservedTokens : Nat
  lostTokens : Nat
  efficiencyPercent : Nat
  topology : String
  deriving Repr, Inhabited

structure Evidence where
  passed : Bool
  policy : String
  availableTokens : Nat
  preservedTokens : Nat
  lostTokens : Nat
  efficiencyPercent : Nat
  comparedParagraphs : Nat
  unresolvedTopologyParagraphs : Nat
  diagnostics : List ParagraphEvidence
  deriving Repr, Inhabited

def isWhitespace (c : Char) : Bool :=
  c == ' ' || c == '\t' || c == '\n' || c == '\r'

def isAsciiWord (c : Char) : Bool :=
  ('a' ≤ c && c ≤ 'z') || ('A' ≤ c && c ≤ 'Z') ||
    ('0' ≤ c && c ≤ '9') || c == '_'

inductive TokenMode where
  | whitespace
  | word
  deriving DecidableEq

def flushToken (current : List Char) (out : List String) : List String :=
  if current.isEmpty then out else out ++ [String.ofList current]

def tokenizeChars : List Char → Option TokenMode → List Char → List String → List String
  | [], _, current, out => flushToken current out
  | c :: rest, mode, current, out =>
      if isWhitespace c then
        match mode with
        | some .whitespace => tokenizeChars rest mode (current ++ [c]) out
        | _ => tokenizeChars rest (some .whitespace) [c] (flushToken current out)
      else if isAsciiWord c then
        match mode with
        | some .word => tokenizeChars rest mode (current ++ [c]) out
        | _ => tokenizeChars rest (some .word) [c] (flushToken current out)
      else
        tokenizeChars rest none [] (flushToken current out ++ [String.ofList [c]])

/-- Tokenization is intentionally exact: whitespace and punctuation are tokens,
so a formatting-only comparison cannot silently discard them. -/
def tokenize (text : String) : List String :=
  tokenizeChars text.toList none [] []

def atomOf (value : String) : Atom :=
  { sha1Hash := value, textContent := value, tagName := "emitted-redline-token" }

def lcsMatches (left right : List String) : List (Nat × Nat) :=
  (computeAtomLcs (left.map atomOf) (right.map atomOf)).matches

def normParagraph (tokens : List XmlTok) : String :=
  String.ofList <| normLine <| tokens.foldl (fun text token => text ++ tokenText token) []

def logicalParagraphs (tokens : List XmlTok) : List String :=
  (normalizeText (extractText tokens)).map String.ofList

def physicalParagraphsAux (current : List XmlTok) (out : List (List XmlTok)) :
    List XmlTok → List (List XmlTok)
  | [] => if current.isEmpty then out else out ++ [current]
  | .pBreak :: rest => physicalParagraphsAux [] (out ++ [current]) rest
  | tok :: rest => physicalParagraphsAux (current ++ [tok]) out rest

def physicalParagraphs (tokens : List XmlTok) : List (List XmlTok) :=
  physicalParagraphsAux [] [] tokens

/-- Keep text-node token boundaries. Concatenating before tokenization would
coalesce spaces separated by revision wrappers and falsely lose an otherwise
ordinary LCS whitespace token. -/
def ordinaryTokensAux : List Wrapper → List XmlTok → List String
  | _, [] => []
  | stack, .enter wrapper :: rest => ordinaryTokensAux (wrapper :: stack) rest
  | stack, .exit wrapper :: rest => ordinaryTokensAux (popWrapper wrapper stack) rest
  | stack, .text value :: rest =>
      if stack.isEmpty then tokenize value ++ ordinaryTokensAux stack rest
      else ordinaryTokensAux stack rest
  | stack, _ :: rest => ordinaryTokensAux stack rest

def ordinaryTokens (tokens : List XmlTok) : List String := ordinaryTokensAux [] tokens

def enumerateFrom (offset : Nat) : List α → List (Nat × α)
  | [] => []
  | value :: rest => (offset, value) :: enumerateFrom (offset + 1) rest

def pairSameSizedGap (original revised : List (Nat × String)) : List ParagraphPair :=
  if original.length != revised.length then [] else
    (List.zip original revised).map fun pair => {
      originalIndex := pair.1.1
      revisedIndex := pair.2.1
      originalText := pair.1.2
      revisedText := pair.2.2
    }

/-- Align unchanged paragraphs exactly, then pair only equal-cardinality gaps.
The latter makes a changed paragraph comparable while refusing to infer an
identity through an inserted/deleted paragraph-mark topology. -/
def alignParagraphs (original revised : List String) : List ParagraphPair :=
  let paragraphMatches := lcsMatches original revised
  let rec go (previousOriginal previousRevised : Nat) : List (Nat × Nat) → List ParagraphPair
    | [] =>
        pairSameSizedGap
          (enumerateFrom previousOriginal (original.drop previousOriginal))
          (enumerateFrom previousRevised (revised.drop previousRevised))
    | (originalIndex, revisedIndex) :: rest =>
        let gap := pairSameSizedGap
          (enumerateFrom previousOriginal
            ((original.take originalIndex).drop previousOriginal))
          (enumerateFrom previousRevised
            ((revised.take revisedIndex).drop previousRevised))
        let aligned : ParagraphPair := {
          originalIndex := originalIndex
          revisedIndex := revisedIndex
          originalText := original.getD originalIndex ""
          revisedText := revised.getD revisedIndex ""
        }
        gap ++ [aligned] ++
          go (originalIndex + 1) (revisedIndex + 1) rest
  go 0 0 paragraphMatches

structure ComparedParagraph where
  index : Nat
  acceptText : String
  rejectText : String
  ordinaryTokens : List String
  deriving Repr, Inhabited

def comparedParagraphs (combined : List XmlTok) : List ComparedParagraph :=
  (enumerateFrom 0 (physicalParagraphs combined)).filterMap fun pair =>
    let acceptText := normParagraph (acceptTokens pair.2)
    let rejectText := normParagraph (rejectTokens pair.2)
    if acceptText.isEmpty && rejectText.isEmpty then none else
      some { index := pair.1, acceptText, rejectText, ordinaryTokens := ordinaryTokens pair.2 }

def matchingCompared (pair : ParagraphPair) (compared : List ComparedParagraph) :
    List ComparedParagraph :=
  compared.filter fun paragraph =>
    paragraph.acceptText == pair.revisedText && paragraph.rejectText == pair.originalText

def cappedTokens (text : String) : List String := (tokenize text).take maxTokensPerParagraph

def evidenceForPair (pair : ParagraphPair) (compared : List ComparedParagraph) : ParagraphEvidence :=
  let candidates := matchingCompared pair compared
  match candidates with
  | [paragraph] =>
      let available := lcsMatches (cappedTokens pair.originalText) (cappedTokens pair.revisedText)
      let availableTokens := available.length
      let commonTokens := available.filterMap fun matchPair => (cappedTokens pair.originalText)[matchPair.1]?
      let preservedTokens := lcsMatches commonTokens paragraph.ordinaryTokens |>.length
      let lostTokens := availableTokens - preservedTokens
      { originalParagraphIndex := pair.originalIndex
        revisedParagraphIndex := pair.revisedIndex
        comparedParagraphIndex := some paragraph.index
        availableTokens
        preservedTokens
        lostTokens
        efficiencyPercent := if availableTokens == 0 then 100 else 100 * preservedTokens / availableTokens
        topology := "identified" }
  | _ =>
      let availableTokens := lcsMatches (cappedTokens pair.originalText)
        (cappedTokens pair.revisedText) |>.length
      { originalParagraphIndex := pair.originalIndex
        revisedParagraphIndex := pair.revisedIndex
        comparedParagraphIndex := none
        availableTokens
        preservedTokens := 0
        lostTokens := availableTokens
        efficiencyPercent := if availableTokens == 0 then 100 else 0
        topology := "unresolved_ambiguous_paragraph_topology" }

def check (original revised combined : List XmlTok) : Evidence :=
  let pairs := alignParagraphs (logicalParagraphs (rejectTokens original))
    (logicalParagraphs (acceptTokens revised))
  let compared := comparedParagraphs combined
  let allEvidence := pairs.map fun pair => evidenceForPair pair compared
  let availableTokens := allEvidence.map (·.availableTokens) |>.sum
  let preservedTokens := allEvidence.map (·.preservedTokens) |>.sum
  let lostTokens := allEvidence.map (·.lostTokens) |>.sum
  { passed := lostTokens == 0
    policy := "authored-zero-loss"
    availableTokens
    preservedTokens
    lostTokens
    efficiencyPercent := if availableTokens == 0 then 100 else 100 * preservedTokens / availableTokens
    comparedParagraphs := compared.length
    unresolvedTopologyParagraphs := allEvidence.filter (·.topology != "identified") |>.length
    diagnostics := allEvidence.take maxParagraphDiagnostics }

def paragraphEvidenceJson (evidence : ParagraphEvidence) : Json :=
  Json.mkObj [
    ("originalParagraphIndex", toJson evidence.originalParagraphIndex),
    ("revisedParagraphIndex", toJson evidence.revisedParagraphIndex),
    ("comparedParagraphIndex", match evidence.comparedParagraphIndex with
      | some index => toJson index | none => Json.null),
    ("availableTokens", toJson evidence.availableTokens),
    ("preservedTokens", toJson evidence.preservedTokens),
    ("lostTokens", toJson evidence.lostTokens),
    ("efficiencyPercent", toJson evidence.efficiencyPercent),
    ("topology", toJson evidence.topology)
  ]

def evidenceJson (evidence : Evidence) : Json :=
  Json.mkObj [
    ("policy", toJson evidence.policy),
    ("passed", toJson evidence.passed),
    ("availableTokens", toJson evidence.availableTokens),
    ("preservedTokens", toJson evidence.preservedTokens),
    ("lostTokens", toJson evidence.lostTokens),
    ("efficiencyPercent", toJson evidence.efficiencyPercent),
    ("comparedParagraphs", toJson evidence.comparedParagraphs),
    ("unresolvedTopologyParagraphs", toJson evidence.unresolvedTopologyParagraphs),
    ("paragraphDiagnostics", Json.arr (evidence.diagnostics.map paragraphEvidenceJson).toArray)
  ]

namespace Regression

def surgical (before after : String) (leading trailing : String := "") : List XmlTok :=
  [ .text leading, .enter .del, .delText before, .exit .del,
    .enter .ins, .text after, .exit .ins, .text trailing ]

example : (check [.pBreak, .text "keep old tail"] [.pBreak, .text "keep new tail"]
    ([.pBreak] ++ surgical "old" "new" "keep " " tail")).passed = true := by native_decide

example : (check [.pBreak, .text "keep old tail"] [.pBreak, .text "keep new tail"]
    [.pBreak, .enter .del, .delText "keep old tail", .exit .del,
     .enter .ins, .text "keep new tail", .exit .ins]).passed = false := by native_decide

example : (check [.pBreak, .text "x x x"] [.pBreak, .text "x y x"]
    ([.pBreak] ++ surgical "x" "y" "x " " x")).passed = true := by native_decide

example : (check [.pBreak, .text "Hello, world!"] [.pBreak, .text "Hello, brave world!"]
    ([.pBreak] ++ surgical "" "brave " "Hello, " "world!")).passed = true := by native_decide

example : (check [.pBreak, .text "a  b"] [.pBreak, .text "a  c b"]
    ([.pBreak] ++ surgical "" "c " "a  " "b")).passed = true := by native_decide

example : (check [.pBreak, .text "a b"] [.pBreak, .text "a x b"]
    ([.pBreak] ++ surgical "" "x " "a " "b")).passed = true := by native_decide

example : (check [.pBreak, .text "a x b"] [.pBreak, .text "a b"]
    ([.pBreak] ++ surgical "x " "" "a " "b")).passed = true := by native_decide

/-- Exact accept/reject projections do not excuse a coarse paragraph split. -/
example : (check [.pBreak, .text "keep old tail"] [.pBreak, .text "keep new tail"]
    [.pBreak,
     .enter .del, .delText "keep old tail", .exit .del,
     .pBreak,
     .enter .ins, .text "keep new tail", .exit .ins]).passed = false := by native_decide

/-- A physical paragraph insertion has no aligned logical pair and therefore
does not charge neighboring ordinary paragraphs. -/
example : (check [.pBreak, .text "alpha", .pBreak, .text "beta"]
    [.pBreak, .text "alpha", .pBreak, .text "beta"]
    [.pBreak, .text "alpha", .pBreak, .text "inserted", .pBreak, .text "beta"]).lostTokens = 0 := by native_decide

end Regression

end EmittedRedlineMinimality
