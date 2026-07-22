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

inductive MoveRangeKind
  | source
  | destination
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
  | moveRangeStart (k : MoveRangeKind) (id : Int) (name : String)
  | moveRangeEnd (k : MoveRangeKind) (id : Int)
  | invalidMoveRangeId
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

def isXmlSpace (c : Char) : Bool :=
  c == ' ' || c == '\t' || c == '\n' || c == '\r'

def tagWords (tag : String) : List String :=
  let normalized := ((tag.replace "\n" " ").replace "\r" " ").replace "\t" " "
  normalized.splitOn " " |>.filter (· != "")

def tagName (tag : String) : String :=
  let first := List.getD (tagWords tag) 0 tag
  first.replace "/" ""

def isStartTag (tag name : String) : Bool :=
  !tag.startsWith "/" && tagName tag == name

def isEndTag (tag name : String) : Bool :=
  tag.startsWith ("/" ++ name)

def tagPayloadAux : List Char → Option Char → List Char → Except String (String × String)
  | [], _, _ => throw "malformed XML tag without closing >"
  | c :: rest, some quote, acc =>
    if c == quote then tagPayloadAux rest none (c :: acc)
    else tagPayloadAux rest (some quote) (c :: acc)
  | c :: rest, none, acc =>
    if c == '"' || c == '\'' then tagPayloadAux rest (some c) (c :: acc)
    else if c == '>' then return (String.ofList acc.reverse, String.ofList rest)
    else tagPayloadAux rest none (c :: acc)

def tagPayload (segment : String) : Except String (String × String) :=
  tagPayloadAux segment.toList none []

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

abbrev XmlAttributes := List (String × String)

inductive AttributeScanMode
  | between
  | name
  | beforeEquals
  | beforeValue
  | value (quote : Char)
  deriving DecidableEq, Repr, Inhabited

structure AttributeScanState where
  mode : AttributeScanMode := .between
  name : String := ""
  value : String := ""
  attributes : XmlAttributes := []
  valid : Bool := true
  deriving Repr, Inhabited

def scanAttributeChar (state : AttributeScanState) (c : Char) : AttributeScanState :=
  if !state.valid then state
  else match state.mode with
  | .between =>
    if isXmlSpace c || c == '/' then state
    else { state with mode := .name, name := state.name.push c }
  | .name =>
    if c == '=' then { state with mode := .beforeValue }
    else if isXmlSpace c then { state with mode := .beforeEquals }
    else { state with name := state.name.push c }
  | .beforeEquals =>
    if isXmlSpace c then state
    else if c == '=' then { state with mode := .beforeValue }
    else { state with valid := false }
  | .beforeValue =>
    if isXmlSpace c then state
    else if c == '"' || c == '\'' then { state with mode := .value c }
    else { state with valid := false }
  | .value quote =>
    if c == quote then
      { mode := .between, attributes := state.attributes ++ [(state.name, state.value)] }
    else { state with value := state.value.push c }

def attributeSuffix (tag : String) : String :=
  let chars := tag.toList.dropWhile (fun c => !isXmlSpace c)
  String.ofList chars

def parseTagAttributes (tag : String) : Except String XmlAttributes := do
  let final := (attributeSuffix tag).toList.foldl scanAttributeChar {}
  if !final.valid || final.mode != .between then throw "malformed XML attributes"
  return final.attributes

def namespaceDeclarations (attributes : XmlAttributes) : List (String × String) :=
  attributes.filterMap fun (key, value) =>
    if key == "xmlns" then some ("", decodeXmlText value)
    else if key.startsWith "xmlns:" then
      some ((key.drop "xmlns:".length).toString, decodeXmlText value)
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

def canonicalizeWmlAttributes (attributes : XmlAttributes)
    (bindings : NamespaceBindings) : XmlAttributes :=
  attributes.filterMap fun (key, value) =>
    if key == "xmlns" || key.startsWith "xmlns:" then none
    else
    let (pre, attrLocal) := splitQName key
    if !pre.isEmpty && namespaceLookupD bindings pre "" == wmlNamespace then
      some ("w:" ++ attrLocal, decodeXmlText value)
    else some (key, decodeXmlText value)

def validateAttributeNamespaces (attributes : XmlAttributes)
    (bindings : NamespaceBindings) : Except String Unit := do
  for (key, _) in attributes do
    if key == "xmlns" || key.startsWith "xmlns:" then continue
    let (pre, _) := splitQName key
    if !pre.isEmpty && (namespaceLookup bindings pre).isNone then
      throw s!"unbound namespace prefix on attribute: {pre}"

def tagAttribute (attributes : XmlAttributes) (key : String) : String :=
  match attributes.find? (fun binding => binding.1 == key) with
  | some binding => binding.2
  | none => ""

def isAsciiDigit (c : Char) : Bool :=
  '0' ≤ c && c ≤ '9'

def decimalDigitsToNat (digits : List Char) : Nat :=
  digits.foldl (fun value digit => value * 10 + (digit.toNat - '0'.toNat)) 0

def parseDecimalNumber (value : String) : Option Int :=
  let collapsed := value.trimAscii.toString
  let (negative, digits) := match collapsed.toList with
    | '+' :: rest => (false, rest)
    | '-' :: rest => (true, rest)
    | rest => (false, rest)
  if digits.isEmpty || !digits.all isAsciiDigit then none
  else
    let magnitude := Int.ofNat (decimalDigitsToNat digits)
    some (if negative then -magnitude else magnitude)

def moveRangeStartToken (kind : MoveRangeKind) (attributes : XmlAttributes) : List XmlTok :=
  match parseDecimalNumber (tagAttribute attributes "w:id") with
  | some id => [.moveRangeStart kind id (tagAttribute attributes "w:name")]
  | none => [.invalidMoveRangeId]

def moveRangeEndToken (kind : MoveRangeKind) (attributes : XmlAttributes) : List XmlTok :=
  match parseDecimalNumber (tagAttribute attributes "w:id") with
  | some id => [.moveRangeEnd kind id]
  | none => [.invalidMoveRangeId]

def tagToken (closing : Bool) (localName : String) (attributes : XmlAttributes)
    (payload : String) : List XmlTok :=
  if !closing && (localName == "footnote" || localName == "endnote") &&
      (tagAttribute attributes "w:type" == "separator" ||
       tagAttribute attributes "w:type" == "continuationSeparator") then [.enterReservedNote]
  else if closing && (localName == "footnote" || localName == "endnote") then [.exitReservedNote]
  else if !closing && localName == "p" then [.pBreak]
  else if !closing && localName == "ins" then [.enter .ins]
  else if closing && localName == "ins" then [.exit .ins]
  else if !closing && localName == "del" then [.enter .del]
  else if closing && localName == "del" then [.exit .del]
  else if !closing && localName == "moveFromRangeStart" then
    moveRangeStartToken .source attributes
  else if !closing && localName == "moveFromRangeEnd" then
    moveRangeEndToken .source attributes
  else if !closing && localName == "moveToRangeStart" then
    moveRangeStartToken .destination attributes
  else if !closing && localName == "moveToRangeEnd" then
    moveRangeEndToken .destination attributes
  else if !closing && localName == "moveFrom" then [.enter .moveFrom]
  else if closing && localName == "moveFrom" then [.exit .moveFrom]
  else if !closing && localName == "moveTo" then [.enter .moveTo]
  else if closing && localName == "moveTo" then [.exit .moveTo]
  else if !closing && localName == "fldChar" then
    if tagAttribute attributes "w:fldCharType" == "begin" then [.fldChar .begin]
    else if tagAttribute attributes "w:fldCharType" == "separate" then [.fldChar .separate]
    else if tagAttribute attributes "w:fldCharType" == "end" then [.fldChar .endf]
    else []
  else if !closing && localName == "t" then [.text (decodeXmlText payload)]
  else if !closing && localName == "delText" then [.delText (decodeXmlText payload)]
  else if !closing && localName == "instrText" then [.instrText (decodeXmlText payload)]
  else if !closing && localName == "delInstrText" then [.delInstrText (decodeXmlText payload)]
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
  let (tag, payload) ← tagPayload segment
  let trimmed := tag.trimAscii.toString
  if trimmed.isEmpty then throw "empty XML tag"
  if trimmed.startsWith "?" || trimmed.startsWith "!" then return state
  if trimmed.startsWith "/" then
    let rawName := ((List.getD (tagWords trimmed) 0 "").drop 1).toString
    let some top := state.stack.head? | throw "unexpected closing tag"
    let (uri, localName) ← resolveQName top.namespaces rawName
    if uri != top.uri || localName != top.localName then
      throw s!"mismatched closing tag: {rawName}"
    let emitted := if uri == wmlNamespace then tagToken true localName [] payload else []
    return { state with stack := state.stack.drop 1, tokens := state.tokens ++ emitted }
  let selfClosing := trimmed.endsWith "/"
  if state.rootSeen && state.stack.isEmpty then throw "multiple XML root elements"
  let rawName := List.getD (tagWords trimmed) 0 ""
  let attributes ← parseTagAttributes trimmed
  let bindings := extendNamespaces (currentNamespaces state) (namespaceDeclarations attributes)
  validateAttributeNamespaces attributes bindings
  let (uri, localName) ← resolveQName bindings rawName
  if !state.rootSeen then
    if uri != wmlNamespace || localName != expectedRoot then
      throw s!"unexpected root namespace={uri} local={localName}; expected namespace={wmlNamespace} local={expectedRoot}"
  let canonicalAttributes := canonicalizeWmlAttributes attributes bindings
  let emitted := if uri == wmlNamespace then tagToken false localName canonicalAttributes payload else []
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

structure MoveRangeFrame where
  kind : MoveRangeKind
  id : Int
  name : String
  deriving DecidableEq, Repr, Inhabited

structure MoveRangeState where
  stack : List MoveRangeFrame := []
  seenIds : List Int := []
  sourceNames : List String := []
  destinationNames : List String := []
  valid : Bool := true
  deriving Repr, Inhabited

def invalidateMoveRanges (state : MoveRangeState) : MoveRangeState :=
  { state with valid := false }

def moveRangeStartInvalid (state : MoveRangeState) (kind : MoveRangeKind)
    (id : Int) (name : String) : Bool :=
  let directionNames := match kind with
    | .source => state.sourceNames
    | .destination => state.destinationNames
  !state.valid || name.isEmpty || state.seenIds.contains id || directionNames.contains name

def stepMoveRanges (state : MoveRangeState) : XmlTok → MoveRangeState
  | .moveRangeStart kind id name =>
    if moveRangeStartInvalid state kind id name then
      invalidateMoveRanges state
    else
      { state with
        stack := { kind, id, name } :: state.stack
        seenIds := id :: state.seenIds
        sourceNames := if kind == .source then name :: state.sourceNames else state.sourceNames
        destinationNames :=
          if kind == .destination then name :: state.destinationNames else state.destinationNames }
  | .moveRangeEnd kind id =>
    match state.stack with
    | top :: rest =>
      if state.valid && top.kind == kind && top.id == id then
        { state with stack := rest }
      else
        invalidateMoveRanges state
    | [] => invalidateMoveRanges state
  | .invalidMoveRangeId => invalidateMoveRanges state
  | _ => state

def moveRangeNamesMatch (sourceNames destinationNames : List String) : Bool :=
  sourceNames.length == destinationNames.length &&
  sourceNames.all destinationNames.contains &&
  destinationNames.all sourceNames.contains

def validateMoveRanges (toks : List XmlTok) : Bool :=
  let final := toks.foldl stepMoveRanges {}
  final.valid && final.stack.isEmpty &&
    moveRangeNamesMatch final.sourceNames final.destinationNames

def isMoveRangeMarker : XmlTok → Bool
  | .moveRangeStart .. => true
  | .moveRangeEnd .. => true
  | .invalidMoveRangeId => true
  | _ => false

inductive MoveRangeTransition : MoveRangeState → XmlTok → MoveRangeState → Prop
  | other (state : MoveRangeState) (tok : XmlTok) (h : isMoveRangeMarker tok = false) :
      MoveRangeTransition state tok state
  | start (state : MoveRangeState) (kind : MoveRangeKind) (id : Int) (name : String)
      (h : moveRangeStartInvalid state kind id name = false) :
      MoveRangeTransition state (.moveRangeStart kind id name)
        { state with
          stack := { kind, id, name } :: state.stack
          seenIds := id :: state.seenIds
          sourceNames := if kind == .source then name :: state.sourceNames else state.sourceNames
          destinationNames :=
            if kind == .destination then name :: state.destinationNames else state.destinationNames }
  | end (state : MoveRangeState) (kind : MoveRangeKind) (id : Int)
      (top : MoveRangeFrame) (rest : List MoveRangeFrame)
      (hStack : state.stack = top :: rest)
      (hValid : state.valid = true) (hKind : top.kind = kind) (hId : top.id = id) :
      MoveRangeTransition state (.moveRangeEnd kind id) { state with stack := rest }

inductive MoveRangeTrace : MoveRangeState → List XmlTok → MoveRangeState → Prop
  | nil (state : MoveRangeState) : MoveRangeTrace state [] state
  | cons (initial next final : MoveRangeState) (tok : XmlTok) (rest : List XmlTok)
      (head : MoveRangeTransition initial tok next)
      (tail : MoveRangeTrace next rest final) :
      MoveRangeTrace initial (tok :: rest) final

def MoveRangesWellFormed (toks : List XmlTok) : Prop :=
  ∃ final : MoveRangeState,
    MoveRangeTrace {} toks final ∧
    final.stack = [] ∧
    final.sourceNames.length = final.destinationNames.length ∧
    (∀ name ∈ final.sourceNames, name ∈ final.destinationNames) ∧
    (∀ name ∈ final.destinationNames, name ∈ final.sourceNames)

theorem stepMoveRanges_invalid (state : MoveRangeState) (tok : XmlTok)
    (h : state.valid = false) : (stepMoveRanges state tok).valid = false := by
  cases tok with
  | moveRangeStart kind id name =>
    cases hInvalid : moveRangeStartInvalid state kind id name <;>
      simp [stepMoveRanges, hInvalid, invalidateMoveRanges, h]
  | moveRangeEnd =>
    cases hStack : state.stack <;> simp [stepMoveRanges, hStack, invalidateMoveRanges, h]
  | invalidMoveRangeId => simp [stepMoveRanges, invalidateMoveRanges]
  | pBreak | enter | exit | text | delText | instrText | delInstrText | fldChar |
      enterReservedNote | exitReservedNote => simp [stepMoveRanges, h]

theorem foldMoveRanges_invalid (state : MoveRangeState) (toks : List XmlTok)
    (h : state.valid = false) : (toks.foldl stepMoveRanges state).valid = false := by
  induction toks generalizing state with
  | nil => exact h
  | cons tok rest ih =>
    exact ih (stepMoveRanges state tok) (stepMoveRanges_invalid state tok h)

theorem stepMoveRanges_transition_of_valid (state : MoveRangeState) (tok : XmlTok)
    (h : (stepMoveRanges state tok).valid = true) :
    MoveRangeTransition state tok (stepMoveRanges state tok) := by
  cases tok with
  | moveRangeStart kind id name =>
    cases hInvalid : moveRangeStartInvalid state kind id name with
    | false =>
      have transition := MoveRangeTransition.start state kind id name hInvalid
      simpa only [stepMoveRanges, hInvalid] using transition
    | true => simp [stepMoveRanges, hInvalid, invalidateMoveRanges] at h
  | moveRangeEnd kind id =>
    cases hStack : state.stack with
    | nil => simp [stepMoveRanges, hStack, invalidateMoveRanges] at h
    | cons top rest =>
      cases hValid : (state.valid && top.kind == kind && top.id == id) with
      | false => simp [stepMoveRanges, hStack, hValid, invalidateMoveRanges] at h
      | true =>
        have hParts : state.valid = true ∧ top.kind = kind ∧ top.id = id := by
          simp only [Bool.and_eq_true, beq_iff_eq] at hValid
          exact ⟨hValid.1.1, hValid.1.2, hValid.2⟩
        have transition := MoveRangeTransition.end state kind id top rest hStack
          hParts.1 hParts.2.1 hParts.2.2
        simpa only [stepMoveRanges, hStack, hValid] using transition
  | invalidMoveRangeId => simp [stepMoveRanges, invalidateMoveRanges] at h
  | pBreak => exact .other state .pBreak rfl
  | enter wrapper => exact .other state (.enter wrapper) rfl
  | exit wrapper => exact .other state (.exit wrapper) rfl
  | text value => exact .other state (.text value) rfl
  | delText value => exact .other state (.delText value) rfl
  | instrText value => exact .other state (.instrText value) rfl
  | delInstrText value => exact .other state (.delInstrText value) rfl
  | fldChar kind => exact .other state (.fldChar kind) rfl
  | enterReservedNote => exact .other state .enterReservedNote rfl
  | exitReservedNote => exact .other state .exitReservedNote rfl

theorem foldMoveRanges_trace_of_valid (state : MoveRangeState) (toks : List XmlTok)
    (h : (toks.foldl stepMoveRanges state).valid = true) :
    MoveRangeTrace state toks (toks.foldl stepMoveRanges state) := by
  induction toks generalizing state with
  | nil => exact .nil state
  | cons tok rest ih =>
    have hStep : (stepMoveRanges state tok).valid = true := by
      cases hValid : (stepMoveRanges state tok).valid with
      | false =>
        have := foldMoveRanges_invalid (stepMoveRanges state tok) rest hValid
        simp_all
      | true => rfl
    exact .cons state (stepMoveRanges state tok) (rest.foldl stepMoveRanges (stepMoveRanges state tok))
      tok rest (stepMoveRanges_transition_of_valid state tok hStep)
      (ih (stepMoveRanges state tok) h)

theorem validateMoveRanges_sound (toks : List XmlTok) (h : validateMoveRanges toks = true) :
    MoveRangesWellFormed toks := by
  let final := toks.foldl stepMoveRanges {}
  have hParts : (final.valid = true ∧ final.stack.isEmpty = true) ∧
      moveRangeNamesMatch final.sourceNames final.destinationNames = true := by
    simpa only [validateMoveRanges, final, Bool.and_eq_true] using h
  have hNames : final.sourceNames.length = final.destinationNames.length ∧
      (∀ name ∈ final.sourceNames, name ∈ final.destinationNames) ∧
      (∀ name ∈ final.destinationNames, name ∈ final.sourceNames) := by
    have hMatch := hParts.2
    simp only [moveRangeNamesMatch, Bool.and_eq_true, beq_iff_eq, List.all_eq_true] at hMatch
    exact ⟨hMatch.1.1, fun name hName => List.contains_iff_mem.mp (hMatch.1.2 name hName),
      fun name hName => List.contains_iff_mem.mp (hMatch.2 name hName)⟩
  exact ⟨final, foldMoveRanges_trace_of_valid {} toks hParts.1.1,
    List.isEmpty_iff.mp hParts.1.2, hNames.1, hNames.2.1, hNames.2.2⟩

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
  combinedHasValidMoveRanges : Bool
  deriving Repr, Inhabited

def CheckReport.passed (r : CheckReport) : Bool :=
  r.acceptPreservesFieldStructure &&
  r.rejectPreservesFieldStructure &&
  r.acceptTextMatchesRevised &&
  r.rejectTextMatchesOriginal &&
  r.combinedHasNoFldCharInsideDel &&
  r.combinedHasValidMoveRanges

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
    combinedHasValidMoveRanges := validateMoveRanges combined
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
    (comparisonCheckerB original revised combined).combinedHasNoFldCharInsideDel = true ∧
    MoveRangesWellFormed combined := by
  simp only [CheckReport.passed, Bool.and_eq_true] at h
  rcases h with ⟨⟨⟨⟨⟨hAccept, hReject⟩, hAcceptText⟩, hRejectText⟩, hNoDelField⟩, hMoveRanges⟩
  exact ⟨hAccept, hReject, hAcceptText, hRejectText, hNoDelField,
    validateMoveRanges_sound combined hMoveRanges⟩

theorem story_collection_checker_sound (stories : List NamedStoryTriple)
    (h : storyCollectionPassed (checkStoryCollection stories) = true) :
    ∀ story ∈ stories,
      let report := comparisonCheckerB story.original story.revised story.combined
      report.acceptPreservesFieldStructure = true ∧
      report.rejectPreservesFieldStructure = true ∧
      report.acceptTextMatchesRevised = true ∧
      report.rejectTextMatchesOriginal = true ∧
      report.combinedHasNoFldCharInsideDel = true ∧
      MoveRangesWellFormed story.combined := by
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
        , ("combinedHasValidMoveRanges", boolJson r.combinedHasValidMoveRanges)
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
