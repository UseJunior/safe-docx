namespace Tier2.CommentReferenceIntegrity.Typed

structure BoundedBytes where
  bytes : List UInt8
  limit : Nat
  admitted : bytes.length ≤ limit
  deriving DecidableEq

structure BoundedByteArray where
  bytes : ByteArray
  limit : Nat
  admitted : bytes.size ≤ limit
  deriving DecidableEq

inductive Side
  | original
  | revised
  | compared
  deriving DecidableEq

inductive RelationshipMode
  | internal
  | external
  | invalid
  deriving DecidableEq

structure TypedRelationship where
  ordinal : Nat
  relationshipType : BoundedBytes
  relationshipId : BoundedBytes
  rawTarget : BoundedBytes
  rawTargetMode : Option BoundedBytes
  normalizedTarget : Option BoundedBytes
  mode : RelationshipMode
  deriving DecidableEq

structure TypedEntry where
  name : BoundedBytes
  flags : Nat
  method : Nat
  crc32 : Nat
  compressedSize : Nat
  expandedSize : Nat
  localHeaderOffset : Nat
  dataOffset : Nat
  localSpanEnd : Nat
  isDirectory : Bool
  deriving DecidableEq

structure TypedPackageIndex where
  entries : List TypedEntry
  centralOffset : Nat
  centralSize : Nat
  deriving DecidableEq

structure TypedEocd where
  offset : Nat
  centralOffset : Nat
  centralSize : Nat
  entryCount : Nat
  deriving DecidableEq

structure TypedXmlAttribute where
  namespaceUri : BoundedBytes
  localName : BoundedBytes
  value : BoundedBytes
  deriving DecidableEq

inductive TypedXmlEvent
  | startElement (namespaceUri localName : BoundedBytes)
      (attributes : List TypedXmlAttribute) (depth : Nat)
      (selfClosing : Bool) (eventOrdinal : Nat)
  | endElement (namespaceUri localName : BoundedBytes) (depth eventOrdinal : Nat)
  | text (value : BoundedByteArray) (depth eventOrdinal : Nat)
  deriving DecidableEq

structure TypedExtraction where
  packageBytes : ByteArray
  snapshotBytes : ByteArray
  entry : TypedEntry
  compressedSlice : ByteArray
  expandedBytes : ByteArray
  deriving DecidableEq

def byteArraySlice (bytes : ByteArray) (start stop : Nat) : ByteArray :=
  bytes.extract start stop

def TypedEntryMetadataOf (left right : TypedEntry) : Prop :=
  left.name.bytes = right.name.bytes ∧
  left.flags = right.flags ∧
  left.method = right.method ∧
  left.crc32 = right.crc32 ∧
  left.compressedSize = right.compressedSize ∧
  left.expandedSize = right.expandedSize ∧
  left.localHeaderOffset = right.localHeaderOffset ∧
  left.dataOffset = right.dataOffset ∧
  left.localSpanEnd = right.localSpanEnd ∧
  left.isDirectory = right.isDirectory

def typedEntryMetadataCheck (left right : TypedEntry) : Bool :=
  decide (left.name.bytes = right.name.bytes) &&
  decide (left.flags = right.flags) &&
  decide (left.method = right.method) &&
  decide (left.crc32 = right.crc32) &&
  decide (left.compressedSize = right.compressedSize) &&
  decide (left.expandedSize = right.expandedSize) &&
  decide (left.localHeaderOffset = right.localHeaderOffset) &&
  decide (left.dataOffset = right.dataOffset) &&
  decide (left.localSpanEnd = right.localSpanEnd) &&
  decide (left.isDirectory = right.isDirectory)

def typedByteAt? (bytes : ByteArray) (offset : Nat) : Option Nat :=
  if offset < bytes.size then
    (bytes.extract offset (offset + 1)).data.toList.head?.map UInt8.toNat
  else none

def typedUInt16At? (bytes : ByteArray) (offset : Nat) : Option Nat := do
  let low ← typedByteAt? bytes offset
  let high ← typedByteAt? bytes (offset + 1)
  pure (low + high * 256)

def typedUInt32At? (bytes : ByteArray) (offset : Nat) : Option Nat := do
  let low ← typedUInt16At? bytes offset
  let high ← typedUInt16At? bytes (offset + 2)
  pure (low + high * 65536)

def typedSignatureCheck
    (bytes : ByteArray) (offset signature : Nat) : Bool :=
  decide (typedUInt32At? bytes offset = some signature)

def typedLocalHeaderSignatureCheck
    (bytes : ByteArray) (offset : Nat) : Bool :=
  typedSignatureCheck bytes offset 0x04034b50

def typedZipBitSet (value bit : Nat) : Bool :=
  (value / (2 ^ bit)) % 2 == 1

def typedZipFlagsAllowed (method flags : Nat) : Bool :=
  let allowed := if method == 0 then [11] else [1, 2, 11]
  (method == 0 || method == 8) &&
    !(List.range 16).any fun bit =>
      !allowed.contains bit && typedZipBitSet flags bit

def typedUtf8Continuation (value : UInt8) : Bool :=
  0x80 ≤ value.toNat && value.toNat ≤ 0xbf

set_option backward.match.sparseCases false in
def typedValidUtf8 : List UInt8 → Bool
  | [] => true
  | first :: rest =>
      if first.toNat ≤ 0x7f then typedValidUtf8 rest
      else if 0xc2 ≤ first.toNat && first.toNat ≤ 0xdf then
        match rest with
        | second :: tail =>
            typedUtf8Continuation second && typedValidUtf8 tail
        | _ => false
      else if first.toNat == 0xe0 then
        match rest with
        | second :: third :: tail =>
            0xa0 ≤ second.toNat && second.toNat ≤ 0xbf &&
              typedUtf8Continuation third && typedValidUtf8 tail
        | _ => false
      else if (0xe1 ≤ first.toNat && first.toNat ≤ 0xec) ||
          (0xee ≤ first.toNat && first.toNat ≤ 0xef) then
        match rest with
        | second :: third :: tail =>
            typedUtf8Continuation second &&
              typedUtf8Continuation third && typedValidUtf8 tail
        | _ => false
      else if first.toNat == 0xed then
        match rest with
        | second :: third :: tail =>
            0x80 ≤ second.toNat && second.toNat ≤ 0x9f &&
              typedUtf8Continuation third && typedValidUtf8 tail
        | _ => false
      else if first.toNat == 0xf0 then
        match rest with
        | second :: third :: fourth :: tail =>
            0x90 ≤ second.toNat && second.toNat ≤ 0xbf &&
              typedUtf8Continuation third &&
              typedUtf8Continuation fourth && typedValidUtf8 tail
        | _ => false
      else if 0xf1 ≤ first.toNat && first.toNat ≤ 0xf3 then
        match rest with
        | second :: third :: fourth :: tail =>
            typedUtf8Continuation second &&
              typedUtf8Continuation third &&
              typedUtf8Continuation fourth && typedValidUtf8 tail
        | _ => false
      else if first.toNat == 0xf4 then
        match rest with
        | second :: third :: fourth :: tail =>
            0x80 ≤ second.toNat && second.toNat ≤ 0x8f &&
              typedUtf8Continuation third &&
              typedUtf8Continuation fourth && typedValidUtf8 tail
        | _ => false
      else false

def typedZipNameEncodingCheck (name : BoundedBytes) (flags : Nat) : Bool :=
  if typedZipBitSet flags 11 then typedValidUtf8 name.bytes
  else name.bytes.all fun value =>
    0x20 ≤ value.toNat && value.toNat ≤ 0x7e

def typedByteSliceEquals (bytes : ByteArray) (start : Nat)
    (expected : List UInt8) : Bool :=
  decide ((bytes.extract start (start + expected.length)).data.toList =
    expected)

set_option backward.match.sparseCases false in
def typedZipExtraFieldsLoop (bytes : ByteArray) (stop : Nat) :
    Nat → Nat → Bool
  | 0, position => decide (position = stop)
  | fuel + 1, position =>
      if position == stop then true
      else
        let headerId := typedUInt16At? bytes position
        let dataSize := typedUInt16At? bytes (position + 2)
        let next := position + 4 + dataSize.getD 0
        decide (position + 4 ≤ stop) &&
        headerId.isSome && dataSize.isSome &&
        decide (next ≤ stop) &&
        decide (headerId != some 0x0001) &&
        decide (headerId != some 0x7075) &&
        typedZipExtraFieldsLoop bytes stop fuel next

def typedZipExtraFieldsCheck (bytes : ByteArray)
    (start length : Nat) : Bool :=
  let stop := start + length
  decide (start ≤ bytes.size) &&
  decide (stop ≤ bytes.size) &&
  typedZipExtraFieldsLoop bytes stop (length / 4 + 1) start

def typedUnsafeEntryNameByte (value : UInt8) : Bool :=
  value == 0 || value == 0x5c || value == 0x3a || value == 0x3f ||
    value == 0x23 || value == 0x2a || value == 0x5b || value == 0x5d ||
    value.toNat < 0x20 || value == 0x7f

def typedSplitPathSegments : List UInt8 → List (List UInt8)
  | [] => [[]]
  | value :: rest =>
      if value == 0x2f then [] :: typedSplitPathSegments rest
      else
        match typedSplitPathSegments rest with
        | [] => [[value]]
        | first :: tail => (value :: first) :: tail

set_option backward.match.sparseCases false in
def typedEndsWithSlash : List UInt8 → Bool
  | [] => false
  | [value] => value == 0x2f
  | _ :: rest => typedEndsWithSlash rest

set_option backward.match.sparseCases false in
def typedDropLast : List UInt8 → List UInt8
  | [] | [_] => []
  | value :: rest => value :: typedDropLast rest

def typedSafeEntryNameCheck (name : BoundedBytes)
    (isDirectory : Bool) : Bool :=
  let pathBytes :=
    if isDirectory then typedDropLast name.bytes else name.bytes
  let contentTypesName :=
    [91,67,111,110,116,101,110,116,95,84,121,112,101,115,93,46,120,109,108]
  name.bytes.length ≤ 256 &&
  ((name.bytes == contentTypesName && !isDirectory) ||
  (!pathBytes.isEmpty &&
    pathBytes.head? != some 0x2f &&
    (typedEndsWithSlash name.bytes == isDirectory) &&
    !pathBytes.any typedUnsafeEntryNameByte &&
    (typedSplitPathSegments pathBytes).all fun segment =>
      !segment.isEmpty && segment != [0x2e] && segment != [0x2e, 0x2e]))

def typedEntryLocalHeaderCheck
    (packageBytes : ByteArray) (index : TypedPackageIndex)
    (entry : TypedEntry) : Bool :=
  let nameLength := typedUInt16At? packageBytes (entry.localHeaderOffset + 26)
  let extraLength := typedUInt16At? packageBytes (entry.localHeaderOffset + 28)
  typedSafeEntryNameCheck entry.name entry.isDirectory &&
  typedZipNameEncodingCheck entry.name entry.flags &&
  typedZipFlagsAllowed entry.method entry.flags &&
  (entry.method == 0 || entry.method == 8) &&
  !entry.isDirectory &&
  typedLocalHeaderSignatureCheck packageBytes entry.localHeaderOffset &&
  typedUInt16At? packageBytes (entry.localHeaderOffset + 6) =
    some entry.flags &&
  typedUInt16At? packageBytes (entry.localHeaderOffset + 8) =
    some entry.method &&
  typedUInt32At? packageBytes (entry.localHeaderOffset + 14) =
    some entry.crc32 &&
  typedUInt32At? packageBytes (entry.localHeaderOffset + 18) =
    some entry.compressedSize &&
  typedUInt32At? packageBytes (entry.localHeaderOffset + 22) =
    some entry.expandedSize &&
  nameLength = some entry.name.bytes.length &&
  extraLength.isSome &&
  decide (entry.localHeaderOffset + 30 + entry.name.bytes.length +
    extraLength.getD 0 = entry.dataOffset) &&
  typedByteSliceEquals packageBytes (entry.localHeaderOffset + 30)
    entry.name.bytes &&
  typedZipExtraFieldsCheck packageBytes
    (entry.localHeaderOffset + 30 + entry.name.bytes.length)
    (extraLength.getD 0) &&
  decide (entry.localSpanEnd = entry.dataOffset + entry.compressedSize) &&
  decide (entry.localHeaderOffset < entry.dataOffset) &&
  decide (entry.dataOffset ≤ entry.localSpanEnd) &&
  decide (entry.localSpanEnd ≤ index.centralOffset)

def typedEntrySpansDisjoint (left right : TypedEntry) : Bool :=
  if left.name.bytes = right.name.bytes then true
  else left.localSpanEnd ≤ right.localHeaderOffset ||
    right.localSpanEnd ≤ left.localHeaderOffset

set_option backward.match.sparseCases false in
def typedCentralEntriesCheck (bytes : ByteArray) (stop : Nat) :
    List TypedEntry → Nat → Bool
  | [], position => decide (position = stop)
  | entry :: rest, position =>
      let flags := typedUInt16At? bytes (position + 8)
      let method := typedUInt16At? bytes (position + 10)
      let crc32 := typedUInt32At? bytes (position + 16)
      let compressedSize := typedUInt32At? bytes (position + 20)
      let expandedSize := typedUInt32At? bytes (position + 24)
      let nameLength := typedUInt16At? bytes (position + 28)
      let extraLength := typedUInt16At? bytes (position + 30)
      let commentLength := typedUInt16At? bytes (position + 32)
      let diskStart := typedUInt16At? bytes (position + 34)
      let externalAttributes := typedUInt32At? bytes (position + 38)
      let localHeaderOffset := typedUInt32At? bytes (position + 42)
      let unixType := externalAttributes.getD 0 / 65536 / 4096
      let next := position + 46 + nameLength.getD 0 +
        extraLength.getD 0 + commentLength.getD 0
      typedSignatureCheck bytes position 0x02014b50 &&
      decide (position + 46 ≤ stop) &&
      flags = some entry.flags &&
      method = some entry.method &&
      crc32 = some entry.crc32 &&
      compressedSize = some entry.compressedSize &&
      expandedSize = some entry.expandedSize &&
      nameLength = some entry.name.bytes.length &&
      extraLength.isSome && commentLength.isSome &&
      diskStart = some 0 &&
      externalAttributes.isSome &&
      localHeaderOffset = some entry.localHeaderOffset &&
      decide (compressedSize != some 0xffffffff) &&
      decide (expandedSize != some 0xffffffff) &&
      decide (localHeaderOffset != some 0xffffffff) &&
      typedZipFlagsAllowed entry.method entry.flags &&
      (entry.method == 0 || entry.method == 8) &&
      typedSafeEntryNameCheck entry.name entry.isDirectory &&
      typedZipNameEncodingCheck entry.name entry.flags &&
      !entry.isDirectory &&
      !typedZipBitSet (externalAttributes.getD 0) 4 &&
      (unixType == 0 || unixType == 8) &&
      typedByteSliceEquals bytes (position + 46) entry.name.bytes &&
      typedZipExtraFieldsCheck bytes
        (position + 46 + entry.name.bytes.length) (extraLength.getD 0) &&
      decide (next ≤ stop) &&
      typedCentralEntriesCheck bytes stop rest next

def typedStructuralEocdAt?
    (packageBytes : ByteArray) (offset : Nat) : Option TypedEocd :=
  let disk := typedUInt16At? packageBytes (offset + 4)
  let centralDisk := typedUInt16At? packageBytes (offset + 6)
  let entriesOnDisk := typedUInt16At? packageBytes (offset + 8)
  let entryCount := typedUInt16At? packageBytes (offset + 10)
  let centralSize := typedUInt32At? packageBytes (offset + 12)
  let centralOffset := typedUInt32At? packageBytes (offset + 16)
  let commentLength := typedUInt16At? packageBytes (offset + 20)
  if typedSignatureCheck packageBytes offset 0x06054b50 &&
      decide (offset + 22 ≤ packageBytes.size) &&
      disk = some 0 && centralDisk = some 0 &&
      entriesOnDisk = entryCount &&
      decide (entryCount != some 0xffff) &&
      decide (centralSize != some 0xffffffff) &&
      decide (centralOffset != some 0xffffffff) &&
      commentLength.isSome &&
      decide (offset + 22 + commentLength.getD 0 = packageBytes.size) &&
      decide (entryCount.getD 0 ≤ 1024) &&
      decide (centralSize.getD 0 ≤ 4194304) &&
      decide (centralOffset.getD 0 + centralSize.getD 0 = offset) then
    some {
      offset
      centralOffset := centralOffset.getD 0
      centralSize := centralSize.getD 0
      entryCount := entryCount.getD 0
    }
  else none

def typedStructuralEocdCandidates
    (packageBytes : ByteArray) : List TypedEocd :=
  let start := packageBytes.size - min packageBytes.size 65557
  (List.range (packageBytes.size - start)).filterMap fun delta =>
    typedStructuralEocdAt? packageBytes (start + delta)

def typedSoleEocdBindsIndexCheck
    (packageBytes : ByteArray) (index : TypedPackageIndex)
    (eocd : TypedEocd) : Bool :=
  decide (eocd.entryCount = index.entries.length) &&
  decide (eocd.centralSize = index.centralSize) &&
  decide (eocd.centralOffset = index.centralOffset) &&
  !typedSignatureCheck packageBytes
    (eocd.offset - min eocd.offset 20) 0x07064b50 &&
  !typedSignatureCheck packageBytes
    (eocd.offset - min eocd.offset 56) 0x06064b50 &&
  typedCentralEntriesCheck packageBytes eocd.offset
    index.entries eocd.centralOffset

set_option backward.match.sparseCases false in
def typedEocdCandidateListBindsIndexCheck
    (packageBytes : ByteArray) (index : TypedPackageIndex) :
    List TypedEocd → Bool
  | eocd :: [] => typedSoleEocdBindsIndexCheck packageBytes index eocd
  | _ => false

def typedBinaryIndexCheck
    (packageBytes : ByteArray) (index : TypedPackageIndex) : Bool :=
  decide (packageBytes.size ≤ 33554432) &&
  decide (22 ≤ packageBytes.size) &&
  decide (index.entries.length ≤ 1024) &&
  decide (index.centralSize ≤ 4194304) &&
  decide (index.centralOffset + index.centralSize ≤ packageBytes.size) &&
  typedEocdCandidateListBindsIndexCheck packageBytes index
    (typedStructuralEocdCandidates packageBytes) &&
  index.entries.all (fun entry =>
    decide ((index.entries.filter fun candidate =>
      candidate.name.bytes = entry.name.bytes).length = 1)) &&
  index.entries.all (typedEntryLocalHeaderCheck packageBytes index) &&
  index.entries.all fun entry =>
    index.entries.all fun other => typedEntrySpansDisjoint entry other

def TypedBinaryIndexOf
    (packageBytes : ByteArray) (index : TypedPackageIndex) : Prop :=
  typedBinaryIndexCheck packageBytes index = true

def typedSelectedEntryCheck
    (index : TypedPackageIndex) (path : BoundedBytes)
    (entry : TypedEntry) : Bool :=
  decide ((index.entries.filter fun candidate =>
    candidate.name.bytes = path.bytes).length = 1) &&
  decide (index.entries.find? (fun candidate =>
    candidate.name.bytes = path.bytes) = some entry) &&
  !entry.isDirectory

def typedExtractionCheck (packageBytes : ByteArray) (index : TypedPackageIndex)
    (entry : TypedEntry) (extraction : TypedExtraction) : Bool :=
  typedBinaryIndexCheck packageBytes index &&
  decide (extraction.packageBytes.data.toList = packageBytes.data.toList) &&
  decide (extraction.snapshotBytes.data.toList = packageBytes.data.toList) &&
  typedSelectedEntryCheck index entry.name entry &&
  typedEntryMetadataCheck extraction.entry entry &&
  decide (extraction.compressedSlice.data.toList =
    (byteArraySlice packageBytes
      entry.dataOffset entry.localSpanEnd).data.toList) &&
  decide (extraction.compressedSlice.size = entry.compressedSize) &&
  decide (extraction.expandedBytes.size = entry.expandedSize) &&
  decide (entry.localHeaderOffset ≤ entry.dataOffset) &&
  decide (entry.dataOffset ≤ entry.localSpanEnd) &&
  decide (entry.localSpanEnd ≤ index.centralOffset)

def TypedExtractionOf (packageBytes : ByteArray) (index : TypedPackageIndex)
    (entry : TypedEntry) (extraction : TypedExtraction) : Prop :=
  typedExtractionCheck packageBytes index entry extraction = true

structure TypedParsedPart where
  rawBytes : ByteArray
  expectedRootUri : BoundedBytes
  expectedRootLocalName : BoundedBytes
  events : List TypedXmlEvent
  depthLimit : Nat
  eventLimit : Nat
  deriving DecidableEq

inductive TypedXmlEventIdentity
  | startElement (namespaceUri localName : List UInt8)
      (attributes : List (List UInt8 × List UInt8 × List UInt8))
      (depth : Nat) (selfClosing : Bool) (eventOrdinal : Nat)
  | endElement (namespaceUri localName : List UInt8)
      (depth eventOrdinal : Nat)
  | text (value : List UInt8) (depth eventOrdinal : Nat)
  deriving DecidableEq

def typedXmlEventIdentity : TypedXmlEvent → TypedXmlEventIdentity
  | .startElement namespaceUri localName attributes depth selfClosing ordinal =>
      .startElement namespaceUri.bytes localName.bytes
        (attributes.map fun attr =>
          (attr.namespaceUri.bytes, attr.localName.bytes,
            attr.value.bytes))
        depth selfClosing ordinal
  | .endElement namespaceUri localName depth ordinal =>
      .endElement namespaceUri.bytes localName.bytes depth ordinal
  | .text value depth ordinal =>
      .text value.bytes.data.toList depth ordinal

def typedParsedPartCheck (extraction : TypedExtraction)
    (expectedRootUri expectedRootLocalName : BoundedBytes)
    (expectedEvents : List TypedXmlEvent)
    (parsed : TypedParsedPart) : Bool :=
  decide (parsed.rawBytes.data.toList =
    extraction.expandedBytes.data.toList) &&
  decide (parsed.expectedRootUri.bytes = expectedRootUri.bytes) &&
  decide (parsed.expectedRootLocalName.bytes = expectedRootLocalName.bytes) &&
  decide (parsed.events.map typedXmlEventIdentity =
    expectedEvents.map typedXmlEventIdentity) &&
  decide (parsed.events.length ≤ parsed.eventLimit)

def TypedParsedPartOf (extraction : TypedExtraction)
    (expectedRootUri expectedRootLocalName : BoundedBytes)
    (expectedEvents : List TypedXmlEvent)
    (parsed : TypedParsedPart) : Prop :=
  typedParsedPartCheck extraction expectedRootUri expectedRootLocalName
    expectedEvents parsed = true

structure TypedSelectedComment where
  relationshipOrdinal : Nat
  relationshipId : BoundedBytes
  normalizedPartPath : BoundedBytes
  deriving DecidableEq

inductive TypedSelectionFailure
  | ambiguous (ordinal : Nat)
  | external (ordinal : Nat)
  | invalidMode (ordinal : Nat)
  | targetLimit (ordinal : Nat)
  | unsafeTarget (ordinal : Nat)
  deriving DecidableEq

def exactTypedCommentRelationships (commentType : BoundedBytes)
    (relationships : List TypedRelationship) : List TypedRelationship :=
  relationships.filter fun relationship =>
    decide (relationship.relationshipType.bytes = commentType.bytes)

def selectSingleTypedCommentRelationship
    (relationship : TypedRelationship) :
    Except TypedSelectionFailure (Option TypedSelectedComment) :=
  if relationship.rawTarget.bytes.length > 256 then
    .error (.targetLimit relationship.ordinal)
  else match relationship.mode with
  | .external => .error (.external relationship.ordinal)
  | .invalid => .error (.invalidMode relationship.ordinal)
  | .internal =>
      match relationship.normalizedTarget with
      | none => .error (.unsafeTarget relationship.ordinal)
      | some normalized =>
          .ok (some {
            relationshipOrdinal := relationship.ordinal
            relationshipId := relationship.relationshipId
            normalizedPartPath := normalized })

def selectTypedCommentSpec (commentType : BoundedBytes)
    (relationships : List TypedRelationship) :
    Except TypedSelectionFailure (Option TypedSelectedComment) :=
  match exactTypedCommentRelationships commentType relationships with
  | [] => .ok none
  | first :: rest =>
      match rest with
      | [] => selectSingleTypedCommentRelationship first
      | second :: _ => .error (.ambiguous second.ordinal)

def selectTypedComment (commentType : BoundedBytes)
    (relationships : List TypedRelationship) :
    Except TypedSelectionFailure (Option TypedSelectedComment) :=
  selectTypedCommentSpec commentType relationships

def TypedCommentSelectionResultOf (commentType : BoundedBytes)
    (relationships : List TypedRelationship)
    (result : Except TypedSelectionFailure (Option TypedSelectedComment)) : Prop :=
  result = selectTypedCommentSpec commentType relationships ∧
  match exactTypedCommentRelationships commentType relationships with
  | [] => result = .ok none
  | first :: rest =>
      match rest with
      | [] => result = selectSingleTypedCommentRelationship first
      | second :: _ => result = .error (.ambiguous second.ordinal)

theorem typed_comment_selector_result_sound
    (commentType : BoundedBytes) (relationships : List TypedRelationship) :
    TypedCommentSelectionResultOf commentType relationships
      (selectTypedComment commentType relationships) := by
  constructor
  · rfl
  · unfold selectTypedComment selectTypedCommentSpec
    generalize hExact :
      exactTypedCommentRelationships commentType relationships = exact
    cases exact with
    | nil => rfl
    | cons first rest =>
        cases rest with
        | nil => rfl
        | cons second tail => rfl

structure TypedStorySource where
  side : Side
  sourceOrdinal : Nat
  partPath : BoundedBytes
  parsed : TypedParsedPart
  deriving DecidableEq

inductive TypedSourceKind
  | main | header | footer | footnotes | endnotes
  deriving DecidableEq

structure TypedSourceSlot where
  kind : TypedSourceKind
  physicalStoryOrdinal : Nat
  source : TypedStorySource
  deriving DecidableEq

structure TypedHeaderFooterSlot where
  slotOrdinal : Nat
  physicalStoryOrdinal : Nat
  kind : TypedSourceKind
  originalPartPath : BoundedBytes
  revisedPartPath : BoundedBytes
  comparedPartPath : BoundedBytes
  deriving DecidableEq

structure TypedHeaderFooterStory where
  physicalStoryOrdinal : Nat
  kind : TypedSourceKind
  partPath : BoundedBytes
  originalPartPath : BoundedBytes
  revisedPartPath : BoundedBytes
  comparedPartPath : BoundedBytes
  selectingSlotOrdinals : List Nat
  source : Option TypedStorySource
  deriving DecidableEq

structure TypedNoteSelection where
  kind : TypedSourceKind
  relationshipSelected : Bool
  referencePresent : Bool
  selectedPartPath : Option BoundedBytes
  partPresent : Bool
  source : Option TypedStorySource
  deriving DecidableEq

inductive TypedPriorSourceAdmission
  | admitted
  | relationshipSelectionFailure
  | storyRealizationFailure
  | noteSemanticFailure
  | resourceFailure
  deriving DecidableEq

structure TypedCommentRealization where
  selected : TypedSelectedComment
  entry : TypedEntry
  extraction : TypedExtraction
  retainedParsedEvents : List TypedXmlEvent
  parsed : TypedParsedPart
  deriving DecidableEq

inductive TypedRealizationFailure
  | partMissing
  | selectedPartLimit
  | tripleSelectedPartLimit
  | partCompressedLimit
  | partExpandedLimit
  | partRatioLimit
  | cumulativeCompressedLimit
  | cumulativeExpandedLimit
  | tripleCompressedLimit
  | tripleExpandedLimit
  | extractionFailed
  | invalidUtf8
  | invalidXml
  | xmlDepthLimit
  | xmlEventLimit
  | cumulativeXmlEventLimit
  | tripleXmlEventLimit
  | rootMismatch
  deriving DecidableEq

structure TypedCanonicalId where
  negative : Bool
  digits : List UInt8
  deriving DecidableEq

structure TypedReference where
  sourceOrdinal : Nat
  occurrenceOrdinal : Nat
  rawId : Option BoundedBytes
  canonicalId : Option TypedCanonicalId
  deriving DecidableEq

structure TypedDefinition where
  occurrenceOrdinal : Nat
  rawId : Option BoundedBytes
  canonicalId : Option TypedCanonicalId
  direct : Bool
  deriving DecidableEq

inductive TypedScanCrossing
  | references (sourceOrdinal occurrenceOrdinal : Nat)
  | uniqueIds (sourceOrdinal occurrenceOrdinal : Nat)
      (canonicalId : TypedCanonicalId)
  | definitions (occurrenceOrdinal : Nat)
  | nonDirectDefinitions (occurrenceOrdinal : Nat)
  deriving DecidableEq

structure TypedCommentScan where
  references : List TypedReference
  definitions : List TypedDefinition
  nonDirectDefinitions : List TypedDefinition
  crossing : Option TypedScanCrossing
  deriving DecidableEq

structure TypedPackageView where
  packageBytes : ByteArray
  index : TypedPackageIndex
  commentType : BoundedBytes
  commentsRootNamespace : BoundedBytes
  commentsRootLocalName : BoundedBytes
  relationships : List TypedRelationship
  mainSource : TypedStorySource
  headerFooterSlots : List TypedHeaderFooterSlot
  headerFooterStories : List TypedHeaderFooterStory
  noteSelections : List TypedNoteSelection
  priorSourceAdmission : TypedPriorSourceAdmission
  realizationFailure : Option TypedRealizationFailure
  realizationFailureDetail : Option BoundedBytes
  selectedPartPresent : Bool
  realization : Option TypedCommentRealization
  retainedScan : TypedCommentScan

inductive TypedEvaluationStatus
  | passed
  | failed
  | notEvaluated
  deriving DecidableEq

inductive TypedCommentOutcome
  | absent
  | selected (value : TypedSelectedComment)
  | selectorError (failure : TypedSelectionFailure)
  | realizationError (value : TypedSelectedComment)
  deriving DecidableEq

inductive TypedIssueCode
  | relationshipRequired
  | selectorAmbiguous
  | selectorExternal
  | selectorInvalidMode
  | selectorTargetLimit
  | selectorUnsafeTarget
  | partMissing
  | selectedPartLimit
  | tripleSelectedPartLimit
  | partCompressedLimit
  | partExpandedLimit
  | partRatioLimit
  | cumulativeCompressedLimit
  | cumulativeExpandedLimit
  | tripleCompressedLimit
  | tripleExpandedLimit
  | extractionFailed
  | invalidUtf8
  | invalidXml
  | xmlDepthLimit
  | xmlEventLimit
  | cumulativeXmlEventLimit
  | tripleXmlEventLimit
  | rootMismatch
  | sourcePartitionIncomplete
  | referenceIdMissing
  | referenceIdMalformed
  | referenceIdTooLong
  | definitionIdMissing
  | definitionIdMalformed
  | definitionIdTooLong
  | definitionNotDirect
  | definitionDuplicate
  | definitionMissing
  | referenceLimit
  | uniqueReferenceLimit
  | definitionLimit
  | nonDirectDefinitionLimit
  deriving DecidableEq

structure TypedCommentIssue where
  side : Side
  code : TypedIssueCode
  sourceOrdinal : Nat
  occurrenceOrdinal : Nat
  canonicalId : Option TypedCanonicalId
  rawId : Option BoundedBytes := none
  detailOverride : Option BoundedBytes := none
  includeTargetMode : Bool := false
  deriving DecidableEq

structure TypedSideEvaluation where
  side : Side
  status : TypedEvaluationStatus
  outcome : TypedCommentOutcome
  realization : Option TypedCommentRealization
  partPresent : Bool
  sources : List TypedStorySource
  scan : TypedCommentScan
  issues : List TypedCommentIssue
  deriving DecidableEq

def emptyTypedCommentScan : TypedCommentScan :=
  { references := [], definitions := [], nonDirectDefinitions := [],
    crossing := none }

def selectedEntry? (pkg : TypedPackageView)
    (selected : TypedSelectedComment) : Option TypedEntry :=
  pkg.index.entries.find? fun entry =>
    decide (entry.name.bytes = selected.normalizedPartPath.bytes)

def typedAdmittedCommentRealizationCheck (pkg : TypedPackageView)
    (selected : TypedSelectedComment)
    (realization : TypedCommentRealization) : Bool :=
  decide (realization.selected.relationshipOrdinal =
    selected.relationshipOrdinal) &&
  decide (realization.selected.relationshipId.bytes =
    selected.relationshipId.bytes) &&
  decide (realization.selected.normalizedPartPath.bytes =
    selected.normalizedPartPath.bytes) &&
  typedBinaryIndexCheck pkg.packageBytes pkg.index &&
  typedSelectedEntryCheck pkg.index selected.normalizedPartPath
    realization.entry &&
  typedExtractionCheck pkg.packageBytes pkg.index realization.entry
    realization.extraction &&
  typedParsedPartCheck realization.extraction pkg.commentsRootNamespace
    pkg.commentsRootLocalName realization.retainedParsedEvents
    realization.parsed

def TypedAdmittedCommentRealizationOf (pkg : TypedPackageView)
    (selected : TypedSelectedComment)
    (realization : TypedCommentRealization) : Prop :=
  typedAdmittedCommentRealizationCheck pkg selected realization = true

instance typedAdmittedCommentRealizationDecidable
    (pkg : TypedPackageView) (selected : TypedSelectedComment)
    (realization : TypedCommentRealization) :
    Decidable (TypedAdmittedCommentRealizationOf pkg selected realization) := by
  unfold TypedAdmittedCommentRealizationOf
  infer_instance

def canonicalTypedCommentSources (pkg : TypedPackageView) :
    List TypedStorySource :=
  [pkg.mainSource] ++
    pkg.headerFooterStories.filterMap (·.source) ++
    pkg.noteSelections.filterMap fun selection =>
      if selection.relationshipSelected && selection.partPresent then
        selection.source
      else none

def canonicalTypedSources (pkg : TypedPackageView) : List TypedStorySource :=
  canonicalTypedCommentSources pkg

def sourceOrdinals (sources : List TypedStorySource) : List Nat :=
  sources.map (·.sourceOrdinal)

set_option backward.match.sparseCases false in
def typedNatEqCheck : Nat → Nat → Bool
  | 0, 0 => true
  | left + 1, right + 1 => typedNatEqCheck left right
  | _, _ => false

set_option backward.match.sparseCases false in
def typedNatLeCheck : Nat → Nat → Bool
  | 0, _ => true
  | _ + 1, 0 => false
  | left + 1, right + 1 => typedNatLeCheck left right

def typedNatLtCheck (left right : Nat) : Bool :=
  typedNatLeCheck (left + 1) right

set_option backward.match.sparseCases false in
def typedNatListEqCheck : List Nat → List Nat → Bool
  | [], [] => true
  | left :: leftRest, right :: rightRest =>
      typedNatEqCheck left right && typedNatListEqCheck leftRest rightRest
  | _, _ => false

def typedNatMemCheck (needle : Nat) (values : List Nat) : Bool :=
  values.any fun value => typedNatEqCheck value needle

def typedNatNodupCheck : List Nat → Bool
  | [] => true
  | value :: rest =>
      !typedNatMemCheck value rest && typedNatNodupCheck rest

def typedListGet? {α : Type} : List α → Nat → Option α
  | [], _ => none
  | value :: _, 0 => some value
  | _ :: rest, index + 1 => typedListGet? rest index

def typedSourceKindValidForHeaderFooter : TypedSourceKind → Bool
  | .header | .footer => true
  | .main | .footnotes | .endnotes => false

set_option backward.match.sparseCases false in
def typedSourceKindEqCheck : TypedSourceKind → TypedSourceKind → Bool
  | .main, .main | .header, .header | .footer, .footer
  | .footnotes, .footnotes | .endnotes, .endnotes => true
  | _, _ => false

set_option backward.match.sparseCases false in
def typedSideEqCheck : Side → Side → Bool
  | .original, .original | .revised, .revised | .compared, .compared => true
  | _, _ => false

def typedUInt8EqCheck (left right : UInt8) : Bool :=
  typedNatEqCheck left.toNat right.toNat

set_option backward.match.sparseCases false in
def typedUInt8ListEqCheck : List UInt8 → List UInt8 → Bool
  | [], [] => true
  | left :: leftRest, right :: rightRest =>
      typedUInt8EqCheck left right &&
        typedUInt8ListEqCheck leftRest rightRest
  | _, _ => false

set_option backward.match.sparseCases false in
def typedSourceKindListEqCheck :
    List TypedSourceKind → List TypedSourceKind → Bool
  | [], [] => true
  | left :: leftRest, right :: rightRest =>
      typedSourceKindEqCheck left right &&
        typedSourceKindListEqCheck leftRest rightRest
  | _, _ => false

def typedHeaderFooterSlotMatchesStory
    (slot : TypedHeaderFooterSlot)
    (story : TypedHeaderFooterStory) : Bool :=
  typedSourceKindEqCheck slot.kind story.kind &&
  typedUInt8ListEqCheck slot.originalPartPath.bytes
    story.originalPartPath.bytes &&
  typedUInt8ListEqCheck slot.revisedPartPath.bytes
    story.revisedPartPath.bytes &&
  typedUInt8ListEqCheck slot.comparedPartPath.bytes
    story.comparedPartPath.bytes

def typedHeaderFooterStoryKeyEq
    (left right : TypedHeaderFooterStory) : Bool :=
  typedSourceKindEqCheck left.kind right.kind &&
  typedUInt8ListEqCheck left.originalPartPath.bytes
    right.originalPartPath.bytes &&
  typedUInt8ListEqCheck left.revisedPartPath.bytes
    right.revisedPartPath.bytes &&
  typedUInt8ListEqCheck left.comparedPartPath.bytes
    right.comparedPartPath.bytes

def typedCanonicalSlotOrdinalsForStory
    (slots : List TypedHeaderFooterSlot)
    (story : TypedHeaderFooterStory) : List Nat :=
  (slots.filter fun slot =>
    typedHeaderFooterSlotMatchesStory slot story).map (·.slotOrdinal)

def typedNatCount (needle : Nat) (values : List Nat) : Nat :=
  (values.filter fun value => typedNatEqCheck needle value).length

def typedStoryKeysUnique : List TypedHeaderFooterStory → Bool
  | [] => true
  | story :: rest =>
      !rest.any (typedHeaderFooterStoryKeyEq story) &&
        typedStoryKeysUnique rest

set_option backward.match.sparseCases false in
def typedFirstSelectorOrdinalsStrict :
    List TypedHeaderFooterStory → Bool
  | [] | [_] => true
  | first :: second :: rest =>
      match first.selectingSlotOrdinals.head?,
          second.selectingSlotOrdinals.head? with
      | some left, some right =>
          typedNatLtCheck left right &&
            typedFirstSelectorOrdinalsStrict (second :: rest)
      | _, _ => false

def typedPartPathForSide (side : Side)
    (story : TypedHeaderFooterStory) : BoundedBytes :=
  match side with
  | .original => story.originalPartPath
  | .revised => story.revisedPartPath
  | .compared => story.comparedPartPath

def typedCanonicalSourceSetAdmittedCheck (side : Side)
    (sources : List TypedStorySource) : Bool :=
  typedNatLeCheck sources.length 387 &&
  typedNatNodupCheck (sourceOrdinals sources) &&
  sources.all fun source =>
    typedSideEqCheck source.side side &&
    typedNatLeCheck source.parsed.events.length source.parsed.eventLimit

set_option backward.match.sparseCases false in
def typedHeaderFooterDerivationCheck
    (side : Side) (pkg : TypedPackageView) : Bool :=
  typedNatListEqCheck (pkg.headerFooterSlots.map (·.slotOrdinal))
    (List.range pkg.headerFooterSlots.length) &&
  typedNatListEqCheck
    (pkg.headerFooterStories.map (·.physicalStoryOrdinal))
    (List.range pkg.headerFooterStories.length) &&
  typedStoryKeysUnique pkg.headerFooterStories &&
  typedFirstSelectorOrdinalsStrict pkg.headerFooterStories &&
  let allSelectors :=
    pkg.headerFooterStories.flatMap (·.selectingSlotOrdinals)
  typedNatEqCheck allSelectors.length pkg.headerFooterSlots.length &&
  pkg.headerFooterSlots.all (fun slot =>
    typedNatEqCheck (typedNatCount slot.slotOrdinal allSelectors) 1) &&
  pkg.headerFooterStories.all (fun story =>
    typedSourceKindValidForHeaderFooter story.kind &&
    !story.selectingSlotOrdinals.isEmpty &&
    typedNatNodupCheck story.selectingSlotOrdinals &&
    typedNatListEqCheck story.selectingSlotOrdinals
      (typedCanonicalSlotOrdinalsForStory pkg.headerFooterSlots story) &&
    typedUInt8ListEqCheck story.partPath.bytes
      (typedPartPathForSide side story).bytes &&
    match story.source with
    | none => false
    | some source =>
        typedSideEqCheck source.side side &&
        typedNatEqCheck source.sourceOrdinal
          (story.physicalStoryOrdinal + 1) &&
        typedUInt8ListEqCheck source.partPath.bytes story.partPath.bytes) &&
  pkg.headerFooterSlots.all fun slot =>
    typedSourceKindValidForHeaderFooter slot.kind &&
    typedNatLtCheck slot.physicalStoryOrdinal
      pkg.headerFooterStories.length &&
    match typedListGet? pkg.headerFooterStories slot.physicalStoryOrdinal with
    | none => false
    | some story =>
        typedHeaderFooterSlotMatchesStory slot story &&
        typedNatMemCheck slot.slotOrdinal story.selectingSlotOrdinals

set_option backward.match.sparseCases false in
def typedNoteSelectionDerivationCheck
    (side : Side) (pkg : TypedPackageView) : Bool :=
  typedSourceKindListEqCheck (pkg.noteSelections.map (·.kind))
    [.footnotes, .endnotes] &&
  pkg.noteSelections.all fun selection =>
    let footnotesSelected : Bool :=
      match pkg.noteSelections with
      | footnotes :: _ =>
          if typedSourceKindEqCheck footnotes.kind .footnotes then
            if footnotes.relationshipSelected then footnotes.partPresent
            else false
          else false
      | [] => false
    let expectedOrdinal := pkg.headerFooterStories.length +
      1 + (if typedSourceKindEqCheck selection.kind .endnotes then
        if footnotesSelected then 1 else 0
      else 0)
    if selection.relationshipSelected then
      selection.partPresent &&
      selection.selectedPartPath.isSome &&
      match selection.source, selection.selectedPartPath with
      | some source, some path =>
          typedSideEqCheck source.side side &&
          typedNatEqCheck source.sourceOrdinal expectedOrdinal &&
          typedUInt8ListEqCheck source.partPath.bytes path.bytes
      | _, _ => false
    else
      !selection.referencePresent &&
        !selection.partPresent && selection.selectedPartPath.isNone &&
        selection.source.isNone

set_option backward.match.sparseCases false in
def typedCanonicalSourceDerivationCheck
    (side : Side) (pkg : TypedPackageView) : Bool :=
  (match pkg.priorSourceAdmission with
    | .admitted => true
    | .relationshipSelectionFailure | .storyRealizationFailure
    | .noteSemanticFailure | .resourceFailure => false) &&
  typedSideEqCheck pkg.mainSource.side side &&
  typedNatEqCheck pkg.mainSource.sourceOrdinal 0 &&
  typedUInt8ListEqCheck pkg.mainSource.partPath.bytes
    [119,111,114,100,47,100,111,99,117,109,101,110,116,46,120,109,108] &&
  typedHeaderFooterDerivationCheck side pkg &&
  typedNoteSelectionDerivationCheck side pkg &&
  let sources := canonicalTypedCommentSources pkg
  typedNatListEqCheck (sourceOrdinals sources) (List.range sources.length) &&
  typedNatNodupCheck (sourceOrdinals sources)

def TypedCanonicalSourceSetAdmitted (side : Side)
    (sources : List TypedStorySource) : Prop :=
  typedCanonicalSourceSetAdmittedCheck side sources = true

instance typedCanonicalSourceSetAdmittedDecidable
    (side : Side) (sources : List TypedStorySource) :
    Decidable (TypedCanonicalSourceSetAdmitted side sources) := by
  unfold TypedCanonicalSourceSetAdmitted
  infer_instance

def TypedCompleteSourceSetOf (pkg : TypedPackageView) (side : Side)
    (sources : List TypedStorySource) : Prop :=
  sources = canonicalTypedCommentSources pkg ∧
  typedCanonicalSourceDerivationCheck side pkg = true ∧
  TypedCanonicalSourceSetAdmitted side sources

instance typedCompleteSourceSetDecidable
    (pkg : TypedPackageView) (side : Side)
    (sources : List TypedStorySource) :
    Decidable (TypedCompleteSourceSetOf pkg side sources) := by
  unfold TypedCompleteSourceSetOf
  infer_instance

def typedCompleteSourceSetCheck
    (pkg : TypedPackageView) (side : Side) : Bool :=
  typedCanonicalSourceDerivationCheck side pkg &&
    typedCanonicalSourceSetAdmittedCheck side (canonicalTypedSources pkg)

structure TypedScanInput where
  wmlNamespace : BoundedBytes
  idLocalName : BoundedBytes
  referenceLocalName : BoundedBytes
  definitionLocalName : BoundedBytes
  sourceEvents : List (Nat × List TypedXmlEvent)
  definitionEvents : List TypedXmlEvent

def typedDecimalSpace (value : UInt8) : Bool :=
  value == 0x09 || value == 0x0a || value == 0x0d || value == 0x20

def dropTypedDecimalSpace : List UInt8 → List UInt8
  | [] => []
  | value :: rest =>
      if typedDecimalSpace value then dropTypedDecimalSpace rest
      else value :: rest

def trimTypedDecimalSpace (values : List UInt8) : List UInt8 :=
  (dropTypedDecimalSpace values.reverse).reverse |> dropTypedDecimalSpace

def typedDecimalDigit (value : UInt8) : Bool :=
  0x30 ≤ value.toNat && value.toNat ≤ 0x39

def dropTypedLeadingZeroes : List UInt8 → List UInt8
  | [] => []
  | value :: rest =>
      if value == 0x30 then dropTypedLeadingZeroes rest
      else value :: rest

def parseTypedDecimalId (raw : BoundedBytes) : Option TypedCanonicalId :=
  if raw.bytes.length > 64 then none
  else
    let trimmed := trimTypedDecimalSpace raw.bytes
    let (negative, unsigned) :=
      match trimmed with
      | [] => (false, [])
      | value :: rest =>
          if value == 0x2b then (false, rest)
          else if value == 0x2d then (true, rest)
          else (false, value :: rest)
    if unsigned.isEmpty || !unsigned.all typedDecimalDigit then none
    else
      let magnitude := dropTypedLeadingZeroes unsigned
      let digits := if magnitude.isEmpty then [UInt8.ofNat 0x30] else magnitude
      some { negative := negative && !magnitude.isEmpty, digits }

def typedAttributeValue? (input : TypedScanInput)
    (attributes : List TypedXmlAttribute) : Option BoundedBytes :=
  (attributes.find? fun item =>
    decide (item.namespaceUri.bytes = input.wmlNamespace.bytes) &&
    decide (item.localName.bytes = input.idLocalName.bytes)).map (·.value)

def typedReferenceCandidate? (input : TypedScanInput) :
    TypedXmlEvent → Option (Option BoundedBytes)
  | .startElement namespaceUri localName attributes _ _ _ =>
      if namespaceUri.bytes = input.wmlNamespace.bytes &&
          localName.bytes = input.referenceLocalName.bytes then
        some (typedAttributeValue? input attributes)
      else none
  | .endElement .. | .text .. => none

def typedDefinitionCandidate? (input : TypedScanInput) :
    TypedXmlEvent → Option (Option BoundedBytes × Bool)
  | .startElement namespaceUri localName attributes depth _ _ =>
      if namespaceUri.bytes = input.wmlNamespace.bytes &&
          localName.bytes = input.definitionLocalName.bytes then
        some (typedAttributeValue? input attributes, depth == 1)
      else none
  | .endElement .. | .text .. => none

structure TypedScanState where
  scan : TypedCommentScan := emptyTypedCommentScan
  canonicalReferenceIds : List TypedCanonicalId := []

def scanTypedReferenceEvent (input : TypedScanInput) (sourceOrdinal : Nat)
    (state : TypedScanState) (event : TypedXmlEvent) : TypedScanState :=
  if state.scan.crossing.isSome then state
  else
    match typedReferenceCandidate? input event with
    | none => state
    | some rawId =>
        let ordinal := state.scan.references.length
        if ordinal == 4096 then
          { state with scan := { state.scan with
              crossing := some (.references sourceOrdinal ordinal) } }
        else
          let canonicalId := rawId.bind parseTypedDecimalId
          match canonicalId with
          | some canonical =>
              if !state.canonicalReferenceIds.contains canonical &&
                  state.canonicalReferenceIds.length == 4096 then
                { state with scan := { state.scan with
                    crossing := some
                      (.uniqueIds sourceOrdinal ordinal canonical) } }
              else
                { scan := { state.scan with references :=
                    state.scan.references ++ [{
                      sourceOrdinal, occurrenceOrdinal := ordinal,
                      rawId, canonicalId }] }
                  canonicalReferenceIds :=
                    if state.canonicalReferenceIds.contains canonical then
                      state.canonicalReferenceIds
                    else state.canonicalReferenceIds ++ [canonical] }
          | none =>
              { state with scan := { state.scan with references :=
                  state.scan.references ++ [{
                    sourceOrdinal, occurrenceOrdinal := ordinal,
                    rawId, canonicalId := none }] } }

def scanTypedDefinitionEvent (input : TypedScanInput)
    (state : TypedScanState) (event : TypedXmlEvent) : TypedScanState :=
  if state.scan.crossing.isSome then state
  else
    match typedDefinitionCandidate? input event with
    | none => state
    | some (rawId, direct) =>
        let canonicalId := rawId.bind parseTypedDecimalId
        if direct then
          let ordinal := state.scan.definitions.length
          if ordinal == 4096 then
            { state with scan := { state.scan with
                crossing := some (.definitions ordinal) } }
          else
            { state with scan := { state.scan with definitions :=
                state.scan.definitions ++ [{
                  occurrenceOrdinal := ordinal, rawId, canonicalId,
                  direct := true }] } }
        else
          let ordinal := state.scan.nonDirectDefinitions.length
          if ordinal == 4096 then
            { state with scan := { state.scan with
                crossing := some (.nonDirectDefinitions ordinal) } }
          else
            { state with scan := { state.scan with nonDirectDefinitions :=
                state.scan.nonDirectDefinitions ++ [{
                  occurrenceOrdinal := ordinal, rawId, canonicalId,
                  direct := false }] } }

def scanTypedCommentEvidence (input : TypedScanInput) : TypedCommentScan :=
  let afterSources := input.sourceEvents.foldl (fun state source =>
    source.2.foldl (scanTypedReferenceEvent input source.1) state) {}
  let afterDefinitions :=
    input.definitionEvents.foldl (scanTypedDefinitionEvent input) afterSources
  afterDefinitions.scan

def TypedParsedCommentEvidenceOf (input : TypedScanInput)
    (result : TypedCommentScan) : Prop :=
  result = scanTypedCommentEvidence input

theorem typed_parsed_comment_inventory_evidence_exact
    (input : TypedScanInput) :
    TypedParsedCommentEvidenceOf input (scanTypedCommentEvidence input) := by
  rfl

def canonicalIds
    (definitions : List TypedDefinition) : List TypedCanonicalId :=
  definitions.filterMap fun definition =>
    if definition.direct then definition.canonicalId else none

def referenceIds
    (references : List TypedReference) : List TypedCanonicalId :=
  references.filterMap (·.canonicalId)

def exactOne (needle : TypedCanonicalId)
    (values : List TypedCanonicalId) : Prop :=
  (values.filter (· = needle)).length = 1

def exactOneCheck (needle : TypedCanonicalId)
    (values : List TypedCanonicalId) : Bool :=
  (values.filter (· = needle)).length == 1

def EveryReferenceIdCanonical (scan : TypedCommentScan) : Prop :=
  ∀ reference ∈ scan.references, reference.canonicalId.isSome

def EveryDefinitionIdCanonical (scan : TypedCommentScan) : Prop :=
  ∀ definition ∈ scan.definitions, definition.canonicalId.isSome

def TypedPackageCommentIntegrity (scan : TypedCommentScan) : Prop :=
  scan.crossing = none ∧ scan.nonDirectDefinitions = [] ∧
  EveryReferenceIdCanonical scan ∧
  EveryDefinitionIdCanonical scan ∧
  (canonicalIds scan.definitions).length = scan.definitions.length ∧
  (canonicalIds scan.definitions).Nodup ∧
  (∀ reference ∈ referenceIds scan.references,
    exactOne reference (canonicalIds scan.definitions))

instance typedPackageCommentIntegrityDecidable (scan : TypedCommentScan) :
    Decidable (TypedPackageCommentIntegrity scan) := by
  unfold TypedPackageCommentIntegrity exactOne
    EveryReferenceIdCanonical EveryDefinitionIdCanonical
  infer_instance

def checkTypedPackageCommentIntegrity (scan : TypedCommentScan) : Bool :=
  decide (TypedPackageCommentIntegrity scan)

theorem typed_package_comment_reference_integrity_sound
    (scan : TypedCommentScan)
    (h : checkTypedPackageCommentIntegrity scan = true) :
    TypedPackageCommentIntegrity scan := by
  exact of_decide_eq_true h

def typedLiteral (values : List UInt8) : BoundedBytes :=
  { bytes := values, limit := values.length, admitted := Nat.le_refl _ }

def typedWmlNamespace : BoundedBytes :=
  typedLiteral [104,116,116,112,58,47,47,115,99,104,101,109,97,115,46,111,
    112,101,110,120,109,108,102,111,114,109,97,116,115,46,111,114,103,47,
    119,111,114,100,112,114,111,99,101,115,115,105,110,103,109,108,47,50,
    48,48,54,47,109,97,105,110]

def typedCommentScanInput (pkg : TypedPackageView)
    (realization : Option TypedCommentRealization) : TypedScanInput := {
  wmlNamespace := typedWmlNamespace
  idLocalName := typedLiteral [105,100]
  referenceLocalName :=
    typedLiteral [99,111,109,109,101,110,116,82,101,102,101,114,101,110,99,101]
  definitionLocalName :=
    typedLiteral [99,111,109,109,101,110,116]
  sourceEvents := (canonicalTypedSources pkg).map fun source =>
    (source.sourceOrdinal, source.parsed.events)
  definitionEvents := realization.map (·.parsed.events) |>.getD []
}

def typedXmlEventOrdinal : TypedXmlEvent → Nat
  | .startElement _ _ _ _ _ ordinal
  | .endElement _ _ _ ordinal
  | .text _ _ ordinal => ordinal

def typedFirstCommentReference?
    (pkg : TypedPackageView) : Option (Nat × Nat) :=
  (typedCommentScanInput pkg none).sourceEvents.findSome? fun source =>
    source.2.findSome? fun event =>
      (typedReferenceCandidate?
        (typedCommentScanInput pkg none) event).map fun _ =>
          (source.1, typedXmlEventOrdinal event)

def typedHasCommentReference (pkg : TypedPackageView) : Bool :=
  (typedFirstCommentReference? pkg).isSome

def issueForSelectionFailure (side : Side) :
    TypedSelectionFailure → TypedCommentIssue
  | .ambiguous ordinal =>
      { side := side, code := .selectorAmbiguous, sourceOrdinal := 0,
        occurrenceOrdinal := ordinal, canonicalId := none }
  | .external ordinal =>
      { side := side, code := .selectorExternal, sourceOrdinal := 0,
        occurrenceOrdinal := ordinal, canonicalId := none }
  | .invalidMode ordinal =>
      { side := side, code := .selectorInvalidMode, sourceOrdinal := 0,
        occurrenceOrdinal := ordinal, canonicalId := none,
        includeTargetMode := true }
  | .targetLimit ordinal =>
      { side := side, code := .selectorTargetLimit, sourceOrdinal := 0,
        occurrenceOrdinal := ordinal, canonicalId := none }
  | .unsafeTarget ordinal =>
      { side := side, code := .selectorUnsafeTarget, sourceOrdinal := 0,
        occurrenceOrdinal := ordinal, canonicalId := none }

def referenceIdIssue (side : Side)
    (reference : TypedReference) : Option TypedCommentIssue :=
  match reference.rawId, reference.canonicalId with
  | none, _ =>
      some {
        side := side
        code := .referenceIdMissing
        sourceOrdinal := reference.sourceOrdinal
        occurrenceOrdinal := reference.occurrenceOrdinal
        canonicalId := none }
  | some raw, none =>
      some {
        side := side
        code := if raw.bytes.length > 64 then .referenceIdTooLong
          else .referenceIdMalformed
        sourceOrdinal := reference.sourceOrdinal
        occurrenceOrdinal := reference.occurrenceOrdinal
        canonicalId := none
        rawId := some raw }
  | some _, some _ => none

def definitionIdIssue (side : Side)
    (definition : TypedDefinition) : Option TypedCommentIssue :=
  match definition.rawId, definition.canonicalId with
  | none, _ =>
      some {
        side := side
        code := .definitionIdMissing
        sourceOrdinal := 0
        occurrenceOrdinal := definition.occurrenceOrdinal
        canonicalId := none }
  | some raw, none =>
      some {
        side := side
        code := if raw.bytes.length > 64 then .definitionIdTooLong
          else .definitionIdMalformed
        sourceOrdinal := 0
        occurrenceOrdinal := definition.occurrenceOrdinal
        canonicalId := none
        rawId := some raw }
  | some _, some _ => none

def duplicateDefinitionIssues (side : Side)
    (definitions : List TypedDefinition) : List TypedCommentIssue :=
  definitions.filterMap fun definition =>
    definition.canonicalId.bind fun canonical =>
      if definitions.any fun earlier =>
          earlier.occurrenceOrdinal < definition.occurrenceOrdinal &&
          earlier.canonicalId == some canonical then
        some {
          side := side
          code := .definitionDuplicate
          sourceOrdinal := 0
          occurrenceOrdinal := definition.occurrenceOrdinal
          canonicalId := some canonical }
      else none

def missingDefinitionIssues (side : Side) (scan : TypedCommentScan) :
    List TypedCommentIssue :=
  scan.references.filterMap fun reference =>
    reference.canonicalId.bind fun canonical =>
      if exactOneCheck canonical (canonicalIds scan.definitions) then none
      else some {
        side := side
        code := .definitionMissing
        sourceOrdinal := reference.sourceOrdinal
        occurrenceOrdinal := reference.occurrenceOrdinal
        canonicalId := some canonical }

def nonDirectDefinitionIssues (side : Side)
    (definitions : List TypedDefinition) : List TypedCommentIssue :=
  definitions.map fun definition =>
    { side := side, code := .definitionNotDirect, sourceOrdinal := 0,
      occurrenceOrdinal := definition.occurrenceOrdinal,
      canonicalId := definition.canonicalId }

def crossingIssue (side : Side) :
    TypedScanCrossing → TypedCommentIssue
  | .references source ordinal =>
      { side := side, code := .referenceLimit, sourceOrdinal := source,
        occurrenceOrdinal := ordinal, canonicalId := none }
  | .uniqueIds source ordinal canonical =>
      { side := side, code := .uniqueReferenceLimit, sourceOrdinal := source,
        occurrenceOrdinal := ordinal, canonicalId := some canonical }
  | .definitions ordinal =>
      { side := side, code := .definitionLimit, sourceOrdinal := 0,
        occurrenceOrdinal := ordinal, canonicalId := none }
  | .nonDirectDefinitions ordinal =>
      { side := side, code := .nonDirectDefinitionLimit, sourceOrdinal := 0,
        occurrenceOrdinal := ordinal, canonicalId := none }

def typedCommentIssues (side : Side)
    (scan : TypedCommentScan) : List TypedCommentIssue :=
  (scan.crossing.map (crossingIssue side)).toList ++
  scan.references.filterMap (referenceIdIssue side) ++
  scan.definitions.filterMap (definitionIdIssue side) ++
  duplicateDefinitionIssues side scan.definitions ++
  missingDefinitionIssues side scan ++
  nonDirectDefinitionIssues side scan.nonDirectDefinitions

def zeroTypedSideEvaluation (side : Side) (outcome : TypedCommentOutcome)
    (issue : TypedCommentIssue) : TypedSideEvaluation :=
  { side := side, status := .notEvaluated, outcome := outcome,
    realization := none, partPresent := false,
    sources := [], scan := emptyTypedCommentScan, issues := [issue] }

def typedRealizationIssueCode :
    TypedRealizationFailure → TypedIssueCode
  | .partMissing => .partMissing
  | .selectedPartLimit => .selectedPartLimit
  | .tripleSelectedPartLimit => .tripleSelectedPartLimit
  | .partCompressedLimit => .partCompressedLimit
  | .partExpandedLimit => .partExpandedLimit
  | .partRatioLimit => .partRatioLimit
  | .cumulativeCompressedLimit => .cumulativeCompressedLimit
  | .cumulativeExpandedLimit => .cumulativeExpandedLimit
  | .tripleCompressedLimit => .tripleCompressedLimit
  | .tripleExpandedLimit => .tripleExpandedLimit
  | .extractionFailed => .extractionFailed
  | .invalidUtf8 => .invalidUtf8
  | .invalidXml => .invalidXml
  | .xmlDepthLimit => .xmlDepthLimit
  | .xmlEventLimit => .xmlEventLimit
  | .cumulativeXmlEventLimit => .cumulativeXmlEventLimit
  | .tripleXmlEventLimit => .tripleXmlEventLimit
  | .rootMismatch => .rootMismatch

def evaluateTypedCommentSideSpec (side : Side)
    (pkg : TypedPackageView) : TypedSideEvaluation :=
  if !typedCompleteSourceSetCheck pkg side then
    zeroTypedSideEvaluation side .absent
      { side := side, code := .sourcePartitionIncomplete, sourceOrdinal := 0,
        occurrenceOrdinal := 0, canonicalId := none }
  else
    match selectTypedComment pkg.commentType pkg.relationships with
    | .error failure =>
        zeroTypedSideEvaluation side (.selectorError failure)
          (issueForSelectionFailure side failure)
    | .ok none =>
        match typedFirstCommentReference? pkg with
        | some (sourceOrdinal, occurrenceOrdinal) =>
          zeroTypedSideEvaluation side .absent
            { side := side, code := .relationshipRequired, sourceOrdinal,
              occurrenceOrdinal, canonicalId := none }
        | none =>
          { side := side, status := .passed, outcome := .absent,
            realization := none, partPresent := false,
            sources := canonicalTypedSources pkg, scan := emptyTypedCommentScan,
            issues := [] }
    | .ok (some selected) =>
        match pkg.realization with
        | none =>
            { zeroTypedSideEvaluation side (.realizationError selected)
              { side := side, code := typedRealizationIssueCode
                  (pkg.realizationFailure.getD .extractionFailed),
                sourceOrdinal := 0,
                occurrenceOrdinal := selected.relationshipOrdinal,
                canonicalId := none,
                detailOverride := pkg.realizationFailureDetail } with
              partPresent := pkg.selectedPartPresent }
        | some realization =>
            if !typedAdmittedCommentRealizationCheck pkg selected realization then
              { zeroTypedSideEvaluation side (.realizationError selected)
                { side := side, code := .extractionFailed, sourceOrdinal := 0,
                  occurrenceOrdinal := selected.relationshipOrdinal,
                  canonicalId := none,
                  detailOverride := pkg.realizationFailureDetail } with
                partPresent := pkg.selectedPartPresent }
            else
              let scan :=
                scanTypedCommentEvidence
                  (typedCommentScanInput pkg (some realization))
              match scan.crossing with
              | some crossing =>
                  zeroTypedSideEvaluation side (.selected selected)
                    (crossingIssue side crossing)
              | none =>
                let issues := typedCommentIssues side scan
                { side := side
                  status := if issues.isEmpty &&
                      checkTypedPackageCommentIntegrity scan then
                    .passed else .failed
                  outcome := .selected selected
                  realization := some realization
                  partPresent := true
                  sources := canonicalTypedSources pkg
                  scan := scan
                  issues := issues }

def evaluateTypedCommentSide (side : Side)
    (pkg : TypedPackageView) : TypedSideEvaluation :=
  evaluateTypedCommentSideSpec side pkg

inductive TypedSelectionToRealizationOf (side : Side)
    (pkg : TypedPackageView) : TypedSideEvaluation → Prop
  | sourceIncomplete
      (hComplete : typedCompleteSourceSetCheck pkg side = false) :
      TypedSelectionToRealizationOf side pkg
        (zeroTypedSideEvaluation side .absent
          { side := side, code := .sourcePartitionIncomplete,
            sourceOrdinal := 0, occurrenceOrdinal := 0, canonicalId := none })
  | selectorError (failure : TypedSelectionFailure)
      (hComplete : typedCompleteSourceSetCheck pkg side = true)
      (hSelection :
        selectTypedComment pkg.commentType pkg.relationships = .error failure) :
      TypedSelectionToRealizationOf side pkg
        (zeroTypedSideEvaluation side (.selectorError failure)
          (issueForSelectionFailure side failure))
  | relationshipRequired (sourceOrdinal occurrenceOrdinal : Nat)
      (hComplete : typedCompleteSourceSetCheck pkg side = true)
      (hSelection :
        selectTypedComment pkg.commentType pkg.relationships = .ok none)
      (hReference :
        typedFirstCommentReference? pkg =
          some (sourceOrdinal, occurrenceOrdinal)) :
      TypedSelectionToRealizationOf side pkg
        (zeroTypedSideEvaluation side .absent
          { side := side, code := .relationshipRequired, sourceOrdinal,
            occurrenceOrdinal, canonicalId := none })
  | absent
      (hComplete : typedCompleteSourceSetCheck pkg side = true)
      (hSelection :
        selectTypedComment pkg.commentType pkg.relationships = .ok none)
      (hReference : typedFirstCommentReference? pkg = none) :
      TypedSelectionToRealizationOf side pkg
        { side := side, status := .passed, outcome := .absent,
          realization := none, partPresent := false,
          sources := canonicalTypedSources pkg, scan := emptyTypedCommentScan,
          issues := [] }
  | realizationMissing (selected : TypedSelectedComment)
      (hComplete : typedCompleteSourceSetCheck pkg side = true)
      (hSelection :
        selectTypedComment pkg.commentType pkg.relationships =
          .ok (some selected))
      (hRealization : pkg.realization = none) :
      TypedSelectionToRealizationOf side pkg
        { zeroTypedSideEvaluation side (.realizationError selected)
            { side := side, code := typedRealizationIssueCode
                (pkg.realizationFailure.getD .extractionFailed),
              sourceOrdinal := 0,
              occurrenceOrdinal := selected.relationshipOrdinal,
              canonicalId := none,
              detailOverride := pkg.realizationFailureDetail } with
          partPresent := pkg.selectedPartPresent }
  | realizationRejected (selected : TypedSelectedComment)
      (realization : TypedCommentRealization)
      (hComplete : typedCompleteSourceSetCheck pkg side = true)
      (hSelection :
        selectTypedComment pkg.commentType pkg.relationships =
          .ok (some selected))
      (hRealization : pkg.realization = some realization)
      (hAdmitted :
        typedAdmittedCommentRealizationCheck pkg selected realization = false) :
      TypedSelectionToRealizationOf side pkg
        { zeroTypedSideEvaluation side (.realizationError selected)
            { side := side, code := .extractionFailed, sourceOrdinal := 0,
              occurrenceOrdinal := selected.relationshipOrdinal,
              canonicalId := none,
              detailOverride := pkg.realizationFailureDetail } with
          partPresent := pkg.selectedPartPresent }
  | scanCrossing (selected : TypedSelectedComment)
      (realization : TypedCommentRealization) (crossing : TypedScanCrossing)
      (hComplete : typedCompleteSourceSetCheck pkg side = true)
      (hSelection :
        selectTypedComment pkg.commentType pkg.relationships =
          .ok (some selected))
      (hRealization : pkg.realization = some realization)
      (hAdmitted :
        typedAdmittedCommentRealizationCheck pkg selected realization = true)
      (hCrossing :
        (scanTypedCommentEvidence
          (typedCommentScanInput pkg (some realization))).crossing =
            some crossing) :
      TypedSelectionToRealizationOf side pkg
        (zeroTypedSideEvaluation side (.selected selected)
          (crossingIssue side crossing))
  | selected (selected : TypedSelectedComment)
      (realization : TypedCommentRealization)
      (scan : TypedCommentScan) (issues : List TypedCommentIssue)
      (hComplete : typedCompleteSourceSetCheck pkg side = true)
      (hSelection :
        selectTypedComment pkg.commentType pkg.relationships =
          .ok (some selected))
      (hRealization : pkg.realization = some realization)
      (hAdmitted :
        typedAdmittedCommentRealizationCheck pkg selected realization = true)
      (hScan :
        scan = scanTypedCommentEvidence
          (typedCommentScanInput pkg (some realization)))
      (hCrossing : scan.crossing = none)
      (hIssues : issues = typedCommentIssues side scan)
      (hIntegrity :
        checkTypedPackageCommentIntegrity scan = true →
          TypedPackageCommentIntegrity scan) :
      TypedSelectionToRealizationOf side pkg
        { side := side
          status := if issues.isEmpty &&
              checkTypedPackageCommentIntegrity scan then .passed else .failed
          outcome := .selected selected
          realization := some realization
          partPresent := true
          sources := canonicalTypedSources pkg
          scan := scan
          issues := issues }

theorem bool_not_true_implies_false :
    ∀ value : Bool, (!value) = true → value = false
  | false, _ => rfl
  | true, h => nomatch h

theorem bool_not_true_rejected_implies_true :
    ∀ value : Bool, (¬(!value) = true) → value = true
  | false, h => False.elim (h rfl)
  | true, _ => rfl

theorem bool_and_eq_true_parts :
    ∀ left right : Bool, (left && right) = true →
      left = true ∧ right = true
  | false, false, h => nomatch h
  | false, true, h => nomatch h
  | true, false, h => nomatch h
  | true, true, _ => ⟨rfl, rfl⟩

theorem typed_comment_selection_to_realization_sound
    (side : Side) (pkg : TypedPackageView) :
    TypedSelectionToRealizationOf side pkg
      (evaluateTypedCommentSide side pkg) := by
  unfold evaluateTypedCommentSide evaluateTypedCommentSideSpec
  split
  · rename_i hComplete
    exact .sourceIncomplete
      (bool_not_true_implies_false
        (typedCompleteSourceSetCheck pkg side) hComplete)
  · rename_i hComplete
    have hComplete' : typedCompleteSourceSetCheck pkg side = true :=
      bool_not_true_rejected_implies_true
        (typedCompleteSourceSetCheck pkg side) hComplete
    split
    · rename_i failure hSelection
      exact .selectorError failure hComplete' hSelection
    · rename_i hSelection
      split
      · rename_i sourceOrdinal occurrenceOrdinal hReference
        exact .relationshipRequired sourceOrdinal occurrenceOrdinal
          hComplete' hSelection hReference
      · rename_i hReference
        exact .absent hComplete' hSelection hReference
    · rename_i selected hSelection
      split
      · rename_i hRealization
        exact .realizationMissing selected hComplete' hSelection hRealization
      · rename_i realization hRealization
        split
        · rename_i hAdmitted
          exact .realizationRejected selected realization hComplete'
            hSelection hRealization
            (bool_not_true_implies_false
              (typedAdmittedCommentRealizationCheck
                pkg selected realization) hAdmitted)
        · rename_i hAdmitted
          have hAdmitted' :
              typedAdmittedCommentRealizationCheck
                pkg selected realization = true :=
            bool_not_true_rejected_implies_true
              (typedAdmittedCommentRealizationCheck
                pkg selected realization) hAdmitted
          generalize hScan :
            scanTypedCommentEvidence
              (typedCommentScanInput pkg (some realization)) = scan
          cases hCrossing : scan.crossing with
          | some crossing =>
            dsimp only
            rw [hCrossing]
            exact .scanCrossing selected realization crossing hComplete'
              hSelection hRealization hAdmitted' (hScan ▸ hCrossing)
          | none =>
            dsimp only
            rw [hCrossing]
            exact .selected selected realization
              scan (typedCommentIssues side scan)
              hComplete' hSelection hRealization hAdmitted' hScan.symm
              hCrossing rfl
              (typed_package_comment_reference_integrity_sound _)

theorem typed_selection_to_realization_evaluation_exact
    {side : Side} {pkg : TypedPackageView} {evaluation : TypedSideEvaluation}
    (h : TypedSelectionToRealizationOf side pkg evaluation) :
    evaluation = evaluateTypedCommentSide side pkg := by
  cases h <;>
    simp_all [evaluateTypedCommentSide, evaluateTypedCommentSideSpec]

theorem typed_admitted_comment_source_set_complete
    (side : Side) (pkg : TypedPackageView)
    (hStatus :
      (evaluateTypedCommentSide side pkg).status ≠ .notEvaluated) :
    TypedCompleteSourceSetOf pkg side
      (evaluateTypedCommentSide side pkg).sources := by
  generalize hEvaluation :
    evaluateTypedCommentSide side pkg = evaluation at hStatus ⊢
  have completeOfCheck
      (hComplete : typedCompleteSourceSetCheck pkg side = true) :
      TypedCompleteSourceSetOf pkg side (canonicalTypedSources pkg) := by
    unfold typedCompleteSourceSetCheck at hComplete
    have hParts := bool_and_eq_true_parts _ _ hComplete
    exact ⟨rfl, hParts.1, hParts.2⟩
  have hSelection : TypedSelectionToRealizationOf side pkg evaluation :=
    hEvaluation ▸ typed_comment_selection_to_realization_sound side pkg
  cases hSelection with
  | sourceIncomplete hComplete =>
      exact (hStatus rfl).elim
  | selectorError failure hComplete hSelector =>
      exact (hStatus rfl).elim
  | relationshipRequired sourceOrdinal occurrenceOrdinal hComplete hSelector hReference =>
      exact (hStatus rfl).elim
  | absent hComplete hSelector hReference =>
      exact completeOfCheck hComplete
  | realizationMissing selected hComplete hSelector hRealization =>
      exact (hStatus rfl).elim
  | realizationRejected selected realization hComplete hSelector hRealization hAdmitted =>
      exact (hStatus rfl).elim
  | scanCrossing selected realization crossing hComplete hSelector hRealization hAdmitted hCrossing =>
      exact (hStatus rfl).elim
  | selected selected realization scan issues hComplete hSelector hRealization hAdmitted hScan hCrossing hIssues hIntegrity =>
      exact completeOfCheck hComplete

def TypedIncompleteZeroOf (evaluation : TypedSideEvaluation) : Prop :=
  evaluation.status = .notEvaluated ↔
    evaluation.realization = none ∧ evaluation.sources = [] ∧
    evaluation.scan.references = [] ∧ evaluation.scan.definitions = [] ∧
    evaluation.scan.nonDirectDefinitions = [] ∧ evaluation.scan.crossing = none

theorem typed_incomplete_comment_partition_zero_evidence_sound
    (side : Side) (pkg : TypedPackageView) :
    TypedIncompleteZeroOf (evaluateTypedCommentSide side pkg) := by
  generalize hEvaluation :
    evaluateTypedCommentSide side pkg = evaluation
  have hSelection : TypedSelectionToRealizationOf side pkg evaluation :=
    hEvaluation ▸ typed_comment_selection_to_realization_sound side pkg
  unfold TypedIncompleteZeroOf
  cases hSelection with
  | sourceIncomplete hComplete =>
      exact ⟨fun _ => ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩, fun _ => rfl⟩
  | selectorError failure hComplete hSelector =>
      exact ⟨fun _ => ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩, fun _ => rfl⟩
  | relationshipRequired sourceOrdinal occurrenceOrdinal hComplete hSelector hReference =>
      exact ⟨fun _ => ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩, fun _ => rfl⟩
  | absent hComplete hSelector hReference =>
      constructor
      · intro h
        cases h
      · intro h
        have hSources := h.2.1
        change canonicalTypedSources pkg = [] at hSources
        cases hSources
  | realizationMissing selected hComplete hSelector hRealization =>
      exact ⟨fun _ => ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩, fun _ => rfl⟩
  | realizationRejected selected realization hComplete hSelector hRealization hAdmitted =>
      exact ⟨fun _ => ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩, fun _ => rfl⟩
  | scanCrossing selected realization crossing hComplete hSelector hRealization hAdmitted hCrossing =>
      exact ⟨fun _ => ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩, fun _ => rfl⟩
  | selected selected realization scan issues hComplete hSelector hRealization hAdmitted hScan hCrossing hIssues hIntegrity =>
      constructor
      · intro h
        cases hPass :
            issues.isEmpty && checkTypedPackageCommentIntegrity scan with
        | false =>
            rw [hPass] at h
            cases h
        | true =>
            rw [hPass] at h
            cases h
      · intro h
        have hRealization := h.1
        change some realization = none at hRealization
        cases hRealization

def typedNegativeEntry : TypedEntry := {
  name := typedLiteral [119,111,114,100,47,99,111,109,109,101,110,116,115,46,
    120,109,108]
  flags := 0
  method := 0
  crc32 := 0xf34b76ab
  compressedSize := 2
  expandedSize := 2
  localHeaderOffset := 0
  dataOffset := 47
  localSpanEnd := 49
  isDirectory := false
}

def typedNegativePackageBytes : ByteArray :=
  ByteArray.mk #[
    -- Complete stored local record.
    0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0xab, 0x76, 0x4b, 0xf3, 2, 0, 0, 0, 2, 0, 0, 0, 17, 0, 0, 0,
    119,111,114,100,47,99,111,109,109,101,110,116,115,46,120,109,108,
    0x3c, 0x3e,
    -- Complete central-directory record.
    0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0xab, 0x76, 0x4b, 0xf3, 2, 0, 0, 0, 2, 0, 0, 0, 17, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    119,111,114,100,47,99,111,109,109,101,110,116,115,46,120,109,108,
    -- EOCD: one record, 63-byte central directory at offset 49.
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0,
    63, 0, 0, 0, 49, 0, 0, 0, 0, 0
  ]

def typedNegativeIndex : TypedPackageIndex := {
  entries := [typedNegativeEntry]
  centralOffset := 49
  centralSize := 63
}

def typedByteArrayOfList (values : List UInt8) : ByteArray :=
  values.foldl (fun bytes value => bytes.push value) ByteArray.empty

def typedAppendByteList (bytes : ByteArray) (values : List UInt8) : ByteArray :=
  values.foldl (fun result value => result.push value) bytes

def typedLe16Bytes (value : Nat) : List UInt8 :=
  [UInt8.ofNat value, UInt8.ofNat (value / 256)]

def typedLe32Bytes (value : Nat) : List UInt8 :=
  typedLe16Bytes value ++ typedLe16Bytes (value / 65536)

def typedStoredZipBytesForName (name : List UInt8) : ByteArray :=
  let nameLength := name.length
  let centralOffset := 32 + nameLength
  let centralSize := 46 + nameLength
  typedByteArrayOfList (
    [0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0xab, 0x76, 0x4b, 0xf3, 2, 0, 0, 0, 2, 0, 0, 0] ++
    typedLe16Bytes nameLength ++ [0, 0] ++ name ++ [0x3c, 0x3e] ++
    [0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0xab, 0x76, 0x4b, 0xf3, 2, 0, 0, 0, 2, 0, 0, 0] ++
    typedLe16Bytes nameLength ++
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] ++ name ++
    [0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0] ++
    typedLe32Bytes centralSize ++ typedLe32Bytes centralOffset ++ [0, 0])

def typedStoredZipEntryForName (name : List UInt8) : TypedEntry := {
  name := typedLiteral name
  flags := 0
  method := 0
  crc32 := 0xf34b76ab
  compressedSize := 2
  expandedSize := 2
  localHeaderOffset := 0
  dataOffset := 30 + name.length
  localSpanEnd := 32 + name.length
  isDirectory := false
}

def typedStoredZipIndexForName (name : List UInt8) : TypedPackageIndex := {
  entries := [typedStoredZipEntryForName name]
  centralOffset := 32 + name.length
  centralSize := 46 + name.length
}

def typedZipName256 : List UInt8 :=
  List.replicate 256 (UInt8.ofNat 0x61)

def typedZipName257 : List UInt8 :=
  List.replicate 257 (UInt8.ofNat 0x61)

def typedAmbiguousEocdBytes : ByteArray :=
  typedAppendByteList (typedNegativePackageBytes.set! 132 22) [
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0,
    85, 0, 0, 0, 49, 0, 0, 0, 0, 0
  ]

def typedNegativeExtraction : TypedExtraction := {
  packageBytes := typedNegativePackageBytes
  snapshotBytes := typedNegativePackageBytes
  entry := typedNegativeEntry
  compressedSlice := ByteArray.mk #[0x3c, 0x3e]
  expandedBytes := ByteArray.mk #[0x3c, 0x3e]
}

def typedInventedExtraction : TypedExtraction :=
  { typedNegativeExtraction with compressedSlice := ByteArray.mk #[0x4b, 0x04] }

theorem typed_negative_extraction_fixture_admitted :
    TypedExtractionOf typedNegativePackageBytes typedNegativeIndex
      typedNegativeEntry typedNegativeExtraction := by
  unfold TypedExtractionOf
  native_decide

theorem invented_typed_zip_slice_rejected :
    ¬TypedExtractionOf typedNegativePackageBytes typedNegativeIndex
      typedNegativeEntry typedInventedExtraction := by
  unfold TypedExtractionOf
  native_decide

def typedForgedCentralCrcBytes : ByteArray :=
  typedNegativePackageBytes.set! 65 0xaa

def typedForgedCentralSizeBytes : ByteArray :=
  typedNegativePackageBytes.set! 69 3

def typedForgedCentralLocalOffsetBytes : ByteArray :=
  typedNegativePackageBytes.set! 91 1

def typedForgedEocdCountBytes : ByteArray :=
  typedNegativePackageBytes.set! 122 2

def typedForgedCentralNameBytes : ByteArray :=
  typedNegativePackageBytes.set! 95 118

def typedMissingEocdBytes : ByteArray :=
  typedNegativePackageBytes.set! 112 0

theorem forged_central_crc_rejected :
    ¬TypedBinaryIndexOf typedForgedCentralCrcBytes typedNegativeIndex := by
  unfold TypedBinaryIndexOf
  native_decide

theorem forged_central_size_rejected :
    ¬TypedBinaryIndexOf typedForgedCentralSizeBytes typedNegativeIndex := by
  unfold TypedBinaryIndexOf
  native_decide

theorem forged_central_local_offset_rejected :
    ¬TypedBinaryIndexOf typedForgedCentralLocalOffsetBytes
      typedNegativeIndex := by
  unfold TypedBinaryIndexOf
  native_decide

theorem forged_eocd_entry_count_rejected :
    ¬TypedBinaryIndexOf typedForgedEocdCountBytes typedNegativeIndex := by
  unfold TypedBinaryIndexOf
  native_decide

theorem forged_central_name_rejected :
    ¬TypedBinaryIndexOf typedForgedCentralNameBytes typedNegativeIndex := by
  unfold TypedBinaryIndexOf
  native_decide

theorem missing_eocd_rejected :
    ¬TypedBinaryIndexOf typedMissingEocdBytes typedNegativeIndex := by
  unfold TypedBinaryIndexOf
  native_decide

theorem ambiguous_structural_eocd_candidates_discovered :
    (typedStructuralEocdCandidates typedAmbiguousEocdBytes).length = 2 := by
  native_decide

theorem ambiguous_structural_eocd_archive_rejected :
    ¬TypedBinaryIndexOf typedAmbiguousEocdBytes typedNegativeIndex := by
  unfold TypedBinaryIndexOf
  native_decide

theorem raw_zip_name_256_bytes_admitted :
    TypedBinaryIndexOf
      (typedStoredZipBytesForName typedZipName256)
      (typedStoredZipIndexForName typedZipName256) := by
  unfold TypedBinaryIndexOf
  native_decide

theorem raw_zip_name_257_bytes_rejected :
    ¬TypedBinaryIndexOf
      (typedStoredZipBytesForName typedZipName257)
      (typedStoredZipIndexForName typedZipName257) := by
  unfold TypedBinaryIndexOf
  native_decide

def typedNegativeRootUri : BoundedBytes := typedLiteral [117]
def typedNegativeRootLocal : BoundedBytes := typedLiteral [99]

def typedNegativeEvent : TypedXmlEvent :=
  .startElement typedNegativeRootUri typedNegativeRootLocal [] 0 false 0

def typedSubstitutedEvent : TypedXmlEvent :=
  .startElement typedNegativeRootUri (typedLiteral [100]) [] 0 false 0

def typedNegativeParsedPart : TypedParsedPart := {
  rawBytes := typedNegativeExtraction.expandedBytes
  expectedRootUri := typedNegativeRootUri
  expectedRootLocalName := typedNegativeRootLocal
  events := [typedNegativeEvent]
  depthLimit := 8
  eventLimit := 8
}

def typedSubstitutedParsedPart : TypedParsedPart :=
  { typedNegativeParsedPart with events := [typedSubstitutedEvent] }

theorem typed_negative_parsed_fixture_admitted :
    TypedParsedPartOf typedNegativeExtraction typedNegativeRootUri
      typedNegativeRootLocal [typedNegativeEvent] typedNegativeParsedPart := by
  unfold TypedParsedPartOf
  native_decide

theorem substituted_typed_parsed_events_rejected :
    ¬TypedParsedPartOf typedNegativeExtraction typedNegativeRootUri
      typedNegativeRootLocal [typedNegativeEvent]
      typedSubstitutedParsedPart := by
  unfold TypedParsedPartOf
  native_decide

def typedNegativeScanInput : TypedScanInput := {
  wmlNamespace := typedWmlNamespace
  idLocalName := typedLiteral [105,100]
  referenceLocalName :=
    typedLiteral [99,111,109,109,101,110,116,82,101,102,101,114,101,110,99,101]
  definitionLocalName :=
    typedLiteral [99,111,109,109,101,110,116]
  sourceEvents := []
  definitionEvents := []
}

def typedSubstitutedScan : TypedCommentScan := {
  references := [{
    sourceOrdinal := 0
    occurrenceOrdinal := 0
    rawId := some (typedLiteral [49])
    canonicalId := some { negative := false, digits := [49] }
  }]
  definitions := []
  nonDirectDefinitions := []
  crossing := none
}

theorem typed_negative_scan_fixture_exact :
    TypedParsedCommentEvidenceOf typedNegativeScanInput
      emptyTypedCommentScan := by
  unfold TypedParsedCommentEvidenceOf
  native_decide

theorem substituted_typed_scan_result_rejected :
    ¬TypedParsedCommentEvidenceOf typedNegativeScanInput
      typedSubstitutedScan := by
  unfold TypedParsedCommentEvidenceOf
  native_decide

def TypedPackageViewIdentityOf (view : TypedPackageView)
    (packageBytes : ByteArray) (index : TypedPackageIndex) : Prop :=
  view.packageBytes = packageBytes ∧
  view.index = index

def typedNegativeSource : TypedStorySource := {
  side := .original
  sourceOrdinal := 0
  partPath := typedLiteral [119,111,114,100,47,100,111,99,117,109,101,110,116,
    46,120,109,108]
  parsed := typedNegativeParsedPart
}

def typedNegativePackageView : TypedPackageView := {
  packageBytes := typedNegativePackageBytes
  index := typedNegativeIndex
  commentType := typedLiteral [99]
  commentsRootNamespace := typedNegativeRootUri
  commentsRootLocalName := typedNegativeRootLocal
  relationships := []
  mainSource := typedNegativeSource
  headerFooterSlots := []
  headerFooterStories := []
  noteSelections :=
    [ { kind := .footnotes, relationshipSelected := false,
        referencePresent := false,
        selectedPartPath := none, partPresent := false, source := none }
    , { kind := .endnotes, relationshipSelected := false,
        referencePresent := false,
        selectedPartPath := none, partPresent := false, source := none }
    ]
  priorSourceAdmission := .admitted
  realizationFailure := none
  realizationFailureDetail := none
  selectedPartPresent := false
  realization := none
  retainedScan := emptyTypedCommentScan
}

def typedSubstitutedPackageBytes : ByteArray :=
  typedNegativePackageBytes.set! 48 0x3f

def typedSubstitutedIndex : TypedPackageIndex :=
  { typedNegativeIndex with centralOffset := 3 }

theorem typed_negative_package_view_fixture_exact :
    TypedPackageViewIdentityOf typedNegativePackageView
      typedNegativePackageBytes typedNegativeIndex := by
  unfold TypedPackageViewIdentityOf
  native_decide

theorem differing_typed_package_view_rejected :
    ¬TypedPackageViewIdentityOf typedNegativePackageView
      typedSubstitutedPackageBytes typedNegativeIndex := by
  unfold TypedPackageViewIdentityOf
  native_decide

theorem differing_typed_package_index_rejected :
    ¬TypedPackageViewIdentityOf typedNegativePackageView
      typedNegativePackageBytes typedSubstitutedIndex := by
  unfold TypedPackageViewIdentityOf
  native_decide

def typedInjectedSource : TypedStorySource :=
  { typedNegativeSource with
    sourceOrdinal := 1
    partPath := typedLiteral [119,111,114,100,47,105,110,106,101,99,116,101,100,
      46,120,109,108] }

theorem omitted_canonical_comment_source_rejected :
    ¬TypedCompleteSourceSetOf typedNegativePackageView .original [] := by
  unfold TypedCompleteSourceSetOf
  native_decide

theorem injected_comment_source_rejected :
    ¬TypedCompleteSourceSetOf typedNegativePackageView .original
      [typedNegativeSource, typedInjectedSource] := by
  unfold TypedCompleteSourceSetOf
  native_decide

theorem duplicated_comment_source_realization_rejected :
    ¬TypedCompleteSourceSetOf typedNegativePackageView .original
      [typedNegativeSource, typedNegativeSource] := by
  unfold TypedCompleteSourceSetOf
  native_decide

def typedHeaderAPath : BoundedBytes :=
  typedLiteral [119,111,114,100,47,104,101,97,100,101,114,65,46,120,109,108]

def typedHeaderBPath : BoundedBytes :=
  typedLiteral [119,111,114,100,47,104,101,97,100,101,114,66,46,120,109,108]

def typedAbaStorySource (ordinal : Nat)
    (path : BoundedBytes) : TypedStorySource :=
  { typedNegativeSource with
    sourceOrdinal := ordinal
    partPath := path }

def typedAbaSlot (ordinal physical : Nat)
    (path : BoundedBytes) : TypedHeaderFooterSlot := {
  slotOrdinal := ordinal
  physicalStoryOrdinal := physical
  kind := .header
  originalPartPath := path
  revisedPartPath := path
  comparedPartPath := path
}

def typedAbaStory (physical : Nat) (path : BoundedBytes)
    (selectors : List Nat) : TypedHeaderFooterStory := {
  physicalStoryOrdinal := physical
  kind := .header
  partPath := path
  originalPartPath := path
  revisedPartPath := path
  comparedPartPath := path
  selectingSlotOrdinals := selectors
  source := some (typedAbaStorySource (physical + 1) path)
}

def typedAbaPackageView : TypedPackageView :=
  { typedNegativePackageView with
    headerFooterSlots :=
      [typedAbaSlot 0 0 typedHeaderAPath,
       typedAbaSlot 1 1 typedHeaderBPath,
       typedAbaSlot 2 0 typedHeaderAPath]
    headerFooterStories :=
      [typedAbaStory 0 typedHeaderAPath [0, 2],
       typedAbaStory 1 typedHeaderBPath [1]] }

theorem interleaved_aba_physical_partition_admitted :
    TypedCompleteSourceSetOf typedAbaPackageView .original
      (canonicalTypedCommentSources typedAbaPackageView) := by
  unfold TypedCompleteSourceSetOf
  native_decide

def typedAbaOmittedPackageView : TypedPackageView :=
  { typedAbaPackageView with
    headerFooterStories :=
      [typedAbaStory 0 typedHeaderAPath [0],
       typedAbaStory 1 typedHeaderBPath [1]] }

def typedAbaDuplicatedPackageView : TypedPackageView :=
  { typedAbaPackageView with
    headerFooterStories :=
      [typedAbaStory 0 typedHeaderAPath [0, 2, 2],
       typedAbaStory 1 typedHeaderBPath [1]] }

def typedAbaWrongKeyPackageView : TypedPackageView :=
  { typedAbaPackageView with
    headerFooterSlots :=
      [typedAbaSlot 0 0 typedHeaderAPath,
       typedAbaSlot 1 1 typedHeaderBPath,
       typedAbaSlot 2 0 typedHeaderBPath] }

def typedAbaWrongOrderPackageView : TypedPackageView :=
  { typedNegativePackageView with
    headerFooterSlots :=
      [typedAbaSlot 0 1 typedHeaderAPath,
       typedAbaSlot 1 0 typedHeaderBPath,
       typedAbaSlot 2 1 typedHeaderAPath]
    headerFooterStories :=
      [typedAbaStory 0 typedHeaderBPath [1],
       typedAbaStory 1 typedHeaderAPath [0, 2]] }

theorem interleaved_aba_omitted_selector_rejected :
    ¬TypedCompleteSourceSetOf typedAbaOmittedPackageView .original
      (canonicalTypedCommentSources typedAbaOmittedPackageView) := by
  unfold TypedCompleteSourceSetOf
  native_decide

theorem interleaved_aba_duplicate_selector_rejected :
    ¬TypedCompleteSourceSetOf typedAbaDuplicatedPackageView .original
      (canonicalTypedCommentSources typedAbaDuplicatedPackageView) := by
  unfold TypedCompleteSourceSetOf
  native_decide

theorem interleaved_aba_wrong_key_rejected :
    ¬TypedCompleteSourceSetOf typedAbaWrongKeyPackageView .original
      (canonicalTypedCommentSources typedAbaWrongKeyPackageView) := by
  unfold TypedCompleteSourceSetOf
  native_decide

theorem interleaved_aba_wrong_first_seen_order_rejected :
    ¬TypedCompleteSourceSetOf typedAbaWrongOrderPackageView .original
      (canonicalTypedCommentSources typedAbaWrongOrderPackageView) := by
  unfold TypedCompleteSourceSetOf
  native_decide

def typedDuplicateCanonicalId : TypedCanonicalId :=
  { negative := false, digits := [49] }

def typedDuplicateDefinitionScan : TypedCommentScan := {
  references := []
  definitions :=
    [ { occurrenceOrdinal := 0, rawId := some (typedLiteral [49]),
        canonicalId := some typedDuplicateCanonicalId, direct := true }
    , { occurrenceOrdinal := 1, rawId := some (typedLiteral [49]),
        canonicalId := some typedDuplicateCanonicalId, direct := true }
    ]
  nonDirectDefinitions := []
  crossing := none
}

theorem duplicate_direct_comment_definitions_rejected :
    checkTypedPackageCommentIntegrity typedDuplicateDefinitionScan = false := by
  native_decide

def typedNegativeSelectedComment : TypedSelectedComment := {
  relationshipOrdinal := 0
  relationshipId := typedLiteral [114,73,100,49]
  normalizedPartPath := typedNegativeEntry.name
}

def typedNegativeRealization : TypedCommentRealization := {
  selected := typedNegativeSelectedComment
  entry := typedNegativeEntry
  extraction := typedNegativeExtraction
  retainedParsedEvents := [typedNegativeEvent]
  parsed := typedNegativeParsedPart
}

def typedAbsentWithStoredEvidence : TypedSideEvaluation :=
  { evaluateTypedCommentSide .original typedNegativePackageView with
    realization := some typedNegativeRealization
    scan := typedSubstitutedScan }

theorem stored_realization_on_absent_branch_rejected :
    ¬TypedSelectionToRealizationOf .original typedNegativePackageView
      typedAbsentWithStoredEvidence := by
  intro h
  have hExact := typed_selection_to_realization_evaluation_exact h
  have hDifferent :
      typedAbsentWithStoredEvidence ≠
        evaluateTypedCommentSide .original typedNegativePackageView := by
    native_decide
  exact hDifferent hExact

def typedExternalRelationship : TypedRelationship := {
  ordinal := 0
  relationshipType := typedNegativePackageView.commentType
  relationshipId := typedNegativeSelectedComment.relationshipId
  rawTarget := typedNegativeSelectedComment.normalizedPartPath
  rawTargetMode := some (typedLiteral [69,120,116,101,114,110,97,108])
  normalizedTarget := some typedNegativeSelectedComment.normalizedPartPath
  mode := .external
}

def typedSelectorErrorPackageView : TypedPackageView :=
  { typedNegativePackageView with
    relationships := [typedExternalRelationship] }

def typedSelectorErrorWithStoredEvidence : TypedSideEvaluation :=
  { evaluateTypedCommentSide .original typedSelectorErrorPackageView with
    realization := some typedNegativeRealization
    scan := typedSubstitutedScan }

theorem stored_realization_on_selector_error_branch_rejected :
    ¬TypedSelectionToRealizationOf .original typedSelectorErrorPackageView
      typedSelectorErrorWithStoredEvidence := by
  intro h
  have hExact := typed_selection_to_realization_evaluation_exact h
  have hDifferent :
      typedSelectorErrorWithStoredEvidence ≠
        evaluateTypedCommentSide .original typedSelectorErrorPackageView := by
    native_decide
  exact hDifferent hExact

def typedForgedIncompleteEvaluation : TypedSideEvaluation :=
  zeroTypedSideEvaluation .original .absent
    { side := .original, code := .partMissing, sourceOrdinal := 0,
      occurrenceOrdinal := 0, canonicalId := none }

theorem forged_comment_incomplete_cause_rejected :
    ¬TypedSelectionToRealizationOf .original typedNegativePackageView
      typedForgedIncompleteEvaluation := by
  intro h
  have hExact := typed_selection_to_realization_evaluation_exact h
  have hDifferent :
      typedForgedIncompleteEvaluation ≠
        evaluateTypedCommentSide .original typedNegativePackageView := by
    native_decide
  exact hDifferent hExact

def typedSelectedPackageView : TypedPackageView :=
  { typedNegativePackageView with
    relationships :=
      [{ typedExternalRelationship with
          rawTargetMode := none
          mode := .internal }]
    selectedPartPresent := true
    realization := some typedNegativeRealization }

def typedForgedCrossingEvaluation : TypedSideEvaluation :=
  zeroTypedSideEvaluation .original
    (.selected typedNegativeSelectedComment)
    (crossingIssue .original (.definitions 4096))

theorem forged_comment_crossing_cause_rejected :
    ¬TypedSelectionToRealizationOf .original typedSelectedPackageView
      typedForgedCrossingEvaluation := by
  intro h
  have hExact := typed_selection_to_realization_evaluation_exact h
  have hDifferent :
      typedForgedCrossingEvaluation ≠
        evaluateTypedCommentSide .original typedSelectedPackageView := by
    native_decide
  exact hDifferent hExact

inductive TypedJson
  | null
  | bool (value : Bool)
  | nat (value : Nat)
  | numberBytes (value : BoundedBytes)
  | bytes (value : BoundedBytes)
  | array (values : List TypedJson)
  | object (fields : List (BoundedBytes × TypedJson))

structure TypedProtocolV6Response where
  protocolVersion : TypedJson
  checker : TypedJson
  passed : TypedJson
  fixedStories : TypedJson
  presenceMismatches : TypedJson
  fixedStoryIssues : TypedJson
  relationshipSlots : TypedJson
  relationshipStories : TypedJson
  selectionIssues : TypedJson
  referenceSourcePartitions : TypedJson
  noteStories : TypedJson
  noteInventories : TypedJson
  noteIntegrityIssues : TypedJson
  commentStory : TypedJson
  commentInventories : TypedJson
  commentIntegrityIssues : TypedJson

def byte (value : Nat) : UInt8 := UInt8.ofNat value
def quote : UInt8 := byte 34
def slash : UInt8 := byte 92

def encodeNatDigitsLoop : Nat → Nat → List UInt8
  | 0, _ => []
  | _ + 1, 0 => []
  | fuel + 1, current =>
      byte (48 + current % 10) :: encodeNatDigitsLoop fuel (current / 10)

def encodeNatDigits (value : Nat) : List UInt8 :=
  match value with
  | 0 => [byte 48]
  | value + 1 =>
      (encodeNatDigitsLoop (value + 2) (value + 1)).reverse

def hexDigit (value : Nat) : UInt8 :=
  if value < 10 then byte (48 + value) else byte (97 + value - 10)

def escapeByte : UInt8 → List UInt8
  | value =>
      match value.toNat with
      | 8 => [slash, byte 98]
      | 9 => [slash, byte 116]
      | 10 => [slash, byte 110]
      | 12 => [slash, byte 102]
      | 13 => [slash, byte 114]
      | 34 => [slash, quote]
      | 92 => [slash, slash]
      | code =>
          if code < 32 then
            [slash, byte 117, byte 48, byte 48,
              hexDigit (code / 16), hexDigit (code % 16)]
          else [value]

def encodeByteString (value : BoundedBytes) : List UInt8 :=
  quote :: value.bytes.flatMap escapeByte ++ [quote]

def joinEncoded : List (List UInt8) → List UInt8
  | [] => []
  | value :: [] => value
  | value :: next :: rest =>
      value ++ byte 44 :: joinEncoded (next :: rest)

def encodeTypedJsonFuel : Nat → TypedJson → List UInt8
  | 0, _ => []
  | _ + 1, .null => [byte 110, byte 117, byte 108, byte 108]
  | _ + 1, .bool false => [byte 102, byte 97, byte 108, byte 115, byte 101]
  | _ + 1, .bool true => [byte 116, byte 114, byte 117, byte 101]
  | _ + 1, .nat value => encodeNatDigits value
  | _ + 1, .numberBytes value => value.bytes
  | _ + 1, .bytes value => encodeByteString value
  | fuel + 1, .array values =>
      byte 91 :: joinEncoded (values.map (encodeTypedJsonFuel fuel)) ++ [byte 93]
  | fuel + 1, .object fields =>
      byte 123 :: joinEncoded (fields.map fun field =>
        encodeByteString field.1 ++ [byte 58] ++
          encodeTypedJsonFuel fuel field.2) ++ [byte 125]

def encodeTypedJson (value : TypedJson) : List UInt8 :=
  encodeTypedJsonFuel 2626369 value

def key (values : List UInt8) : BoundedBytes :=
  { bytes := values, limit := values.length, admitted := Nat.le_refl _ }

def protocolV6Fields (response : TypedProtocolV6Response) :
    List (BoundedBytes × TypedJson) :=
  [ (key [99,104,101,99,107,101,114], response.checker)
  , (key [99,111,109,109,101,110,116,73,110,116,101,103,114,105,116,121,73,115,115,117,101,115],
      response.commentIntegrityIssues)
  , (key [99,111,109,109,101,110,116,73,110,118,101,110,116,111,114,105,101,115],
      response.commentInventories)
  , (key [99,111,109,109,101,110,116,83,116,111,114,121],
      response.commentStory)
  , (key [102,105,120,101,100,83,116,111,114,105,101,115],
      response.fixedStories)
  , (key [102,105,120,101,100,83,116,111,114,121,73,115,115,117,101,115],
      response.fixedStoryIssues)
  , (key [110,111,116,101,73,110,116,101,103,114,105,116,121,73,115,115,117,101,115],
      response.noteIntegrityIssues)
  , (key [110,111,116,101,73,110,118,101,110,116,111,114,105,101,115],
      response.noteInventories)
  , (key [110,111,116,101,83,116,111,114,105,101,115], response.noteStories)
  , (key [112,97,115,115,101,100], response.passed)
  , (key [112,114,101,115,101,110,99,101,77,105,115,109,97,116,99,104,101,115],
      response.presenceMismatches)
  , (key [112,114,111,116,111,99,111,108,86,101,114,115,105,111,110],
      response.protocolVersion)
  , (key [114,101,102,101,114,101,110,99,101,83,111,117,114,99,101,80,97,114,116,105,116,105,111,110,115],
      response.referenceSourcePartitions)
  , (key [114,101,108,97,116,105,111,110,115,104,105,112,83,108,111,116,115],
      response.relationshipSlots)
  , (key [114,101,108,97,116,105,111,110,115,104,105,112,83,116,111,114,105,101,115],
      response.relationshipStories)
  , (key [115,101,108,101,99,116,105,111,110,73,115,115,117,101,115],
      response.selectionIssues)
  ]

def independentProtocolV6Projection
    (response : TypedProtocolV6Response) : List UInt8 :=
  encodeTypedJson (.object (protocolV6Fields response))

structure TypedInheritedV5Evaluation where
  passed : Bool
  fixedStories : TypedJson
  presenceMismatches : TypedJson
  fixedStoryIssues : TypedJson
  relationshipSlots : TypedJson
  relationshipStories : TypedJson
  selectionIssues : TypedJson
  referenceSourcePartitions : TypedJson
  noteStories : TypedJson
  noteInventories : TypedJson
  noteIntegrityIssues : TypedJson

structure TypedRequestV6 where
  original : TypedPackageView
  revised : TypedPackageView
  compared : TypedPackageView
  inherited : TypedInheritedV5Evaluation

def typedAscii (values : List UInt8) : TypedJson :=
  .bytes (typedLiteral values)

def typedSideName : Side → TypedJson
  | .original => typedAscii [111,114,105,103,105,110,97,108]
  | .revised => typedAscii [114,101,118,105,115,101,100]
  | .compared => typedAscii [99,111,109,112,97,114,101,100]

def typedStatusName : TypedEvaluationStatus → TypedJson
  | .passed => typedAscii [112,97,115,115,101,100]
  | .failed => typedAscii [102,97,105,108,101,100]
  | .notEvaluated =>
      typedAscii [110,111,116,95,101,118,97,108,117,97,116,101,100]

def typedSelectedIdentityJson (selected : TypedSelectedComment) : TypedJson :=
  .object
    [ (key [110,111,114,109,97,108,105,122,101,100,80,97,114,116,80,97,116,104],
        .bytes selected.normalizedPartPath)
    , (key [114,101,108,97,116,105,111,110,115,104,105,112,73,100],
        .bytes selected.relationshipId)
    , (key [114,101,108,97,116,105,111,110,115,104,105,112,82,101,99,111,114,100,79,114,100,105,110,97,108],
        .nat selected.relationshipOrdinal)
    ]

def typedEvaluationIdentity (evaluation : TypedSideEvaluation) :
    Option TypedSelectedComment :=
  match evaluation.outcome with
  | .selected selected | .realizationError selected => some selected
  | .absent | .selectorError _ => none

def typedCommentSideStoryJson
    (evaluation : TypedSideEvaluation) : TypedJson :=
  let sideStatus :=
    match evaluation.outcome with
    | .absent =>
        match evaluation.status with
        | .passed => typedAscii [97,98,115,101,110,116]
        | .failed => typedStatusName .failed
        | .notEvaluated => typedStatusName .notEvaluated
    | .selected _ | .selectorError _ | .realizationError _ =>
        typedStatusName evaluation.status
  .object
    [ (key [112,97,114,116,80,114,101,115,101,110,116],
        .bool evaluation.partPresent)
    , (key [114,101,108,97,116,105,111,110,115,104,105,112],
        (typedEvaluationIdentity evaluation).map typedSelectedIdentityJson
          |>.getD .null)
    , (key [115,116,97,116,117,115], sideStatus)
    ]

def typedParsedEventCount (evaluation : TypedSideEvaluation) : Nat :=
  evaluation.realization.map (·.parsed.events.length) |>.getD 0

def typedCommentStoryJson (original revised compared : TypedSideEvaluation) :
    TypedJson :=
  let aggregateStatus :=
    if [original, revised, compared].any
        (fun evaluation => evaluation.status == .notEvaluated) then
      typedStatusName .notEvaluated
    else if [original, revised, compared].any
        (fun evaluation => evaluation.status == .failed) then
      typedStatusName .failed
    else typedStatusName .passed
  .object
    [ (key [99,111,109,112,97,114,101,100],
        typedCommentSideStoryJson compared)
    , (key [111,114,105,103,105,110,97,108],
        typedCommentSideStoryJson original)
    , (key [112,97,114,115,101,100,84,111,107,101,110,67,111,117,110,116,115],
        .object
          [ (key [99,111,109,98,105,110,101,100],
              .nat (typedParsedEventCount compared))
          , (key [111,114,105,103,105,110,97,108],
              .nat (typedParsedEventCount original))
          , (key [114,101,118,105,115,101,100],
              .nat (typedParsedEventCount revised))
          ])
    , (key [114,101,118,105,115,101,100],
        typedCommentSideStoryJson revised)
    , (key [115,116,97,116,117,115], aggregateStatus)
    ]

def typedUniqueReferenceCount (scan : TypedCommentScan) : Nat :=
  (referenceIds scan.references).eraseDups.length

def typedUnreferencedDefinitionCount (scan : TypedCommentScan) : Nat :=
  (canonicalIds scan.definitions).filter
    (fun value => !(referenceIds scan.references).contains value) |>.length

def typedCommentInventoryJson (evaluation : TypedSideEvaluation) : TypedJson :=
  .object
    [ (key [100,101,102,105,110,105,116,105,111,110,115],
        .nat (canonicalIds evaluation.scan.definitions).length)
    , (key [110,111,110,68,105,114,101,99,116,68,101,102,105,110,105,116,105,111,110,115],
        .nat evaluation.scan.nonDirectDefinitions.length)
    , (key [114,101,102,101,114,101,110,99,101,79,99,99,117,114,114,101,110,99,101,115],
        .nat (referenceIds evaluation.scan.references).length)
    , (key [114,101,108,97,116,105,111,110,115,104,105,112],
        (typedEvaluationIdentity evaluation).map typedSelectedIdentityJson
          |>.getD .null)
    , (key [115,105,100,101], typedSideName evaluation.side)
    , (key [115,116,97,116,117,115], typedStatusName evaluation.status)
    , (key [117,110,105,113,117,101,82,101,102,101,114,101,110,99,101,73,100,115],
        .nat (typedUniqueReferenceCount evaluation.scan))
    , (key [117,110,114,101,102,101,114,101,110,99,101,100,68,101,102,105,110,105,116,105,111,110,115],
        .nat (typedUnreferencedDefinitionCount evaluation.scan))
    ]

def typedIssueCodeName : TypedIssueCode → TypedJson
  | .relationshipRequired =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,76,65,84,73,79,78,83,72,73,80,95,82,69,81,85,73,82,69,68]
  | .selectorAmbiguous =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,76,65,84,73,79,78,83,72,73,80,95,65,77,66,73,71,85,79,85,83]
  | .selectorExternal =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,76,65,84,73,79,78,83,72,73,80,95,69,88,84,69,82,78,65,76]
  | .selectorInvalidMode =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,76,65,84,73,79,78,83,72,73,80,95,73,78,86,65,76,73,68,95,84,65,82,71,69,84,95,77,79,68,69]
  | .selectorTargetLimit =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,76,65,84,73,79,78,83,72,73,80,95,84,65,82,71,69,84,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .selectorUnsafeTarget =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,76,65,84,73,79,78,83,72,73,80,95,85,78,83,65,70,69,95,84,65,82,71,69,84]
  | .partMissing => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,77,73,83,83,73,78,71]
  | .selectedPartLimit => typedAscii [67,79,77,77,69,78,84,95,83,69,76,69,67,84,69,68,95,80,65,82,84,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .tripleSelectedPartLimit => typedAscii [67,79,77,77,69,78,84,95,84,82,73,80,76,69,95,83,69,76,69,67,84,69,68,95,80,65,82,84,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .partCompressedLimit => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,67,79,77,80,82,69,83,83,69,68,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .partExpandedLimit => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,69,88,80,65,78,68,69,68,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .partRatioLimit => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,82,65,84,73,79,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .cumulativeCompressedLimit => typedAscii [67,79,77,77,69,78,84,95,67,85,77,85,76,65,84,73,86,69,95,67,79,77,80,82,69,83,83,69,68,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .cumulativeExpandedLimit => typedAscii [67,79,77,77,69,78,84,95,67,85,77,85,76,65,84,73,86,69,95,69,88,80,65,78,68,69,68,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .tripleCompressedLimit => typedAscii [67,79,77,77,69,78,84,95,84,82,73,80,76,69,95,67,79,77,80,82,69,83,83,69,68,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .tripleExpandedLimit => typedAscii [67,79,77,77,69,78,84,95,84,82,73,80,76,69,95,69,88,80,65,78,68,69,68,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .extractionFailed => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,69,88,84,82,65,67,84,73,79,78,95,70,65,73,76,69,68]
  | .invalidUtf8 => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,73,78,86,65,76,73,68,95,85,84,70,56]
  | .invalidXml => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,73,78,86,65,76,73,68,95,88,77,76]
  | .xmlDepthLimit => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,88,77,76,95,68,69,80,84,72,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .xmlEventLimit => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,88,77,76,95,69,86,69,78,84,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .cumulativeXmlEventLimit => typedAscii [67,79,77,77,69,78,84,95,67,85,77,85,76,65,84,73,86,69,95,88,77,76,95,69,86,69,78,84,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .tripleXmlEventLimit => typedAscii [67,79,77,77,69,78,84,95,84,82,73,80,76,69,95,88,77,76,95,69,86,69,78,84,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .rootMismatch => typedAscii [67,79,77,77,69,78,84,95,80,65,82,84,95,82,79,79,84,95,77,73,83,77,65,84,67,72]
  | .sourcePartitionIncomplete =>
      typedAscii [67,79,77,77,69,78,84,95,83,79,85,82,67,69,95,80,65,82,84,73,84,73,79,78,95,73,78,67,79,77,80,76,69,84,69]
  | .referenceIdMissing =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,73,68,95,77,73,83,83,73,78,71]
  | .referenceIdMalformed =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,73,68,95,77,65,76,70,79,82,77,69,68]
  | .referenceIdTooLong =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,73,68,95,84,79,79,95,76,79,78,71]
  | .definitionIdMissing =>
      typedAscii [67,79,77,77,69,78,84,95,68,69,70,73,78,73,84,73,79,78,95,73,68,95,77,73,83,83,73,78,71]
  | .definitionIdMalformed =>
      typedAscii [67,79,77,77,69,78,84,95,68,69,70,73,78,73,84,73,79,78,95,73,68,95,77,65,76,70,79,82,77,69,68]
  | .definitionIdTooLong =>
      typedAscii [67,79,77,77,69,78,84,95,68,69,70,73,78,73,84,73,79,78,95,73,68,95,84,79,79,95,76,79,78,71]
  | .definitionNotDirect =>
      typedAscii [67,79,77,77,69,78,84,95,68,69,70,73,78,73,84,73,79,78,95,78,79,84,95,68,73,82,69,67,84]
  | .definitionDuplicate =>
      typedAscii [67,79,77,77,69,78,84,95,68,69,70,73,78,73,84,73,79,78,95,68,85,80,76,73,67,65,84,69]
  | .definitionMissing =>
      typedAscii [67,79,77,77,69,78,84,95,68,69,70,73,78,73,84,73,79,78,95,77,73,83,83,73,78,71]
  | .referenceLimit =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,79,67,67,85,82,82,69,78,67,69,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .uniqueReferenceLimit =>
      typedAscii [67,79,77,77,69,78,84,95,85,78,73,81,85,69,95,82,69,70,69,82,69,78,67,69,95,73,68,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .definitionLimit =>
      typedAscii [67,79,77,77,69,78,84,95,68,69,70,73,78,73,84,73,79,78,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .nonDirectDefinitionLimit =>
      typedAscii [67,79,77,77,69,78,84,95,78,79,78,95,68,73,82,69,67,84,95,68,69,70,73,78,73,84,73,79,78,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]

def typedIssueDetail : TypedIssueCode → TypedJson
  | .relationshipRequired =>
      typedAscii [97,32,119,58,99,111,109,109,101,110,116,82,101,102,101,114,101,110,99,101,32,114,101,113,117,105,114,101,115,32,111,110,101,32,101,120,97,99,116,32,105,110,116,101,114,110,97,108,32,99,111,109,109,101,110,116,115,32,114,101,108,97,116,105,111,110,115,104,105,112]
  | .selectorAmbiguous =>
      typedAscii [109,117,108,116,105,112,108,101,32,101,120,97,99,116,32,84,114,97,110,115,105,116,105,111,110,97,108,32,99,111,109,109,101,110,116,115,32,114,101,108,97,116,105,111,110,115,104,105,112,115,32,101,120,105,115,116]
  | .selectorExternal =>
      typedAscii [116,104,101,32,115,111,108,101,32,101,120,97,99,116,32,84,114,97,110,115,105,116,105,111,110,97,108,32,99,111,109,109,101,110,116,115,32,114,101,108,97,116,105,111,110,115,104,105,112,32,105,115,32,101,120,116,101,114,110,97,108]
  | .selectorInvalidMode =>
      typedAscii [116,104,101,32,115,111,108,101,32,101,120,97,99,116,32,84,114,97,110,115,105,116,105,111,110,97,108,32,99,111,109,109,101,110,116,115,32,114,101,108,97,116,105,111,110,115,104,105,112,32,104,97,115,32,97,110,32,105,110,118,97,108,105,100,32,84,97,114,103,101,116,77,111,100,101]
  | .selectorTargetLimit =>
      typedAscii [116,104,101,32,99,111,109,109,101,110,116,115,32,114,101,108,97,116,105,111,110,115,104,105,112,32,116,97,114,103,101,116,32,101,120,99,101,101,100,115,32,105,116,115,32,98,111,117,110,100,101,100,32,108,111,99,97,116,111,114,32,108,105,109,105,116]
  | .selectorUnsafeTarget =>
      typedAscii [116,104,101,32,99,111,109,109,101,110,116,115,32,114,101,108,97,116,105,111,110,115,104,105,112,32,116,97,114,103,101,116,32,105,115,32,117,110,115,97,102,101]
  | .sourcePartitionIncomplete =>
      typedAscii [116,104,101,32,97,100,109,105,116,116,101,100,32,109,97,105,110,47,110,111,116,101,47,104,101,97,100,101,114,47,102,111,111,116,101,114,32,115,111,117,114,99,101,32,112,97,114,116,105,116,105,111,110,32,105,115,32,105,110,99,111,109,112,108,101,116,101]
  | .referenceIdMissing =>
      typedAscii [99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,104,97,115,32,110,111,32,119,58,105,100]
  | .referenceIdMalformed =>
      typedAscii [99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,119,58,105,100,32,105,115,32,110,111,116,32,97,110,32,83,84,95,68,101,99,105,109,97,108,78,117,109,98,101,114]
  | .referenceIdTooLong =>
      typedAscii [99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,119,58,105,100,32,101,120,99,101,101,100,115,32,54,52,32,85,84,70,45,56,32,98,121,116,101,115]
  | .definitionIdMissing =>
      typedAscii [100,105,114,101,99,116,32,99,111,109,109,101,110,116,32,100,101,102,105,110,105,116,105,111,110,32,104,97,115,32,110,111,32,119,58,105,100]
  | .definitionIdMalformed =>
      typedAscii [100,105,114,101,99,116,32,99,111,109,109,101,110,116,32,100,101,102,105,110,105,116,105,111,110,32,119,58,105,100,32,105,115,32,110,111,116,32,97,110,32,83,84,95,68,101,99,105,109,97,108,78,117,109,98,101,114]
  | .definitionIdTooLong =>
      typedAscii [100,105,114,101,99,116,32,99,111,109,109,101,110,116,32,100,101,102,105,110,105,116,105,111,110,32,119,58,105,100,32,101,120,99,101,101,100,115,32,54,52,32,85,84,70,45,56,32,98,121,116,101,115]
  | .definitionNotDirect =>
      typedAscii [119,58,99,111,109,109,101,110,116,32,100,101,102,105,110,105,116,105,111,110,115,32,109,117,115,116,32,98,101,32,100,105,114,101,99,116,32,99,104,105,108,100,114,101,110,32,111,102,32,119,58,99,111,109,109,101,110,116,115]
  | .definitionDuplicate =>
      typedAscii [109,117,108,116,105,112,108,101,32,100,105,114,101,99,116,32,99,111,109,109,101,110,116,32,100,101,102,105,110,105,116,105,111,110,115,32,104,97,118,101,32,116,104,101,32,115,97,109,101,32,99,97,110,111,110,105,99,97,108,32,119,58,105,100]
  | .definitionMissing =>
      typedAscii [99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,100,111,101,115,32,110,111,116,32,114,101,115,111,108,118,101,32,116,111,32,101,120,97,99,116,108,121,32,111,110,101,32,100,105,114,101,99,116,32,100,101,102,105,110,105,116,105,111,110]
  | .referenceLimit =>
      typedAscii [99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,111,99,99,117,114,114,101,110,99,101,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100]
  | .uniqueReferenceLimit =>
      typedAscii [117,110,105,113,117,101,32,99,97,110,111,110,105,99,97,108,32,99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,73,68,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100]
  | .definitionLimit =>
      typedAscii [100,105,114,101,99,116,32,99,111,109,109,101,110,116,32,100,101,102,105,110,105,116,105,111,110,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100]
  | .nonDirectDefinitionLimit =>
      typedAscii [110,111,110,45,100,105,114,101,99,116,32,99,111,109,109,101,110,116,32,100,101,102,105,110,105,116,105,111,110,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100]
  | .partMissing => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,105,115,32,109,105,115,115,105,110,103]
  | .selectedPartLimit => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,99,114,111,115,115,101,115,32,116,104,101,32,115,105,100,101,32,115,101,108,101,99,116,101,100,45,112,97,114,116,32,108,105,109,105,116]
  | .tripleSelectedPartLimit => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,99,114,111,115,115,101,115,32,116,104,101,32,116,104,114,101,101,45,112,97,99,107,97,103,101,32,115,101,108,101,99,116,101,100,45,112,97,114,116,32,108,105,109,105,116]
  | .partCompressedLimit => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,99,114,111,115,115,101,115,32,116,104,101,32,99,111,109,112,114,101,115,115,101,100,45,98,121,116,101,32,108,105,109,105,116]
  | .partExpandedLimit => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,99,114,111,115,115,101,115,32,116,104,101,32,101,120,112,97,110,100,101,100,45,98,121,116,101,32,108,105,109,105,116]
  | .partRatioLimit => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,99,114,111,115,115,101,115,32,116,104,101,32,101,120,112,97,110,115,105,111,110,45,114,97,116,105,111,32,108,105,109,105,116]
  | .cumulativeCompressedLimit => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,99,114,111,115,115,101,115,32,116,104,101,32,115,105,100,101,32,99,111,109,112,114,101,115,115,101,100,45,98,121,116,101,32,108,105,109,105,116]
  | .cumulativeExpandedLimit => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,99,114,111,115,115,101,115,32,116,104,101,32,115,105,100,101,32,101,120,112,97,110,100,101,100,45,98,121,116,101,32,108,105,109,105,116]
  | .tripleCompressedLimit => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,99,114,111,115,115,101,115,32,116,104,101,32,116,104,114,101,101,45,112,97,99,107,97,103,101,32,99,111,109,112,114,101,115,115,101,100,45,98,121,116,101,32,108,105,109,105,116]
  | .tripleExpandedLimit => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,99,114,111,115,115,101,115,32,116,104,101,32,116,104,114,101,101,45,112,97,99,107,97,103,101,32,101,120,112,97,110,100,101,100,45,98,121,116,101,32,108,105,109,105,116]
  | .extractionFailed => typedAscii [116,104,101,32,105,110,100,101,120,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,102,97,105,108,101,100,32,114,101,116,97,105,110,101,100,32,101,120,116,114,97,99,116,105,111,110]
  | .invalidUtf8 => typedAscii [116,104,101,32,115,101,108,101,99,116,101,100,32,99,111,109,109,101,110,116,115,32,112,97,114,116,32,105,115,32,110,111,116,32,118,97,108,105,100,32,85,84,70,45,56]
  | .invalidXml | .xmlDepthLimit | .xmlEventLimit
  | .cumulativeXmlEventLimit | .tripleXmlEventLimit | .rootMismatch =>
      typedAscii []

def typedIssueOrdinalSpace (code : TypedIssueCode) : TypedJson :=
  match code with
  | .selectorAmbiguous | .selectorExternal | .selectorInvalidMode
  | .selectorTargetLimit | .selectorUnsafeTarget
  | .partMissing | .selectedPartLimit | .tripleSelectedPartLimit
  | .partCompressedLimit | .partExpandedLimit | .partRatioLimit
  | .cumulativeCompressedLimit | .cumulativeExpandedLimit
  | .tripleCompressedLimit | .tripleExpandedLimit | .extractionFailed
  | .invalidUtf8 | .invalidXml | .xmlDepthLimit | .xmlEventLimit
  | .cumulativeXmlEventLimit | .tripleXmlEventLimit | .rootMismatch =>
      typedAscii [114,101,108,97,116,105,111,110,115,104,105,112]
  | .sourcePartitionIncomplete =>
      typedAscii [115,111,117,114,99,101]
  | .referenceIdMissing | .referenceIdMalformed | .referenceIdTooLong
  | .relationshipRequired | .definitionMissing | .referenceLimit
  | .uniqueReferenceLimit =>
      typedAscii [114,101,102,101,114,101,110,99,101]
  | .definitionIdMissing | .definitionIdMalformed | .definitionIdTooLong
  | .definitionNotDirect | .definitionDuplicate | .definitionLimit
  | .nonDirectDefinitionLimit =>
      typedAscii [100,101,102,105,110,105,116,105,111,110]

def typedCanonicalIdBytes (value : TypedCanonicalId) : BoundedBytes :=
  typedLiteral ((if value.negative then [UInt8.ofNat 45] else []) ++ value.digits)

def typedSourceKindName : TypedSourceKind → TypedJson
  | .main => typedAscii [109,97,105,110]
  | .header => typedAscii [104,101,97,100,101,114]
  | .footer => typedAscii [102,111,111,116,101,114]
  | .footnotes => typedAscii [102,111,111,116,110,111,116,101,115]
  | .endnotes => typedAscii [101,110,100,110,111,116,101,115]

def typedIssueSourceIdentity (pkg : TypedPackageView)
    (issue : TypedCommentIssue) : TypedJson × Nat :=
  match issue.code with
  | .definitionIdMissing | .definitionIdMalformed | .definitionIdTooLong
  | .definitionNotDirect | .definitionDuplicate | .definitionLimit
  | .nonDirectDefinitionLimit | .partMissing | .selectedPartLimit
  | .tripleSelectedPartLimit | .partCompressedLimit | .partExpandedLimit
  | .partRatioLimit | .cumulativeCompressedLimit
  | .cumulativeExpandedLimit | .tripleCompressedLimit
  | .tripleExpandedLimit | .extractionFailed | .invalidUtf8
  | .invalidXml | .xmlDepthLimit | .xmlEventLimit
  | .cumulativeXmlEventLimit | .tripleXmlEventLimit | .rootMismatch =>
      (typedAscii [99,111,109,109,101,110,116,115], 0)
  | .selectorAmbiguous | .selectorExternal | .selectorInvalidMode
  | .selectorTargetLimit | .selectorUnsafeTarget
  | .sourcePartitionIncomplete =>
      (typedSourceKindName .main, 0)
  | .relationshipRequired | .referenceIdMissing | .referenceIdMalformed
  | .referenceIdTooLong | .definitionMissing | .referenceLimit
  | .uniqueReferenceLimit =>
      if issue.sourceOrdinal = pkg.mainSource.sourceOrdinal then
        (typedSourceKindName .main, 0)
      else
        match pkg.headerFooterStories.find? (fun story =>
            story.source.any fun source =>
              source.sourceOrdinal == issue.sourceOrdinal) with
        | some story =>
            (typedSourceKindName story.kind, story.physicalStoryOrdinal)
        | none =>
            match pkg.noteSelections.find? (fun selection =>
                selection.source.any fun source =>
                  source.sourceOrdinal == issue.sourceOrdinal) with
            | some selection => (typedSourceKindName selection.kind, 0)
            | none => (typedSourceKindName .main, 0)

def typedIssueSourceJson (pkg : TypedPackageView)
    (issue : TypedCommentIssue) : TypedJson :=
  let identity := typedIssueSourceIdentity pkg issue
  .object
    [ (key [115,111,117,114,99,101,83,116,111,114,121], identity.1)
    , (key [115,111,117,114,99,101,83,116,111,114,121,79,114,100,105,110,97,108],
        .nat identity.2)
    ]

def typedIssueRelationshipFields (pkg : TypedPackageView)
    (issue : TypedCommentIssue) : List (BoundedBytes × TypedJson) :=
  match pkg.relationships.find?
      (fun relationship => relationship.ordinal == issue.occurrenceOrdinal) with
  | none => []
  | some relationship =>
      match issue.code with
      | .selectorExternal | .selectorUnsafeTarget =>
          [ (key [114,97,119,84,97,114,103,101,116],
              .bytes relationship.rawTarget)
          , (key [114,101,108,97,116,105,111,110,115,104,105,112,73,100],
              .bytes relationship.relationshipId) ]
      | .selectorInvalidMode =>
          [ (key [114,97,119,84,97,114,103,101,116],
              .bytes relationship.rawTarget)
          , (key [114,101,108,97,116,105,111,110,115,104,105,112,73,100],
              .bytes relationship.relationshipId) ]
      | .selectorTargetLimit =>
          [ (key [114,97,119,84,97,114,103,101,116,66,121,116,101,76,101,110,103,116,104],
              .nat relationship.rawTarget.bytes.length)
          , (key [114,101,108,97,116,105,111,110,115,104,105,112,73,100],
              .bytes relationship.relationshipId) ]
      | .partMissing | .selectedPartLimit | .tripleSelectedPartLimit
      | .partCompressedLimit | .partExpandedLimit | .partRatioLimit
      | .cumulativeCompressedLimit | .cumulativeExpandedLimit
      | .tripleCompressedLimit | .tripleExpandedLimit
      | .extractionFailed | .invalidUtf8 | .invalidXml | .xmlDepthLimit
      | .xmlEventLimit | .cumulativeXmlEventLimit
      | .tripleXmlEventLimit | .rootMismatch =>
          [ (key [110,111,114,109,97,108,105,122,101,100,80,97,114,116,80,97,116,104],
              relationship.normalizedTarget.map TypedJson.bytes |>.getD
                (typedAscii []))
          , (key [114,101,108,97,116,105,111,110,115,104,105,112,73,100],
              .bytes relationship.relationshipId) ]
      | .relationshipRequired | .selectorAmbiguous
      | .sourcePartitionIncomplete | .referenceIdMissing
      | .referenceIdMalformed | .referenceIdTooLong
      | .definitionIdMissing | .definitionIdMalformed
      | .definitionIdTooLong | .definitionNotDirect
      | .definitionDuplicate | .definitionMissing
      | .referenceLimit | .uniqueReferenceLimit
      | .definitionLimit | .nonDirectDefinitionLimit => []

def typedByteListLess : List UInt8 → List UInt8 → Bool
  | [], [] => false
  | [], _ :: _ => true
  | _ :: _, [] => false
  | left :: leftRest, right :: rightRest =>
      if left < right then true
      else if right < left then false
      else typedByteListLess leftRest rightRest

def typedOrdinalSpaceRank : TypedIssueCode → Nat
  | .selectorAmbiguous | .selectorExternal | .selectorInvalidMode
  | .selectorTargetLimit | .selectorUnsafeTarget | .partMissing
  | .selectedPartLimit | .tripleSelectedPartLimit | .partCompressedLimit
  | .partExpandedLimit | .partRatioLimit | .cumulativeCompressedLimit
  | .cumulativeExpandedLimit | .tripleCompressedLimit
  | .tripleExpandedLimit | .extractionFailed | .invalidUtf8
  | .invalidXml | .xmlDepthLimit | .xmlEventLimit
  | .cumulativeXmlEventLimit | .tripleXmlEventLimit | .rootMismatch => 0
  | .sourcePartitionIncomplete => 1
  | .definitionIdMissing | .definitionIdMalformed | .definitionIdTooLong
  | .definitionNotDirect | .definitionDuplicate | .definitionLimit
  | .nonDirectDefinitionLimit => 2
  | .relationshipRequired | .referenceIdMissing | .referenceIdMalformed
  | .referenceIdTooLong | .definitionMissing | .referenceLimit
  | .uniqueReferenceLimit => 3

def typedIssueLess (pkg : TypedPackageView)
    (left right : TypedCommentIssue) : Bool :=
  let leftRank := typedOrdinalSpaceRank left.code
  let rightRank := typedOrdinalSpaceRank right.code
  if leftRank < rightRank then true
  else if rightRank < leftRank then false
  else if left.occurrenceOrdinal < right.occurrenceOrdinal then true
  else if right.occurrenceOrdinal < left.occurrenceOrdinal then false
  else
    let leftSource := typedIssueSourceIdentity pkg left
    let rightSource := typedIssueSourceIdentity pkg right
    if leftSource.2 < rightSource.2 then true
    else if rightSource.2 < leftSource.2 then false
    else typedByteListLess
      (encodeTypedJson (typedIssueCodeName left.code))
      (encodeTypedJson (typedIssueCodeName right.code))

def typedInsertBy {α : Type} (less : α → α → Bool)
    (value : α) : List α → List α
  | [] => [value]
  | next :: rest =>
      if less next value then next :: typedInsertBy less value rest
      else value :: next :: rest

def typedStableSortBy {α : Type} (less : α → α → Bool) :
    List α → List α
  | [] => []
  | value :: rest =>
      typedInsertBy less value (typedStableSortBy less rest)

def typedCommentIssueJson (pkg : TypedPackageView)
    (issue : TypedCommentIssue) : TypedJson :=
  .object
    (((match issue.canonicalId with
      | none => []
      | some canonical =>
          [(key [99,97,110,111,110,105,99,97,108,73,100],
            .bytes (typedCanonicalIdBytes canonical))]) ++
    [ (key [99,111,100,101], typedIssueCodeName issue.code)
    , (key [100,101,116,97,105,108],
        issue.detailOverride.map TypedJson.bytes |>.getD
          (typedIssueDetail issue.code))
    , (key [102,105,114,115,116,79,99,99,117,114,114,101,110,99,101,79,114,100,105,110,97,108],
        .nat issue.occurrenceOrdinal)
    , (key [107,105,110,100],
        typedAscii [99,111,109,109,101,110,116,115])
    , (key [111,99,99,117,114,114,101,110,99,101,67,111,117,110,116], .nat 1)
    , (key [111,114,100,105,110,97,108,83,112,97,99,101],
        typedIssueOrdinalSpace issue.code)
    ] ++
    (match issue.rawId with
    | some raw =>
      if raw.bytes.length > 64 then
        [(key [114,97,119,73,100,66,121,116,101,76,101,110,103,116,104],
          .nat raw.bytes.length)]
      else [(key [114,97,119,73,100], .bytes raw)]
    | none => []) ++ typedIssueRelationshipFields pkg issue ++
    [ (key [115,105,100,101], typedSideName issue.side)
    , (key [115,111,117,114,99,101], typedIssueSourceJson pkg issue)
    ] ++
    (if issue.includeTargetMode then
      match pkg.relationships.find?
          (fun relationship =>
            relationship.ordinal == issue.occurrenceOrdinal) with
      | some relationship =>
          [(key [116,97,114,103,101,116,77,111,100,101],
            relationship.rawTargetMode.map TypedJson.bytes |>.getD
              (typedAscii []))]
      | none => []
    else []) |> typedStableSortBy (fun left right =>
      typedByteListLess left.1.bytes right.1.bytes)))

def allTypedCommentSidesPass (original revised compared : TypedSideEvaluation) :
    Bool :=
  [original, revised, compared].all fun evaluation =>
    evaluation.status == .passed && evaluation.issues.isEmpty

def globallyStoppedTypedSideEvaluation
    (side : Side) : TypedSideEvaluation :=
  { side
    status := .notEvaluated
    outcome := .absent
    realization := none
    partPresent := false
    sources := []
    scan := emptyTypedCommentScan
    issues := [] }

def ordinaryTypedResponseV6 (request : TypedRequestV6) :
    TypedProtocolV6Response :=
  let original := evaluateTypedCommentSide .original request.original
  let revised :=
    if original.status == .notEvaluated then
      globallyStoppedTypedSideEvaluation .revised
    else evaluateTypedCommentSide .revised request.revised
  let compared :=
    if original.status == .notEvaluated ||
        revised.status == .notEvaluated then
      globallyStoppedTypedSideEvaluation .compared
    else evaluateTypedCommentSide .compared request.compared
  { protocolVersion := .nat 6
    checker := typedAscii
      [115,97,102,101,45,100,111,99,120,45,108,101,97,110,45,99,111,110,
       118,101,110,116,105,111,110,97,108,45,109,97,105,110,45,99,111,109,
       109,101,110,116,45,105,110,116,101,103,114,105,116,121,45,99,104,101,
       99,107,101,114]
    passed := .bool (request.inherited.passed &&
      allTypedCommentSidesPass original revised compared)
    fixedStories := request.inherited.fixedStories
    presenceMismatches := request.inherited.presenceMismatches
    fixedStoryIssues := request.inherited.fixedStoryIssues
    relationshipSlots := request.inherited.relationshipSlots
    relationshipStories := request.inherited.relationshipStories
    selectionIssues := request.inherited.selectionIssues
    referenceSourcePartitions := request.inherited.referenceSourcePartitions
    noteStories := request.inherited.noteStories
    noteInventories := request.inherited.noteInventories
    noteIntegrityIssues := request.inherited.noteIntegrityIssues
    commentStory := typedCommentStoryJson original revised compared
    commentInventories := .array
      [typedCommentInventoryJson original, typedCommentInventoryJson revised,
       typedCommentInventoryJson compared]
    commentIntegrityIssues := .array
      ((typedStableSortBy (typedIssueLess request.original) original.issues |>.map
          (typedCommentIssueJson request.original)) ++
       (typedStableSortBy (typedIssueLess request.revised) revised.issues |>.map
          (typedCommentIssueJson request.revised)) ++
       (typedStableSortBy (typedIssueLess request.compared) compared.issues |>.map
          (typedCommentIssueJson request.compared))) }

def typedJsonArrayValues : TypedJson → List TypedJson
  | .array values => values
  | .null | .bool _ | .nat _ | .numberBytes _ | .bytes _ | .object _ => []

def typedJsonStringChargeFuel : Nat → TypedJson → Nat
  | 0, _ => 0
  | _ + 1, .bytes value => (encodeByteString value).length
  | fuel + 1, .array values =>
      (values.map (typedJsonStringChargeFuel fuel)).sum
  | fuel + 1, .object fields =>
      (fields.map fun field => typedJsonStringChargeFuel fuel field.2).sum
  | _ + 1, .null | _ + 1, .bool _
  | _ + 1, .nat _ | _ + 1, .numberBytes _ => 0

def typedJsonStringCharge (value : TypedJson) : Nat :=
  typedJsonStringChargeFuel 2626369 value

def typedFirstCrossingLoop (charged admitted : Nat) :
    List TypedJson → Option Bool
  | [] => none
  | issue :: rest =>
      if admitted == 511 then some false
      else
        let candidate := typedJsonStringCharge issue
        if charged + candidate > 1571840 then some true
        else typedFirstCrossingLoop (charged + candidate)
          (admitted + 1) rest

def typedFirstProtocolCrossing
    (ordinary : TypedProtocolV6Response) : Option Bool :=
  let nonIssues :=
    typedJsonArrayValues ordinary.fixedStories ++
    typedJsonArrayValues ordinary.referenceSourcePartitions ++
    typedJsonArrayValues ordinary.noteStories ++
    typedJsonArrayValues ordinary.noteInventories ++
    [ordinary.commentStory] ++
    typedJsonArrayValues ordinary.commentInventories ++
    typedJsonArrayValues ordinary.relationshipSlots ++
    typedJsonArrayValues ordinary.relationshipStories
  let nonIssueCharge := (nonIssues.map typedJsonStringCharge).sum
  if nonIssueCharge > 1571840 then some true
  else
    typedFirstCrossingLoop nonIssueCharge 0
      (typedJsonArrayValues ordinary.selectionIssues ++
       typedJsonArrayValues ordinary.noteIntegrityIssues ++
       typedJsonArrayValues ordinary.commentIntegrityIssues)

def typedTerminalDefinitionStory (kind : TypedJson) : TypedJson :=
  .object
    [ (key [107,105,110,100], kind)
    , (key [112,97,114,116,80,114,101,115,101,110,116], .bool false)
    ]

def typedTerminalSource (pkg : TypedPackageView) : TypedJson :=
  .object
    [ (key [110,111,114,109,97,108,105,122,101,100,80,97,114,116,80,97,116,104],
        .bytes pkg.mainSource.partPath)
    , (key [115,111,117,114,99,101,79,114,100,105,110,97,108],
        .nat pkg.mainSource.sourceOrdinal)
    , (key [115,111,117,114,99,101,83,116,111,114,121],
        typedAscii [109,97,105,110])
    ]

def typedTerminalLiteralSource : TypedJson :=
  .object
    [ (key [110,111,114,109,97,108,105,122,101,100,80,97,114,116,80,97,116,104],
        typedAscii [119,111,114,100,47,100,111,99,117,109,101,110,116,46,120,109,108])
    , (key [115,111,117,114,99,101,79,114,100,105,110,97,108], .nat 0)
    , (key [115,111,117,114,99,101,83,116,111,114,121],
        typedAscii [109,97,105,110])
    ]

def typedTerminalPartition (side : Side)
    (pkg : TypedPackageView) : TypedJson :=
  .object
    [ (key [100,101,102,105,110,105,116,105,111,110,83,116,111,114,105,101,115],
        .array
          [ typedTerminalDefinitionStory
              (typedAscii [102,111,111,116,110,111,116,101,115])
          , typedTerminalDefinitionStory
              (typedAscii [101,110,100,110,111,116,101,115])
          ])
    , (key [115,105,100,101], typedSideName side)
    , (key [115,111,117,114,99,101,115],
        .array [typedTerminalSource pkg])
    , (key [115,116,97,116,117,115],
        typedAscii [105,110,99,111,109,112,108,101,116,101])
    ]

def typedTerminalLiteralPartition (side : Side) : TypedJson :=
  .object
    [ (key [100,101,102,105,110,105,116,105,111,110,83,116,111,114,105,101,115],
        .array
          [ typedTerminalDefinitionStory
              (typedAscii [102,111,111,116,110,111,116,101,115])
          , typedTerminalDefinitionStory
              (typedAscii [101,110,100,110,111,116,101,115])
          ])
    , (key [115,105,100,101], typedSideName side)
    , (key [115,111,117,114,99,101,115],
        .array [typedTerminalLiteralSource])
    , (key [115,116,97,116,117,115],
        typedAscii [105,110,99,111,109,112,108,101,116,101])
    ]

def typedTerminalNoteSide (kind : TypedJson) : TypedJson :=
  typedTerminalDefinitionStory kind

def typedTerminalNoteStory (kind : TypedJson) : TypedJson :=
  .object
    [ (key [99,111,109,112,97,114,101,100], typedTerminalNoteSide kind)
    , (key [107,105,110,100], kind)
    , (key [111,114,105,103,105,110,97,108], typedTerminalNoteSide kind)
    , (key [112,97,114,115,101,100,84,111,107,101,110,67,111,117,110,116,115],
        .object
          [ (key [99,111,109,98,105,110,101,100], .nat 0)
          , (key [111,114,105,103,105,110,97,108], .nat 0)
          , (key [114,101,118,105,115,101,100], .nat 0)
          ])
    , (key [114,101,118,105,115,101,100], typedTerminalNoteSide kind)
    , (key [115,116,97,116,117,115],
        typedAscii [110,111,116,95,101,118,97,108,117,97,116,101,100])
    ]

def typedTerminalNoteInventory (side : Side)
    (kind : TypedJson) : TypedJson :=
  .object
    [ (key [100,101,102,105,110,105,116,105,111,110,115],
        .object
          [ (key [99,111,110,116,105,110,117,97,116,105,111,110,78,111,116,105,99,101],
              .nat 0)
          , (key [99,111,110,116,105,110,117,97,116,105,111,110,83,101,112,97,114,97,116,111,114],
              .nat 0)
          , (key [115,101,112,97,114,97,116,111,114], .nat 0)
          , (key [117,115,101,114], .nat 0)
          ])
    , (key [102,111,114,98,105,100,100,101,110,68,101,102,105,110,105,116,105,111,110,83,116,111,114,121,82,101,102,101,114,101,110,99,101,115],
        .nat 0)
    , (key [107,105,110,100], kind)
    , (key [114,101,102,101,114,101,110,99,101,79,99,99,117,114,114,101,110,99,101,115],
        .nat 0)
    , (key [115,105,100,101], typedSideName side)
    , (key [115,116,97,116,117,115],
        typedAscii [110,111,116,95,101,118,97,108,117,97,116,101,100])
    , (key [117,110,105,113,117,101,82,101,102,101,114,101,110,99,101,73,100,115],
        .nat 0)
    ]

def typedTerminalCommentSide : TypedJson :=
  .object
    [ (key [112,97,114,116,80,114,101,115,101,110,116], .bool false)
    , (key [114,101,108,97,116,105,111,110,115,104,105,112], .null)
    , (key [115,116,97,116,117,115],
        typedAscii [110,111,116,95,101,118,97,108,117,97,116,101,100])
    ]

def typedTerminalCommentStory : TypedJson :=
  .object
    [ (key [99,111,109,112,97,114,101,100], typedTerminalCommentSide)
    , (key [111,114,105,103,105,110,97,108], typedTerminalCommentSide)
    , (key [112,97,114,115,101,100,84,111,107,101,110,67,111,117,110,116,115],
        .object
          [ (key [99,111,109,98,105,110,101,100], .nat 0)
          , (key [111,114,105,103,105,110,97,108], .nat 0)
          , (key [114,101,118,105,115,101,100], .nat 0)
          ])
    , (key [114,101,118,105,115,101,100], typedTerminalCommentSide)
    , (key [115,116,97,116,117,115],
        typedAscii [110,111,116,95,101,118,97,108,117,97,116,101,100])
    ]

def typedTerminalCommentInventory (side : Side) : TypedJson :=
  .object
    [ (key [100,101,102,105,110,105,116,105,111,110,115], .nat 0)
    , (key [110,111,110,68,105,114,101,99,116,68,101,102,105,110,105,116,105,111,110,115],
        .nat 0)
    , (key [114,101,102,101,114,101,110,99,101,79,99,99,117,114,114,101,110,99,101,115],
        .nat 0)
    , (key [114,101,108,97,116,105,111,110,115,104,105,112], .null)
    , (key [115,105,100,101], typedSideName side)
    , (key [115,116,97,116,117,115],
        typedAscii [110,111,116,95,101,118,97,108,117,97,116,101,100])
    , (key [117,110,105,113,117,101,82,101,102,101,114,101,110,99,101,73,100,115],
        .nat 0)
    , (key [117,110,114,101,102,101,114,101,110,99,101,100,68,101,102,105,110,105,116,105,111,110,115],
        .nat 0)
    ]

def typedTerminalIssue (evidenceBudget : Bool) : TypedJson :=
  .object
    [ (key [99,111,100,101], if evidenceBudget then
          typedAscii [67,79,77,77,69,78,84,95,69,86,73,68,69,78,67,69,95,83,84,82,73,78,71,95,66,85,68,71,69,84,95,69,88,67,69,69,68,69,68]
        else
          typedAscii [67,79,77,77,69,78,84,95,73,83,83,85,69,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68])
    , (key [100,101,116,97,105,108], if evidenceBudget then
          typedAscii [112,114,111,116,111,99,111,108,32,118,54,32,101,115,99,97,112,101,100,32,101,118,105,100,101,110,99,101,32,115,116,114,105,110,103,32,98,117,100,103,101,116,32,101,120,99,101,101,100,101,100]
        else
          typedAscii [112,114,111,116,111,99,111,108,32,118,54,32,97,103,103,114,101,103,97,116,101,32,111,114,100,105,110,97,114,121,32,105,115,115,117,101,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100])
    , (key [102,105,114,115,116,79,99,99,117,114,114,101,110,99,101,79,114,100,105,110,97,108],
        .nat 0)
    , (key [107,105,110,100], typedAscii [99,111,109,109,101,110,116,115])
    , (key [111,99,99,117,114,114,101,110,99,101,67,111,117,110,116], .nat 1)
    , (key [111,114,100,105,110,97,108,83,112,97,99,101],
        typedAscii [97,103,103,114,101,103,97,116,101])
    , (key [115,105,100,101], typedAscii [111,114,105,103,105,110,97,108])
    ]

def terminalTypedResponseV6 (request : TypedRequestV6)
    (evidenceBudget : Bool) : TypedProtocolV6Response :=
  let footnotes := typedAscii [102,111,111,116,110,111,116,101,115]
  let endnotes := typedAscii [101,110,100,110,111,116,101,115]
  { protocolVersion := .nat 6
    checker := typedAscii
      [115,97,102,101,45,100,111,99,120,45,108,101,97,110,45,99,111,110,
       118,101,110,116,105,111,110,97,108,45,109,97,105,110,45,99,111,109,
       109,101,110,116,45,105,110,116,101,103,114,105,116,121,45,99,104,101,
       99,107,101,114]
    passed := .bool false
    fixedStories := .array
      (typedJsonArrayValues request.inherited.fixedStories |>.take 1)
    presenceMismatches := .array []
    fixedStoryIssues := .array []
    relationshipSlots := .array []
    relationshipStories := .array []
    selectionIssues := .array []
    referenceSourcePartitions := .array
      [ typedTerminalPartition .original request.original
      , typedTerminalPartition .revised request.revised
      , typedTerminalPartition .compared request.compared
      ]
    noteStories := .array
      [typedTerminalNoteStory footnotes, typedTerminalNoteStory endnotes]
    noteInventories := .array
      [ typedTerminalNoteInventory .original footnotes
      , typedTerminalNoteInventory .original endnotes
      , typedTerminalNoteInventory .revised footnotes
      , typedTerminalNoteInventory .revised endnotes
      , typedTerminalNoteInventory .compared footnotes
      , typedTerminalNoteInventory .compared endnotes
      ]
    noteIntegrityIssues := .array []
    commentStory := typedTerminalCommentStory
    commentInventories := .array
      [ typedTerminalCommentInventory .original
      , typedTerminalCommentInventory .revised
      , typedTerminalCommentInventory .compared
      ]
    commentIntegrityIssues := .array [typedTerminalIssue evidenceBudget] }

def typedTerminalMainStory : TypedJson :=
  let checks := .object
    [ (key [97,99,99,101,112,116,80,114,101,115,101,114,118,101,115,70,105,101,108,100,83,116,114,117,99,116,117,114,101],
        .bool true)
    , (key [97,99,99,101,112,116,84,101,120,116,77,97,116,99,104,101,115,82,101,118,105,115,101,100],
        .bool true)
    , (key [99,111,109,98,105,110,101,100,72,97,115,78,111,70,108,100,67,104,97,114,73,110,115,105,100,101,68,101,108],
        .bool true)
    , (key [99,111,109,98,105,110,101,100,72,97,115,86,97,108,105,100,77,111,118,101,82,97,110,103,101,115],
        .bool true)
    , (key [114,101,106,101,99,116,80,114,101,115,101,114,118,101,115,70,105,101,108,100,83,116,114,117,99,116,117,114,101],
        .bool true)
    , (key [114,101,106,101,99,116,84,101,120,116,77,97,116,99,104,101,115,79,114,105,103,105,110,97,108],
        .bool true)
    ]
  .object
    [ (key [110,97,109,101], typedAscii [109,97,105,110])
    , (key [112,97,114,115,101,100,84,111,107,101,110,67,111,117,110,116,115],
        .object
          [ (key [99,111,109,98,105,110,101,100], .nat 1)
          , (key [111,114,105,103,105,110,97,108], .nat 1)
          , (key [114,101,118,105,115,101,100], .nat 1)
          ])
    , (key [112,114,101,115,101,110,99,101],
        .object
          [ (key [99,111,109,98,105,110,101,100], .bool true)
          , (key [111,114,105,103,105,110,97,108], .bool true)
          , (key [114,101,118,105,115,101,100], .bool true)
          ])
    , (key [114,101,112,111,114,116],
        .object
          [ (key [99,104,101,99,107,115], checks)
          , (key [112,97,115,115,101,100], .bool true)
          ])
    ]

def terminalTypedEnvelopeFallback : TypedProtocolV6Response :=
  let footnotes := typedAscii [102,111,111,116,110,111,116,101,115]
  let endnotes := typedAscii [101,110,100,110,111,116,101,115]
  {
    protocolVersion := .nat 6
    checker := typedAscii
      [115,97,102,101,45,100,111,99,120,45,108,101,97,110,45,99,111,110,
       118,101,110,116,105,111,110,97,108,45,109,97,105,110,45,99,111,109,
       109,101,110,116,45,105,110,116,101,103,114,105,116,121,45,99,104,101,
       99,107,101,114]
    passed := .bool false
    fixedStories := .array [typedTerminalMainStory]
    presenceMismatches := .array []
    fixedStoryIssues := .array []
    relationshipSlots := .array []
    relationshipStories := .array []
    selectionIssues := .array []
    referenceSourcePartitions := .array
      [ typedTerminalLiteralPartition .original
      , typedTerminalLiteralPartition .revised
      , typedTerminalLiteralPartition .compared
      ]
    noteStories := .array
      [typedTerminalNoteStory footnotes, typedTerminalNoteStory endnotes]
    noteInventories := .array
      [ typedTerminalNoteInventory .original footnotes
      , typedTerminalNoteInventory .original endnotes
      , typedTerminalNoteInventory .revised footnotes
      , typedTerminalNoteInventory .revised endnotes
      , typedTerminalNoteInventory .compared footnotes
      , typedTerminalNoteInventory .compared endnotes
      ]
    noteIntegrityIssues := .array []
    commentStory := typedTerminalCommentStory
    commentInventories := .array
      [ typedTerminalCommentInventory .original
      , typedTerminalCommentInventory .revised
      , typedTerminalCommentInventory .compared
      ]
    commentIntegrityIssues := .array [typedTerminalIssue true]
  }

def canonicalTypedResponseV6Candidate
    (request : TypedRequestV6) : TypedProtocolV6Response :=
  let ordinary := ordinaryTypedResponseV6 request
  match typedFirstProtocolCrossing ordinary with
  | some evidenceBudget => terminalTypedResponseV6 request evidenceBudget
  | none =>
      if (independentProtocolV6Projection ordinary).length ≤ 2624704 then
        ordinary
      else terminalTypedResponseV6 request true

def canonicalTypedResponseV6
    (request : TypedRequestV6) : TypedProtocolV6Response :=
  let candidate := canonicalTypedResponseV6Candidate request
  if (independentProtocolV6Projection candidate).length ≤ 2626368 then
    candidate
  else terminalTypedEnvelopeFallback

theorem canonical_typed_response_v6_candidate_protocol
    (request : TypedRequestV6) :
    (canonicalTypedResponseV6Candidate request).protocolVersion = .nat 6 := by
  simp only [canonicalTypedResponseV6Candidate]
  split
  · rfl
  · split <;> rfl

theorem terminal_typed_envelope_fallback_protocol :
    terminalTypedEnvelopeFallback.protocolVersion = .nat 6 := by
  rfl

set_option maxRecDepth 1000000 in
set_option maxHeartbeats 2000000 in
theorem terminal_typed_envelope_fallback_bounded :
    (independentProtocolV6Projection
      terminalTypedEnvelopeFallback).length ≤ 2626368 := by
  change 4529 ≤ 2626368
  exact Nat.le_add_right 4529 2621839

theorem canonical_typed_response_v6_protocol
    (request : TypedRequestV6) :
    (canonicalTypedResponseV6 request).protocolVersion = .nat 6 := by
  simp only [canonicalTypedResponseV6]
  split
  · exact canonical_typed_response_v6_candidate_protocol request
  · exact terminal_typed_envelope_fallback_protocol

theorem canonical_typed_response_v6_bounded
    (request : TypedRequestV6) :
    (independentProtocolV6Projection
      (canonicalTypedResponseV6 request)).length ≤ 2626368 := by
  simp only [canonicalTypedResponseV6]
  split
  · assumption
  · exact terminal_typed_envelope_fallback_bounded

def TypedCommentAggregatePassOf
    (request : TypedRequestV6) (response : TypedProtocolV6Response) : Prop :=
  response = canonicalTypedResponseV6 request ∧
  response.protocolVersion = .nat 6 ∧
  TypedSelectionToRealizationOf .original request.original
    (evaluateTypedCommentSide .original request.original) ∧
  TypedSelectionToRealizationOf .revised request.revised
    (evaluateTypedCommentSide .revised request.revised) ∧
  TypedSelectionToRealizationOf .compared request.compared
    (evaluateTypedCommentSide .compared request.compared)

def TypedSerializedResponseV6Of
    (response : TypedProtocolV6Response) (canonicalBytes : List UInt8) : Prop :=
  canonicalBytes = independentProtocolV6Projection response ∧
  canonicalBytes.length ≤ 2626368

set_option maxRecDepth 100000 in
set_option maxHeartbeats 2000000 in
theorem typed_comment_integrity_aggregate_pass_sound
    (request : TypedRequestV6) :
    TypedCommentAggregatePassOf request (canonicalTypedResponseV6 request) ∧
    TypedSerializedResponseV6Of (canonicalTypedResponseV6 request)
      (independentProtocolV6Projection
        (canonicalTypedResponseV6 request)) := by
  exact
    ⟨⟨rfl, canonical_typed_response_v6_protocol request,
      typed_comment_selection_to_realization_sound _ _,
      typed_comment_selection_to_realization_sound _ _,
      typed_comment_selection_to_realization_sound _ _⟩,
     ⟨rfl, canonical_typed_response_v6_bounded request⟩⟩

def typedNegativePackageViewForSide (side : Side) : TypedPackageView :=
  { typedNegativePackageView with
    mainSource := { typedNegativeSource with side := side } }

def typedNegativeInheritedV5 : TypedInheritedV5Evaluation := {
  passed := true
  fixedStories := .array []
  presenceMismatches := .array []
  fixedStoryIssues := .array []
  relationshipSlots := .array []
  relationshipStories := .array []
  selectionIssues := .array []
  referenceSourcePartitions := .array []
  noteStories := .array []
  noteInventories := .array []
  noteIntegrityIssues := .array []
}

def typedNegativeRequestV6 : TypedRequestV6 := {
  original := typedNegativePackageViewForSide .original
  revised := typedNegativePackageViewForSide .revised
  compared := typedNegativePackageViewForSide .compared
  inherited := typedNegativeInheritedV5
}

def typedInjectedInventoryResponse : TypedProtocolV6Response :=
  { canonicalTypedResponseV6 typedNegativeRequestV6 with
    commentInventories := .array
      [typedAscii [105,110,106,101,99,116,101,100]] }

theorem injected_comment_inventory_rejected :
    ¬TypedCommentAggregatePassOf typedNegativeRequestV6
      typedInjectedInventoryResponse := by
  intro h
  have hProjectionDifferent :
      independentProtocolV6Projection typedInjectedInventoryResponse ≠
        independentProtocolV6Projection
          (canonicalTypedResponseV6 typedNegativeRequestV6) := by
    native_decide
  exact hProjectionDifferent (congrArg independentProtocolV6Projection h.1)

def typedCommentSelectorResultSoundSignature : Prop :=
  ∀ (commentType : BoundedBytes) (relationships : List TypedRelationship),
    TypedCommentSelectionResultOf commentType relationships
      (selectTypedComment commentType relationships)

def typedCommentSelectionToRealizationSoundSignature : Prop :=
  ∀ (side : Side) (pkg : TypedPackageView),
    TypedSelectionToRealizationOf side pkg
      (evaluateTypedCommentSide side pkg)

def typedAdmittedCommentSourceSetCompleteSignature : Prop :=
  ∀ (side : Side) (pkg : TypedPackageView),
    (evaluateTypedCommentSide side pkg).status ≠ .notEvaluated →
    TypedCompleteSourceSetOf pkg side
      (evaluateTypedCommentSide side pkg).sources

def typedParsedCommentInventoryEvidenceExactSignature : Prop :=
  ∀ input : TypedScanInput,
    TypedParsedCommentEvidenceOf input (scanTypedCommentEvidence input)

def typedPackageCommentReferenceIntegritySoundSignature : Prop :=
  ∀ (scan : TypedCommentScan),
    checkTypedPackageCommentIntegrity scan = true →
    TypedPackageCommentIntegrity scan

def typedIncompleteCommentPartitionZeroEvidenceSoundSignature : Prop :=
  ∀ (side : Side) (pkg : TypedPackageView),
    TypedIncompleteZeroOf (evaluateTypedCommentSide side pkg)

def typedCommentIntegrityAggregatePassSoundSignature : Prop :=
  ∀ (request : TypedRequestV6),
    TypedCommentAggregatePassOf request (canonicalTypedResponseV6 request) ∧
    TypedSerializedResponseV6Of (canonicalTypedResponseV6 request)
      (independentProtocolV6Projection (canonicalTypedResponseV6 request))

def projectionWitnessResponse : TypedProtocolV6Response :=
  terminalTypedEnvelopeFallback

theorem omitted_comment_integrity_issues_changes_projection :
    independentProtocolV6Projection
        { projectionWitnessResponse with
          commentIntegrityIssues := .array [] } ≠
      independentProtocolV6Projection projectionWitnessResponse := by
  native_decide

theorem inherited_field_drift_changes_projection :
    independentProtocolV6Projection
        { projectionWitnessResponse with fixedStories := .array [] } ≠
      independentProtocolV6Projection projectionWitnessResponse := by
  native_decide

end Tier2.CommentReferenceIntegrity.Typed
