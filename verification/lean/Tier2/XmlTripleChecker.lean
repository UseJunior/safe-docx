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

def wmlNamespace : String :=
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

def normalizeTagWhitespace (tag : String) : String :=
  ((tag.replace "\n" " ").replace "\r" " ").replace "\t" " "

def tagWords (tag : String) : List String :=
  (normalizeTagWhitespace tag).splitOn " " |>.filter (· != "")

def tagName (tag : String) : String :=
  let first := List.getD (tagWords tag) 0 tag
  first.replace "/" ""

def isStartTag (tag name : String) : Bool :=
  !tag.startsWith "/" && tagName tag == name

def isEndTag (tag name : String) : Bool :=
  tag.startsWith ("/" ++ name)

def tagPayload (segment : String) : String × String :=
  match segment.splitOn ">" with
  | [] => ("", "")
  | tag :: rest => (tag, String.intercalate ">" rest)

def splitQName (name : String) : String × String :=
  match name.splitOn ":" with
  | [localName] => ("", localName)
  | [pre, localName] => (pre, localName)
  | _ => ("", "")

abbrev NamespaceBindings := List (String × String)

def namespaceLookup (bindings : NamespaceBindings) (key : String) : Option String :=
  match bindings.find? (fun binding => binding.1 == key) with
  | some binding => some binding.2
  | none => none

def namespaceLookupD (bindings : NamespaceBindings) (key fallback : String) : String :=
  (namespaceLookup bindings key).getD fallback

def attrTokenValue (token key : String) : Option String :=
  let doubleMarker := key ++ "=\""
  let singleMarker := key ++ "='"
  if token.startsWith doubleMarker && token.endsWith "\"" then
    some ((token.drop doubleMarker.length).dropEnd 1).toString
  else if token.startsWith singleMarker && token.endsWith "'" then
    some ((token.drop singleMarker.length).dropEnd 1).toString
  else none

def namespaceDeclarations (tag : String) : List (String × String) :=
  (tagWords tag).filterMap fun rawToken =>
    let token := if rawToken.endsWith "/" then (rawToken.dropEnd 1).toString else rawToken
    if let some value := attrTokenValue token "xmlns" then some ("", value)
    else if token.startsWith "xmlns:" then
      let key := List.getD (token.splitOn "=") 0 ""
      let pre := (List.getD (key.splitOn ":") 1 "")
      (attrTokenValue token key).map fun value => (pre, value)
    else none

def extendNamespaces (base : NamespaceBindings) (decls : List (String × String)) : NamespaceBindings :=
  decls.foldl (fun acc binding => binding :: acc.filter (fun old => old.1 != binding.1)) base

def resolveQName (bindings : NamespaceBindings) (name : String) : Except String (String × String) := do
  let (pre, localName) := splitQName name
  if localName.isEmpty then throw s!"invalid qualified name: {name}"
  if pre.isEmpty then return (namespaceLookupD bindings "" "", localName)
  match namespaceLookup bindings pre with
  | some uri => return (uri, localName)
  | none => throw s!"unbound namespace prefix: {pre}"

def canonicalizeWmlTag (tag localName : String) (bindings : NamespaceBindings) : String :=
  let attrs := (tagWords tag).drop 1 |>.filter (fun token => !token.startsWith "xmlns")
  let attrs := attrs.map fun rawToken =>
    let token := if rawToken.endsWith "/" then (rawToken.dropEnd 1).toString else rawToken
    let key := List.getD (token.splitOn "=") 0 token
    let (pre, attrLocal) := splitQName key
    if !pre.isEmpty && namespaceLookupD bindings pre "" == wmlNamespace then
      match attrTokenValue token key with
      | some value => "w:" ++ attrLocal ++ "=\"" ++ value ++ "\""
      | none => token
    else token
  String.intercalate " " (("w:" ++ localName) :: attrs)

def validateAttributeNamespaces (tag : String) (bindings : NamespaceBindings) : Except String Unit := do
  for rawToken in (tagWords tag).drop 1 do
    let token := if rawToken.endsWith "/" then (rawToken.dropEnd 1).toString else rawToken
    let key := List.getD (token.splitOn "=") 0 token
    if key == "xmlns" || key.startsWith "xmlns:" then continue
    let (pre, _) := splitQName key
    if !pre.isEmpty && (namespaceLookup bindings pre).isNone then
      throw s!"unbound namespace prefix on attribute: {pre}"

def tagToken (tag payload : String) : List XmlTok :=
  if (isStartTag tag "w:footnote" || isStartTag tag "w:endnote") &&
      (tag.contains "w:type=\"separator\"" ||
       tag.contains "w:type=\"continuationSeparator\"") then [.enterReservedNote]
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

structure OpenElement where
  uri : String
  localName : String
  namespaces : NamespaceBindings

structure XmlParseState where
  stack : List OpenElement := []
  tokens : List XmlTok := []
  rootSeen : Bool := false

def currentNamespaces (state : XmlParseState) : NamespaceBindings :=
  match state.stack with
  | top :: _ => top.namespaces
  | [] => [("xml", "http://www.w3.org/XML/1998/namespace")]

def parseXmlSegment (expectedRoot : String) (state : XmlParseState) (segment : String) :
    Except String XmlParseState := do
  let parts := segment.splitOn ">"
  if parts.length < 2 then throw "malformed XML tag without closing >"
  let tag := List.getD parts 0 ""
  let payload := String.intercalate ">" (parts.drop 1)
  let trimmed := tag.trimAscii.toString
  if trimmed.isEmpty then throw "empty XML tag"
  if trimmed.startsWith "?" || trimmed.startsWith "!" then return state
  if trimmed.startsWith "/" then
    let rawName := ((List.getD (tagWords trimmed) 0 "").drop 1).toString
    let some top := state.stack.head? | throw "unexpected closing tag"
    let (uri, localName) ← resolveQName top.namespaces rawName
    if uri != top.uri || localName != top.localName then
      throw s!"mismatched closing tag: {rawName}"
    let emitted := if uri == wmlNamespace then tagToken ("/w:" ++ localName) payload else []
    return { state with stack := state.stack.drop 1, tokens := state.tokens ++ emitted }
  let selfClosing := trimmed.endsWith "/"
  if state.rootSeen && state.stack.isEmpty then throw "multiple XML root elements"
  let rawName := List.getD (tagWords trimmed) 0 ""
  let bindings := extendNamespaces (currentNamespaces state) (namespaceDeclarations trimmed)
  validateAttributeNamespaces trimmed bindings
  let (uri, localName) ← resolveQName bindings rawName
  if !state.rootSeen then
    if uri != wmlNamespace || localName != expectedRoot then
      throw s!"unexpected root namespace={uri} local={localName}; expected namespace={wmlNamespace} local={expectedRoot}"
  let canonical := if uri == wmlNamespace then canonicalizeWmlTag trimmed localName bindings else trimmed
  let emitted := if uri == wmlNamespace then tagToken canonical payload else []
  let next := { state with tokens := state.tokens ++ emitted, rootSeen := true }
  if selfClosing then return next
  return { next with stack := { uri, localName, namespaces := bindings } :: next.stack }

def parseXmlTokensForRoot (xml expectedRoot : String) : Except String (List XmlTok) := do
  let segments := (xml.splitOn "<").drop 1
  if segments.isEmpty then throw "XML has no root element"
  let final ← segments.foldlM (parseXmlSegment expectedRoot) {}
  if !final.rootSeen then throw "XML has no root element"
  if !final.stack.isEmpty then throw "XML has unclosed elements"
  return final.tokens

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

theorem projectUserNoteTokensAux_of_no_reserved (inside : Bool) (toks : List XmlTok)
    (h : toks.all (fun tok => tok != .enterReservedNote && tok != .exitReservedNote) = true) :
    projectUserNoteTokensAux inside toks = if inside then [] else toks := by
  induction toks generalizing inside with
  | nil => simp [projectUserNoteTokensAux]
  | cons tok rest ih =>
    simp only [List.all_cons, Bool.and_eq_true] at h
    rcases h with ⟨⟨hEnter, hExit⟩, hRest⟩
    cases inside <;> cases tok <;> simp_all [projectUserNoteTokensAux]

theorem projectUserNoteTokens_idempotent (toks : List XmlTok) :
    projectUserNoteTokens (projectUserNoteTokens toks) = projectUserNoteTokens toks := by
  apply projectUserNoteTokensAux_of_no_reserved false
  exact projectUserNoteTokens_no_reserved toks

theorem projectUserNoteTokens_typed_reserved (payload : List XmlTok)
    (h : payload.all (fun tok => tok != .enterReservedNote && tok != .exitReservedNote) = true) :
    projectUserNoteTokens (.enterReservedNote :: payload ++ [.exitReservedNote]) = [] := by
  induction payload with
  | nil => simp [projectUserNoteTokens, projectUserNoteTokensAux]
  | cons tok rest ih =>
    simp only [List.all_cons, Bool.and_eq_true] at h
    rcases h with ⟨⟨hEnter, hExit⟩, hRest⟩
    cases tok <;> simp_all [projectUserNoteTokens, projectUserNoteTokensAux]

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
    | .ok (false :: rest) => .ok (true :: rest)
    | .ok _ => .invalid
    | .invalid => .invalid
  | .fldChar .endf =>
    match r with
    | .ok [] => .invalid
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
  toks.countP isBegin == toks.countP isEnd && toks.foldl stepField (.ok []) == .ok []

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
  originalPresent : Bool := true
  revisedPresent : Bool := true
  combinedPresent : Bool := true
  deriving Repr, Inhabited

structure StoryReport where
  name : String
  report : CheckReport
  originalTokenCount : Nat
  revisedTokenCount : Nat
  combinedTokenCount : Nat
  originalPresent : Bool
  revisedPresent : Bool
  combinedPresent : Bool
  deriving Repr, Inhabited

def checkNamedStory (story : NamedStoryTriple) : StoryReport :=
  { name := story.name
    report := comparisonCheckerB story.original story.revised story.combined
    originalTokenCount := story.original.length
    revisedTokenCount := story.revised.length
    combinedTokenCount := story.combined.length
    originalPresent := story.originalPresent
    revisedPresent := story.revisedPresent
    combinedPresent := story.combinedPresent }

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
    , ("presence", Json.mkObj
        [ ("original", toJson r.originalPresent)
        , ("revised", toJson r.revisedPresent)
        , ("combined", toJson r.combinedPresent)
        ])
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson r.originalTokenCount)
        , ("revised", toJson r.revisedTokenCount)
        , ("combined", toJson r.combinedTokenCount)
        ])
    , ("report", reportToJson r.report)
    ]

end Tier2.XmlTripleChecker
