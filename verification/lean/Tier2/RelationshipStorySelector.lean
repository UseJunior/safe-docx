import Lean.Data.Json
import Tier2.XmlTripleChecker

namespace Tier2.RelationshipStorySelector

open Lean Tier2.XmlTripleChecker

def packageRelationshipsNamespace : String :=
  "http://schemas.openxmlformats.org/package/2006/relationships"

def officeRelationshipsNamespace : String :=
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

def headerRelationshipType : String :=
  officeRelationshipsNamespace ++ "/header"

def footerRelationshipType : String :=
  officeRelationshipsNamespace ++ "/footer"

def maxPackageBytes : Nat := 32 * 1024 * 1024
def maxCentralDirectoryBytes : Nat := 4 * 1024 * 1024
def maxZipEntries : Nat := 1024
def maxZipNameBytes : Nat := 256
def maxPartCompressedBytes : Nat := 8 * 1024 * 1024
def maxPartExpandedBytes : Nat := 16 * 1024 * 1024
def maxSections : Nat := 64
def maxBindings : Nat := 384
def maxRelationshipRecords : Nat := 1024
def maxSelectedParts : Nat := 256
def maxXmlEventsPerPart : Nat := 500000
def maxXmlDepth : Nat := 128
def maxRelationshipIdBytes : Nat := 128
def maxLocatorBytes : Nat := 256

def byteAt? (bytes : ByteArray) (offset : Nat) : Option Nat :=
  if h : offset < bytes.size then some (bytes[offset].toNat) else none

def readUInt16? (bytes : ByteArray) (offset : Nat) : Option Nat := do
  let a ← byteAt? bytes offset
  let b ← byteAt? bytes (offset + 1)
  return a + b * 256

def readUInt32? (bytes : ByteArray) (offset : Nat) : Option Nat := do
  let a ← byteAt? bytes offset
  let b ← byteAt? bytes (offset + 1)
  let c ← byteAt? bytes (offset + 2)
  let d ← byteAt? bytes (offset + 3)
  return a + b * 256 + c * 65536 + d * 16777216

def readUInt16 (bytes : ByteArray) (offset : Nat) : Except String Nat :=
  match readUInt16? bytes offset with
  | some value => pure value
  | none => throw "truncated ZIP uint16"

def readUInt32 (bytes : ByteArray) (offset : Nat) : Except String Nat :=
  match readUInt32? bytes offset with
  | some value => pure value
  | none => throw "truncated ZIP uint32"

def hasSignature (bytes : ByteArray) (offset signature : Nat) : Bool :=
  readUInt32? bytes offset == some signature

def checkedEnd (start length limit : Nat) : Except String Nat := do
  if start > limit || length > limit - start then throw "ZIP range is out of bounds"
  return start + length

def bitSet (value bit : Nat) : Bool :=
  (value / (2 ^ bit)) % 2 == 1

def flagsAllowed (method flags : Nat) : Bool :=
  let allowed := if method == 0 then [11] else [1, 2, 11]
  (method == 0 || method == 8) &&
    !(List.range 16).any (fun bit => !allowed.contains bit && bitSet flags bit)

def parseExtraFields (bytes : ByteArray) (start length : Nat) : Except String Unit := do
  let stop ← checkedEnd start length bytes.size
  let rec loop (fuel position : Nat) : Except String Unit := do
    match fuel with
    | 0 =>
      if position == stop then return () else throw "malformed ZIP extra field"
    | fuel + 1 =>
      if position == stop then return ()
      if position + 4 > stop then throw "malformed ZIP extra field"
      let headerId ← readUInt16 bytes position
      let dataSize ← readUInt16 bytes (position + 2)
      let next ← checkedEnd (position + 4) dataSize stop
      if headerId == 0x0001 then throw "ZIP64 extra field is unsupported"
      if headerId == 0x7075 then throw "Unicode Path extra field is ambiguous"
      loop fuel next
  loop (length / 4 + 1) start

def decodeZipName (bytes : ByteArray) (start length flags : Nat) : Except String String := do
  if length == 0 || length > maxZipNameBytes then throw "invalid ZIP filename length"
  let stop ← checkedEnd start length bytes.size
  let raw := bytes.extract start stop
  if bitSet flags 11 then
    match String.fromUTF8? raw with
    | some value => return value
    | none => throw "ZIP UTF-8 filename is malformed"
  else
    if !(raw.toList.all fun byte => 0x20 ≤ byte.toNat && byte.toNat ≤ 0x7e) then
      throw "unflagged ZIP filename is not printable ASCII"
    match String.fromUTF8? raw with
    | some value => return value
    | none => throw "ASCII ZIP filename failed to decode"

def safeZipName (name : String) : Bool :=
  if name == "[Content_Types].xml" then true
  else
    let identity := if name.endsWith "/" then String.ofList name.toList.dropLast else name
    let chars := identity.toList
    let segments := identity.splitOn "/"
    !identity.isEmpty &&
      !identity.startsWith "/" &&
      !identity.contains "\\" &&
      !identity.contains ":" &&
      !identity.contains "?" &&
      !identity.contains "#" &&
      !identity.contains "*" &&
      !identity.contains "[" &&
      !identity.contains "]" &&
      chars.all (fun c => 0x20 ≤ c.toNat && c.toNat != 0x7f) &&
      segments.all (fun segment => !segment.isEmpty && segment != "." && segment != "..")

structure ZipEntry where
  name : String
  flags : Nat
  method : Nat
  crc32 : Nat
  compressedSize : Nat
  expandedSize : Nat
  localHeaderOffset : Nat
  dataOffset : Nat
  localSpanEnd : Nat
  isDirectory : Bool
  deriving BEq, Repr, Inhabited

structure ZipIndex where
  entries : List ZipEntry
  centralOffset : Nat
  centralSize : Nat
  deriving Repr, Inhabited

structure Eocd where
  offset : Nat
  centralOffset : Nat
  centralSize : Nat
  entryCount : Nat
  deriving Repr, Inhabited

def parseEocdAt (bytes : ByteArray) (offset : Nat) : Except String Eocd := do
  if !hasSignature bytes offset 0x06054b50 then throw "invalid EOCD signature"
  let endFixed ← checkedEnd offset 22 bytes.size
  let disk ← readUInt16 bytes (offset + 4)
  let centralDisk ← readUInt16 bytes (offset + 6)
  let entriesOnDisk ← readUInt16 bytes (offset + 8)
  let entryCount ← readUInt16 bytes (offset + 10)
  let centralSize ← readUInt32 bytes (offset + 12)
  let centralOffset ← readUInt32 bytes (offset + 16)
  let commentLength ← readUInt16 bytes (offset + 20)
  let endWithComment ← checkedEnd endFixed commentLength bytes.size
  if endWithComment != bytes.size then throw "EOCD does not end at EOF"
  if disk != 0 || centralDisk != 0 || entriesOnDisk != entryCount then
    throw "multi-disk ZIP is unsupported"
  if entryCount == 0xffff || centralSize == 0xffffffff || centralOffset == 0xffffffff then
    throw "ZIP64 sentinel is unsupported"
  if entryCount > maxZipEntries then throw "ZIP entry limit exceeded"
  if centralSize > maxCentralDirectoryBytes then throw "central-directory limit exceeded"
  let centralEnd ← checkedEnd centralOffset centralSize bytes.size
  if centralEnd != offset then throw "central directory does not end at EOCD"
  return { offset, centralOffset, centralSize, entryCount }

def findEocd (bytes : ByteArray) : Except String Eocd := do
  if bytes.size > maxPackageBytes then throw "DOCX package limit exceeded"
  if bytes.size < 22 then throw "ZIP is too short for EOCD"
  let start := bytes.size - min bytes.size 65557
  let candidates := (List.range (bytes.size - start)).filterMap fun delta =>
    let offset := start + delta
    if hasSignature bytes offset 0x06054b50 then
      match parseEocdAt bytes offset with
      | .ok eocd => some eocd
      | .error _ => none
    else none
  match candidates with
  | [candidate] =>
    if hasSignature bytes (candidate.offset - min candidate.offset 20) 0x07064b50 ||
        hasSignature bytes (candidate.offset - min candidate.offset 56) 0x06064b50 then
      throw "ZIP64 locator or record is unsupported"
    return candidate
  | [] => throw "no valid classic EOCD"
  | _ => throw "ambiguous classic EOCD"

structure CentralEntry where
  name : String
  flags : Nat
  method : Nat
  crc32 : Nat
  compressedSize : Nat
  expandedSize : Nat
  localHeaderOffset : Nat
  isDirectory : Bool
  deriving Repr, Inhabited

def parseCentralEntries (bytes : ByteArray) (eocd : Eocd) : Except String (List CentralEntry) := do
  let stop := eocd.centralOffset + eocd.centralSize
  let rec loop (remaining position : Nat) (entries : List CentralEntry) :
      Except String (List CentralEntry) := do
    match remaining with
    | 0 =>
      if position == stop then return entries else throw "central directory has trailing bytes"
    | remaining + 1 =>
      if position + 46 > stop || !hasSignature bytes position 0x02014b50 then
        throw "malformed central-directory record"
      let flags ← readUInt16 bytes (position + 8)
      let method ← readUInt16 bytes (position + 10)
      let crc32 ← readUInt32 bytes (position + 16)
      let compressedSize ← readUInt32 bytes (position + 20)
      let expandedSize ← readUInt32 bytes (position + 24)
      let nameLength ← readUInt16 bytes (position + 28)
      let extraLength ← readUInt16 bytes (position + 30)
      let commentLength ← readUInt16 bytes (position + 32)
      let diskStart ← readUInt16 bytes (position + 34)
      let externalAttributes ← readUInt32 bytes (position + 38)
      let localHeaderOffset ← readUInt32 bytes (position + 42)
      if diskStart != 0 then throw "central record disk-start must be zero"
      if compressedSize == 0xffffffff || expandedSize == 0xffffffff ||
          localHeaderOffset == 0xffffffff then
        throw "ZIP64 sentinel is unsupported"
      if !flagsAllowed method flags then throw "unsupported ZIP general-purpose flags"
      if method != 0 && method != 8 then throw "unsupported ZIP compression method"
      let variableLength := nameLength + extraLength + commentLength
      let next ← checkedEnd (position + 46) variableLength stop
      let name ← decodeZipName bytes (position + 46) nameLength flags
      if !safeZipName name then throw "unsafe ZIP entry name"
      parseExtraFields bytes (position + 46 + nameLength) extraLength
      let dosDirectory := bitSet externalAttributes 4
      let unixMode := externalAttributes / 65536
      let unixType := unixMode / 4096
      let isDirectory := dosDirectory || unixType == 4
      if ![0, 4, 8].contains unixType then throw "non-regular ZIP entry is unsupported"
      if isDirectory != name.endsWith "/" then throw "ZIP directory identity is ambiguous"
      if isDirectory then throw s!"ZIP directory entry is unsupported: {name}"
      loop remaining next
        (entries ++ [{
          name := name
          flags := flags
          method := method
          crc32 := crc32
          compressedSize := compressedSize
          expandedSize := expandedSize
          localHeaderOffset := localHeaderOffset
          isDirectory := isDirectory
        }])
  loop eocd.entryCount eocd.centralOffset []

def spansOverlap (leftStart leftEnd rightStart rightEnd : Nat) : Bool :=
  leftStart < rightEnd && rightStart < leftEnd

def validateLocalEntry (bytes : ByteArray) (centralOffset : Nat) (entry : CentralEntry) :
    Except String ZipEntry := do
  let offset := entry.localHeaderOffset
  if offset + 30 > centralOffset || !hasSignature bytes offset 0x04034b50 then
    throw "invalid local ZIP header"
  let flags ← readUInt16 bytes (offset + 6)
  let method ← readUInt16 bytes (offset + 8)
  let crc32 ← readUInt32 bytes (offset + 14)
  let compressedSize ← readUInt32 bytes (offset + 18)
  let expandedSize ← readUInt32 bytes (offset + 22)
  let nameLength ← readUInt16 bytes (offset + 26)
  let extraLength ← readUInt16 bytes (offset + 28)
  if flags != entry.flags || method != entry.method || crc32 != entry.crc32 ||
      compressedSize != entry.compressedSize || expandedSize != entry.expandedSize then
    throw "central/local ZIP metadata mismatch"
  let name ← decodeZipName bytes (offset + 30) nameLength flags
  if name != entry.name then throw "central/local ZIP filename mismatch"
  parseExtraFields bytes (offset + 30 + nameLength) extraLength
  let dataOffset ← checkedEnd (offset + 30) (nameLength + extraLength) centralOffset
  let localSpanEnd ← checkedEnd dataOffset compressedSize centralOffset
  return { entry with dataOffset, localSpanEnd }

def buildZipIndex (bytes : ByteArray) : Except String ZipIndex := do
  let eocd ← findEocd bytes
  let centralEntries ← parseCentralEntries bytes eocd
  let entries ← centralEntries.mapM (validateLocalEntry bytes eocd.centralOffset)
  if entries.any fun entry =>
      (entries.filter fun other => other.name == entry.name).length > 1 then
    throw "duplicate exact ZIP entry name"
  if entries.any fun entry =>
      entries.any fun other =>
        entry.localHeaderOffset != other.localHeaderOffset &&
          spansOverlap entry.localHeaderOffset entry.localSpanEnd
            other.localHeaderOffset other.localSpanEnd then
    throw "overlapping complete local ZIP records"
  return { entries, centralOffset := eocd.centralOffset, centralSize := eocd.centralSize }

def ZipIndex.find? (index : ZipIndex) (name : String) : Option ZipEntry :=
  index.entries.find? (fun entry => entry.name == name)

inductive StoryKind
  | header
  | footer
  deriving BEq, DecidableEq, Repr, Inhabited

def StoryKind.toString : StoryKind → String
  | .header => "header"
  | .footer => "footer"

def StoryKind.relationshipType : StoryKind → String
  | .header => headerRelationshipType
  | .footer => footerRelationshipType

def StoryKind.rootName : StoryKind → String
  | .header => "hdr"
  | .footer => "ftr"

inductive StoryRole
  | first
  | default
  | even
  deriving BEq, DecidableEq, Repr, Inhabited

def StoryRole.toString : StoryRole → String
  | .first => "first"
  | .default => "default"
  | .even => "even"

def StoryRole.rank : StoryRole → Nat
  | .first => 0
  | .default => 1
  | .even => 2

def parseStoryRole (value : String) : Option StoryRole :=
  match value with
  | "first" => some .first
  | "default" => some .default
  | "even" => some .even
  | _ => none

inductive VerifierSide
  | original
  | revised
  | compared
  deriving BEq, DecidableEq, Repr, Inhabited

def VerifierSide.toString : VerifierSide → String
  | .original => "original"
  | .revised => "revised"
  | .compared => "compared"

structure DirectBinding where
  sectionOrdinal : Nat
  kind : StoryKind
  role : StoryRole
  relationshipId : String
  deriving BEq, DecidableEq, Repr, Inhabited

structure SelectionIssue where
  code : String
  side : Option VerifierSide := none
  sectionOrdinal : Option Nat := none
  kind : Option StoryKind := none
  role : Option StoryRole := none
  relationshipId : Option String := none
  rawTarget : Option String := none
  normalizedPartPath : Option String := none
  detail : String
  deriving BEq, Repr, Inhabited

def expandedAttribute? (attributes : List ExpandedXmlAttribute) (uri localName : String) :
    Option String :=
  (attributes.find? fun attr =>
    attr.uri == uri && attr.localName == localName).map (·.value)

structure DocumentInventory where
  sectionCount : Nat
  bindings : List DirectBinding
  issues : List SelectionIssue
  eventCount : Nat
  maxDepthSeen : Nat
  deriving Repr, Inhabited

structure InventoryState where
  sectionCount : Nat := 0
  bindings : List DirectBinding := []
  issues : List SelectionIssue := []
  openSection : Option (Nat × Nat) := none
  ancestors : List (String × String) := []
  directBodyCount : Nat := 0
  openDirectBodyDepth : Option Nat := none
  terminalBodySectionSeen : Bool := false
  structuralError : Option String := none

def bindingLess (left right : DirectBinding) : Bool :=
  left.sectionOrdinal < right.sectionOrdinal ||
  (left.sectionOrdinal == right.sectionOrdinal &&
    (match left.kind, right.kind with
     | .header, .footer => true
     | .footer, .header => false
     | _, _ => left.role.rank < right.role.rank))

def inspectDocumentEvent (side : VerifierSide) (state : InventoryState) (event : XmlEvent) :
    InventoryState :=
  match event with
  | .startElement uri localName attributes depth selfClosing =>
    let element := (uri, localName)
    let nextAncestors := if selfClosing then state.ancestors else state.ancestors ++ [element]
    let directBodyChild :=
      state.ancestors ==
        [(wmlNamespace, "document"), (wmlNamespace, "body")]
    if uri == wmlNamespace && localName == "body" then
      if state.ancestors == [(wmlNamespace, "document")] then
        { state with
          directBodyCount := state.directBodyCount + 1
          openDirectBodyDepth := if selfClosing then none else some depth
          structuralError :=
            if state.directBodyCount == 0 then state.structuralError
            else some "word/document.xml contains multiple direct w:body elements"
          ancestors := nextAncestors }
      else
        { state with
          structuralError := some "word/document.xml contains a nested or misplaced w:body"
          ancestors := nextAncestors }
    else if directBodyChild && state.terminalBodySectionSeen then
      { state with
        structuralError := some <|
          if uri == wmlNamespace && localName == "sectPr" then
            "word/document.xml contains duplicate direct body-level terminal w:sectPr"
          else
            "word/document.xml contains a body element after terminal w:sectPr"
        ancestors := nextAncestors }
    else if uri == wmlNamespace && localName == "sectPr" then
      let supported :=
        directBodyChild ||
        state.ancestors ==
          [(wmlNamespace, "document"), (wmlNamespace, "body"),
           (wmlNamespace, "p"), (wmlNamespace, "pPr")]
      if supported then
        { state with
          openSection := if selfClosing then none else some (state.sectionCount, depth)
          sectionCount := state.sectionCount + 1
          terminalBodySectionSeen := state.terminalBodySectionSeen || directBodyChild
          ancestors := nextAncestors }
      else
        { state with
          issues := state.issues ++ [{
            code := "UNSUPPORTED_SECTION_PLACEMENT"
            side := some side
            detail := "w:sectPr is not a direct child of w:body or direct w:body/w:p/w:pPr"
          }]
          ancestors := nextAncestors }
    else if uri == wmlNamespace &&
        (localName == "headerReference" || localName == "footerReference") &&
        state.openSection.isNone then
      { state with
        issues := state.issues ++ [{
          code := "INDIRECT_SECTION_BINDING"
          side := some side
          kind := some (if localName == "headerReference" then .header else .footer)
          detail := "header/footer reference is outside an open supported direct w:sectPr"
        }]
        ancestors := nextAncestors }
    else
      match state.openSection with
      | some (sectionOrdinal, sectionDepth) =>
        if uri == wmlNamespace &&
            (localName == "headerReference" || localName == "footerReference") &&
            depth != sectionDepth + 1 then
          { state with
            issues := state.issues ++ [{
              code := "INDIRECT_SECTION_BINDING"
              side := some side
              sectionOrdinal := some sectionOrdinal
              kind := some (if localName == "headerReference" then .header else .footer)
              detail := "header/footer reference is not a direct child of supported w:sectPr"
            }]
            ancestors := nextAncestors }
        else if depth == sectionDepth + 1 && uri == wmlNamespace &&
            (localName == "headerReference" || localName == "footerReference") then
          let kind := if localName == "headerReference" then StoryKind.header else StoryKind.footer
          let roleValue := expandedAttribute? attributes wmlNamespace "type"
          let relationshipId := expandedAttribute? attributes officeRelationshipsNamespace "id"
          match roleValue.bind parseStoryRole, relationshipId with
          | some role, some id =>
            let binding := { sectionOrdinal, kind, role, relationshipId := id }
            if state.bindings.any fun old =>
                old.sectionOrdinal == sectionOrdinal && old.kind == kind && old.role == role then
              let issue : SelectionIssue := {
                  code := "DUPLICATE_SECTION_BINDING", side := some side,
                  sectionOrdinal := some sectionOrdinal, kind := some kind, role := some role,
                  relationshipId := some id, detail := "duplicate direct section binding" }
              { state with issues := state.issues ++ [issue], ancestors := nextAncestors }
            else if id.isEmpty then
              let issue : SelectionIssue := {
                  code := "MISSING_RELATIONSHIP_ID", side := some side,
                  sectionOrdinal := some sectionOrdinal, kind := some kind, role := some role,
                  detail := "direct section binding has an empty relationship id" }
              { state with issues := state.issues ++ [issue], ancestors := nextAncestors }
            else if id.toUTF8.size > maxRelationshipIdBytes then
              let issue : SelectionIssue := {
                  code := "RELATIONSHIP_ID_LIMIT_EXCEEDED", side := some side,
                  sectionOrdinal := some sectionOrdinal, kind := some kind, role := some role,
                  detail := "relationship id exceeds the verifier limit" }
              { state with issues := state.issues ++ [issue], ancestors := nextAncestors }
            else { state with bindings := state.bindings ++ [binding], ancestors := nextAncestors }
          | none, _ =>
            let issue : SelectionIssue := {
                code := "INVALID_BINDING_ROLE", side := some side,
                sectionOrdinal := some sectionOrdinal, kind := some kind,
                detail := "direct section binding role is missing or unsupported" }
            { state with issues := state.issues ++ [issue], ancestors := nextAncestors }
          | _, none =>
            let issue : SelectionIssue := {
                code := "MISSING_RELATIONSHIP_ID", side := some side,
                sectionOrdinal := some sectionOrdinal, kind := some kind,
                detail := "direct section binding has no namespace-resolved relationship id" }
            { state with issues := state.issues ++ [issue], ancestors := nextAncestors }
        else { state with ancestors := nextAncestors }
      | none => { state with ancestors := nextAncestors }
  | .endElement uri localName depth =>
    let nextAncestors := state.ancestors.dropLast
    let nextState :=
      if uri == wmlNamespace && localName == "body" &&
          state.openDirectBodyDepth == some depth then
        { state with openDirectBodyDepth := none }
      else state
    match nextState.openSection with
    | some (_, sectionDepth) =>
      if uri == wmlNamespace && localName == "sectPr" && depth == sectionDepth then
        { nextState with openSection := none, ancestors := nextAncestors }
      else { nextState with ancestors := nextAncestors }
    | none => { nextState with ancestors := nextAncestors }
  | .text .. => state

def documentInventoryFromParsed (side : VerifierSide)
    (parsed : XmlEventParseState) : Except String DocumentInventory := do
  if parsed.eventCount > maxXmlEventsPerPart then throw "XML event limit exceeded"
  if parsed.maxDepthSeen > maxXmlDepth then throw "XML depth limit exceeded"
  let state := parsed.events.foldl (inspectDocumentEvent side) {}
  if state.directBodyCount != 1 then
    throw "word/document.xml must contain exactly one direct w:body"
  if let some detail := state.structuralError then throw detail
  if state.sectionCount > maxSections then throw "section limit exceeded"
  if state.bindings.length > maxBindings then throw "binding limit exceeded"
  return {
    sectionCount := state.sectionCount
    bindings := state.bindings.mergeSort bindingLess
    issues := state.issues
    eventCount := parsed.eventCount
    maxDepthSeen := parsed.maxDepthSeen
  }

def parseDocumentInventory (side : VerifierSide) (xml : String) :
    Except String DocumentInventory := do
  let parsed ← parseXmlEventsForRoot xml wmlNamespace "document"
  documentInventoryFromParsed side parsed

structure RelationshipRecord where
  id : String
  relationshipType : String
  rawTarget : String
  targetMode : Option String
  deriving BEq, Repr, Inhabited

def parseRelationshipRecord (attributes : List ExpandedXmlAttribute) :
    Except String RelationshipRecord := do
  if attributes.any (fun attr => !attr.uri.isEmpty) then
    throw "relationship attributes must be unqualified"
  if attributes.any (fun attr =>
      !["Id", "Type", "Target", "TargetMode"].contains attr.localName) then
    throw "unknown relationship attribute"
  let some id := expandedAttribute? attributes "" "Id" |
    throw "relationship record has no Id"
  let some relationshipType := expandedAttribute? attributes "" "Type" |
    throw "relationship record has no Type"
  let some targetValue := expandedAttribute? attributes "" "Target" |
    throw "relationship record has no Target"
  let targetMode := expandedAttribute? attributes "" "TargetMode"
  if id.toUTF8.size > maxRelationshipIdBytes then
    throw "relationship record Id exceeds its limit"
  return RelationshipRecord.mk id relationshipType targetValue targetMode

def parseRelationships (xml : String) : Except String (List RelationshipRecord × Nat) := do
  let parsed ← parseXmlEventsForRoot xml packageRelationshipsNamespace "Relationships"
  if parsed.eventCount > maxXmlEventsPerPart then throw "XML event limit exceeded"
  if parsed.maxDepthSeen > maxXmlDepth then throw "XML depth limit exceeded"
  let mut records := []
  let mut openRecord : Option Nat := none
  for event in parsed.events do
    match event with
    | .startElement uri localName attributes depth selfClosing =>
      if depth == 0 then pure ()
      else if depth == 1 && uri == packageRelationshipsNamespace &&
          localName == "Relationship" && openRecord.isNone then
        records := records ++ [← parseRelationshipRecord attributes]
        if !selfClosing then openRecord := some depth
      else throw "relationships root has a malformed direct child"
    | .endElement uri localName depth =>
      if depth == 0 then pure ()
      else if openRecord == some depth && uri == packageRelationshipsNamespace &&
          localName == "Relationship" then
        openRecord := none
      else throw "relationship records contain child content"
    | .text _ _ => throw "relationships root contains non-whitespace text"
  if openRecord.isSome then throw "relationship record is not closed"
  if records.length > maxRelationshipRecords then throw "relationship record limit exceeded"
  if records.any fun record => (records.filter fun other => other.id == record.id).length > 1 then
    throw "duplicate relationship id"
  return (records, parsed.eventCount)

def hexByteValue (byte : UInt8) : Option Nat :=
  let value := byte.toNat
  if 0x30 ≤ value && value ≤ 0x39 then some (value - 0x30)
  else if 0x61 ≤ value && value ≤ 0x66 then some (10 + value - 0x61)
  else if 0x41 ≤ value && value ≤ 0x46 then some (10 + value - 0x41)
  else none

def percentDecodePass (target : String) : Except String String := do
  let bytes := target.toUTF8
  let rec loop (fuel position : Nat) (decoded : ByteArray) : Except String ByteArray := do
    match fuel with
    | 0 =>
      if position == bytes.size then return decoded else throw "target percent decoder exhausted"
    | fuel + 1 =>
      if position == bytes.size then return decoded
      let byte := bytes[position]!
      if byte.toNat != 0x25 then loop fuel (position + 1) (decoded.push byte)
      else
        if position + 2 >= bytes.size then throw "target has a malformed percent escape"
        let some high := hexByteValue bytes[position + 1]! |
          throw "target has a malformed percent escape"
        let some low := hexByteValue bytes[position + 2]! |
          throw "target has a malformed percent escape"
        let value := high * 16 + low
        if value == 0x2f || value == 0x5c then
          throw "target has an encoded separator escape"
        loop fuel (position + 3) (decoded.push (UInt8.ofNat value))
  let decodedBytes ← loop (bytes.size + 1) 0 .empty
  match String.fromUTF8? decodedBytes with
  | some decoded => return decoded
  | none => throw "target percent escapes do not form UTF-8"

def hasEncodedDotSegment (target : String) : Bool :=
  target.splitOn "/" |>.any fun segment => segment == "." || segment == ".."

def percentDecodeTarget (rawTarget : String) : Except String String := do
  let rec loop (fuel : Nat) (current : String) : Except String String := do
    match fuel with
    | 0 => throw "target percent decoder exhausted"
    | fuel + 1 =>
      if !current.contains "%" then return current
      let decoded ← percentDecodePass current
      if hasEncodedDotSegment decoded then
        throw "target percent decoding produced an encoded dot segment"
      loop fuel decoded
  loop (rawTarget.toUTF8.size + 1) rawTarget

def normalizeTarget (rawTarget : String) : Except String String := do
  if rawTarget.isEmpty || rawTarget.toUTF8.size > maxLocatorBytes then
    throw "target is empty or exceeds its limit"
  if rawTarget.contains "\\" || rawTarget.contains "?" || rawTarget.contains "#" ||
      rawTarget.contains "*" || rawTarget.contains "[" || rawTarget.contains "]" ||
      rawTarget.startsWith "//" then
    throw "target uses unsafe syntax"
  let decodedTarget ← percentDecodeTarget rawTarget
  if decodedTarget.contains "*" || decodedTarget.contains "[" || decodedTarget.contains "]" then
    throw "target percent decoding produced unsafe glob syntax"
  let withoutLeading := if decodedTarget.startsWith "/" then (decodedTarget.drop 1).toString
    else "word/" ++ decodedTarget
  let rec normalize (segments stack : List String) : Except String (List String) := do
    match segments with
    | [] => return stack
    | segment :: rest =>
      if segment.isEmpty || segment == "." then normalize rest stack
      else if segment == ".." then
        match stack.reverse with
        | [] => throw "target escapes the package root"
        | _ :: reversedRest => normalize rest reversedRest.reverse
      else if segment.contains ":" ||
          segment.toList.any (fun c => c.toNat < 0x20 || c.toNat == 0x7f) then
        throw "target contains an unsafe segment"
      else normalize rest (stack ++ [segment])
  let normalized ← normalize (withoutLeading.splitOn "/") []
  if normalized.isEmpty then throw "target normalizes to the package root"
  let result := String.intercalate "/" normalized
  if result.toUTF8.size > maxLocatorBytes then throw "normalized target exceeds its limit"
  return result

structure RelationshipIdentity where
  relationshipId : String
  normalizedPartPath : String
  deriving BEq, DecidableEq, Repr, Inhabited

structure AlignedSlot where
  slotOrdinal : Nat
  sourceCandidateOrdinal : Nat := 0
  sectionOrdinal : Nat
  kind : StoryKind
  role : StoryRole
  original : RelationshipIdentity
  revised : RelationshipIdentity
  compared : RelationshipIdentity
  physicalStoryOrdinal : Nat := 0
  deriving BEq, DecidableEq, Repr, Inhabited

structure PhysicalStory where
  physicalStoryOrdinal : Nat
  kind : StoryKind
  originalPartPath : String
  revisedPartPath : String
  comparedPartPath : String
  selectingSlotOrdinals : List Nat
  deriving BEq, DecidableEq, Repr, Inhabited

def sameLogicalSlot (left right : DirectBinding) : Bool :=
  left.sectionOrdinal == right.sectionOrdinal && left.kind == right.kind && left.role == right.role

def issueForBinding (code detail : String) (side : VerifierSide) (binding : DirectBinding)
    (rawTarget : Option String := none) : SelectionIssue :=
  { code := code
    side := some side
    sectionOrdinal := some binding.sectionOrdinal
    kind := some binding.kind
    role := some binding.role
    relationshipId := some binding.relationshipId
    rawTarget := rawTarget
    detail := detail }

def resolveBinding (side : VerifierSide) (records : List RelationshipRecord)
    (binding : DirectBinding) : Except SelectionIssue RelationshipIdentity := do
  let some record := records.find? (fun record => record.id == binding.relationshipId) |
    throw (issueForBinding "MISSING_RELATIONSHIP"
      "direct binding relationship id was not found" side binding)
  if record.relationshipType != binding.kind.relationshipType then
    throw (issueForBinding "RELATIONSHIP_TYPE_MISMATCH"
      "selected relationship type does not match binding kind" side binding (some record.rawTarget))
  match record.targetMode with
  | some "Internal" | none => pure ()
  | some "External" =>
    throw (issueForBinding "EXTERNAL_TARGET"
      "selected relationship is external" side binding (some record.rawTarget))
  | some _ =>
    throw (issueForBinding "INVALID_TARGET_MODE"
      "selected relationship has unsupported TargetMode" side binding (some record.rawTarget))
  if record.rawTarget.toUTF8.size > maxLocatorBytes then
    throw (issueForBinding "TARGET_LENGTH_LIMIT_EXCEEDED"
      "selected relationship target exceeds its limit" side binding)
  let normalizedPartPath ← match normalizeTarget record.rawTarget with
    | .ok path => pure path
    | .error detail =>
      let code := if detail.contains "limit" then "TARGET_LENGTH_LIMIT_EXCEEDED"
        else "UNSAFE_TARGET"
      throw (issueForBinding code detail side binding
        (if code == "UNSAFE_TARGET" then some record.rawTarget else none))
  return { relationshipId := binding.relationshipId, normalizedPartPath }

def physicalKey (slot : AlignedSlot) : StoryKind × String × String × String :=
  (slot.kind, slot.original.normalizedPartPath, slot.revised.normalizedPartPath,
    slot.compared.normalizedPartPath)

def assignPhysicalStories (slots : List AlignedSlot) : List AlignedSlot × List PhysicalStory :=
  slots.foldl (fun (assigned, stories) slot =>
    match stories.find? fun story =>
        story.kind == slot.kind &&
        story.originalPartPath == slot.original.normalizedPartPath &&
        story.revisedPartPath == slot.revised.normalizedPartPath &&
        story.comparedPartPath == slot.compared.normalizedPartPath with
    | some existing =>
      let updatedStories := stories.map fun story =>
        if story.physicalStoryOrdinal == existing.physicalStoryOrdinal then
          { story with selectingSlotOrdinals := story.selectingSlotOrdinals ++ [slot.slotOrdinal] }
        else story
      (assigned ++ [{ slot with physicalStoryOrdinal := existing.physicalStoryOrdinal }],
        updatedStories)
    | none =>
      let ordinal := stories.length
      (assigned ++ [{ slot with physicalStoryOrdinal := ordinal }],
        stories ++ [{
          physicalStoryOrdinal := ordinal
          kind := slot.kind
          originalPartPath := slot.original.normalizedPartPath
          revisedPartPath := slot.revised.normalizedPartPath
          comparedPartPath := slot.compared.normalizedPartPath
          selectingSlotOrdinals := [slot.slotOrdinal]
        }])) ([], [])

structure AlignedBindingCandidate where
  candidateOrdinal : Nat
  original : DirectBinding
  revised : DirectBinding
  compared : DirectBinding
  deriving BEq, DecidableEq, Repr, Inhabited

structure ResolvedSideBinding where
  side : VerifierSide
  binding : DirectBinding
  identity : RelationshipIdentity
  deriving BEq, DecidableEq, Repr, Inhabited

structure CandidateOutcome where
  candidate : AlignedBindingCandidate
  original : Except SelectionIssue RelationshipIdentity
  revised : Except SelectionIssue RelationshipIdentity
  compared : Except SelectionIssue RelationshipIdentity
  deriving Repr

def CandidateOutcome.issues (outcome : CandidateOutcome) : List SelectionIssue :=
  [(.original, outcome.candidate.original, outcome.original),
   (.revised, outcome.candidate.revised, outcome.revised),
   (.compared, outcome.candidate.compared, outcome.compared)].filterMap
    fun (side, binding, result) =>
      match result with
      | .error issue => some issue
      | .ok _ =>
        if match outcome.original, outcome.revised, outcome.compared with
            | .ok _, .ok _, .ok _ => true
            | _, _, _ => false then none
        else some (issueForBinding "SECTION_SLOT_MISMATCH"
          "peer-side relationship resolution prevented an aligned slot" side binding)

def CandidateOutcome.resolvedBindings (outcome : CandidateOutcome) : List ResolvedSideBinding :=
  [(.original, outcome.candidate.original, outcome.original),
   (.revised, outcome.candidate.revised, outcome.revised),
   (.compared, outcome.candidate.compared, outcome.compared)].filterMap
    fun (side, binding, result) =>
      match result with
      | .ok identity => some { side, binding, identity }
      | .error _ => none

def CandidateOutcome.slot? (outcome : CandidateOutcome) : Option AlignedSlot :=
  match outcome.original, outcome.revised, outcome.compared with
  | .ok original, .ok revised, .ok compared =>
    some {
      slotOrdinal := outcome.candidate.candidateOrdinal
      sourceCandidateOrdinal := outcome.candidate.candidateOrdinal
      sectionOrdinal := outcome.candidate.original.sectionOrdinal
      kind := outcome.candidate.original.kind
      role := outcome.candidate.original.role
      original
      revised
      compared
    }
  | _, _, _ => none

def resolveCandidate (originalRelationships revisedRelationships comparedRelationships :
    List RelationshipRecord) (candidate : AlignedBindingCandidate) : CandidateOutcome :=
  {
    candidate
    original := resolveBinding .original originalRelationships candidate.original
    revised := resolveBinding .revised revisedRelationships candidate.revised
    compared := resolveBinding .compared comparedRelationships candidate.compared
  }

def alignedCandidates (original revised compared : DocumentInventory) :
    List AlignedBindingCandidate :=
  (List.zip (List.zip original.bindings revised.bindings) compared.bindings).zipIdx.map
    fun (pair, candidateOrdinal) => {
      candidateOrdinal
      original := pair.1.1
      revised := pair.1.2
      compared := pair.2
    }

def resolveCandidates (original revised compared : DocumentInventory)
    (originalRelationships revisedRelationships comparedRelationships :
      List RelationshipRecord) : List CandidateOutcome :=
  (alignedCandidates original revised compared).map
    (resolveCandidate originalRelationships revisedRelationships comparedRelationships)

def reindexSlots (slots : List AlignedSlot) : List AlignedSlot :=
  slots.zipIdx.map fun (slot, slotOrdinal) => { slot with slotOrdinal }

def samePhysicalKey (slot : AlignedSlot) (work : PhysicalStory) : Bool :=
  slot.kind == work.kind &&
  slot.original.normalizedPartPath == work.originalPartPath &&
  slot.revised.normalizedPartPath == work.revisedPartPath &&
  slot.compared.normalizedPartPath == work.comparedPartPath

def physicalStoryKey (work : PhysicalStory) : StoryKind × String × String × String :=
  (work.kind, work.originalPartPath, work.revisedPartPath, work.comparedPartPath)

def locatorsForPhysicalStories (stories : List PhysicalStory) : List Nat :=
  stories.flatMap (·.selectingSlotOrdinals)

def canonicalLocatorsForPhysicalStory (slots : List AlignedSlot) (story : PhysicalStory) :
    List Nat :=
  ((slots.filter fun slot => samePhysicalKey slot story).map (·.slotOrdinal)).mergeSort (· < ·)

def uniqueWorkForSlotB (slot : AlignedSlot) (stories : List PhysicalStory) : Bool :=
  (stories.filter fun story =>
    slot.slotOrdinal ∈ story.selectingSlotOrdinals && samePhysicalKey slot story).length == 1

def alignedSlotUniqueWorkB (slots : List AlignedSlot) (stories : List PhysicalStory) : Bool :=
  slots.all fun slot => uniqueWorkForSlotB slot stories

def selectorLocatorPartitionB (slots : List AlignedSlot) (stories : List PhysicalStory) : Bool :=
  let locators := locatorsForPhysicalStories stories
  locators.length == slots.length &&
    slots.all (fun slot => (locators.filter (· == slot.slotOrdinal)).length == 1) &&
    stories.all (fun story =>
      !story.selectingSlotOrdinals.isEmpty &&
      story.selectingSlotOrdinals == canonicalLocatorsForPhysicalStory slots story) &&
    stories.all (fun story =>
      (stories.filter fun other => physicalStoryKey other == physicalStoryKey story).length == 1)

def assignPhysicalStoriesChecked (slots : List AlignedSlot) :
    Except String (List AlignedSlot × List PhysicalStory) :=
  let result := assignPhysicalStories slots
  if alignedSlotUniqueWorkB result.1 result.2 &&
      selectorLocatorPartitionB result.1 result.2 then
    .ok result
  else .error "physical-story assignment violated selector partition invariants"

structure RuntimeSelectorResult where
  alignedSlots : List AlignedSlot
  physicalStories : List PhysicalStory
  issues : List SelectionIssue
  candidateOutcomes : List CandidateOutcome
  resolvedBindings : List ResolvedSideBinding
  deriving Repr, Inhabited

def issueIdentifiesBindingB (issue : SelectionIssue) (side : VerifierSide)
    (binding : DirectBinding) : Bool :=
  issue.side == some side &&
  issue.sectionOrdinal == some binding.sectionOrdinal &&
  issue.kind == some binding.kind &&
  issue.role == some binding.role &&
  issue.relationshipId == some binding.relationshipId

def slotIdentity (slot : AlignedSlot) : VerifierSide → RelationshipIdentity
  | .original => slot.original
  | .revised => slot.revised
  | .compared => slot.compared

def candidateBinding (candidate : AlignedBindingCandidate) : VerifierSide → DirectBinding
  | .original => candidate.original
  | .revised => candidate.revised
  | .compared => candidate.compared

def candidateResult (outcome : CandidateOutcome) :
    VerifierSide → Except SelectionIssue RelationshipIdentity
  | .original => outcome.original
  | .revised => outcome.revised
  | .compared => outcome.compared

def slotIdentifiesCandidateSideB (slot : AlignedSlot) (outcome : CandidateOutcome)
    (side : VerifierSide) : Bool :=
  let binding := candidateBinding outcome.candidate side
  slot.sourceCandidateOrdinal == outcome.candidate.candidateOrdinal &&
  slot.sectionOrdinal == binding.sectionOrdinal &&
  slot.kind == binding.kind &&
  slot.role == binding.role

def slotContainsSideBindingB (slot : AlignedSlot) (outcome : CandidateOutcome)
    (side : VerifierSide) (identity : RelationshipIdentity) : Bool :=
  slotIdentifiesCandidateSideB slot outcome side &&
  slotIdentity slot side == identity

def sideBindingCompleteB (outcome : CandidateOutcome) (slots : List AlignedSlot)
    (side : VerifierSide) : Bool :=
  let binding := candidateBinding outcome.candidate side
  let identifyingIssues :=
    outcome.issues.filter fun issue => issueIdentifiesBindingB issue side binding
  match candidateResult outcome side with
  | .error _ =>
    identifyingIssues.length == 1 &&
    (slots.filter fun slot => slotIdentifiesCandidateSideB slot outcome side).isEmpty
  | .ok identity =>
    let matchingSlots := slots.filter fun slot =>
      slotContainsSideBindingB slot outcome side identity
    (identifyingIssues.length == 1 && matchingSlots.isEmpty) ||
      (identifyingIssues.isEmpty && matchingSlots.length == 1)

def directSelectionCompleteB (outcomes : List CandidateOutcome)
    (slots : List AlignedSlot) : Bool :=
  outcomes.all fun outcome =>
    [.original, .revised, .compared].all fun side =>
      sideBindingCompleteB outcome slots side

def resolveCandidatesChecked (original revised compared : DocumentInventory)
    (originalRelationships revisedRelationships comparedRelationships :
      List RelationshipRecord) :
    Except String (List CandidateOutcome × List AlignedSlot) :=
  let outcomes := resolveCandidates original revised compared originalRelationships
    revisedRelationships comparedRelationships
  let slots := reindexSlots (outcomes.filterMap CandidateOutcome.slot?)
  if directSelectionCompleteB outcomes slots then .ok (outcomes, slots)
  else .error "direct binding selection violated issue-or-slot completeness"

theorem directSelectionComplete_of_true {outcomes : List CandidateOutcome}
    {slots : List AlignedSlot} (h : directSelectionCompleteB outcomes slots = true) :
    ∀ outcome ∈ outcomes, ∀ side ∈ [.original, .revised, .compared],
      sideBindingCompleteB outcome slots side = true := by
  simpa [directSelectionCompleteB] using h

def alignInventories (original revised compared : DocumentInventory)
    (originalRelationships revisedRelationships comparedRelationships :
      List RelationshipRecord) : Except String RuntimeSelectorResult :=
  if original.sectionCount != revised.sectionCount ||
      original.sectionCount != compared.sectionCount then
    let issue : SelectionIssue := {
        code := "SECTION_COUNT_MISMATCH"
        detail := "selector-observable section counts differ across package sides" }
    .ok {
      alignedSlots := []
      physicalStories := []
      candidateOutcomes := []
      resolvedBindings := []
      issues := original.issues ++ revised.issues ++ compared.issues ++ [issue]
    }
  else if original.bindings.length != revised.bindings.length ||
      original.bindings.length != compared.bindings.length ||
      !(List.zip original.bindings revised.bindings).all (fun pair => sameLogicalSlot pair.1 pair.2) ||
      !(List.zip original.bindings compared.bindings).all (fun pair => sameLogicalSlot pair.1 pair.2) then
    let issue : SelectionIssue := {
        code := "SECTION_SLOT_MISMATCH"
        detail := "selector-observable ordered direct binding inventories differ" }
    .ok {
      alignedSlots := []
      physicalStories := []
      candidateOutcomes := []
      resolvedBindings := []
      issues := original.issues ++ revised.issues ++ compared.issues ++ [issue]
    }
  else
    match resolveCandidatesChecked original revised compared originalRelationships
        revisedRelationships comparedRelationships with
    | .error detail => .error detail
    | .ok (outcomes, slots) =>
      let issues := original.issues ++ revised.issues ++ compared.issues ++
        outcomes.flatMap CandidateOutcome.issues
      let resolvedBindings := outcomes.flatMap CandidateOutcome.resolvedBindings
      match assignPhysicalStoriesChecked slots with
      | .error detail => .error detail
      | .ok (assigned, stories) =>
        .ok {
          alignedSlots := assigned
          physicalStories := stories
          issues
          candidateOutcomes := outcomes
          resolvedBindings
        }

theorem direct_binding_selection_complete
    (original revised compared : DocumentInventory)
    (originalRelationships revisedRelationships comparedRelationships :
      List RelationshipRecord)
    (outcomes : List CandidateOutcome) (slots : List AlignedSlot)
    (h : resolveCandidatesChecked original revised compared originalRelationships
      revisedRelationships comparedRelationships = .ok (outcomes, slots)) :
    ∀ outcome ∈ outcomes, ∀ side ∈ [.original, .revised, .compared],
      sideBindingCompleteB outcome slots side = true := by
  simp only [resolveCandidatesChecked] at h
  split at h
  next valid =>
    have hEq :
        (resolveCandidates original revised compared originalRelationships
          revisedRelationships comparedRelationships,
         reindexSlots ((resolveCandidates original revised compared originalRelationships
          revisedRelationships comparedRelationships).filterMap CandidateOutcome.slot?)) =
        (outcomes, slots) := by
      simpa using h
    cases hEq
    exact directSelectionComplete_of_true valid
  next => contradiction

theorem aligned_slot_unique_work_item
    (slots assigned : List AlignedSlot) (stories : List PhysicalStory)
    (h : assignPhysicalStoriesChecked slots = .ok (assigned, stories)) :
    alignedSlotUniqueWorkB assigned stories = true := by
  simp only [assignPhysicalStoriesChecked] at h
  split at h
  next valid =>
    have hEq : assignPhysicalStories slots = (assigned, stories) := by
      simpa using h
    have hLeft := Bool.and_eq_true_iff.mp valid |>.1
    simpa [hEq] using hLeft
  next => contradiction

theorem dedup_preserves_selector_locators
    (slots assigned : List AlignedSlot) (stories : List PhysicalStory)
    (h : assignPhysicalStoriesChecked slots = .ok (assigned, stories)) :
    selectorLocatorPartitionB assigned stories = true := by
  simp only [assignPhysicalStoriesChecked] at h
  split at h
  next valid =>
    have hEq : assignPhysicalStories slots = (assigned, stories) := by
      simpa using h
    have hRight := Bool.and_eq_true_iff.mp valid |>.2
    simpa [hEq] using hRight
  next => contradiction

def namedStoryTripleForPhysicalStory (story : PhysicalStory)
    (original revised compared : List XmlTok) : NamedStoryTriple :=
  {
    name := s!"relationship-{story.physicalStoryOrdinal}"
    original
    revised
    combined := compared
  }

structure LoadedPhysicalWork where
  story : PhysicalStory
  original : List XmlTok
  revised : List XmlTok
  combined : List XmlTok
  deriving Repr, Inhabited

def LoadedPhysicalWork.triple (work : LoadedPhysicalWork) : NamedStoryTriple :=
  namedStoryTripleForPhysicalStory work.story work.original work.revised work.combined

def projectLoadedSelection (slots : List AlignedSlot) (loaded : List LoadedPhysicalWork) :
    Except String (List AlignedSlot × List LoadedPhysicalWork) := do
  let retainedSlots := reindexSlots <| slots.filter fun slot =>
    loaded.any fun work => samePhysicalKey slot work.story
  let (assigned, stories) ← assignPhysicalStoriesChecked retainedSlots
  let projected ← stories.mapM fun story => do
    let some work := loaded.find? fun candidate =>
      physicalStoryKey candidate.story == physicalStoryKey story |
      throw "loaded physical work has no projected selector story"
    return { work with story }
  return (assigned, projected)

def loadedTripleCorrespondsB (story : PhysicalStory) (work : LoadedPhysicalWork)
    (triple : NamedStoryTriple) : Bool :=
  work.story == story &&
  triple.name == s!"relationship-{story.physicalStoryOrdinal}" &&
  triple.original == work.original &&
  triple.revised == work.revised &&
  triple.combined == work.combined &&
  triple.originalPresent &&
  triple.revisedPresent &&
  triple.combinedPresent

def selectedStoryIdentityCorrespondsB : List PhysicalStory → List LoadedPhysicalWork →
    List NamedStoryTriple → Bool
  | [], [], [] => true
  | story :: stories, work :: works, triple :: triples =>
    loadedTripleCorrespondsB story work triple &&
      selectedStoryIdentityCorrespondsB stories works triples
  | _, _, _ => false

def aggregateSelectionValidB (outcomes : List CandidateOutcome) (slots : List AlignedSlot)
    (stories : List PhysicalStory) (loaded : List LoadedPhysicalWork)
    (selected : List NamedStoryTriple) : Bool :=
  directSelectionCompleteB outcomes slots &&
  alignedSlotUniqueWorkB slots stories &&
  selectorLocatorPartitionB slots stories &&
  selectedStoryIdentityCorrespondsB stories loaded selected

def validateAggregateSelection (outcomes : List CandidateOutcome) (slots : List AlignedSlot)
    (stories : List PhysicalStory) (loaded : List LoadedPhysicalWork)
    (selected : List NamedStoryTriple) : Except String Unit :=
  if aggregateSelectionValidB outcomes slots stories loaded selected then
    .ok ()
  else .error "selected story triples do not correspond to physical selector work items"

def protocolV4ResponseJson (passed : Bool) (fixedStories fixedStoryIssues
    relationshipSlots relationshipStories selectionIssues : List Json) : Json :=
  Json.mkObj
    [ ("protocolVersion", toJson (4 : Nat))
    , ("checker", toJson "safe-docx-lean-relationship-story-checker")
    , ("passed", toJson passed)
    , ("fixedStories", Json.arr fixedStories.toArray)
    , ("presenceMismatches", Json.arr #[])
    , ("fixedStoryIssues", Json.arr fixedStoryIssues.toArray)
    , ("relationshipSlots", Json.arr relationshipSlots.toArray)
    , ("relationshipStories", Json.arr relationshipStories.toArray)
    , ("selectionIssues", Json.arr selectionIssues.toArray)
    ]

def CheckedStoryProperties (story : NamedStoryTriple) : Prop :=
  let report := comparisonCheckerB story.original story.revised story.combined
  report.acceptPreservesFieldStructure = true ∧
  report.rejectPreservesFieldStructure = true ∧
  report.acceptTextMatchesRevised = true ∧
  report.rejectTextMatchesOriginal = true ∧
  report.combinedHasNoFldCharInsideDel = true ∧
  MoveRangesWellFormed story.combined

theorem relationship_story_aggregate_sound
    (outcomes : List CandidateOutcome) (slots : List AlignedSlot)
    (physicalStories : List PhysicalStory) (loaded : List LoadedPhysicalWork)
    (fixedStories selectedStories : List NamedStoryTriple)
    (hSelection :
      validateAggregateSelection outcomes slots physicalStories loaded selectedStories = .ok ())
    (hPassed :
      storyCollectionPassed
        (checkStoryCollection (fixedStories ++ selectedStories)) = true) :
    (∀ outcome ∈ outcomes, ∀ side ∈ [.original, .revised, .compared],
      sideBindingCompleteB outcome slots side = true) ∧
    alignedSlotUniqueWorkB slots physicalStories = true ∧
    selectorLocatorPartitionB slots physicalStories = true ∧
    selectedStoryIdentityCorrespondsB physicalStories loaded selectedStories = true ∧
    ∀ story ∈ fixedStories ++ selectedStories,
      CheckedStoryProperties story := by
  simp only [validateAggregateSelection] at hSelection
  split at hSelection
  next valid =>
    have outer := Bool.and_eq_true_iff.mp valid
    have throughLocators := Bool.and_eq_true_iff.mp outer.1
    have throughAlignment := Bool.and_eq_true_iff.mp throughLocators.1
    have hStories :
        ∀ story ∈ fixedStories ++ selectedStories,
          CheckedStoryProperties story :=
      story_collection_checker_sound (fixedStories ++ selectedStories) hPassed
    exact ⟨directSelectionComplete_of_true throughAlignment.1, throughAlignment.2,
      throughLocators.2, outer.2, hStories⟩
  next => contradiction

end Tier2.RelationshipStorySelector
