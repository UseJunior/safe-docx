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

def asciiDigitValue (c : Char) : Option Nat :=
  if '0' ≤ c && c ≤ '9' then some (c.toNat - '0'.toNat) else none

def hexDigitValue (c : Char) : Option Nat :=
  if '0' ≤ c && c ≤ '9' then some (c.toNat - '0'.toNat)
  else if 'a' ≤ c && c ≤ 'f' then some (10 + c.toNat - 'a'.toNat)
  else if 'A' ≤ c && c ≤ 'F' then some (10 + c.toNat - 'A'.toNat)
  else none

def parseReferenceDigits (base : Nat) (digitValue : Char → Option Nat)
    (digits : List Char) : Option Nat :=
  if digits.isEmpty then none
  else digits.foldlM (fun value digit => do
    let digitValue ← digitValue digit
    return value * base + digitValue) 0

def isLegalXmlChar (value : Nat) : Bool :=
  value == 0x9 || value == 0xA || value == 0xD ||
    (0x20 ≤ value && value ≤ 0xD7FF) ||
    (0xE000 ≤ value && value ≤ 0xFFFD) ||
    (0x10000 ≤ value && value ≤ 0x10FFFF)

def asciiXmlLiteralByte (value : UInt8) : Bool :=
  value.toNat == 0x9 || value.toNat == 0xA || value.toNat == 0xD ||
    (0x20 ≤ value.toNat && value.toNat ≤ 0x7F)

set_option backward.match.sparseCases false in
def asciiXmlLiteralFastLoop (bytes : ByteArray) : Nat → Bool
  | 0 => true
  | index + 1 =>
      asciiXmlLiteralByte (bytes.get! index) &&
        asciiXmlLiteralFastLoop bytes index

def asciiXmlLiteralFast (value : String) : Bool :=
  asciiXmlLiteralFastLoop value.toUTF8 value.toUTF8.size

set_option backward.match.sparseCases false in
def asciiXmlTextFastLoop (bytes : ByteArray) : Nat → Bool
  | 0 => true
  | index + 1 =>
      let value := bytes.get! index
      asciiXmlLiteralByte value && value.toNat != 0x26 &&
        asciiXmlTextFastLoop bytes index

def asciiXmlTextFast (value : String) : Bool :=
  asciiXmlTextFastLoop value.toUTF8 value.toUTF8.size

set_option backward.match.sparseCases false in
def asciiXmlAttributeFastLoop (bytes : ByteArray) : Nat → Bool
  | 0 => true
  | index + 1 =>
      let value := (bytes.get! index).toNat
      0x20 ≤ value && value ≤ 0x7F && value != 0x26 &&
        asciiXmlAttributeFastLoop bytes index

def asciiXmlAttributeFast (value : String) : Bool :=
  asciiXmlAttributeFastLoop value.toUTF8 value.toUTF8.size

def decodeXmlReference (reference : List Char) : Except String Char := do
  let value ← match reference with
    | ['l', 't'] => pure 0x3C
    | ['g', 't'] => pure 0x3E
    | ['a', 'm', 'p'] => pure 0x26
    | ['q', 'u', 'o', 't'] => pure 0x22
    | ['a', 'p', 'o', 's'] => pure 0x27
    | '#' :: 'x' :: digits =>
      match parseReferenceDigits 16 hexDigitValue digits with
      | some value => pure value
      | none => throw "malformed hexadecimal XML reference"
    | '#' :: digits =>
      match parseReferenceDigits 10 asciiDigitValue digits with
      | some value => pure value
      | none => throw "malformed decimal XML reference"
    | _ => throw "unknown XML entity reference"
  if !isLegalXmlChar value then throw "XML reference is not a legal XML character"
  return Char.ofNat value

partial def decodeXmlTextAux : List Char → List Char → Except String (List Char)
  | [], acc => pure acc.reverse
  | '&' :: rest, acc => do
    let (reference, suffix) := rest.span (· != ';')
    let _ :: after := suffix | throw "unterminated XML reference"
    let decoded ← decodeXmlReference reference
    decodeXmlTextAux after (decoded :: acc)
  | c :: rest, acc => do
    if !isLegalXmlChar c.toNat then throw "literal is not a legal XML character"
    decodeXmlTextAux rest (c :: acc)

def decodeXmlText (s : String) : Except String String := do
  if asciiXmlTextFast s then
    return s
  return String.ofList (← decodeXmlTextAux s.toList [])

partial def decodeXmlAttributeValueAux : List Char → List Char → Except String (List Char)
  | [], acc => pure acc.reverse
  | '&' :: rest, acc => do
    let (reference, suffix) := rest.span (· != ';')
    let _ :: after := suffix | throw "unterminated XML reference"
    let decoded ← decodeXmlReference reference
    decodeXmlAttributeValueAux after (decoded :: acc)
  | '\r' :: '\n' :: rest, acc => decodeXmlAttributeValueAux rest (' ' :: acc)
  | '\r' :: rest, acc => decodeXmlAttributeValueAux rest (' ' :: acc)
  | '\n' :: rest, acc => decodeXmlAttributeValueAux rest (' ' :: acc)
  | '\t' :: rest, acc => decodeXmlAttributeValueAux rest (' ' :: acc)
  | c :: rest, acc => do
    if !isLegalXmlChar c.toNat then throw "literal is not a legal XML character"
    decodeXmlAttributeValueAux rest (c :: acc)

def decodeXmlAttributeValue (s : String) : Except String String := do
  if asciiXmlAttributeFast s then
    return s
  return String.ofList (← decodeXmlAttributeValueAux s.toList [])

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

structure TagPayloadScanState where
  quote : Option Char := none
  index : Nat := 0
  delimiter : Option Nat := none

def scanTagPayloadChar
    (state : TagPayloadScanState) (c : Char) : TagPayloadScanState :=
  if state.delimiter.isSome then state
  else
    match state.quote with
    | some quote =>
        { state with
          quote := if c == quote then none else some quote
          index := state.index + 1 }
    | none =>
        if c == '"' || c == '\'' then
          { state with quote := some c, index := state.index + 1 }
        else if c == '>' then
          { state with delimiter := some state.index }
        else
          { state with index := state.index + 1 }

def tagPayload (segment : String) : Except String (String × String) :=
  let final := segment.foldl scanTagPayloadChar {}
  match final.delimiter with
  | none => throw "malformed XML tag without closing >"
  | some index =>
      pure (segment.take index |>.toString,
        segment.drop (index + 1) |>.toString)

def isXmlNameStartChar (c : Char) : Bool :=
  let value := c.toNat
  ('A' ≤ c && c ≤ 'Z') || ('a' ≤ c && c ≤ 'z') || c == '_' ||
    (0xC0 ≤ value && value ≤ 0xD6) || (0xD8 ≤ value && value ≤ 0xF6) ||
    (0xF8 ≤ value && value ≤ 0x2FF) || (0x370 ≤ value && value ≤ 0x37D) ||
    (0x37F ≤ value && value ≤ 0x1FFF) || (0x200C ≤ value && value ≤ 0x200D) ||
    (0x2070 ≤ value && value ≤ 0x218F) || (0x2C00 ≤ value && value ≤ 0x2FEF) ||
    (0x3001 ≤ value && value ≤ 0xD7FF) || (0xF900 ≤ value && value ≤ 0xFDCF) ||
    (0xFDF0 ≤ value && value ≤ 0xFFFD) || (0x10000 ≤ value && value ≤ 0xEFFFF)

def isXmlNameChar (c : Char) : Bool :=
  let value := c.toNat
  isXmlNameStartChar c || c == '-' || c == '.' || ('0' ≤ c && c ≤ '9') ||
    value == 0xB7 || (0x0300 ≤ value && value ≤ 0x036F) ||
    (0x203F ≤ value && value ≤ 0x2040)

def isValidNcName (name : String) : Bool :=
  match name.toList with
  | [] => false
  | first :: rest => isXmlNameStartChar first && rest.all isXmlNameChar

def parseQName (name : String) : Except String (String × String) := do
  match name.splitOn ":" with
  | [localName] =>
    if isValidNcName localName then return ("", localName)
    throw s!"invalid qualified name: {name}"
  | [pre, localName] =>
    if isValidNcName pre && isValidNcName localName then return (pre, localName)
    throw s!"invalid qualified name: {name}"
  | _ => throw s!"invalid qualified name: {name}"

abbrev NamespaceBindings := List (String × String)

def namespaceLookup (bindings : NamespaceBindings) (key : String) : Option String :=
  match bindings.find? (fun binding => binding.1 == key) with
  | some binding => some binding.2
  | none => none

def namespaceLookupD (bindings : NamespaceBindings) (key fallback : String) : String :=
  (namespaceLookup bindings key).getD fallback

abbrev XmlAttributes := List (String × String)

def xmlNamespace : String :=
  "http://www.w3.org/XML/1998/namespace"

def xmlnsNamespace : String :=
  "http://www.w3.org/2000/xmlns/"

inductive AttributeScanMode
  | between
  | name
  | beforeEquals
  | beforeValue
  | value (quote : Char)
  | afterValue
  | trailingSlash
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
    if isXmlSpace c then state
    else if c == '/' then { state with mode := .trailingSlash }
    else if c == '=' || c == '"' || c == '\'' || c == '<' || c == '>' then
      { state with valid := false }
    else { state with mode := .name, name := state.name.push c }
  | .name =>
    if c == '=' then { state with mode := .beforeValue }
    else if isXmlSpace c then { state with mode := .beforeEquals }
    else if c == '"' || c == '\'' || c == '<' || c == '>' || c == '/' then
      { state with valid := false }
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
      { mode := .afterValue, attributes := state.attributes ++ [(state.name, state.value)] }
    else if c == '<' then { state with valid := false }
    else { state with value := state.value.push c }
  | .afterValue =>
    if isXmlSpace c then { state with mode := .between }
    else if c == '/' then { state with mode := .trailingSlash }
    else { state with valid := false }
  | .trailingSlash =>
    if isXmlSpace c then state else { state with valid := false }

def attributeSuffix (tag : String) : String :=
  tag.dropWhile (fun c => !isXmlSpace c) |>.toString

def parseTagAttributes (tag : String) : Except String XmlAttributes := do
  let final := (attributeSuffix tag).foldl scanAttributeChar {}
  let complete := final.mode == .between || final.mode == .afterValue ||
    final.mode == .trailingSlash
  if !final.valid || !complete then throw "malformed XML attributes"
  if final.attributes.any (fun attr =>
      (final.attributes.filter fun other => other.1 == attr.1).length > 1) then
    throw "duplicate XML attribute name"
  return final.attributes

def decodeXmlAttributes (attributes : XmlAttributes) : Except String XmlAttributes :=
  attributes.mapM fun (key, value) => return (key, ← decodeXmlAttributeValue value)

def validateNamespaceDeclaration (pre uri : String) : Except String Unit := do
  if pre == "xmlns" then throw "the xmlns prefix cannot be rebound"
  if pre == "xml" && uri != xmlNamespace then throw "the xml prefix has a fixed namespace"
  if pre != "xml" && uri == xmlNamespace then throw "the XML namespace requires the xml prefix"
  if uri == xmlnsNamespace then throw "the xmlns namespace cannot be bound"
  if !pre.isEmpty && uri.isEmpty then throw "a namespace prefix cannot bind an empty URI"

def namespaceDeclarations (attributes : XmlAttributes) : Except String (List (String × String)) :=
  attributes.foldlM (fun declarations (key, value) => do
    if key == "xmlns" then
      validateNamespaceDeclaration "" value
      return ("", value) :: declarations
    let (pre, localName) ← parseQName key
    if pre == "xmlns" then
      validateNamespaceDeclaration localName value
      return (localName, value) :: declarations
    return declarations) []

def extendNamespaces (base : NamespaceBindings) (decls : List (String × String)) : NamespaceBindings :=
  decls.foldl (fun acc binding => binding :: acc.filter (fun old => old.1 != binding.1)) base

def resolveQName (bindings : NamespaceBindings) (name : String) : Except String (String × String) := do
  let (pre, localName) ← parseQName name
  if pre.isEmpty then return (namespaceLookupD bindings "" "", localName)
  match namespaceLookup bindings pre with
  | some uri => return (uri, localName)
  | none => throw s!"unbound namespace prefix: {pre}"

def resolveAttributeQName (bindings : NamespaceBindings) (name : String) :
    Except String (String × String) := do
  let (pre, localName) ← parseQName name
  if pre.isEmpty then return ("", localName)
  match namespaceLookup bindings pre with
  | some uri => return (uri, localName)
  | none => throw s!"unbound namespace prefix on attribute: {pre}"

structure ExpandedXmlAttribute where
  uri : String
  localName : String
  value : String
  deriving BEq, DecidableEq, Repr

def expandOrdinaryAttributes (attributes : XmlAttributes)
    (bindings : NamespaceBindings) : Except String (List ExpandedXmlAttribute) :=
  attributes.foldlM (fun expanded (key, value) => do
    if key == "xmlns" || key.startsWith "xmlns:" then return expanded
    let (uri, localName) ← resolveAttributeQName bindings key
    return expanded ++ [{ uri, localName, value }]) []

def validateUniqueExpandedAttributes (attributes : List ExpandedXmlAttribute) :
    Except String Unit := do
  let _ ← attributes.foldlM (fun expandedNames attr => do
    let expandedName := (attr.uri, attr.localName)
    if expandedNames.contains expandedName then
      throw "duplicate XML attribute expanded name"
    return expandedName :: expandedNames) []

def canonicalizeAttributes (attributes : List ExpandedXmlAttribute) : XmlAttributes :=
  attributes.map fun attr =>
    if attr.uri == wmlNamespace then ("w:" ++ attr.localName, attr.value)
    else if attr.uri.isEmpty then (attr.localName, attr.value)
    else ("{" ++ attr.uri ++ "}" ++ attr.localName, attr.value)

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

def tagTokenDecoded (closing : Bool) (localName : String) (attributes : XmlAttributes)
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
  else if !closing && localName == "t" then [.text payload]
  else if !closing && localName == "delText" then [.delText payload]
  else if !closing && localName == "instrText" then [.instrText payload]
  else if !closing && localName == "delInstrText" then [.delInstrText payload]
  else []

def balanceSelfClosingTagTokens (localName : String) (selfClosing : Bool)
    (opening : List XmlTok) : List XmlTok :=
  if selfClosing then opening ++ tagTokenDecoded true localName [] "" else opening

def tagToken (closing : Bool) (localName : String) (attributes : XmlAttributes)
    (payload : String) : Except String (List XmlTok) := do
  return tagTokenDecoded closing localName attributes (← decodeXmlText payload)

structure OpenElement where
  uri : String
  localName : String
  namespaces : NamespaceBindings

structure XmlParseState where
  stack : List OpenElement := []
  tokens : List XmlTok := []
  rootSeen : Bool := false
  declarationAllowed : Bool := false

def currentNamespaces (state : XmlParseState) : NamespaceBindings :=
  match state.stack with
  | top :: _ => top.namespaces
  | [] => [("xml", xmlNamespace)]

def dropLastString (value : String) : String :=
  String.ofList value.toList.dropLast

def asciiLowerChar (c : Char) : Char :=
  if 'A' ≤ c && c ≤ 'Z' then Char.ofNat (c.toNat + ('a'.toNat - 'A'.toNat)) else c

def isUtf8Encoding (value : String) : Bool :=
  String.ofList (value.toList.map asciiLowerChar) == "utf-8"

def parseXmlDeclaration (trimmed : String) : Except String Unit := do
  if !trimmed.endsWith "?" then throw "malformed XML declaration"
  let body := dropLastString (trimmed.drop 1).toString
  let attributes ← parseTagAttributes body
  if attributes.any (fun attr => attr.2.contains '&') then
    throw "XML declaration values cannot contain references"
  match attributes with
  | [("version", "1.0")] => pure ()
  | [("version", "1.0"), ("encoding", encoding)] =>
    if isUtf8Encoding encoding then pure () else throw "XML declaration encoding must be UTF-8"
  | [("version", "1.0"), ("standalone", standalone)] =>
    if standalone == "yes" || standalone == "no" then pure ()
    else throw "invalid XML standalone value"
  | [("version", "1.0"), ("encoding", encoding), ("standalone", standalone)] =>
    if !isUtf8Encoding encoding then throw "XML declaration encoding must be UTF-8"
    if standalone != "yes" && standalone != "no" then throw "invalid XML standalone value"
    pure ()
  | _ => throw "unsupported or malformed XML declaration"

def finishXmlSegment (state : XmlParseState) (payload : String) : Except String XmlParseState := do
  if state.stack.isEmpty && !payload.all isXmlSpace then
    throw "non-whitespace content outside the XML root"
  return state

def stripLeadingUtf8Bom (xml : String) : String :=
  let bytes := xml.toUTF8
  if bytes.size ≥ 3 &&
      (bytes.get! 0).toNat == 0xEF &&
      (bytes.get! 1).toNat == 0xBB &&
      (bytes.get! 2).toNat == 0xBF then
    xml.drop 1 |>.toString
  else
    xml

def parseXmlSegment (expectedRoot : String) (state : XmlParseState) (segment : String) :
    Except String XmlParseState := do
  let (tag, payload) ← tagPayload segment
  let trimmed := tag.trimAscii.toString
  if trimmed.isEmpty then throw "empty XML tag"
  if trimmed.startsWith "?" then
    if List.getD (tagWords trimmed) 0 "" != "?xml" then
      throw "processing instructions are outside the accepted XML subset"
    if !state.declarationAllowed || state.rootSeen || !state.stack.isEmpty then
      throw "XML declaration must be the first construct"
    parseXmlDeclaration trimmed
    return ← finishXmlSegment { state with declarationAllowed := false } payload
  if trimmed.startsWith "!" then
    throw "comments, CDATA, and markup declarations are outside the accepted XML subset"
  if trimmed.startsWith "/" then
    let rawName := (trimmed.drop 1).toString
    if rawName.any isXmlSpace || rawName.endsWith "/" then
      throw "malformed closing tag"
    let some top := state.stack.head? | throw "unexpected closing tag"
    let (uri, localName) ← resolveQName top.namespaces rawName
    if uri != top.uri || localName != top.localName then
      throw s!"mismatched closing tag: {rawName}"
    let decodedPayload ← decodeXmlText payload
    let emitted := if uri == wmlNamespace then
      tagTokenDecoded true localName [] decodedPayload else []
    let next := { state with
      stack := state.stack.drop 1
      tokens := state.tokens ++ emitted
      declarationAllowed := false }
    return ← finishXmlSegment next payload
  let selfClosing := trimmed.endsWith "/"
  if state.rootSeen && state.stack.isEmpty then throw "multiple XML root elements"
  let firstWord := List.getD (tagWords trimmed) 0 ""
  let rawName := if selfClosing && firstWord.endsWith "/" then
    dropLastString firstWord else firstWord
  let rawAttributes ← parseTagAttributes trimmed
  let attributes ← decodeXmlAttributes rawAttributes
  let declarations ← namespaceDeclarations attributes
  let bindings := extendNamespaces (currentNamespaces state) declarations
  let expandedAttributes ← expandOrdinaryAttributes attributes bindings
  validateUniqueExpandedAttributes expandedAttributes
  let (uri, localName) ← resolveQName bindings rawName
  if !state.rootSeen then
    if uri != wmlNamespace || localName != expectedRoot then
      throw s!"unexpected root namespace={uri} local={localName}; expected namespace={wmlNamespace} local={expectedRoot}"
  let canonicalAttributes := canonicalizeAttributes expandedAttributes
  let decodedPayload ← decodeXmlText payload
  let emitted := if uri == wmlNamespace then
    balanceSelfClosingTagTokens localName selfClosing
      (tagTokenDecoded false localName canonicalAttributes
        (if selfClosing then "" else decodedPayload))
    else []
  let next := { state with
    tokens := state.tokens ++ emitted
    rootSeen := true
    declarationAllowed := false }
  if selfClosing then return ← finishXmlSegment next payload
  return { next with stack := { uri, localName, namespaces := bindings } :: next.stack }

def parseXmlTokensForRoot (xml expectedRoot : String) : Except String (List XmlTok) := do
  if !asciiXmlLiteralFast xml &&
      !xml.toList.all (fun c => isLegalXmlChar c.toNat) then
    throw "XML contains a disallowed literal character"
  let normalizedXml := stripLeadingUtf8Bom xml
  let pieces := normalizedXml.splitOn "<"
  let leadingText := List.getD pieces 0 ""
  if !leadingText.all isXmlSpace then throw "non-whitespace content before the XML root"
  let segments := pieces.drop 1
  if segments.isEmpty then throw "XML has no root element"
  let initial : XmlParseState := { declarationAllowed := leadingText.isEmpty }
  let final ← segments.foldlM (parseXmlSegment expectedRoot) initial
  if !final.rootSeen then throw "XML has no root element"
  if !final.stack.isEmpty then throw "XML has unclosed elements"
  return final.tokens

inductive XmlEvent
  | startElement (uri localName : String) (attributes : List ExpandedXmlAttribute)
      (depth : Nat) (selfClosing : Bool)
  | endElement (uri localName : String) (depth : Nat)
  | text (value : String) (depth : Nat)
  deriving BEq, DecidableEq, Repr, Inhabited

structure XmlEventParseState where
  stack : List OpenElement := []
  events : List XmlEvent := []
  rootSeen : Bool := false
  declarationAllowed : Bool := false
  eventCount : Nat := 0
  maxDepthSeen : Nat := 0

inductive XmlEventParseFailureKind
  | invalidXml
  | unexpectedRoot
  | eventLimit
  | depthLimit
  deriving BEq, Repr, Inhabited

structure XmlEventParseFailure where
  kind : XmlEventParseFailureKind
  detail : String
  completedEvents : Nat
  observedEvents : Nat
  observedDepth : Nat
  deriving Repr, Inhabited

def xmlEventParseFailure (state : XmlEventParseState) (kind : XmlEventParseFailureKind)
    (detail : String) (observedEvents := state.eventCount)
    (observedDepth := state.maxDepthSeen) : XmlEventParseFailure :=
  { kind, detail, completedEvents := state.eventCount, observedEvents, observedDepth }

def liftXmlEventFailure (state : XmlEventParseState) (result : Except String α) :
    Except XmlEventParseFailure α :=
  result.mapError fun detail => xmlEventParseFailure state .invalidXml detail

def finishXmlEventSegment (state : XmlEventParseState) (payload : String) :
    Except String XmlEventParseState := do
  if state.stack.isEmpty && !payload.all isXmlSpace then
    throw "non-whitespace content outside the XML root"
  let decoded ← decodeXmlText payload
  let whitespaceIsSemantic :=
    match state.stack.head? with
    | some top =>
      top.uri == wmlNamespace &&
        ["t", "delText", "instrText", "delInstrText"].contains top.localName
    | none => false
  if decoded.all isXmlSpace && !whitespaceIsSemantic then return state
  return { state with
    events := .text decoded state.stack.length :: state.events
    eventCount := state.eventCount + 1 }

def parseXmlEventSegment (expectedRootUri expectedRootLocalName : String)
    (state : XmlEventParseState) (segment : String) :
    Except XmlEventParseFailure XmlEventParseState := do
  let (tag, payload) ← liftXmlEventFailure state (tagPayload segment)
  let trimmed := tag.trimAscii.toString
  if trimmed.isEmpty then
    throw (xmlEventParseFailure state .invalidXml "empty XML tag")
  if trimmed.startsWith "?" then
    if List.getD (tagWords trimmed) 0 "" != "?xml" then
      throw (xmlEventParseFailure state .invalidXml
        "processing instructions are outside the accepted XML subset")
    if !state.declarationAllowed || state.rootSeen || !state.stack.isEmpty then
      throw (xmlEventParseFailure state .invalidXml
        "XML declaration must be the first construct")
    let _ ← liftXmlEventFailure state (parseXmlDeclaration trimmed)
    let next := { state with declarationAllowed := false }
    return ← liftXmlEventFailure next (finishXmlEventSegment next payload)
  if trimmed.startsWith "!" then
    throw (xmlEventParseFailure state .invalidXml
      "comments, CDATA, and markup declarations are outside the accepted XML subset")
  if trimmed.startsWith "/" then
    let rawName := (trimmed.drop 1).toString
    if rawName.any isXmlSpace || rawName.endsWith "/" then
      throw (xmlEventParseFailure state .invalidXml "malformed closing tag")
    let some top := state.stack.head? |
      throw (xmlEventParseFailure state .invalidXml "unexpected closing tag")
    let (uri, localName) ← liftXmlEventFailure state
      (resolveQName top.namespaces rawName)
    if uri != top.uri || localName != top.localName then
      throw (xmlEventParseFailure state .invalidXml s!"mismatched closing tag: {rawName}")
    let depth := state.stack.length - 1
    let next := { state with
      stack := state.stack.drop 1
      events := .endElement uri localName depth :: state.events
      eventCount := state.eventCount + 1
      declarationAllowed := false }
    return ← liftXmlEventFailure next (finishXmlEventSegment next payload)
  let selfClosing := trimmed.endsWith "/"
  if state.rootSeen && state.stack.isEmpty then
    throw (xmlEventParseFailure state .invalidXml "multiple XML root elements")
  let firstWord := List.getD (tagWords trimmed) 0 ""
  let rawName := if selfClosing && firstWord.endsWith "/" then
    dropLastString firstWord else firstWord
  let rawAttributes ← liftXmlEventFailure state (parseTagAttributes trimmed)
  let attributes ← liftXmlEventFailure state (decodeXmlAttributes rawAttributes)
  let declarations ← liftXmlEventFailure state (namespaceDeclarations attributes)
  let bindings := extendNamespaces (currentNamespaces {
    stack := state.stack
    tokens := []
    rootSeen := state.rootSeen
    declarationAllowed := state.declarationAllowed
  }) declarations
  let expandedAttributes ← liftXmlEventFailure state
    (expandOrdinaryAttributes attributes bindings)
  let _ ← liftXmlEventFailure state (validateUniqueExpandedAttributes expandedAttributes)
  let (uri, localName) ← liftXmlEventFailure state (resolveQName bindings rawName)
  if !state.rootSeen && (uri != expectedRootUri || localName != expectedRootLocalName) then
    throw (xmlEventParseFailure state .unexpectedRoot
      s!"unexpected root namespace={uri} local={localName}; expected namespace={expectedRootUri} local={expectedRootLocalName}")
  let depth := state.stack.length
  let next := { state with
    events := .startElement uri localName expandedAttributes depth selfClosing :: state.events
    rootSeen := true
    eventCount := state.eventCount + 1
    maxDepthSeen := max state.maxDepthSeen (depth + 1)
    declarationAllowed := false }
  if selfClosing then
    return ← liftXmlEventFailure next (finishXmlEventSegment next payload)
  let opened := {
    next with stack := { uri, localName, namespaces := bindings } :: next.stack
  }
  return ← liftXmlEventFailure opened (finishXmlEventSegment opened payload)

def parseXmlEventsForRootBoundedTyped (xml expectedRootUri expectedRootLocalName : String)
    (eventLimit depthLimit : Nat) : Except XmlEventParseFailure XmlEventParseState := do
  let empty : XmlEventParseState := {}
  if !asciiXmlLiteralFast xml &&
      !xml.toList.all (fun c => isLegalXmlChar c.toNat) then
    throw (xmlEventParseFailure empty .invalidXml
      "XML contains a disallowed literal character")
  let normalizedXml := stripLeadingUtf8Bom xml
  let pieces := normalizedXml.splitOn "<"
  let leadingText := List.getD pieces 0 ""
  if !leadingText.all isXmlSpace then
    throw (xmlEventParseFailure empty .invalidXml
      "non-whitespace content before the XML root")
  let segments := pieces.drop 1
  if segments.isEmpty then
    throw (xmlEventParseFailure empty .invalidXml "XML has no root element")
  let initial : XmlEventParseState := { declarationAllowed := leadingText.isEmpty }
  let final ← segments.foldlM (fun state segment => do
    let next ← parseXmlEventSegment expectedRootUri expectedRootLocalName state segment
    if next.eventCount > eventLimit then
      throw (xmlEventParseFailure state .eventLimit "XML event limit exceeded"
        next.eventCount next.maxDepthSeen)
    if next.maxDepthSeen > depthLimit then
      throw (xmlEventParseFailure state .depthLimit "XML depth limit exceeded"
        next.eventCount next.maxDepthSeen)
    return next) initial
  if !final.rootSeen then
    throw (xmlEventParseFailure final .invalidXml "XML has no root element")
  if !final.stack.isEmpty then
    throw (xmlEventParseFailure final .invalidXml "XML has unclosed elements")
  return { final with events := final.events.reverse }

def parseXmlEventsForRootBounded (xml expectedRootUri expectedRootLocalName : String)
    (eventLimit depthLimit : Nat) : Except String XmlEventParseState :=
  (parseXmlEventsForRootBoundedTyped xml expectedRootUri expectedRootLocalName
    eventLimit depthLimit).mapError (·.detail)

def parseXmlEventsForRoot (xml expectedRootUri expectedRootLocalName : String) :
    Except String XmlEventParseState :=
  parseXmlEventsForRootBounded xml expectedRootUri expectedRootLocalName
    (xml.toUTF8.size + 1) (xml.toUTF8.size + 1)

structure XmlEventTokenState where
  stack : List (String × String) := []
  tokens : List XmlTok := []

def textTokenForElement (uri localName value : String) : List XmlTok :=
  if uri != wmlNamespace then []
  else if localName == "t" then [.text value]
  else if localName == "delText" then [.delText value]
  else if localName == "instrText" then [.instrText value]
  else if localName == "delInstrText" then [.delInstrText value]
  else []

def tokensFromXmlEvents (events : List XmlEvent) : List XmlTok :=
  (events.foldl (fun (state : XmlEventTokenState) event =>
    match event with
    | XmlEvent.startElement uri localName attributes _ selfClosing =>
      let emitted :=
        if ["t", "delText", "instrText", "delInstrText"].contains localName then []
        else if uri == wmlNamespace then
          balanceSelfClosingTagTokens localName selfClosing
            (tagTokenDecoded false localName (canonicalizeAttributes attributes) "")
        else []
      {
        stack := if selfClosing then state.stack else (uri, localName) :: state.stack
        tokens := state.tokens ++ emitted
      }
    | XmlEvent.endElement uri localName _ =>
      let emitted :=
        if uri == wmlNamespace then tagTokenDecoded true localName [] "" else []
      { stack := state.stack.drop 1, tokens := state.tokens ++ emitted }
    | XmlEvent.text value _ =>
      match state.stack.head? with
      | some (uri, localName) =>
        { state with tokens := state.tokens ++ textTokenForElement uri localName value }
      | none => state) {}).tokens

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

def FieldCtx.insideCode (ctx : FieldCtx) : Bool :=
  ctx.any (fun pastSeparator => !pastSeparator)

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
    | .ok ctx => if ctx.insideCode then r else .invalid
    | .invalid => .invalid
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
