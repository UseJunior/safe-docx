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
  value : BoundedByteArray
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

set_option backward.match.sparseCases false in
def typedNatEqCheck : Nat → Nat → Bool
  | 0, 0 => true
  | left + 1, right + 1 => typedNatEqCheck left right
  | _, _ => false

set_option backward.match.sparseCases false in
def typedBoolEqCheck : Bool → Bool → Bool
  | false, false => true
  | true, true => true
  | _, _ => false

def typedNativeNatEqCheck (left right : Nat) : Bool :=
  if left = right then true else false

def typedNativeUInt8EqCheck (left right : UInt8) : Bool :=
  if left = right then true else false

set_option backward.match.sparseCases false in
def typedNatListEqCheck : List Nat → List Nat → Bool
  | [], [] => true
  | left :: leftRest, right :: rightRest =>
      typedNatEqCheck left right && typedNatListEqCheck leftRest rightRest
  | _, _ => false

set_option backward.match.sparseCases false in
def typedByteListEqCheck : List UInt8 → List UInt8 → Bool
  | [], [] => true
  | left :: leftRest, right :: rightRest =>
      typedNatEqCheck left.toNat right.toNat &&
        typedByteListEqCheck leftRest rightRest
  | _, _ => false

def typedByteArrayGetFast (bytes : ByteArray) (index : Nat)
    (_inBounds : index < bytes.size) : UInt8 :=
  bytes.get! index

set_option backward.match.sparseCases false in
@[implemented_by typedByteArrayGetFast]
def typedByteArrayGet (bytes : ByteArray) (index : Nat)
    (inBounds : index < bytes.size) : UInt8 :=
  bytes.data[index]'(by
    simpa only [ByteArray.size_data] using inBounds)

set_option backward.match.sparseCases false in
def typedByteArrayEqLoop (left right : ByteArray) : Nat → Bool
  | 0 => true
  | index + 1 =>
      if leftInBounds : index < left.size then
        if rightInBounds : index < right.size then
          typedNativeUInt8EqCheck
              (typedByteArrayGet left index leftInBounds)
              (typedByteArrayGet right index rightInBounds) &&
            typedByteArrayEqLoop left right index
        else false
      else false

def typedByteArrayEqCheck (left right : ByteArray) : Bool :=
  typedNativeNatEqCheck left.size right.size &&
    typedByteArrayEqLoop left right left.size

theorem typedBoolAndTrueParts :
    ∀ left right : Bool, (left && right) = true →
      left = true ∧ right = true
  | false, false, h => nomatch h
  | false, true, h => nomatch h
  | true, false, h => nomatch h
  | true, true, _ => ⟨rfl, rfl⟩

theorem typedNatEqCheck_refl : ∀ value,
    typedNatEqCheck value value = true
  | 0 => rfl
  | Nat.succ value => typedNatEqCheck_refl value

theorem typedNatEqCheck_sound : ∀ left right,
    typedNatEqCheck left right = true → left = right
  | 0, 0, _ => rfl
  | 0, _ + 1, h => nomatch h
  | _ + 1, 0, h => nomatch h
  | left + 1, right + 1, h =>
      congrArg Nat.succ (typedNatEqCheck_sound left right h)

theorem typedNatEqCheck_true_iff (left right : Nat) :
    typedNatEqCheck left right = true ↔ left = right := by
  constructor
  · exact typedNatEqCheck_sound left right
  · intro h
    subst right
    exact typedNatEqCheck_refl left

theorem typedNativeNatEqCheck_refl (value : Nat) :
    typedNativeNatEqCheck value value = true := by
  unfold typedNativeNatEqCheck
  split
  · rfl
  · contradiction

theorem typedNativeNatEqCheck_sound (left right : Nat)
    (h : typedNativeNatEqCheck left right = true) : left = right := by
  unfold typedNativeNatEqCheck at h
  split at h
  · assumption
  · contradiction

theorem typedNativeUInt8EqCheck_refl (value : UInt8) :
    typedNativeUInt8EqCheck value value = true := by
  unfold typedNativeUInt8EqCheck
  split
  · rfl
  · contradiction

theorem typedNativeUInt8EqCheck_sound (left right : UInt8)
    (h : typedNativeUInt8EqCheck left right = true) : left = right := by
  unfold typedNativeUInt8EqCheck at h
  split at h
  · assumption
  · contradiction

set_option backward.match.sparseCases false in
theorem typedBoolEqCheck_refl : ∀ value,
    typedBoolEqCheck value value = true
  | false => rfl
  | true => rfl

set_option backward.match.sparseCases false in
theorem typedBoolEqCheck_sound : ∀ left right,
    typedBoolEqCheck left right = true → left = right
  | false, false, _ => rfl
  | false, true, h => nomatch h
  | true, false, h => nomatch h
  | true, true, _ => rfl

theorem typedByteListEqCheck_refl : ∀ values,
    typedByteListEqCheck values values = true
  | [] => rfl
  | _ :: rest => by
      rw [typedByteListEqCheck, typedNatEqCheck_refl,
        typedByteListEqCheck_refl rest]
      rfl

theorem typedByteListEqCheck_sound : ∀ left right,
    typedByteListEqCheck left right = true → left = right
  | [], [], _ => rfl
  | [], _ :: _, h => nomatch h
  | _ :: _, [], h => nomatch h
  | left :: leftRest, right :: rightRest, h => by
      have parts := typedBoolAndTrueParts _ _ h
      have headEq : left = right :=
        UInt8.toNat_inj.mp
          (typedNatEqCheck_sound left.toNat right.toNat parts.1)
      have restEq :=
        typedByteListEqCheck_sound leftRest rightRest parts.2
      rw [headEq, restEq]

theorem typedByteListEqCheck_true_iff (left right : List UInt8) :
    typedByteListEqCheck left right = true ↔ left = right := by
  constructor
  · exact typedByteListEqCheck_sound left right
  · intro h
    subst right
    exact typedByteListEqCheck_refl left

theorem typedByteArrayEqLoop_refl (value : ByteArray) :
    ∀ count, count ≤ value.size →
      typedByteArrayEqLoop value value count = true
  | 0, _ => rfl
  | count + 1, countLe => by
      have countLt : count < value.size := countLe
      rw [typedByteArrayEqLoop, dif_pos countLt, dif_pos countLt,
        typedNativeUInt8EqCheck_refl,
        typedByteArrayEqLoop_refl value count (Nat.le_of_lt countLt)]
      rfl

theorem typedByteArrayEqLoop_sound (left right : ByteArray) :
    ∀ count, typedByteArrayEqLoop left right count = true →
      ∀ index, index < count →
        ∀ (leftInBounds : index < left.size)
          (rightInBounds : index < right.size),
          typedByteArrayGet left index leftInBounds =
            typedByteArrayGet right index rightInBounds
  | 0, _, _, h, _, _ => nomatch h
  | count + 1, h, index, indexLt, leftInBounds, rightInBounds => by
      have countLeftInBounds : count < left.size := by
        unfold typedByteArrayEqLoop at h
        split at h
        · assumption
        · contradiction
      have countRightInBounds : count < right.size := by
        unfold typedByteArrayEqLoop at h
        rw [dif_pos countLeftInBounds] at h
        split at h
        · assumption
        · contradiction
      rw [typedByteArrayEqLoop, dif_pos countLeftInBounds,
        dif_pos countRightInBounds] at h
      have parts := typedBoolAndTrueParts _ _ h
      by_cases indexEq : index = count
      · subst index
        exact typedNativeUInt8EqCheck_sound _ _ parts.1
      · exact typedByteArrayEqLoop_sound left right count parts.2 index
          (Nat.lt_of_le_of_ne (Nat.le_of_lt_succ indexLt) indexEq)
          leftInBounds rightInBounds

theorem typedByteArrayEqCheck_sound (left right : ByteArray)
    (h : typedByteArrayEqCheck left right = true) :
    left.data.toList = right.data.toList := by
  have parts := typedBoolAndTrueParts _ _ h
  have sizeEq := typedNativeNatEqCheck_sound _ _ parts.1
  have elementEq := typedByteArrayEqLoop_sound left right left.size parts.2
  have dataEq : left.data = right.data := by
    apply Array.ext
    · simpa only [ByteArray.size_data] using sizeEq
    · intro index leftLt rightLt
      have leftByteLt : index < left.size := by
        simpa only [ByteArray.size_data] using leftLt
      have rightByteLt : index < right.size := by
        simpa only [ByteArray.size_data] using rightLt
      simpa only [typedByteArrayGet] using
        elementEq index leftByteLt leftByteLt rightByteLt
  exact congrArg Array.toList dataEq

theorem typedByteArrayEqCheck_refl (value : ByteArray) :
    typedByteArrayEqCheck value value = true := by
  unfold typedByteArrayEqCheck
  rw [typedNativeNatEqCheck_refl,
    typedByteArrayEqLoop_refl value value.size (Nat.le_refl _)]
  rfl

theorem typedByteArrayEqCheck_true_iff (left right : ByteArray) :
    typedByteArrayEqCheck left right = true ↔
      left.data.toList = right.data.toList := by
  constructor
  · exact typedByteArrayEqCheck_sound left right
  · intro h
    cases left with
    | mk leftData =>
        cases right with
        | mk rightData =>
            cases leftData with
            | mk leftBytes =>
                cases rightData with
                | mk rightBytes =>
                    change leftBytes = rightBytes at h
                    subst rightBytes
                    exact typedByteArrayEqCheck_refl _

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
  typedByteArrayEqCheck extraction.packageBytes packageBytes &&
  typedByteArrayEqCheck extraction.snapshotBytes packageBytes &&
  typedSelectedEntryCheck index entry.name entry &&
  typedEntryMetadataCheck extraction.entry entry &&
  typedByteArrayEqCheck extraction.compressedSlice
    (byteArraySlice packageBytes entry.dataOffset entry.localSpanEnd) &&
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
            attr.value.bytes.data.toList))
        depth selfClosing ordinal
  | .endElement namespaceUri localName depth ordinal =>
      .endElement namespaceUri.bytes localName.bytes depth ordinal
  | .text value depth ordinal =>
      .text value.bytes.data.toList depth ordinal

def typedXmlAttributeEqCheck
    (left right : TypedXmlAttribute) : Bool :=
  typedByteListEqCheck left.namespaceUri.bytes right.namespaceUri.bytes &&
  typedByteListEqCheck left.localName.bytes right.localName.bytes &&
  typedByteArrayEqCheck left.value.bytes right.value.bytes

set_option backward.match.sparseCases false in
def typedXmlAttributeListEqCheck :
    List TypedXmlAttribute → List TypedXmlAttribute → Bool
  | [], [] => true
  | left :: leftRest, right :: rightRest =>
      typedXmlAttributeEqCheck left right &&
        typedXmlAttributeListEqCheck leftRest rightRest
  | _, _ => false

set_option backward.match.sparseCases false in
def typedXmlEventEqCheck : TypedXmlEvent → TypedXmlEvent → Bool
  | .startElement leftUri leftName leftAttributes leftDepth
        leftSelfClosing leftOrdinal,
      .startElement rightUri rightName rightAttributes rightDepth
        rightSelfClosing rightOrdinal =>
      typedByteListEqCheck leftUri.bytes rightUri.bytes &&
      typedByteListEqCheck leftName.bytes rightName.bytes &&
      typedXmlAttributeListEqCheck leftAttributes rightAttributes &&
      typedNatEqCheck leftDepth rightDepth &&
      typedBoolEqCheck leftSelfClosing rightSelfClosing &&
      typedNatEqCheck leftOrdinal rightOrdinal
  | .endElement leftUri leftName leftDepth leftOrdinal,
      .endElement rightUri rightName rightDepth rightOrdinal =>
      typedByteListEqCheck leftUri.bytes rightUri.bytes &&
      typedByteListEqCheck leftName.bytes rightName.bytes &&
      typedNatEqCheck leftDepth rightDepth &&
      typedNatEqCheck leftOrdinal rightOrdinal
  | .text leftValue leftDepth leftOrdinal,
      .text rightValue rightDepth rightOrdinal =>
      typedByteArrayEqCheck leftValue.bytes rightValue.bytes &&
      typedNatEqCheck leftDepth rightDepth &&
      typedNatEqCheck leftOrdinal rightOrdinal
  | _, _ => false

set_option backward.match.sparseCases false in
def typedXmlEventListEqCheck :
    List TypedXmlEvent → List TypedXmlEvent → Bool
  | [], [] => true
  | left :: leftRest, right :: rightRest =>
      if typedXmlEventEqCheck left right then
        typedXmlEventListEqCheck leftRest rightRest
      else false
  | _, _ => false

theorem typedXmlAttributeEqCheck_sound
    (left right : TypedXmlAttribute)
    (h : typedXmlAttributeEqCheck left right = true) :
    left.namespaceUri.bytes = right.namespaceUri.bytes ∧
      left.localName.bytes = right.localName.bytes ∧
      left.value.bytes.data.toList = right.value.bytes.data.toList := by
  have outer := typedBoolAndTrueParts _ _ h
  have inner := typedBoolAndTrueParts _ _ outer.1
  exact ⟨
    typedByteListEqCheck_sound _ _ inner.1,
    typedByteListEqCheck_sound _ _ inner.2,
    typedByteArrayEqCheck_sound _ _ outer.2⟩

theorem typedXmlAttributeEqCheck_complete
    (left right : TypedXmlAttribute)
    (h : left.namespaceUri.bytes = right.namespaceUri.bytes ∧
      left.localName.bytes = right.localName.bytes ∧
      left.value.bytes.data.toList = right.value.bytes.data.toList) :
    typedXmlAttributeEqCheck left right = true := by
  unfold typedXmlAttributeEqCheck
  rw [h.1, h.2.1, typedByteListEqCheck_refl,
    typedByteListEqCheck_refl,
    (typedByteArrayEqCheck_true_iff _ _).mpr h.2.2]
  rfl

theorem typedXmlAttributeEqCheck_true_iff
    (left right : TypedXmlAttribute) :
    typedXmlAttributeEqCheck left right = true ↔
      left.namespaceUri.bytes = right.namespaceUri.bytes ∧
      left.localName.bytes = right.localName.bytes ∧
      left.value.bytes.data.toList = right.value.bytes.data.toList :=
  ⟨typedXmlAttributeEqCheck_sound left right,
    typedXmlAttributeEqCheck_complete left right⟩

theorem typedXmlAttributeListEqCheck_sound : ∀ left right,
    typedXmlAttributeListEqCheck left right = true →
      left.map (fun item =>
        (item.namespaceUri.bytes, item.localName.bytes,
          item.value.bytes.data.toList)) =
      right.map (fun item =>
        (item.namespaceUri.bytes, item.localName.bytes,
          item.value.bytes.data.toList)) := by
  intro left
  induction left with
  | nil =>
      intro right
      cases right with
      | nil => intro; rfl
      | cons _ _ => intro h; nomatch h
  | cons item rest ih =>
      intro right
      cases right with
      | nil => intro h; nomatch h
      | cons rightAttribute rightRest =>
          intro h
          have parts := typedBoolAndTrueParts _ _ h
          have head :=
            typedXmlAttributeEqCheck_sound item rightAttribute parts.1
          have tail := ih rightRest parts.2
          change
            (item.namespaceUri.bytes, item.localName.bytes,
                item.value.bytes.data.toList) ::
                rest.map (fun candidate =>
                  (candidate.namespaceUri.bytes, candidate.localName.bytes,
                    candidate.value.bytes.data.toList)) =
              (rightAttribute.namespaceUri.bytes,
                rightAttribute.localName.bytes,
                rightAttribute.value.bytes.data.toList) ::
                rightRest.map (fun candidate =>
                  (candidate.namespaceUri.bytes, candidate.localName.bytes,
                    candidate.value.bytes.data.toList))
          rw [head.1, head.2.1, head.2.2, tail]

theorem typedXmlAttributeListEqCheck_complete : ∀ left right,
    left.map (fun item =>
      (item.namespaceUri.bytes, item.localName.bytes,
        item.value.bytes.data.toList)) =
    right.map (fun item =>
      (item.namespaceUri.bytes, item.localName.bytes,
        item.value.bytes.data.toList)) →
    typedXmlAttributeListEqCheck left right = true := by
  intro left
  induction left with
  | nil =>
      intro right h
      cases right with
      | nil => rfl
      | cons _ _ => nomatch h
  | cons item rest ih =>
      intro right
      cases right with
      | nil => intro h; nomatch h
      | cons rightAttribute rightRest =>
          intro h
          injection h with head tail
          injection head with namespaceEq remainingEq
          injection remainingEq with localNameEq valueEq
          have headCheck :=
            typedXmlAttributeEqCheck_complete item rightAttribute
              ⟨namespaceEq, localNameEq, valueEq⟩
          have tailCheck := ih rightRest tail
          rw [typedXmlAttributeListEqCheck, headCheck, tailCheck]
          rfl

theorem typedXmlAttributeListEqCheck_true_iff (left right) :
    typedXmlAttributeListEqCheck left right = true ↔
      left.map (fun item =>
        (item.namespaceUri.bytes, item.localName.bytes,
          item.value.bytes.data.toList)) =
      right.map (fun item =>
        (item.namespaceUri.bytes, item.localName.bytes,
          item.value.bytes.data.toList)) :=
  ⟨typedXmlAttributeListEqCheck_sound left right,
    typedXmlAttributeListEqCheck_complete left right⟩

theorem typedXmlEventEqCheck_sound
    (left right : TypedXmlEvent)
    (h : typedXmlEventEqCheck left right = true) :
    typedXmlEventIdentity left = typedXmlEventIdentity right := by
  cases left with
  | startElement leftUri leftName leftAttributes leftDepth
      leftSelfClosing leftOrdinal =>
      cases right with
      | startElement rightUri rightName rightAttributes rightDepth
          rightSelfClosing rightOrdinal =>
          have part6 := typedBoolAndTrueParts _ _ h
          have part5 := typedBoolAndTrueParts _ _ part6.1
          have part4 := typedBoolAndTrueParts _ _ part5.1
          have part3 := typedBoolAndTrueParts _ _ part4.1
          have part2 := typedBoolAndTrueParts _ _ part3.1
          have uriEq := typedByteListEqCheck_sound _ _ part2.1
          have nameEq := typedByteListEqCheck_sound _ _ part2.2
          have attributesEq :=
            typedXmlAttributeListEqCheck_sound _ _ part3.2
          have depthEq := typedNatEqCheck_sound _ _ part4.2
          have selfClosingEq := typedBoolEqCheck_sound _ _ part5.2
          have ordinalEq := typedNatEqCheck_sound _ _ part6.2
          change TypedXmlEventIdentity.startElement leftUri.bytes leftName.bytes
              (leftAttributes.map fun item =>
                (item.namespaceUri.bytes, item.localName.bytes,
                  item.value.bytes.data.toList))
              leftDepth leftSelfClosing leftOrdinal =
            TypedXmlEventIdentity.startElement rightUri.bytes rightName.bytes
              (rightAttributes.map fun item =>
                (item.namespaceUri.bytes, item.localName.bytes,
                  item.value.bytes.data.toList))
              rightDepth rightSelfClosing rightOrdinal
          rw [uriEq, nameEq, attributesEq, depthEq, selfClosingEq, ordinalEq]
      | endElement _ _ _ _ => nomatch h
      | text _ _ _ => nomatch h
  | endElement leftUri leftName leftDepth leftOrdinal =>
      cases right with
      | startElement _ _ _ _ _ _ => nomatch h
      | endElement rightUri rightName rightDepth rightOrdinal =>
          have part4 := typedBoolAndTrueParts _ _ h
          have part3 := typedBoolAndTrueParts _ _ part4.1
          have part2 := typedBoolAndTrueParts _ _ part3.1
          have uriEq := typedByteListEqCheck_sound _ _ part2.1
          have nameEq := typedByteListEqCheck_sound _ _ part2.2
          have depthEq := typedNatEqCheck_sound _ _ part3.2
          have ordinalEq := typedNatEqCheck_sound _ _ part4.2
          change TypedXmlEventIdentity.endElement leftUri.bytes leftName.bytes
              leftDepth leftOrdinal =
            TypedXmlEventIdentity.endElement rightUri.bytes rightName.bytes
              rightDepth rightOrdinal
          rw [uriEq, nameEq, depthEq, ordinalEq]
      | text _ _ _ => nomatch h
  | text leftValue leftDepth leftOrdinal =>
      cases right with
      | startElement _ _ _ _ _ _ => nomatch h
      | endElement _ _ _ _ => nomatch h
      | text rightValue rightDepth rightOrdinal =>
          have part3 := typedBoolAndTrueParts _ _ h
          have part2 := typedBoolAndTrueParts _ _ part3.1
          have valueEq := typedByteArrayEqCheck_sound _ _ part2.1
          have depthEq := typedNatEqCheck_sound _ _ part2.2
          have ordinalEq := typedNatEqCheck_sound _ _ part3.2
          change TypedXmlEventIdentity.text leftValue.bytes.data.toList
              leftDepth leftOrdinal =
            TypedXmlEventIdentity.text rightValue.bytes.data.toList
              rightDepth rightOrdinal
          rw [valueEq, depthEq, ordinalEq]

theorem typedXmlEventEqCheck_complete
    (left right : TypedXmlEvent)
    (h : typedXmlEventIdentity left = typedXmlEventIdentity right) :
    typedXmlEventEqCheck left right = true := by
  cases left with
  | startElement leftUri leftName leftAttributes leftDepth
      leftSelfClosing leftOrdinal =>
      cases right with
      | startElement rightUri rightName rightAttributes rightDepth
          rightSelfClosing rightOrdinal =>
          injection h with uriEq nameEq attributesEq depthEq
            selfClosingEq ordinalEq
          have uriCheck :=
            typedByteListEqCheck_true_iff _ _ |>.mpr uriEq
          have nameCheck :=
            typedByteListEqCheck_true_iff _ _ |>.mpr nameEq
          have attributesCheck :=
            typedXmlAttributeListEqCheck_complete _ _ attributesEq
          have depthCheck :=
            typedNatEqCheck_true_iff _ _ |>.mpr depthEq
          have selfClosingCheck : typedBoolEqCheck leftSelfClosing
              rightSelfClosing = true := by
            subst rightSelfClosing
            exact typedBoolEqCheck_refl leftSelfClosing
          have ordinalCheck :=
            typedNatEqCheck_true_iff _ _ |>.mpr ordinalEq
          change
            (typedByteListEqCheck leftUri.bytes rightUri.bytes &&
                typedByteListEqCheck leftName.bytes rightName.bytes &&
                typedXmlAttributeListEqCheck leftAttributes rightAttributes &&
                typedNatEqCheck leftDepth rightDepth &&
                typedBoolEqCheck leftSelfClosing rightSelfClosing &&
                typedNatEqCheck leftOrdinal rightOrdinal) = true
          rw [uriCheck, nameCheck, attributesCheck, depthCheck,
            selfClosingCheck, ordinalCheck]
          rfl
      | endElement _ _ _ _ => nomatch h
      | text _ _ _ => nomatch h
  | endElement leftUri leftName leftDepth leftOrdinal =>
      cases right with
      | startElement _ _ _ _ _ _ => nomatch h
      | endElement rightUri rightName rightDepth rightOrdinal =>
          injection h with uriEq nameEq depthEq ordinalEq
          have uriCheck :=
            typedByteListEqCheck_true_iff _ _ |>.mpr uriEq
          have nameCheck :=
            typedByteListEqCheck_true_iff _ _ |>.mpr nameEq
          have depthCheck :=
            typedNatEqCheck_true_iff _ _ |>.mpr depthEq
          have ordinalCheck :=
            typedNatEqCheck_true_iff _ _ |>.mpr ordinalEq
          change
            (typedByteListEqCheck leftUri.bytes rightUri.bytes &&
                typedByteListEqCheck leftName.bytes rightName.bytes &&
                typedNatEqCheck leftDepth rightDepth &&
                typedNatEqCheck leftOrdinal rightOrdinal) = true
          rw [uriCheck, nameCheck, depthCheck, ordinalCheck]
          rfl
      | text _ _ _ => nomatch h
  | text leftValue leftDepth leftOrdinal =>
      cases right with
      | startElement _ _ _ _ _ _ => nomatch h
      | endElement _ _ _ _ => nomatch h
      | text rightValue rightDepth rightOrdinal =>
          injection h with valueEq depthEq ordinalEq
          have valueCheck : typedByteArrayEqCheck leftValue.bytes
              rightValue.bytes = true := by
            exact (typedByteArrayEqCheck_true_iff _ _).mpr valueEq
          have depthCheck :=
            typedNatEqCheck_true_iff _ _ |>.mpr depthEq
          have ordinalCheck :=
            typedNatEqCheck_true_iff _ _ |>.mpr ordinalEq
          change
            (typedByteArrayEqCheck leftValue.bytes rightValue.bytes &&
                typedNatEqCheck leftDepth rightDepth &&
                typedNatEqCheck leftOrdinal rightOrdinal) = true
          rw [valueCheck, depthCheck, ordinalCheck]
          rfl

theorem typedXmlEventEqCheck_true_iff
    (left right : TypedXmlEvent) :
    typedXmlEventEqCheck left right = true ↔
      typedXmlEventIdentity left = typedXmlEventIdentity right :=
  ⟨typedXmlEventEqCheck_sound left right,
    typedXmlEventEqCheck_complete left right⟩

theorem typedXmlEventListEqCheck_sound : ∀ left right,
    typedXmlEventListEqCheck left right = true →
      left.map typedXmlEventIdentity = right.map typedXmlEventIdentity := by
  intro left
  induction left with
  | nil =>
      intro right
      cases right with
      | nil => intro; rfl
      | cons _ _ => intro h; nomatch h
  | cons event rest ih =>
      intro right
      cases right with
      | nil => intro h; nomatch h
      | cons rightEvent rightRest =>
          intro h
          cases hHead : typedXmlEventEqCheck event rightEvent with
          | false => simp [typedXmlEventListEqCheck, hHead] at h
          | true =>
            have head := typedXmlEventEqCheck_sound event rightEvent hHead
            have hTail : typedXmlEventListEqCheck rest rightRest = true := by
              simpa [typedXmlEventListEqCheck, hHead] using h
            have tail := ih rightRest hTail
            change typedXmlEventIdentity event ::
                rest.map typedXmlEventIdentity =
              typedXmlEventIdentity rightEvent ::
                rightRest.map typedXmlEventIdentity
            rw [head, tail]

theorem typedXmlEventListEqCheck_complete : ∀ left right,
    left.map typedXmlEventIdentity = right.map typedXmlEventIdentity →
      typedXmlEventListEqCheck left right = true := by
  intro left
  induction left with
  | nil =>
      intro right h
      cases right with
      | nil => rfl
      | cons _ _ => nomatch h
  | cons event rest ih =>
      intro right
      cases right with
      | nil => intro h; nomatch h
      | cons rightEvent rightRest =>
          intro h
          injection h with head tail
          have headCheck :=
            typedXmlEventEqCheck_complete event rightEvent head
          have tailCheck := ih rightRest tail
          simp [typedXmlEventListEqCheck, headCheck, tailCheck]

theorem typedXmlEventListEqCheck_true_iff (left right) :
    typedXmlEventListEqCheck left right = true ↔
      left.map typedXmlEventIdentity = right.map typedXmlEventIdentity :=
  ⟨typedXmlEventListEqCheck_sound left right,
    typedXmlEventListEqCheck_complete left right⟩

def typedParsedPartCheck (extraction : TypedExtraction)
    (expectedRootUri expectedRootLocalName : BoundedBytes)
    (expectedEvents : List TypedXmlEvent)
    (parsed : TypedParsedPart) : Bool :=
  typedByteArrayEqCheck parsed.rawBytes extraction.expandedBytes &&
  decide (parsed.expectedRootUri.bytes = expectedRootUri.bytes) &&
  decide (parsed.expectedRootLocalName.bytes = expectedRootLocalName.bytes) &&
  typedXmlEventListEqCheck parsed.events expectedEvents &&
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

def TypedCommentSelectionResultV6Of (commentType : BoundedBytes)
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
    TypedCommentSelectionResultV6Of commentType relationships
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
def typedNatLeCheck : Nat → Nat → Bool
  | 0, _ => true
  | _ + 1, 0 => false
  | left + 1, right + 1 => typedNatLeCheck left right

def typedNatLtCheck (left right : Nat) : Bool :=
  typedNatLeCheck (left + 1) right

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
    decide (item.localName.bytes = input.idLocalName.bytes)).map fun item =>
      { bytes := item.value.bytes.data.toList
        limit := item.value.limit
        admitted := by
          simpa only [Array.length_toList, ByteArray.size_data] using
            item.value.admitted }

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
          typedAscii [112,114,111,116,111,99,111,108,32,118,55,32,101,115,99,97,112,101,100,32,101,118,105,100,101,110,99,101,32,115,116,114,105,110,103,32,98,117,100,103,101,116,32,101,120,99,101,101,100,101,100]
        else
          typedAscii [112,114,111,116,111,99,111,108,32,118,55,32,97,103,103,114,101,103,97,116,101,32,111,114,100,105,110,97,114,121,32,105,115,115,117,101,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100])
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
    TypedCommentSelectionResultV6Of commentType relationships
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

/- Protocol v7 independently models marker topology over the exact typed package
   views. This section intentionally stays byte-native and does not import the
   executable checker. -/

abbrev CanonicalDecimalId := TypedCanonicalId
abbrev TypedSelectedCommentIdentity := TypedSelectedComment
abbrev TypedCommentSelectionFailure := TypedSelectionFailure
abbrev TypedCommentRealizationFailure := TypedRealizationFailure
abbrev TypedCommentDefinition := TypedDefinition

inductive TypedMarkerKind
  | rangeStart
  | rangeEnd
  | reference
  deriving DecidableEq

structure TypedPhysicalStoryIdentity where
  kind : TypedSourceKind
  physicalStoryOrdinal : Nat
  deriving DecidableEq

structure TypedMarkerOccurrence where
  kind : TypedMarkerKind
  story : TypedPhysicalStoryIdentity
  sourceSetOrdinal : Nat
  sourceEventOrdinal : Nat
  markerOccurrenceOrdinal : Nat
  kindOccurrenceOrdinal : Nat
  rawId : Option BoundedBytes
  canonicalId : Option CanonicalDecimalId
  deriving DecidableEq

inductive TypedMarkerScanCrossing
  | referenceLimit (sourceSetOrdinal sourceEventOrdinal occurrenceOrdinal : Nat)
  | rangeStartLimit (sourceSetOrdinal sourceEventOrdinal occurrenceOrdinal : Nat)
  | rangeEndLimit (sourceSetOrdinal sourceEventOrdinal occurrenceOrdinal : Nat)
  | uniqueIdLimit (kind : TypedMarkerKind)
      (sourceSetOrdinal sourceEventOrdinal occurrenceOrdinal : Nat)
      (canonicalId : CanonicalDecimalId)
  deriving DecidableEq

structure TypedMarkerScanInput where
  stories : List TypedStorySource
  slots : List TypedSourceSlot
  wmlNamespace : BoundedBytes
  idLocalName : BoundedBytes
  rangeStartLocalName : BoundedBytes
  rangeEndLocalName : BoundedBytes
  referenceLocalName : BoundedBytes

structure TypedMarkerAssociationV7 where
  referenceCount : Nat := 0
  rangeStartCount : Nat := 0
  rangeEndCount : Nat := 0
  firstReference : Option TypedMarkerOccurrence := none
  firstRangeStart : Option TypedMarkerOccurrence := none
  firstRangeEnd : Option TypedMarkerOccurrence := none
  firstDuplicateReference : Option TypedMarkerOccurrence := none
  firstDuplicateRangeStart : Option TypedMarkerOccurrence := none
  firstDuplicateRangeEnd : Option TypedMarkerOccurrence := none
  deriving DecidableEq

inductive TypedCanonicalIdTrie where
  | empty
  | node (association : Option TypedMarkerAssociationV7)
      (children : List (UInt8 × TypedCanonicalIdTrie))
  deriving Inhabited

structure TypedMarkerScanEvidence where
  inputStories : List TypedStorySource
  occurrences : List TypedMarkerOccurrence
  canonicalIds : List CanonicalDecimalId
  referenceOccurrences : Nat
  rangeStartOccurrences : Nat
  rangeEndOccurrences : Nat
  processedEventCount : Nat
  processedStoryCount : Nat
  crossing : Option TypedMarkerScanCrossing
  deriving DecidableEq

structure TypedRequestV7 where
  original : TypedPackageView
  revised : TypedPackageView
  compared : TypedPackageView
  inherited : TypedInheritedV5Evaluation
  originalRetainedMarkerScan : Option TypedMarkerScanEvidence := none
  revisedRetainedMarkerScan : Option TypedMarkerScanEvidence := none
  comparedRetainedMarkerScan : Option TypedMarkerScanEvidence := none

def typedPackageAt (request : TypedRequestV7) : Side → TypedPackageView
  | .original => request.original
  | .revised => request.revised
  | .compared => request.compared

def retainedTypedMarkerScanAt
    (request : TypedRequestV7) : Side → Option TypedMarkerScanEvidence
  | .original => request.originalRetainedMarkerScan
  | .revised => request.revisedRetainedMarkerScan
  | .compared => request.comparedRetainedMarkerScan

def selectTypedCommentV7 (pkg : TypedPackageView) :
    Except TypedCommentSelectionFailure (Option TypedSelectedCommentIdentity) :=
  selectTypedComment pkg.commentType pkg.relationships

def TypedCommentSelectionResultOf (pkg : TypedPackageView)
    (result : Except TypedCommentSelectionFailure
      (Option TypedSelectedCommentIdentity)) : Prop :=
  result = selectTypedCommentV7 pkg

def realizeTypedCommentV7 (request : TypedRequestV7) (side : Side) :
    Except TypedCommentRealizationFailure (Option TypedCommentRealization) :=
  let pkg := typedPackageAt request side
  match selectTypedCommentV7 pkg with
  | .error _ => .error .partMissing
  | .ok none => .ok none
  | .ok (some selected) =>
      match pkg.realizationFailure with
      | some failure => .error failure
      | none =>
        match pkg.realization with
        | some realization =>
          if typedAdmittedCommentRealizationCheck pkg selected realization then
            .ok (some realization)
          else .error .extractionFailed
        | none => .error .partMissing

def canonicalTypedCommentSourceSlotsOfPackageV7
    (pkg : TypedPackageView) : List TypedSourceSlot :=
  let main : TypedSourceSlot := {
    kind := .main, physicalStoryOrdinal := 0, source := pkg.mainSource }
  let physical := pkg.headerFooterStories.filterMap fun story =>
    story.source.map fun source => {
      kind := story.kind
      physicalStoryOrdinal := story.physicalStoryOrdinal
      source }
  let notes := pkg.noteSelections.filterMap fun selection =>
    selection.source.map fun source => {
      kind := selection.kind, physicalStoryOrdinal := 0, source }
  main :: physical ++ notes

def canonicalTypedCommentSourceSlotsV7
    (request : TypedRequestV7) (side : Side) : List TypedSourceSlot :=
  canonicalTypedCommentSourceSlotsOfPackageV7 (typedPackageAt request side)

def canonicalTypedCommentSourcesV7
    (request : TypedRequestV7) (side : Side) : List TypedStorySource :=
  (canonicalTypedCommentSourceSlotsV7 request side).map (·.source)

def typedCanonicalIdTrieKey (id : CanonicalDecimalId) : List UInt8 :=
  (if id.negative then 1 else 0) :: id.digits

def typedCanonicalIdTrieGet :
    TypedCanonicalIdTrie → List UInt8 → Option TypedMarkerAssociationV7
  | .empty, _ => none
  | .node association _, [] => association
  | .node _ children, byte :: rest =>
      match children.find? (fun child => child.1 == byte) with
      | none => none
      | some child => typedCanonicalIdTrieGet child.2 rest

def typedCanonicalIdTrieInsertChild (byte : UInt8)
    (value : TypedCanonicalIdTrie) :
    List (UInt8 × TypedCanonicalIdTrie) →
      List (UInt8 × TypedCanonicalIdTrie)
  | [] => [(byte, value)]
  | child :: rest =>
      if child.1 == byte then (byte, value) :: rest
      else child :: typedCanonicalIdTrieInsertChild byte value rest

def typedCanonicalIdTrieInsert :
    TypedCanonicalIdTrie → List UInt8 → TypedMarkerAssociationV7 →
      TypedCanonicalIdTrie
  | .empty, [], association => .node (some association) []
  | .empty, byte :: rest, association =>
      .node none [(byte, typedCanonicalIdTrieInsert .empty rest association)]
  | .node _ children, [], association => .node (some association) children
  | .node terminal children, byte :: rest, association =>
      let child := (children.find? fun item => item.1 == byte).map (·.2)
        |>.getD .empty
      .node terminal (typedCanonicalIdTrieInsertChild byte
        (typedCanonicalIdTrieInsert child rest association) children)

def typedCanonicalIdTrieHas (trie : TypedCanonicalIdTrie)
    (id : CanonicalDecimalId) : Bool :=
  (typedCanonicalIdTrieGet trie (typedCanonicalIdTrieKey id)).isSome

def typedCanonicalIdTrieAssociation? (trie : TypedCanonicalIdTrie)
    (id : CanonicalDecimalId) : Option TypedMarkerAssociationV7 :=
  typedCanonicalIdTrieGet trie (typedCanonicalIdTrieKey id)

def typedCanonicalIdTrieSet (trie : TypedCanonicalIdTrie)
    (id : CanonicalDecimalId) (association : TypedMarkerAssociationV7) :
    TypedCanonicalIdTrie :=
  typedCanonicalIdTrieInsert trie (typedCanonicalIdTrieKey id) association

structure TypedMarkerScanState where
  occurrences : List TypedMarkerOccurrence := []
  canonicalIds : List CanonicalDecimalId := []
  canonicalIdTrie : TypedCanonicalIdTrie := .empty
  referenceOccurrences : Nat := 0
  rangeStartOccurrences : Nat := 0
  rangeEndOccurrences : Nat := 0
  markerOccurrences : Nat := 0
  processedEventCount : Nat := 0
  processedStoryCount : Nat := 0
  crossing : Option TypedMarkerScanCrossing := none
  deriving Inhabited

def typedMarkerScanInputV7
    (request : TypedRequestV7) (side : Side) : TypedMarkerScanInput :=
  { stories := canonicalTypedCommentSourcesV7 request side
    slots := canonicalTypedCommentSourceSlotsV7 request side
    wmlNamespace := typedWmlNamespace
    idLocalName := typedLiteral [105,100]
    rangeStartLocalName :=
      typedLiteral [99,111,109,109,101,110,116,82,97,110,103,101,83,116,97,114,116]
    rangeEndLocalName :=
      typedLiteral [99,111,109,109,101,110,116,82,97,110,103,101,69,110,100]
    referenceLocalName :=
      typedLiteral [99,111,109,109,101,110,116,82,101,102,101,114,101,110,99,101] }

def typedMarkerAttributeValue? (input : TypedMarkerScanInput)
    (attributes : List TypedXmlAttribute) : Option BoundedBytes :=
  (attributes.find? fun item =>
    decide (item.namespaceUri.bytes = input.wmlNamespace.bytes) &&
    decide (item.localName.bytes = input.idLocalName.bytes)).map fun item =>
      { bytes := item.value.bytes.data.toList
        limit := item.value.limit
        admitted := by
          simpa only [Array.length_toList, ByteArray.size_data] using
            item.value.admitted }

def typedMarkerCandidateV7 (input : TypedMarkerScanInput) :
    TypedXmlEvent → Option (TypedMarkerKind × Option BoundedBytes)
  | .startElement namespaceUri localName attributes _ _ _ =>
    if namespaceUri.bytes != input.wmlNamespace.bytes then none
    else if localName.bytes = input.rangeStartLocalName.bytes then
      some (.rangeStart, typedMarkerAttributeValue? input attributes)
    else if localName.bytes = input.rangeEndLocalName.bytes then
      some (.rangeEnd, typedMarkerAttributeValue? input attributes)
    else if localName.bytes = input.referenceLocalName.bytes then
      some (.reference, typedMarkerAttributeValue? input attributes)
    else none
  | .endElement .. | .text .. => none

def typedMarkerKindCount (kind : TypedMarkerKind)
    (state : TypedMarkerScanState) : Nat :=
  match kind with
  | .reference => state.referenceOccurrences
  | .rangeStart => state.rangeStartOccurrences
  | .rangeEnd => state.rangeEndOccurrences

def updateTypedMarkerAssociationV7
    (association : TypedMarkerAssociationV7)
    (occurrence : TypedMarkerOccurrence) : TypedMarkerAssociationV7 :=
  match occurrence.kind with
  | .reference =>
      { association with
        referenceCount := association.referenceCount + 1
        firstReference := association.firstReference.orElse
          (fun _ => some occurrence)
        firstDuplicateReference :=
          if association.referenceCount == 1 then some occurrence
          else association.firstDuplicateReference }
  | .rangeStart =>
      { association with
        rangeStartCount := association.rangeStartCount + 1
        firstRangeStart := association.firstRangeStart.orElse
          (fun _ => some occurrence)
        firstDuplicateRangeStart :=
          if association.rangeStartCount == 1 then some occurrence
          else association.firstDuplicateRangeStart }
  | .rangeEnd =>
      { association with
        rangeEndCount := association.rangeEndCount + 1
        firstRangeEnd := association.firstRangeEnd.orElse
          (fun _ => some occurrence)
        firstDuplicateRangeEnd :=
          if association.rangeEndCount == 1 then some occurrence
          else association.firstDuplicateRangeEnd }

def typedMarkerAssociationTrieFromOccurrencesV7 :
    TypedCanonicalIdTrie → List TypedMarkerOccurrence → TypedCanonicalIdTrie
  | trie, [] => trie
  | trie, occurrence :: rest =>
      let next := match occurrence.canonicalId with
        | none => trie
        | some canonical =>
            let association :=
              (typedCanonicalIdTrieAssociation? trie canonical).getD {}
            typedCanonicalIdTrieSet trie canonical
              (updateTypedMarkerAssociationV7 association occurrence)
      typedMarkerAssociationTrieFromOccurrencesV7 next rest

def typedMarkerStoryAt (input : TypedMarkerScanInput) (ordinal : Nat) :
    TypedPhysicalStoryIdentity :=
  match typedListGet? input.slots ordinal with
  | some slot => { kind := slot.kind, physicalStoryOrdinal := slot.physicalStoryOrdinal }
  | none => { kind := .main, physicalStoryOrdinal := 0 }

def TypedMarkerScanInputObservationalEqV7
    (left right : TypedMarkerScanInput) : Prop :=
  left.wmlNamespace = right.wmlNamespace ∧
  left.idLocalName = right.idLocalName ∧
  left.rangeStartLocalName = right.rangeStartLocalName ∧
  left.rangeEndLocalName = right.rangeEndLocalName ∧
  left.referenceLocalName = right.referenceLocalName ∧
  ∀ ordinal, typedMarkerStoryAt left ordinal =
    typedMarkerStoryAt right ordinal

theorem typed_marker_candidate_v7_input_observational_ext
    (left right : TypedMarkerScanInput)
    (hInput : TypedMarkerScanInputObservationalEqV7 left right)
    (event : TypedXmlEvent) :
    typedMarkerCandidateV7 left event =
      typedMarkerCandidateV7 right event := by
  cases left with
  | mk leftStories leftSlots leftNamespace leftId leftStart leftEnd
      leftReference =>
    cases right with
    | mk rightStories rightSlots rightNamespace rightId rightStart rightEnd
        rightReference =>
      simp only [TypedMarkerScanInputObservationalEqV7] at hInput
      rcases hInput with
        ⟨hNamespace, hId, hStart, hEnd, hReference, _⟩
      cases hNamespace
      cases hId
      cases hStart
      cases hEnd
      cases hReference
      cases event <;> rfl

def scanTypedMarkerEventV7 (input : TypedMarkerScanInput)
    (sourceSetOrdinal sourceEventOrdinal : Nat)
    (state : TypedMarkerScanState) (event : TypedXmlEvent) :
    TypedMarkerScanState :=
  if state.crossing.isSome then state
  else match typedMarkerCandidateV7 input event with
  | none => state
  | some (kind, rawId) =>
    let kindOrdinal := typedMarkerKindCount kind state
    let canonicalId := rawId.bind parseTypedDecimalId
    let occurrence : TypedMarkerOccurrence := {
      kind
      story := typedMarkerStoryAt input sourceSetOrdinal
      sourceSetOrdinal
      sourceEventOrdinal
      markerOccurrenceOrdinal := state.markerOccurrences
      kindOccurrenceOrdinal := kindOrdinal
      rawId
      canonicalId }
    if kind == .reference && kindOrdinal == 4096 then
      { state with crossing := Option.some <|
          .referenceLimit sourceSetOrdinal sourceEventOrdinal kindOrdinal }
    else if kind == .rangeStart && kindOrdinal == 4096 then
      { state with crossing := Option.some <|
          .rangeStartLimit sourceSetOrdinal sourceEventOrdinal kindOrdinal }
    else if kind == .rangeEnd && kindOrdinal == 4096 then
      { state with crossing := Option.some <|
          .rangeEndLimit sourceSetOrdinal sourceEventOrdinal kindOrdinal }
    else
      let referenceOccurrences := state.referenceOccurrences +
        (if kind == .reference then 1 else 0)
      let rangeStartOccurrences := state.rangeStartOccurrences +
        (if kind == .rangeStart then 1 else 0)
      let rangeEndOccurrences := state.rangeEndOccurrences +
        (if kind == .rangeEnd then 1 else 0)
      match canonicalId with
      | some canonical =>
        match typedCanonicalIdTrieAssociation? state.canonicalIdTrie canonical with
        | some association =>
            { state with
              occurrences := occurrence :: state.occurrences
              canonicalIdTrie := typedCanonicalIdTrieSet state.canonicalIdTrie
                canonical (updateTypedMarkerAssociationV7 association occurrence)
              referenceOccurrences
              rangeStartOccurrences
              rangeEndOccurrences
              markerOccurrences := state.markerOccurrences + 1 }
        | none =>
          if state.canonicalIds.length == 4096 then
            let crossing := TypedMarkerScanCrossing.uniqueIdLimit kind
              sourceSetOrdinal sourceEventOrdinal kindOrdinal canonical
            { state with crossing := some crossing }
          else
            { state with
              occurrences := occurrence :: state.occurrences
              canonicalIds := canonical :: state.canonicalIds
              canonicalIdTrie := typedCanonicalIdTrieSet state.canonicalIdTrie
                canonical (updateTypedMarkerAssociationV7 {} occurrence)
              referenceOccurrences
              rangeStartOccurrences
              rangeEndOccurrences
              markerOccurrences := state.markerOccurrences + 1 }
      | none =>
        { state with
          occurrences := occurrence :: state.occurrences
          referenceOccurrences
          rangeStartOccurrences
          rangeEndOccurrences
          markerOccurrences := state.markerOccurrences + 1 }

theorem scan_typed_marker_event_v7_input_observational_ext
    (left right : TypedMarkerScanInput)
    (hInput : TypedMarkerScanInputObservationalEqV7 left right)
    (sourceSetOrdinal sourceEventOrdinal : Nat)
    (state : TypedMarkerScanState) (event : TypedXmlEvent) :
    scanTypedMarkerEventV7 left sourceSetOrdinal sourceEventOrdinal
        state event =
      scanTypedMarkerEventV7 right sourceSetOrdinal sourceEventOrdinal
        state event := by
  unfold scanTypedMarkerEventV7
  rw [typed_marker_candidate_v7_input_observational_ext left right hInput event,
    hInput.2.2.2.2.2 sourceSetOrdinal]

def scanTypedStoryEventsV7 (input : TypedMarkerScanInput)
    (sourceSetOrdinal : Nat) : Nat → Nat → TypedMarkerScanState →
    List TypedXmlEvent → TypedMarkerScanState
  | _, 0, state, _ => state
  | _, _, state, [] => state
  | eventOrdinal, fuel + 1, state, event :: rest =>
      if state.crossing.isSome then state
      else
        let afterEvent := scanTypedMarkerEventV7 input sourceSetOrdinal
          eventOrdinal { state with
            processedEventCount := state.processedEventCount + 1 } event
        if afterEvent.crossing.isSome then afterEvent
        else scanTypedStoryEventsV7 input sourceSetOrdinal
          (eventOrdinal + 1) fuel afterEvent rest

theorem scan_typed_story_events_v7_input_observational_ext
    (left right : TypedMarkerScanInput)
    (hInput : TypedMarkerScanInputObservationalEqV7 left right)
    (sourceSetOrdinal : Nat) :
    ∀ eventOrdinal fuel state events,
      scanTypedStoryEventsV7 left sourceSetOrdinal eventOrdinal fuel
          state events =
        scanTypedStoryEventsV7 right sourceSetOrdinal eventOrdinal fuel
          state events
  | _, 0, _, _ => rfl
  | _, _ + 1, _, [] => rfl
  | eventOrdinal, fuel + 1, state, event :: rest => by
      unfold scanTypedStoryEventsV7
      by_cases hStopped : state.crossing.isSome = true
      · simp only [hStopped, if_true]
      · simp only [hStopped]
        rw [scan_typed_marker_event_v7_input_observational_ext
          left right hInput]
        by_cases hAfter :
            (scanTypedMarkerEventV7 right sourceSetOrdinal eventOrdinal
              { state with
                processedEventCount := state.processedEventCount + 1 }
              event).crossing.isSome = true
        · simp only [hAfter, if_true]
        · simp only [hAfter]
          exact scan_typed_story_events_v7_input_observational_ext
            left right hInput sourceSetOrdinal
            (eventOrdinal + 1) fuel _ rest

def scanTypedStoriesV7 (input : TypedMarkerScanInput) :
    Nat → Nat → TypedMarkerScanState → List TypedStorySource → TypedMarkerScanState
  | _, 0, state, _ => state
  | _, _, state, [] => state
  | sourceOrdinal, fuel + 1, state, story :: rest =>
      if state.crossing.isSome then state
      else
        let afterStory := scanTypedStoryEventsV7 input sourceOrdinal 0
          (story.parsed.events.length + 1)
          { state with processedStoryCount := state.processedStoryCount + 1 }
          story.parsed.events
        if afterStory.crossing.isSome then afterStory
        else scanTypedStoriesV7 input (sourceOrdinal + 1) fuel afterStory rest

theorem scan_typed_stories_v7_input_observational_ext
    (left right : TypedMarkerScanInput)
    (hInput : TypedMarkerScanInputObservationalEqV7 left right) :
    ∀ sourceOrdinal fuel state stories,
      scanTypedStoriesV7 left sourceOrdinal fuel state stories =
        scanTypedStoriesV7 right sourceOrdinal fuel state stories
  | _, 0, _, _ => rfl
  | _, _ + 1, _, [] => rfl
  | sourceOrdinal, fuel + 1, state, story :: rest => by
      unfold scanTypedStoriesV7
      by_cases hStopped : state.crossing.isSome = true
      · simp only [hStopped, if_true]
      · simp only [hStopped]
        rw [scan_typed_story_events_v7_input_observational_ext
          left right hInput]
        by_cases hAfter :
            (scanTypedStoryEventsV7 right sourceOrdinal 0
              (story.parsed.events.length + 1)
              { state with
                processedStoryCount := state.processedStoryCount + 1 }
              story.parsed.events).crossing.isSome = true
        · simp only [hAfter, if_true]
        · simp only [hAfter]
          exact scan_typed_stories_v7_input_observational_ext
            left right hInput (sourceOrdinal + 1) fuel _ rest

def scanTypedCommentMarkersV7
    (input : TypedMarkerScanInput) : TypedMarkerScanEvidence :=
  let state := scanTypedStoriesV7 input 0 (input.stories.length + 1) {} input.stories
  { inputStories := input.stories
    occurrences := state.occurrences.reverse
    canonicalIds := state.canonicalIds.reverse
    referenceOccurrences := state.referenceOccurrences
    rangeStartOccurrences := state.rangeStartOccurrences
    rangeEndOccurrences := state.rangeEndOccurrences
    processedEventCount := state.processedEventCount
    processedStoryCount := state.processedStoryCount
    crossing := state.crossing }

def retainedOrIndependentTypedMarkerScanV7
    (request : TypedRequestV7) (side : Side) : TypedMarkerScanEvidence :=
  scanTypedCommentMarkersV7 (typedMarkerScanInputV7 request side)

theorem retained_or_independent_typed_marker_scan_v7_input_stories
    (request : TypedRequestV7) (side : Side) :
    (retainedOrIndependentTypedMarkerScanV7 request side).inputStories =
      canonicalTypedCommentSourcesV7 request side := by
  rfl

theorem retained_or_independent_typed_marker_scan_v7_of_none
    (request : TypedRequestV7) (side : Side)
    (_hNone : retainedTypedMarkerScanAt request side = none) :
    retainedOrIndependentTypedMarkerScanV7 request side =
      scanTypedCommentMarkersV7 (typedMarkerScanInputV7 request side) := by
  rfl

def typedDefinitionScanInputV7
    (events : List TypedXmlEvent) : TypedScanInput := {
    wmlNamespace := typedWmlNamespace
    idLocalName := typedLiteral [105,100]
    referenceLocalName := typedLiteral []
    definitionLocalName := typedLiteral [99,111,109,109,101,110,116]
    sourceEvents := []
    definitionEvents := events
  }

def typedDefinitionsFromEventsV7 (events : List TypedXmlEvent) :
    List TypedCommentDefinition :=
  let scan := scanTypedCommentEvidence (typedDefinitionScanInputV7 events)
  scan.definitions ++ scan.nonDirectDefinitions

set_option backward.match.sparseCases false in
def typedDefinitionsV7
    (request : TypedRequestV7) (side : Side) : List TypedCommentDefinition :=
  match realizeTypedCommentV7 request side with
  | .ok (some realization) =>
      typedDefinitionsFromEventsV7 realization.retainedParsedEvents
  | _ => []

def typedOccurrencesForIdV7 (kind : TypedMarkerKind)
    (scan : TypedMarkerScanEvidence) (id : CanonicalDecimalId) :
    List TypedMarkerOccurrence :=
  scan.occurrences.filter fun occurrence =>
    occurrence.kind = kind && occurrence.canonicalId = some id

def typedDefinitionsForIdV7 (definitions : List TypedCommentDefinition)
    (id : CanonicalDecimalId) : List TypedCommentDefinition :=
  definitions.filter fun definition =>
    definition.direct && definition.canonicalId = some id

def typedIncrementDirectDefinitionCountV7
    (trie : TypedCanonicalIdTrie)
    (definition : TypedCommentDefinition) : TypedCanonicalIdTrie :=
  if definition.direct then
    match definition.canonicalId with
    | some canonical =>
        let association :=
          (typedCanonicalIdTrieAssociation? trie canonical).getD {}
        typedCanonicalIdTrieSet trie canonical
          { association with
            referenceCount := association.referenceCount + 1 }
    | none => trie
  else trie

def typedDirectDefinitionCountTrieV7
    (definitions : List TypedCommentDefinition)
    (initial : TypedCanonicalIdTrie) : TypedCanonicalIdTrie :=
  definitions.foldl typedIncrementDirectDefinitionCountV7 initial

def typedDirectDefinitionCountV7 (trie : TypedCanonicalIdTrie)
    (id : CanonicalDecimalId) : Nat :=
  (typedCanonicalIdTrieAssociation? trie id).map (·.referenceCount) |>.getD 0

def typedCollectDefinitionIdsV7 :
    TypedCanonicalIdTrie → List CanonicalDecimalId →
      List TypedCommentDefinition →
        List CanonicalDecimalId × TypedCanonicalIdTrie
  | seen, output, [] => (output.reverse, seen)
  | seen, output, definition :: rest =>
      match definition.canonicalId with
      | none => typedCollectDefinitionIdsV7 seen output rest
      | some canonical =>
          if typedCanonicalIdTrieHas seen canonical then
            typedCollectDefinitionIdsV7 seen output rest
          else
            typedCollectDefinitionIdsV7
              (typedCanonicalIdTrieSet seen canonical {}) (canonical :: output) rest

def typedAppendUnseenMarkerIdsV7 :
    TypedCanonicalIdTrie → List CanonicalDecimalId →
      List CanonicalDecimalId → List CanonicalDecimalId
  | _, output, [] => output.reverse
  | seen, output, canonical :: rest =>
      if typedCanonicalIdTrieHas seen canonical then
        typedAppendUnseenMarkerIdsV7 seen output rest
      else
        typedAppendUnseenMarkerIdsV7
          (typedCanonicalIdTrieSet seen canonical {}) (canonical :: output) rest

def typedSourceOccurrencesForIdV7 (scan : TypedMarkerScanEvidence)
    (id : CanonicalDecimalId) : List TypedMarkerOccurrence :=
  scan.occurrences.filter fun occurrence => occurrence.canonicalId = some id

def TypedCommentIdTopologyOf
    (definitions : List TypedCommentDefinition) (scan : TypedMarkerScanEvidence)
    (id : CanonicalDecimalId) : Prop :=
  let references := typedOccurrencesForIdV7 .reference scan id
  let starts := typedOccurrencesForIdV7 .rangeStart scan id
  let ends := typedOccurrencesForIdV7 .rangeEnd scan id
  (typedDefinitionsForIdV7 definitions id).length = 1 ∧
  match references, starts, ends with
  | [_], [], [] => True
  | [reference], [start], [finish] =>
      start.story = finish.story ∧ finish.story = reference.story ∧
      start.sourceEventOrdinal < finish.sourceEventOrdinal
  | _, _, _ => False

def typedAllCommentIdsV7 (definitions : List TypedCommentDefinition)
    (scan : TypedMarkerScanEvidence) : List CanonicalDecimalId :=
  let collected := typedCollectDefinitionIdsV7 .empty [] definitions
  collected.1 ++ typedAppendUnseenMarkerIdsV7 collected.2 [] scan.canonicalIds

set_option backward.match.sparseCases false in
def checkTypedCommentIdTopologyV7
    (definitionCounts : TypedCanonicalIdTrie)
    (associations : TypedCanonicalIdTrie)
    (id : CanonicalDecimalId) : Bool :=
  typedNatEqCheck (typedDirectDefinitionCountV7 definitionCounts id) 1 &&
  match typedCanonicalIdTrieAssociation? associations id with
  | none => true
  | some association =>
    match association.referenceCount, association.rangeStartCount,
        association.rangeEndCount with
    | 1, 0, 0 => true
    | 1, 1, 1 =>
      match association.firstReference, association.firstRangeStart,
          association.firstRangeEnd with
      | some reference, some start, some finish =>
      (match start.story.kind, finish.story.kind with
       | .main, .main | .header, .header | .footer, .footer
       | .footnotes, .footnotes | .endnotes, .endnotes => true
       | _, _ => false) &&
      typedNatEqCheck start.story.physicalStoryOrdinal
        finish.story.physicalStoryOrdinal &&
      (match finish.story.kind, reference.story.kind with
       | .main, .main | .header, .header | .footer, .footer
       | .footnotes, .footnotes | .endnotes, .endnotes => true
       | _, _ => false) &&
      typedNatEqCheck finish.story.physicalStoryOrdinal
        reference.story.physicalStoryOrdinal &&
      typedNatLtCheck start.sourceEventOrdinal finish.sourceEventOrdinal
      | _, _, _ => false
    | _, _, _ => false

def checkTypedCommentIdsTopologyV7
    (definitionCounts : TypedCanonicalIdTrie)
    (associations : TypedCanonicalIdTrie) :
      List CanonicalDecimalId → Bool
  | [] => true
  | id :: rest =>
      checkTypedCommentIdTopologyV7 definitionCounts associations id &&
        checkTypedCommentIdsTopologyV7 definitionCounts associations rest

def TypedPackageCommentRangeIntegrity
    (definitions : List TypedCommentDefinition)
    (scan : TypedMarkerScanEvidence) : Prop :=
  scan.crossing.isNone = true ∧
  checkTypedCommentIdsTopologyV7
    (typedDirectDefinitionCountTrieV7 definitions .empty)
    (typedMarkerAssociationTrieFromOccurrencesV7 .empty scan.occurrences)
    (typedAllCommentIdsV7 definitions scan) = true

def checkTypedPackageCommentRangeIntegrity
    (definitions : List TypedCommentDefinition)
    (scan : TypedMarkerScanEvidence) : Bool :=
  scan.crossing.isNone &&
  checkTypedCommentIdsTopologyV7
    (typedDirectDefinitionCountTrieV7 definitions .empty)
    (typedMarkerAssociationTrieFromOccurrencesV7 .empty scan.occurrences)
    (typedAllCommentIdsV7 definitions scan)

inductive TypedSideCommentStatusV7
  | passed | failed | notEvaluated
  deriving DecidableEq

def typedSideCommentPassedV7 : TypedSideCommentStatusV7 → Bool
  | .passed => true
  | .failed | .notEvaluated => false

def typedSideCommentNotEvaluatedV7 : TypedSideCommentStatusV7 → Bool
  | .notEvaluated => true
  | .passed | .failed => false

set_option backward.match.sparseCases false in
def typedPriorSourceAdmittedV7 : TypedPriorSourceAdmission → Bool
  | .admitted => true
  | _ => false

def typedSelectionResolvedV7 :
    Except TypedCommentSelectionFailure
      (Option TypedSelectedCommentIdentity) → Bool
  | .ok _ => true
  | .error _ => false

def typedRealizationResolvedV7 :
    Except TypedCommentRealizationFailure
      (Option TypedCommentRealization) → Bool
  | .ok _ => true
  | .error _ => false

structure TypedSideCommentEvaluationV7 where
  side : Side
  status : TypedSideCommentStatusV7
  partPresent : Bool
  selection :
    Except TypedCommentSelectionFailure (Option TypedSelectedCommentIdentity)
  realization :
    Except TypedCommentRealizationFailure (Option TypedCommentRealization)
  sources : List TypedStorySource
  markerScan : TypedMarkerScanEvidence
  definitions : List TypedCommentDefinition

def emptyTypedMarkerScanEvidenceV7 : TypedMarkerScanEvidence :=
  { inputStories := [], occurrences := [], canonicalIds := []
    referenceOccurrences := 0, rangeStartOccurrences := 0
    rangeEndOccurrences := 0, processedEventCount := 0
    processedStoryCount := 0, crossing := none }

def globallyStoppedTypedCommentEvaluationV7
    (side : Side) : TypedSideCommentEvaluationV7 :=
  { side, status := .notEvaluated, partPresent := false, selection := .ok none
    realization := .ok none, sources := []
    markerScan := emptyTypedMarkerScanEvidenceV7, definitions := [] }

def typedCommentPrerequisitesV7
    (request : TypedRequestV7) (side : Side) : Bool :=
  let pkg := typedPackageAt request side
  let selection := selectTypedCommentV7 pkg
  let realization := realizeTypedCommentV7 request side
  let sources := canonicalTypedCommentSourcesV7 request side
  let markerScan := retainedOrIndependentTypedMarkerScanV7 request side
  let selectionMarkerCompatible := match selection with
    | .ok none => markerScan.occurrences.isEmpty
    | .ok (some _) => true
    | .error _ => false
  typedPriorSourceAdmittedV7 pkg.priorSourceAdmission &&
    typedSelectionResolvedV7 selection &&
    typedRealizationResolvedV7 realization &&
    selectionMarkerCompatible &&
    markerScan.crossing.isNone &&
    typedNatLeCheck sources.length 387

set_option backward.match.sparseCases false in
def evaluateTypedCommentSideV7
    (request : TypedRequestV7) (side : Side) : TypedSideCommentEvaluationV7 :=
  let pkg := typedPackageAt request side
  let inheritedEvaluation := evaluateTypedCommentSide side pkg
  let selection := selectTypedCommentV7 pkg
  let realization := realizeTypedCommentV7 request side
  let sources := canonicalTypedCommentSourcesV7 request side
  let markerScan := retainedOrIndependentTypedMarkerScanV7 request side
  let definitions := typedDefinitionsV7 request side
  let incomplete := !typedCommentPrerequisitesV7 request side
  let status := if incomplete then .notEvaluated
    else if inheritedEvaluation.status == .failed ||
        !checkTypedPackageCommentRangeIntegrity definitions markerScan then
      .failed
    else .passed
  { side, status, partPresent := inheritedEvaluation.partPresent
    selection, realization
    sources := if incomplete then [] else sources
    markerScan := if incomplete then emptyTypedMarkerScanEvidenceV7 else markerScan
    definitions := if incomplete then [] else definitions }

abbrev TypedProtocolV7Response := TypedProtocolV6Response

def typedRequestV6OfV7 (request : TypedRequestV7) : TypedRequestV6 :=
  { original := request.original, revised := request.revised
    compared := request.compared, inherited := request.inherited }

def typedCommentInventoryOfEvaluationV7
    (evaluation : TypedSideCommentEvaluationV7) : TypedJson :=
  let side := evaluation.side
  let scan := evaluation.markerScan
  let definitions := evaluation.definitions.filter fun definition =>
    definition.direct && definition.canonicalId.isSome
  let sourceIds := scan.canonicalIds
  let unreferenced := definitions.filter fun definition =>
    match definition.canonicalId with
    | some id => !sourceIds.contains id
    | none => false
  let zero := typedSideCommentNotEvaluatedV7 evaluation.status
  .object
    [ (key [100,101,102,105,110,105,116,105,111,110,115],
        .nat (if zero then 0 else definitions.length))
    , (key [110,111,110,68,105,114,101,99,116,68,101,102,105,110,105,116,105,111,110,115],
        .nat (if zero then 0 else
          evaluation.definitions.filter (fun definition => !definition.direct) |>.length))
    , (key [114,97,110,103,101,69,110,100,79,99,99,117,114,114,101,110,99,101,115],
        .nat (if zero then 0 else scan.rangeEndOccurrences))
    , (key [114,97,110,103,101,83,116,97,114,116,79,99,99,117,114,114,101,110,99,101,115],
        .nat (if zero then 0 else scan.rangeStartOccurrences))
    , (key [114,101,102,101,114,101,110,99,101,79,99,99,117,114,114,101,110,99,101,115],
        .nat (if zero then 0 else scan.referenceOccurrences))
    , (key [114,101,108,97,116,105,111,110,115,104,105,112],
        match evaluation.selection with
        | .ok (some selected) => typedSelectedIdentityJson selected
        | .ok none | .error _ => .null)
    , (key [115,105,100,101], typedSideName side)
    , (key [115,116,97,116,117,115], match evaluation.status with
        | .passed => typedAscii [112,97,115,115,101,100]
        | .failed => typedAscii [102,97,105,108,101,100]
        | .notEvaluated =>
          typedAscii [110,111,116,95,101,118,97,108,117,97,116,101,100])
    , (key [117,110,105,113,117,101,82,101,102,101,114,101,110,99,101,73,100,115],
        .nat (if zero then 0 else scan.canonicalIds.length))
    , (key [117,110,114,101,102,101,114,101,110,99,101,100,68,101,102,105,110,105,116,105,111,110,115],
        .nat (if zero then 0 else unreferenced.length))
    ]

def typedCommentInventoryV7 (request : TypedRequestV7) (side : Side) :
    TypedJson :=
  typedCommentInventoryOfEvaluationV7
    (evaluateTypedCommentSideV7 request side)

inductive TypedTopologyIssueCodeV7
  | referenceDuplicate | referenceMissing
  | rangeStartDuplicate | rangeEndDuplicate
  | rangeStartOrphaned | rangeEndOrphaned
  | rangeCrossStory | rangeReversed

def typedTopologyIssueCodeV7 : TypedTopologyIssueCodeV7 → TypedJson
  | .referenceDuplicate =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,68,85,80,76,73,67,65,84,69]
  | .referenceMissing =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,77,73,83,83,73,78,71]
  | .rangeStartDuplicate =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,83,84,65,82,84,95,68,85,80,76,73,67,65,84,69]
  | .rangeEndDuplicate =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,69,78,68,95,68,85,80,76,73,67,65,84,69]
  | .rangeStartOrphaned =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,83,84,65,82,84,95,79,82,80,72,65,78,69,68]
  | .rangeEndOrphaned =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,69,78,68,95,79,82,80,72,65,78,69,68]
  | .rangeCrossStory =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,67,82,79,83,83,95,83,84,79,82,89]
  | .rangeReversed =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,82,69,86,69,82,83,69,68]

def typedTopologyIssueDetailV7 : TypedTopologyIssueCodeV7 → TypedJson
  | .referenceDuplicate =>
      typedAscii [109,117,108,116,105,112,108,101,32,99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,115,32,104,97,118,101,32,116,104,101,32,115,97,109,101,32,99,97,110,111,110,105,99,97,108,32,119,58,105,100]
  | .referenceMissing =>
      typedAscii [97,32,99,111,109,109,101,110,116,32,114,97,110,103,101,32,101,110,100,112,111,105,110,116,32,104,97,115,32,110,111,32,117,110,105,113,117,101,32,99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101]
  | .rangeStartDuplicate =>
      typedAscii [109,117,108,116,105,112,108,101,32,99,111,109,109,101,110,116,32,114,97,110,103,101,32,115,116,97,114,116,115,32,104,97,118,101,32,116,104,101,32,115,97,109,101,32,99,97,110,111,110,105,99,97,108,32,119,58,105,100]
  | .rangeEndDuplicate =>
      typedAscii [109,117,108,116,105,112,108,101,32,99,111,109,109,101,110,116,32,114,97,110,103,101,32,101,110,100,115,32,104,97,118,101,32,116,104,101,32,115,97,109,101,32,99,97,110,111,110,105,99,97,108,32,119,58,105,100]
  | .rangeStartOrphaned =>
      typedAscii [116,104,101,32,83,97,102,101,45,68,79,67,88,32,112,97,105,114,101,100,45,111,114,45,112,111,105,110,116,32,112,114,111,102,105,108,101,32,114,101,106,101,99,116,115,32,97,110,32,117,110,109,97,116,99,104,101,100,32,114,97,110,103,101,32,115,116,97,114,116]
  | .rangeEndOrphaned =>
      typedAscii [116,104,101,32,83,97,102,101,45,68,79,67,88,32,112,97,105,114,101,100,45,111,114,45,112,111,105,110,116,32,112,114,111,102,105,108,101,32,114,101,106,101,99,116,115,32,97,110,32,117,110,109,97,116,99,104,101,100,32,114,97,110,103,101,32,101,110,100]
  | .rangeCrossStory =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,101,110,100,112,111,105,110,116,115,32,97,110,100,32,114,101,102,101,114,101,110,99,101,32,109,117,115,116,32,115,104,97,114,101,32,111,110,101,32,112,104,121,115,105,99,97,108,32,115,116,111,114,121]
  | .rangeReversed =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,115,116,97,114,116,32,109,117,115,116,32,112,114,101,99,101,100,101,32,105,116,115,32,101,110,100,32,105,110,32,116,104,101,32,115,97,109,101,32,112,104,121,115,105,99,97,108,32,115,116,111,114,121]

def typedMarkerSourceJsonV7 (occurrence : TypedMarkerOccurrence) : TypedJson :=
  .object
    [ (key [115,111,117,114,99,101,83,116,111,114,121],
        typedSourceKindName occurrence.story.kind)
    , (key [115,111,117,114,99,101,83,116,111,114,121,79,114,100,105,110,97,108],
        .nat occurrence.story.physicalStoryOrdinal)
    ]

def typedMarkerOrdinalSpaceV7 (kind : TypedMarkerKind) : TypedJson :=
  match kind with
  | .rangeStart => typedAscii [114,97,110,103,101,83,116,97,114,116]
  | .rangeEnd => typedAscii [114,97,110,103,101,69,110,100]
  | .reference => typedAscii [114,101,102,101,114,101,110,99,101]

def typedMarkerCrossingOccurrenceV7 (request : TypedRequestV7) (side : Side)
    (kind : TypedMarkerKind) (sourceSetOrdinal sourceEventOrdinal
      occurrenceOrdinal : Nat)
    (canonicalId : Option CanonicalDecimalId := none) :
    TypedMarkerOccurrence :=
  { kind
    story := typedMarkerStoryAt (typedMarkerScanInputV7 request side)
      sourceSetOrdinal
    sourceSetOrdinal, sourceEventOrdinal
    markerOccurrenceOrdinal := 0
    kindOccurrenceOrdinal := occurrenceOrdinal
    rawId := none, canonicalId }

def typedMarkerCrossingCodeV7 (kind : TypedMarkerKind)
    (unique : Bool) : TypedJson :=
  if unique then
    typedAscii [67,79,77,77,69,78,84,95,85,78,73,81,85,69,95,82,69,70,69,82,69,78,67,69,95,79,82,95,82,65,78,71,69,95,73,68,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  else match kind with
  | .reference =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,79,67,67,85,82,82,69,78,67,69,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .rangeStart =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,83,84,65,82,84,95,79,67,67,85,82,82,69,78,67,69,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]
  | .rangeEnd =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,69,78,68,95,79,67,67,85,82,82,69,78,67,69,95,76,73,77,73,84,95,69,88,67,69,69,68,69,68]

def typedMarkerCrossingDetailV7 (kind : TypedMarkerKind)
    (unique : Bool) : TypedJson :=
  if unique then
    typedAscii [117,110,105,113,117,101,32,99,97,110,111,110,105,99,97,108,32,99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,111,114,32,114,97,110,103,101,32,73,68,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100]
  else match kind with
  | .reference =>
      typedAscii [99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,111,99,99,117,114,114,101,110,99,101,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100]
  | .rangeStart =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,115,116,97,114,116,32,111,99,99,117,114,114,101,110,99,101,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100]
  | .rangeEnd =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,101,110,100,32,111,99,99,117,114,114,101,110,99,101,32,108,105,109,105,116,32,101,120,99,101,101,100,101,100]

def typedMarkerCrossingIssueJsonV7 (side : Side)
    (occurrence : TypedMarkerOccurrence) (unique : Bool) : TypedJson :=
  .object <| typedStableSortBy (fun left right =>
    typedByteListLess left.1.bytes right.1.bytes) <|
    [ (key [99,111,100,101], typedMarkerCrossingCodeV7 occurrence.kind unique)
    , (key [100,101,116,97,105,108],
        typedMarkerCrossingDetailV7 occurrence.kind unique)
    , (key [102,105,114,115,116,79,99,99,117,114,114,101,110,99,101,79,114,100,105,110,97,108],
        .nat occurrence.kindOccurrenceOrdinal)
    , (key [107,105,110,100], typedAscii [99,111,109,109,101,110,116,115])
    , (key [111,99,99,117,114,114,101,110,99,101,67,111,117,110,116], .nat 1)
    , (key [111,114,100,105,110,97,108,83,112,97,99,101],
        typedMarkerOrdinalSpaceV7 occurrence.kind)
    , (key [115,105,100,101], typedSideName side)
    , (key [115,111,117,114,99,101], typedMarkerSourceJsonV7 occurrence)
    , (key [115,111,117,114,99,101,69,118,101,110,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceEventOrdinal)
    , (key [115,111,117,114,99,101,83,101,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceSetOrdinal) ] ++
      (if unique then
        (occurrence.canonicalId.map (fun id =>
          [(key [99,97,110,111,110,105,99,97,108,73,100],
            .bytes (typedCanonicalIdBytes id))])).getD []
       else [])

def typedMarkerCrossingIssuesV7 (request : TypedRequestV7)
    (side : Side) : List TypedJson :=
  let scan := retainedOrIndependentTypedMarkerScanV7 request side
  match scan.crossing with
  | none => []
  | some (.referenceLimit source event ordinal) =>
      [typedMarkerCrossingIssueJsonV7 side
        (typedMarkerCrossingOccurrenceV7 request side .reference
          source event ordinal) false]
  | some (.rangeStartLimit source event ordinal) =>
      [typedMarkerCrossingIssueJsonV7 side
        (typedMarkerCrossingOccurrenceV7 request side .rangeStart
          source event ordinal) false]
  | some (.rangeEndLimit source event ordinal) =>
      [typedMarkerCrossingIssueJsonV7 side
        (typedMarkerCrossingOccurrenceV7 request side .rangeEnd
          source event ordinal) false]
  | some (.uniqueIdLimit kind source event ordinal canonicalId) =>
      [typedMarkerCrossingIssueJsonV7 side
        (typedMarkerCrossingOccurrenceV7 request side kind source event ordinal
          (some canonicalId)) true]

def typedTopologyIssueJsonV7 (side : Side) (id : CanonicalDecimalId)
    (code : TypedTopologyIssueCodeV7) (occurrence : TypedMarkerOccurrence)
    (count : Nat)
    (extras : List (BoundedBytes × TypedJson) := []) : TypedJson :=
  .object <| typedStableSortBy (fun left right =>
    typedByteListLess left.1.bytes right.1.bytes) <|
    [ (key [99,97,110,111,110,105,99,97,108,73,100],
        .bytes (typedCanonicalIdBytes id))
    , (key [99,111,100,101], typedTopologyIssueCodeV7 code)
    , (key [100,101,116,97,105,108], typedTopologyIssueDetailV7 code)
    , (key [102,105,114,115,116,79,99,99,117,114,114,101,110,99,101,79,114,100,105,110,97,108],
        .nat occurrence.kindOccurrenceOrdinal)
    , (key [107,105,110,100], typedAscii [99,111,109,109,101,110,116,115])
    , (key [111,99,99,117,114,114,101,110,99,101,67,111,117,110,116],
        .nat count)
    , (key [111,114,100,105,110,97,108,83,112,97,99,101],
        typedMarkerOrdinalSpaceV7 occurrence.kind)
    , (key [115,105,100,101], typedSideName side)
    , (key [115,111,117,114,99,101], typedMarkerSourceJsonV7 occurrence)
    , (key [115,111,117,114,99,101,69,118,101,110,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceEventOrdinal)
    , (key [115,111,117,114,99,101,83,101,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceSetOrdinal)
    ] ++ extras

def typedEarlierMarkerV7 (left right : TypedMarkerOccurrence) :
    TypedMarkerOccurrence :=
  if typedNatLeCheck left.markerOccurrenceOrdinal right.markerOccurrenceOrdinal
  then left else right

def typedEarliestMarkerV7 : List TypedMarkerOccurrence →
    Option TypedMarkerOccurrence
  | [] => none
  | first :: rest => some (rest.foldl typedEarlierMarkerV7 first)

set_option backward.match.sparseCases false in
def typedSameMarkerStoryV7 (left right : TypedMarkerOccurrence) : Bool :=
  (match left.story.kind, right.story.kind with
   | .main, .main | .header, .header | .footer, .footer
   | .footnotes, .footnotes | .endnotes, .endnotes => true
   | _, _ => false) &&
  typedNatEqCheck left.story.physicalStoryOrdinal
    right.story.physicalStoryOrdinal

set_option backward.match.sparseCases false in
def typedTopologyIssueForIdV7 (side : Side)
    (associations : TypedCanonicalIdTrie) (id : CanonicalDecimalId) :
    Option TypedJson :=
  match typedCanonicalIdTrieAssociation? associations id with
  | none => none
  | some association =>
    if association.referenceCount > 1 then
      association.firstDuplicateReference.map fun occurrence =>
        typedTopologyIssueJsonV7 side id .referenceDuplicate
          occurrence (association.referenceCount - 1)
    else if association.referenceCount = 0 &&
        (association.rangeStartCount > 0 || association.rangeEndCount > 0) then
      typedEarliestMarkerV7
        (association.firstRangeStart.toList ++
          association.firstRangeEnd.toList) |>.map fun occurrence =>
        typedTopologyIssueJsonV7 side id .referenceMissing occurrence 1
    else if association.rangeStartCount > 1 then
      association.firstDuplicateRangeStart.map fun occurrence =>
        typedTopologyIssueJsonV7 side id .rangeStartDuplicate
          occurrence (association.rangeStartCount - 1)
    else if association.rangeEndCount > 1 then
      association.firstDuplicateRangeEnd.map fun occurrence =>
        typedTopologyIssueJsonV7 side id .rangeEndDuplicate
          occurrence (association.rangeEndCount - 1)
    else match association.firstRangeStart, association.firstRangeEnd with
    | some start, none =>
        some (typedTopologyIssueJsonV7 side id .rangeStartOrphaned start 1)
    | none, some finish =>
        some (typedTopologyIssueJsonV7 side id .rangeEndOrphaned finish 1)
    | some start, some finish =>
      match association.firstReference with
      | some reference =>
        let all := [start, finish, reference]
        match typedEarliestMarkerV7 all with
        | none => none
        | some first =>
          match all.find? fun occurrence =>
              !typedSameMarkerStoryV7 first occurrence with
          | some related =>
            some <| typedTopologyIssueJsonV7 side id .rangeCrossStory first 1
              [ (key [114,101,108,97,116,101,100,83,111,117,114,99,101],
                  typedMarkerSourceJsonV7 related)
              , (key [114,101,108,97,116,101,100,83,111,117,114,99,101,69,118,101,110,116,79,114,100,105,110,97,108],
                  .nat related.sourceEventOrdinal)
              , (key [114,101,108,97,116,101,100,83,111,117,114,99,101,83,101,116,79,114,100,105,110,97,108],
                  .nat related.sourceSetOrdinal) ]
          | none =>
            if typedNatLtCheck start.sourceEventOrdinal
                finish.sourceEventOrdinal then none
            else some <| typedTopologyIssueJsonV7 side id .rangeReversed
              start 1
              [ (key [114,97,110,103,101,69,110,100,69,118,101,110,116,79,114,100,105,110,97,108],
                  .nat finish.sourceEventOrdinal) ]
      | _ => none
    | _, _ => none

def typedTopologyIssuesV7 (request : TypedRequestV7) (side : Side) :
    List TypedJson :=
  let scan := retainedOrIndependentTypedMarkerScanV7 request side
  let associations :=
    typedMarkerAssociationTrieFromOccurrencesV7 .empty scan.occurrences
  scan.canonicalIds.filterMap (typedTopologyIssueForIdV7 side associations)

def typedRelationshipRequiredIssueV7 (side : Side)
    (occurrence : TypedMarkerOccurrence) : TypedJson :=
  .object
    [ (key [99,111,100,101],
        typedAscii [67,79,77,77,69,78,84,95,82,69,76,65,84,73,79,78,83,72,73,80,95,82,69,81,85,73,82,69,68])
    , (key [100,101,116,97,105,108],
        typedAscii [97,32,99,111,109,109,101,110,116,32,109,97,114,107,101,114,32,114,101,113,117,105,114,101,115,32,111,110,101,32,101,120,97,99,116,32,105,110,116,101,114,110,97,108,32,99,111,109,109,101,110,116,115,32,114,101,108,97,116,105,111,110,115,104,105,112])
    , (key [102,105,114,115,116,79,99,99,117,114,114,101,110,99,101,79,114,100,105,110,97,108],
        .nat 0)
    , (key [107,105,110,100], typedAscii [99,111,109,109,101,110,116,115])
    , (key [111,99,99,117,114,114,101,110,99,101,67,111,117,110,116], .nat 1)
    , (key [111,114,100,105,110,97,108,83,112,97,99,101],
        typedMarkerOrdinalSpaceV7 occurrence.kind)
    , (key [115,105,100,101], typedSideName side)
    , (key [115,111,117,114,99,101], typedMarkerSourceJsonV7 occurrence)
    , (key [115,111,117,114,99,101,69,118,101,110,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceEventOrdinal)
    , (key [115,111,117,114,99,101,83,101,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceSetOrdinal)
    ]

def typedRelationshipRequiredIssuesV7
    (request : TypedRequestV7) (side : Side) : List TypedJson :=
  match selectTypedCommentV7 (typedPackageAt request side) with
  | .ok none =>
    match (retainedOrIndependentTypedMarkerScanV7 request side).occurrences with
    | first :: _ => [typedRelationshipRequiredIssueV7 side first]
    | [] => []
  | .ok (some _) | .error _ => []

def typedMalformedMarkerCodeV7 (kind : TypedMarkerKind)
    (rawId : Option BoundedBytes) : TypedJson :=
  let suffix := match rawId with
    | none => 0
    | some raw => if raw.bytes.length > 64 then 1 else 2
  match kind, suffix with
  | .rangeStart, 0 =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,83,84,65,82,84,95,73,68,95,77,73,83,83,73,78,71]
  | .rangeStart, 1 =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,83,84,65,82,84,95,73,68,95,84,79,79,95,76,79,78,71]
  | .rangeStart, _ =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,83,84,65,82,84,95,73,68,95,77,65,76,70,79,82,77,69,68]
  | .rangeEnd, 0 =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,69,78,68,95,73,68,95,77,73,83,83,73,78,71]
  | .rangeEnd, 1 =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,69,78,68,95,73,68,95,84,79,79,95,76,79,78,71]
  | .rangeEnd, _ =>
      typedAscii [67,79,77,77,69,78,84,95,82,65,78,71,69,95,69,78,68,95,73,68,95,77,65,76,70,79,82,77,69,68]
  | .reference, 0 =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,73,68,95,77,73,83,83,73,78,71]
  | .reference, 1 =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,73,68,95,84,79,79,95,76,79,78,71]
  | .reference, _ =>
      typedAscii [67,79,77,77,69,78,84,95,82,69,70,69,82,69,78,67,69,95,73,68,95,77,65,76,70,79,82,77,69,68]

def typedMalformedMarkerDetailV7 (kind : TypedMarkerKind)
    (rawId : Option BoundedBytes) : TypedJson :=
  let suffix := match rawId with
    | none => 0
    | some raw => if raw.bytes.length > 64 then 1 else 2
  match kind, suffix with
  | .rangeStart, 0 =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,115,116,97,114,116,32,104,97,115,32,110,111,32,119,58,105,100]
  | .rangeStart, 1 =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,115,116,97,114,116,32,119,58,105,100,32,101,120,99,101,101,100,115,32,54,52,32,85,84,70,45,56,32,98,121,116,101,115]
  | .rangeStart, _ =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,115,116,97,114,116,32,119,58,105,100,32,105,115,32,110,111,116,32,97,110,32,83,84,95,68,101,99,105,109,97,108,78,117,109,98,101,114]
  | .rangeEnd, 0 =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,101,110,100,32,104,97,115,32,110,111,32,119,58,105,100]
  | .rangeEnd, 1 =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,101,110,100,32,119,58,105,100,32,101,120,99,101,101,100,115,32,54,52,32,85,84,70,45,56,32,98,121,116,101,115]
  | .rangeEnd, _ =>
      typedAscii [99,111,109,109,101,110,116,32,114,97,110,103,101,32,101,110,100,32,119,58,105,100,32,105,115,32,110,111,116,32,97,110,32,83,84,95,68,101,99,105,109,97,108,78,117,109,98,101,114]
  | .reference, 0 =>
      typedAscii [99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,104,97,115,32,110,111,32,119,58,105,100]
  | .reference, 1 =>
      typedAscii [99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,119,58,105,100,32,101,120,99,101,101,100,115,32,54,52,32,85,84,70,45,56,32,98,121,116,101,115]
  | .reference, _ =>
      typedAscii [99,111,109,109,101,110,116,32,114,101,102,101,114,101,110,99,101,32,119,58,105,100,32,105,115,32,110,111,116,32,97,110,32,83,84,95,68,101,99,105,109,97,108,78,117,109,98,101,114]

def typedMalformedMarkerIssueV7 (side : Side)
    (occurrence : TypedMarkerOccurrence) : TypedJson :=
  let rawField := match occurrence.rawId with
    | none => []
    | some raw =>
      if raw.bytes.length > 64 then
        [(key [114,97,119,73,100,66,121,116,101,76,101,110,103,116,104],
          .nat raw.bytes.length)]
      else [(key [114,97,119,73,100], .bytes raw)]
  .object <| typedStableSortBy (fun left right =>
    typedByteListLess left.1.bytes right.1.bytes) <|
    [ (key [99,111,100,101],
        typedMalformedMarkerCodeV7 occurrence.kind occurrence.rawId)
    , (key [100,101,116,97,105,108],
        typedMalformedMarkerDetailV7 occurrence.kind occurrence.rawId)
    , (key [102,105,114,115,116,79,99,99,117,114,114,101,110,99,101,79,114,100,105,110,97,108],
        .nat occurrence.kindOccurrenceOrdinal)
    , (key [107,105,110,100], typedAscii [99,111,109,109,101,110,116,115])
    , (key [111,99,99,117,114,114,101,110,99,101,67,111,117,110,116], .nat 1)
    , (key [111,114,100,105,110,97,108,83,112,97,99,101],
        typedMarkerOrdinalSpaceV7 occurrence.kind)
    , (key [115,105,100,101], typedSideName side)
    , (key [115,111,117,114,99,101], typedMarkerSourceJsonV7 occurrence)
    , (key [115,111,117,114,99,101,69,118,101,110,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceEventOrdinal)
    , (key [115,111,117,114,99,101,83,101,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceSetOrdinal)
    ] ++ rawField

def typedMalformedMarkerIssuesV7
    (evaluation : TypedSideCommentEvaluationV7) : List TypedJson :=
  evaluation.markerScan.occurrences.filterMap fun occurrence =>
    if occurrence.canonicalId.isSome then none
    else some (typedMalformedMarkerIssueV7 evaluation.side occurrence)

def typedMarkerDefinitionMissingIssueV7 (side : Side)
    (id : CanonicalDecimalId) (occurrence : TypedMarkerOccurrence) : TypedJson :=
  .object
    [ (key [99,97,110,111,110,105,99,97,108,73,100],
        .bytes (typedCanonicalIdBytes id))
    , (key [99,111,100,101],
        typedAscii [67,79,77,77,69,78,84,95,68,69,70,73,78,73,84,73,79,78,95,77,73,83,83,73,78,71])
    , (key [100,101,116,97,105,108],
        typedAscii [99,111,109,109,101,110,116,32,115,111,117,114,99,101,32,73,68,32,100,111,101,115,32,110,111,116,32,114,101,115,111,108,118,101,32,116,111,32,101,120,97,99,116,108,121,32,111,110,101,32,100,105,114,101,99,116,32,100,101,102,105,110,105,116,105,111,110])
    , (key [102,105,114,115,116,79,99,99,117,114,114,101,110,99,101,79,114,100,105,110,97,108],
        .nat occurrence.kindOccurrenceOrdinal)
    , (key [107,105,110,100], typedAscii [99,111,109,109,101,110,116,115])
    , (key [111,99,99,117,114,114,101,110,99,101,67,111,117,110,116], .nat 1)
    , (key [111,114,100,105,110,97,108,83,112,97,99,101],
        typedMarkerOrdinalSpaceV7 occurrence.kind)
    , (key [115,105,100,101], typedSideName side)
    , (key [115,111,117,114,99,101], typedMarkerSourceJsonV7 occurrence)
    , (key [115,111,117,114,99,101,69,118,101,110,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceEventOrdinal)
    , (key [115,111,117,114,99,101,83,101,116,79,114,100,105,110,97,108],
        .nat occurrence.sourceSetOrdinal)
    ]

def typedDefinitionMissingIssuesV7
    (request : TypedRequestV7) (side : Side) : List TypedJson :=
  match realizeTypedCommentV7 request side with
  | .ok (some _) =>
    let scan := retainedOrIndependentTypedMarkerScanV7 request side
    let definitions := typedDefinitionsV7 request side
    let definitionCounts :=
      typedDirectDefinitionCountTrieV7 definitions .empty
    let associations :=
      typedMarkerAssociationTrieFromOccurrencesV7 .empty scan.occurrences
    scan.canonicalIds.filterMap fun id =>
      if typedDirectDefinitionCountV7 definitionCounts id = 1 then none
      else
        (typedCanonicalIdTrieAssociation? associations id).bind
          fun association =>
            typedEarliestMarkerV7
              (association.firstReference.toList ++
                association.firstRangeStart.toList ++
                association.firstRangeEnd.toList) |>.map
              (typedMarkerDefinitionMissingIssueV7 side id)
  | .ok none | .error _ => []

set_option backward.match.sparseCases false in
def typedInheritedDefinitionIssuesV7
    (request : TypedRequestV7) (side : Side) : List TypedJson :=
  let pkg := typedPackageAt request side
  let evaluation := evaluateTypedCommentSide side pkg
  evaluation.issues.filterMap fun issue =>
    match issue.code with
    | .definitionIdMissing | .definitionIdMalformed | .definitionIdTooLong
    | .definitionNotDirect | .definitionDuplicate =>
        some (typedCommentIssueJson pkg issue)
    | _ => none

set_option backward.match.sparseCases false in
def typedCommentSideStoryV7
    (evaluation : TypedSideCommentEvaluationV7) : TypedJson :=
  let relationship := match evaluation.selection with
    | .ok (some selected) => typedSelectedIdentityJson selected
    | .ok none | .error _ => .null
  let status := match evaluation.status, evaluation.selection with
    | .notEvaluated, _ =>
        typedAscii [110,111,116,95,101,118,97,108,117,97,116,101,100]
    | .failed, _ => typedAscii [102,97,105,108,101,100]
    | .passed, .ok none => typedAscii [97,98,115,101,110,116]
    | .passed, _ => typedAscii [112,97,115,115,101,100]
  .object
    [ (key [112,97,114,116,80,114,101,115,101,110,116],
        .bool evaluation.partPresent)
    , (key [114,101,108,97,116,105,111,110,115,104,105,112], relationship)
    , (key [115,116,97,116,117,115], status)
    ]

def typedCommentParsedCountV7
    (evaluation : TypedSideCommentEvaluationV7) : Nat :=
  match evaluation.realization with
  | .ok (some realization) => realization.retainedParsedEvents.length
  | .ok none | .error _ => 0

def typedCommentStoryV7 (original revised compared :
    TypedSideCommentEvaluationV7) : TypedJson :=
  let evaluations := [original, revised, compared]
  let status :=
    if evaluations.any fun evaluation =>
        typedSideCommentNotEvaluatedV7 evaluation.status then
      typedAscii [110,111,116,95,101,118,97,108,117,97,116,101,100]
    else if evaluations.any fun evaluation =>
        !typedSideCommentPassedV7 evaluation.status then
      typedAscii [102,97,105,108,101,100]
    else typedAscii [112,97,115,115,101,100]
  .object
    [ (key [99,111,109,112,97,114,101,100],
        typedCommentSideStoryV7 compared)
    , (key [111,114,105,103,105,110,97,108],
        typedCommentSideStoryV7 original)
    , (key [112,97,114,115,101,100,84,111,107,101,110,67,111,117,110,116,115],
        .object
          [ (key [99,111,109,98,105,110,101,100],
              .nat (typedCommentParsedCountV7 compared))
          , (key [111,114,105,103,105,110,97,108],
              .nat (typedCommentParsedCountV7 original))
          , (key [114,101,118,105,115,101,100],
              .nat (typedCommentParsedCountV7 revised))
          ])
    , (key [114,101,118,105,115,101,100],
        typedCommentSideStoryV7 revised)
    , (key [115,116,97,116,117,115], status)
    ]

def typedProtocolResponseHasTerminalIssueV7
    (response : TypedProtocolV6Response) : Bool :=
  decide (encodeTypedJson response.commentIntegrityIssues =
      encodeTypedJson (.array [typedTerminalIssue false])) ||
  decide (encodeTypedJson response.commentIntegrityIssues =
      encodeTypedJson (.array [typedTerminalIssue true]))

def canonicalTypedResponseV7
    (request : TypedRequestV7) : TypedProtocolV7Response :=
  let base := canonicalTypedResponseV6 (typedRequestV6OfV7 request)
  let checker := typedAscii
    [115,97,102,101,45,100,111,99,120,45,108,101,97,110,45,99,111,110,
     118,101,110,116,105,111,110,97,108,45,109,97,105,110,45,99,111,109,
     109,101,110,116,45,114,97,110,103,101,45,105,110,116,101,103,114,105,
     116,121,45,99,104,101,99,107,101,114]
  let evaluatedOriginal := evaluateTypedCommentSideV7 request .original
  let original :=
    if !typedPriorSourceAdmittedV7 request.original.priorSourceAdmission then
      globallyStoppedTypedCommentEvaluationV7 .original
    else evaluatedOriginal
  let revised := if typedSideCommentNotEvaluatedV7 original.status ||
      !typedPriorSourceAdmittedV7 request.revised.priorSourceAdmission then
      globallyStoppedTypedCommentEvaluationV7 .revised
    else evaluateTypedCommentSideV7 request .revised
  let compared := if typedSideCommentNotEvaluatedV7 original.status ||
      typedSideCommentNotEvaluatedV7 revised.status ||
      !typedPriorSourceAdmittedV7 request.compared.priorSourceAdmission then
      globallyStoppedTypedCommentEvaluationV7 .compared
    else evaluateTypedCommentSideV7 request .compared
  let evaluations := [original, revised, compared]
  let passed := request.inherited.passed &&
    evaluations.all fun evaluation =>
      typedSideCommentPassedV7 evaluation.status
  let originalRelationshipIssues :=
    if typedPriorSourceAdmittedV7 request.original.priorSourceAdmission then
      typedRelationshipRequiredIssuesV7 request .original
    else []
  let revisedRelationshipIssues :=
    if typedSideCommentNotEvaluatedV7 original.status then []
    else typedRelationshipRequiredIssuesV7 request .revised
  let comparedRelationshipIssues :=
    if typedSideCommentNotEvaluatedV7 original.status ||
        typedSideCommentNotEvaluatedV7 revised.status then []
    else typedRelationshipRequiredIssuesV7 request .compared
  let relationshipIssues := originalRelationshipIssues ++
    revisedRelationshipIssues ++ comparedRelationshipIssues
  let originalCrossingIssues :=
    if typedPriorSourceAdmittedV7 request.original.priorSourceAdmission then
      typedMarkerCrossingIssuesV7 request .original
    else []
  let revisedCrossingIssues :=
    if typedSideCommentNotEvaluatedV7 original.status then []
    else typedMarkerCrossingIssuesV7 request .revised
  let comparedCrossingIssues :=
    if typedSideCommentNotEvaluatedV7 original.status ||
        typedSideCommentNotEvaluatedV7 revised.status then []
    else typedMarkerCrossingIssuesV7 request .compared
  let originalIssues := if !originalCrossingIssues.isEmpty then
      originalCrossingIssues
    else if typedSideCommentNotEvaluatedV7 original.status then []
    else typedDefinitionMissingIssuesV7 request .original ++
      typedInheritedDefinitionIssuesV7 request .original ++
      typedMalformedMarkerIssuesV7 original ++
      typedTopologyIssuesV7 request .original
  let revisedIssues := if !revisedCrossingIssues.isEmpty then
      revisedCrossingIssues
    else if typedSideCommentNotEvaluatedV7 revised.status then []
    else typedDefinitionMissingIssuesV7 request .revised ++
      typedInheritedDefinitionIssuesV7 request .revised ++
      typedMalformedMarkerIssuesV7 revised ++
      typedTopologyIssuesV7 request .revised
  let comparedIssues := if !comparedCrossingIssues.isEmpty then
      comparedCrossingIssues
    else if typedSideCommentNotEvaluatedV7 compared.status then []
    else typedDefinitionMissingIssuesV7 request .compared ++
      typedInheritedDefinitionIssuesV7 request .compared ++
      typedMalformedMarkerIssuesV7 compared ++
      typedTopologyIssuesV7 request .compared
  let semanticIssues := originalIssues ++ revisedIssues ++ comparedIssues
  let candidate := if typedProtocolResponseHasTerminalIssueV7 base then
    { base with
      commentStory := typedTerminalCommentStory
      commentInventories := .array
        [ typedCommentInventoryOfEvaluationV7
            (globallyStoppedTypedCommentEvaluationV7 .original)
        , typedCommentInventoryOfEvaluationV7
            (globallyStoppedTypedCommentEvaluationV7 .revised)
        , typedCommentInventoryOfEvaluationV7
            (globallyStoppedTypedCommentEvaluationV7 .compared) ] }
  else { base with
    passed := .bool passed
    commentStory := typedCommentStoryV7 original revised compared
    commentInventories := .array
      [ typedCommentInventoryOfEvaluationV7 original
      , typedCommentInventoryOfEvaluationV7 revised
      , typedCommentInventoryOfEvaluationV7 compared ]
    commentIntegrityIssues := .array <|
      if !relationshipIssues.isEmpty then relationshipIssues
      else if !semanticIssues.isEmpty then semanticIssues
      else typedJsonArrayValues base.commentIntegrityIssues }
  { candidate with protocolVersion := .nat 7, checker }

def independentProtocolV7Projection :
    TypedProtocolV7Response → List UInt8 :=
  independentProtocolV6Projection

def TypedRequestBoundPackageOf (request : TypedRequestV7) (side : Side)
    (pkg : TypedPackageView) : Prop :=
  pkg = typedPackageAt request side

def TypedSelectionToRealizationV7Of (request : TypedRequestV7) (side : Side)
    (evaluation : TypedSideCommentEvaluationV7) : Prop :=
  evaluation = evaluateTypedCommentSideV7 request side ∧
  evaluation.selection = selectTypedCommentV7 (typedPackageAt request side) ∧
  evaluation.realization = realizeTypedCommentV7 request side

def TypedCompleteCommentSourceSetV7Of (request : TypedRequestV7) (side : Side)
    (sources : List TypedStorySource) : Prop :=
  sources = canonicalTypedCommentSourcesV7 request side ∧
  (evaluateTypedCommentSideV7 request side).status ≠ .notEvaluated ∧
  (typedMarkerScanInputV7 request side).stories = sources

def TypedCommentMarkerScanOf (request : TypedRequestV7) (side : Side)
    (evidence : TypedMarkerScanEvidence) : Prop :=
  evidence = retainedOrIndependentTypedMarkerScanV7 request side ∧
  evidence.inputStories = canonicalTypedCommentSourcesV7 request side

def TypedIncompleteCommentRangeZeroOf (side : Side)
    (evaluation : TypedSideCommentEvaluationV7) : Prop :=
  evaluation.side = side ∧ evaluation.status = .notEvaluated ∧
  evaluation.sources = [] ∧
  evaluation.markerScan = emptyTypedMarkerScanEvidenceV7 ∧
  evaluation.definitions = []

def TypedCommentRangeAggregatePassOf (request : TypedRequestV7)
    (response : TypedProtocolV7Response) : Prop :=
  response = canonicalTypedResponseV7 request ∧ response.protocolVersion = .nat 7 ∧
  TypedCommentAggregatePassOf (typedRequestV6OfV7 request)
    (canonicalTypedResponseV6 (typedRequestV6OfV7 request)) ∧
  ∀ side,
    TypedRequestBoundPackageOf request side (typedPackageAt request side) ∧
    TypedSelectionToRealizationV7Of request side
      (evaluateTypedCommentSideV7 request side) ∧
    (evaluateTypedCommentSideV7 request side).status = .passed ∧
    TypedCompleteCommentSourceSetV7Of request side
      (canonicalTypedCommentSourcesV7 request side) ∧
    TypedCommentMarkerScanOf request side
      (retainedOrIndependentTypedMarkerScanV7 request side) ∧
    (evaluateTypedCommentSideV7 request side).definitions =
      typedDefinitionsV7 request side ∧
    TypedPackageCommentRangeIntegrity
      (typedDefinitionsV7 request side)
      (retainedOrIndependentTypedMarkerScanV7 request side)

def typedAllCommentRangeSidesPassV7 (request : TypedRequestV7) : Bool :=
  typedSideCommentPassedV7
      (evaluateTypedCommentSideV7 request .original).status &&
    typedSideCommentPassedV7
      (evaluateTypedCommentSideV7 request .revised).status &&
    typedSideCommentPassedV7
      (evaluateTypedCommentSideV7 request .compared).status

def TypedSerializedResponseV7Of
    (response : TypedProtocolV7Response) (bytes : List UInt8) : Prop :=
  bytes = independentProtocolV7Projection response

theorem typed_comment_selector_result_v7_sound
    (request : TypedRequestV7) (side : Side) :
    TypedRequestBoundPackageOf request side (typedPackageAt request side) ∧
    TypedCommentSelectionResultOf (typedPackageAt request side)
      (selectTypedCommentV7 (typedPackageAt request side)) := by
  exact ⟨rfl, rfl⟩

theorem typed_comment_selection_to_realization_v7_sound
    (request : TypedRequestV7) (side : Side) :
    TypedSelectionToRealizationV7Of request side
      (evaluateTypedCommentSideV7 request side) := by
  exact ⟨rfl, rfl, rfl⟩

theorem typed_admitted_comment_source_set_v7_complete
    (request : TypedRequestV7) (side : Side)
    (hEvaluated :
      (evaluateTypedCommentSideV7 request side).status ≠ .notEvaluated) :
    TypedCompleteCommentSourceSetV7Of request side
      (canonicalTypedCommentSourcesV7 request side) ∧
    (typedMarkerScanInputV7 request side).stories =
      canonicalTypedCommentSourcesV7 request side := by
  exact ⟨⟨rfl, hEvaluated, rfl⟩, rfl⟩

theorem typed_comment_marker_scan_evidence_exact
    (request : TypedRequestV7) (side : Side) :
    TypedCommentMarkerScanOf request side
      (retainedOrIndependentTypedMarkerScanV7 request side) ∧
    (retainedOrIndependentTypedMarkerScanV7 request side).inputStories =
        canonicalTypedCommentSourcesV7 request side := by
  refine ⟨?_, ?_⟩
  · unfold TypedCommentMarkerScanOf
    exact ⟨rfl,
      retained_or_independent_typed_marker_scan_v7_input_stories request side⟩
  · exact retained_or_independent_typed_marker_scan_v7_input_stories request side

theorem typed_package_comment_range_integrity_sound
    (request : TypedRequestV7) (side : Side)
    (hCheck :
      checkTypedPackageCommentRangeIntegrity
        (typedDefinitionsV7 request side)
        (retainedOrIndependentTypedMarkerScanV7 request side) = true) :
    TypedPackageCommentRangeIntegrity
      (typedDefinitionsV7 request side)
      (retainedOrIndependentTypedMarkerScanV7 request side) := by
  exact bool_and_eq_true_parts _ _ hCheck

set_option backward.match.sparseCases false in
theorem typed_incomplete_comment_range_zero_evidence_sound
    (request : TypedRequestV7) (side : Side)
    (hIncomplete :
      (evaluateTypedCommentSideV7 request side).status = .notEvaluated) :
    TypedIncompleteCommentRangeZeroOf side
      (evaluateTypedCommentSideV7 request side) := by
  unfold evaluateTypedCommentSideV7 at hIncomplete
  unfold TypedIncompleteCommentRangeZeroOf
  unfold evaluateTypedCommentSideV7
  dsimp only at hIncomplete ⊢
  by_cases hPrerequisite :
      (!typedCommentPrerequisitesV7 request side) = true
  · exact ⟨rfl, if_pos hPrerequisite, if_pos hPrerequisite,
      if_pos hPrerequisite, if_pos hPrerequisite⟩
  · rw [if_neg hPrerequisite] at hIncomplete
    split at hIncomplete <;> contradiction

theorem typed_evaluated_comment_definitions_v7_exact
    (request : TypedRequestV7) (side : Side)
    (hEvaluated :
      (evaluateTypedCommentSideV7 request side).status ≠ .notEvaluated) :
    (evaluateTypedCommentSideV7 request side).definitions =
      typedDefinitionsV7 request side := by
  unfold evaluateTypedCommentSideV7 at hEvaluated ⊢
  dsimp only at hEvaluated ⊢
  by_cases hPrerequisite :
      (!typedCommentPrerequisitesV7 request side) = true
  · rw [if_pos hPrerequisite] at hEvaluated
    exact False.elim (hEvaluated rfl)
  · rw [if_neg hPrerequisite]

theorem typed_comment_side_pass_integrity_v7
    (request : TypedRequestV7) (side : Side)
    (hPassed :
      (evaluateTypedCommentSideV7 request side).status = .passed) :
    checkTypedPackageCommentRangeIntegrity
      (typedDefinitionsV7 request side)
      (retainedOrIndependentTypedMarkerScanV7 request side) = true := by
  unfold evaluateTypedCommentSideV7 at hPassed
  dsimp only at hPassed
  split at hPassed
  · contradiction
  · split at hPassed
    · contradiction
    · rename_i hStatus
      cases hCheck :
          checkTypedPackageCommentRangeIntegrity
            (typedDefinitionsV7 request side)
            (retainedOrIndependentTypedMarkerScanV7 request side) with
      | false =>
          have hImpossible :
              ((evaluateTypedCommentSide side
                  (typedPackageAt request side)).status == .failed ||
                !checkTypedPackageCommentRangeIntegrity
                  (typedDefinitionsV7 request side)
                  (retainedOrIndependentTypedMarkerScanV7 request side)) = true := by
            rw [hCheck]
            cases hInherited :
                ((evaluateTypedCommentSide side
                  (typedPackageAt request side)).status == .failed) <;> rfl
          exact False.elim (hStatus hImpossible)
      | true => rfl

theorem typed_side_comment_passed_v7_eq_true
    (status : TypedSideCommentStatusV7)
    (hPass : typedSideCommentPassedV7 status = true) :
    status = .passed := by
  cases status with
  | passed => rfl
  | failed => nomatch hPass
  | notEvaluated => nomatch hPass

theorem typed_all_comment_range_sides_pass_v7_sound
    (request : TypedRequestV7)
    (hPass : typedAllCommentRangeSidesPassV7 request = true) :
    ∀ side, (evaluateTypedCommentSideV7 request side).status = .passed := by
  intro side
  unfold typedAllCommentRangeSidesPassV7 at hPass
  have hParts := bool_and_eq_true_parts _ _ hPass
  have hEarlier := bool_and_eq_true_parts _ _ hParts.1
  cases side with
  | original =>
      exact typed_side_comment_passed_v7_eq_true _ hEarlier.1
  | revised =>
      exact typed_side_comment_passed_v7_eq_true _ hEarlier.2
  | compared =>
      exact typed_side_comment_passed_v7_eq_true _ hParts.2

theorem canonical_typed_response_v7_protocol
    (request : TypedRequestV7) :
    (canonicalTypedResponseV7 request).protocolVersion = .nat 7 := by
  change TypedJson.nat 7 = TypedJson.nat 7
  rfl

theorem typed_comment_range_aggregate_pass_sound
    (request : TypedRequestV7)
    (hPass : typedAllCommentRangeSidesPassV7 request = true) :
    let response := canonicalTypedResponseV7 request
    let bytes := independentProtocolV7Projection response
    TypedCommentRangeAggregatePassOf request response ∧
    TypedSerializedResponseV7Of response bytes := by
  dsimp only
  constructor
  · refine ⟨rfl, canonical_typed_response_v7_protocol request,
      (typed_comment_integrity_aggregate_pass_sound
        (typedRequestV6OfV7 request)).1, ?_⟩
    intro side
    have hSidePassed :=
      typed_all_comment_range_sides_pass_v7_sound request hPass side
    have hEvaluated :
        (evaluateTypedCommentSideV7 request side).status ≠ .notEvaluated := by
      intro hNotEvaluated
      rw [hSidePassed] at hNotEvaluated
      contradiction
    refine ⟨rfl, typed_comment_selection_to_realization_v7_sound request side,
      hSidePassed,
      (typed_admitted_comment_source_set_v7_complete
        request side hEvaluated).1,
      (typed_comment_marker_scan_evidence_exact request side).1,
      typed_evaluated_comment_definitions_v7_exact request side hEvaluated,
      ?_⟩
    exact typed_package_comment_range_integrity_sound request side
      (typed_comment_side_pass_integrity_v7 request side hSidePassed)
  · rfl

def typedNegativeRequestV7 : TypedRequestV7 :=
  { original := typedNegativePackageViewForSide .original
    revised := typedNegativePackageViewForSide .revised
    compared := typedNegativePackageViewForSide .compared
    inherited := typedNegativeInheritedV5 }

def typedTopologyWitnessId : CanonicalDecimalId :=
  { negative := false, digits := [55] }

def typedTopologyWitnessStory (kind : TypedSourceKind := .main)
    (ordinal : Nat := 0) : TypedPhysicalStoryIdentity :=
  { kind, physicalStoryOrdinal := ordinal }

def typedTopologyWitnessAttribute : TypedXmlAttribute :=
  { namespaceUri := typedWmlNamespace
    localName := typedLiteral [105,100]
    value := {
      bytes := ByteArray.mk #[55]
      limit := 1
      admitted := by decide } }

def typedTopologyWitnessEvent (kind : TypedMarkerKind)
    (eventOrdinal : Nat) : TypedXmlEvent :=
  let localName := match kind with
    | .rangeStart =>
        typedLiteral [99,111,109,109,101,110,116,82,97,110,103,101,83,116,97,114,116]
    | .rangeEnd =>
        typedLiteral [99,111,109,109,101,110,116,82,97,110,103,101,69,110,100]
    | .reference =>
        typedLiteral [99,111,109,109,101,110,116,82,101,102,101,114,101,110,99,101]
  .startElement typedWmlNamespace localName
    [typedTopologyWitnessAttribute] 1 true eventOrdinal

def typedTopologyDefinitionEvent : TypedXmlEvent :=
  .startElement typedWmlNamespace
    (typedLiteral [99,111,109,109,101,110,116])
    [typedTopologyWitnessAttribute] 1 false 0

def typedTopologyDefinitionParsedPart : TypedParsedPart :=
  { typedNegativeParsedPart with
    expectedRootUri := typedWmlNamespace
    expectedRootLocalName :=
      typedLiteral [99,111,109,109,101,110,116,115]
    events := [typedTopologyDefinitionEvent] }

def typedTopologyDefinitionRealization : TypedCommentRealization :=
  { typedNegativeRealization with
    retainedParsedEvents := [typedTopologyDefinitionEvent]
    parsed := typedTopologyDefinitionParsedPart }

def typedTopologyWitnessSource (side : Side) (sourceOrdinal : Nat)
    (partPath : BoundedBytes) (events : List TypedXmlEvent) :
    TypedStorySource :=
  { typedNegativeSource with
    side
    sourceOrdinal
    partPath
    parsed := { typedNegativeParsedPart with events, eventLimit := 32 } }

def typedTopologyWitnessPackage (side : Side)
    (mainEvents headerEvents : List TypedXmlEvent) : TypedPackageView :=
  let main := typedTopologyWitnessSource side 0
    (typedLiteral [119,111,114,100,47,100,111,99,117,109,101,110,116,46,120,109,108])
    mainEvents
  let headerPath :=
    typedLiteral [119,111,114,100,47,104,101,97,100,101,114,49,46,120,109,108]
  let header := typedTopologyWitnessSource side 1 headerPath headerEvents
  { typedSelectedPackageView with
    commentsRootNamespace := typedWmlNamespace
    commentsRootLocalName :=
      typedLiteral [99,111,109,109,101,110,116,115]
    realization := some typedTopologyDefinitionRealization
    mainSource := main
    headerFooterStories := if headerEvents.isEmpty then [] else [{
      physicalStoryOrdinal := 0
      kind := .header
      partPath := headerPath
      originalPartPath := headerPath
      revisedPartPath := headerPath
      comparedPartPath := headerPath
      selectingSlotOrdinals := [0]
      source := some header }] }

def typedTopologyWitnessRequest (mainEvents : List TypedXmlEvent)
    (headerEvents : List TypedXmlEvent := []) : TypedRequestV7 :=
  { typedNegativeRequestV7 with
    original := typedTopologyWitnessPackage .original mainEvents headerEvents }

def typedPointTopologyRequestV7 : TypedRequestV7 :=
  typedTopologyWitnessRequest [typedTopologyWitnessEvent .reference 0]

def typedRangeTopologyRequestV7 : TypedRequestV7 :=
  typedTopologyWitnessRequest
    [ typedTopologyWitnessEvent .rangeStart 0
    , typedTopologyWitnessEvent .rangeEnd 1
    , typedTopologyWitnessEvent .reference 2 ]

def typedDuplicateReferenceRequestV7 : TypedRequestV7 :=
  typedTopologyWitnessRequest
    [ typedTopologyWitnessEvent .reference 0
    , typedTopologyWitnessEvent .reference 1 ]

def typedOrphanEndpointRequestV7 : TypedRequestV7 :=
  typedTopologyWitnessRequest
    [ typedTopologyWitnessEvent .rangeStart 0
    , typedTopologyWitnessEvent .reference 1 ]

def typedReversedRangeRequestV7 : TypedRequestV7 :=
  typedTopologyWitnessRequest
    [ typedTopologyWitnessEvent .rangeEnd 0
    , typedTopologyWitnessEvent .rangeStart 1
    , typedTopologyWitnessEvent .reference 2 ]

def typedCrossStoryRangeRequestV7 : TypedRequestV7 :=
  typedTopologyWitnessRequest
    [ typedTopologyWitnessEvent .rangeStart 0
    , typedTopologyWitnessEvent .reference 1 ]
    [typedTopologyWitnessEvent .rangeEnd 0]

def typedTopologyWitnessDefinition : TypedCommentDefinition :=
  { occurrenceOrdinal := 0, rawId := some (typedLiteral [55])
    canonicalId := some typedTopologyWitnessId, direct := true }

def typedPointTopologyWitness : TypedMarkerScanEvidence :=
  retainedOrIndependentTypedMarkerScanV7 typedPointTopologyRequestV7 .original

def typedRangeTopologyWitness : TypedMarkerScanEvidence :=
  retainedOrIndependentTypedMarkerScanV7 typedRangeTopologyRequestV7 .original

theorem typed_point_comment_topology_witness_passes :
    checkTypedPackageCommentRangeIntegrity
      [typedTopologyWitnessDefinition] typedPointTopologyWitness = true := by decide

theorem typed_ranged_comment_topology_witness_passes :
    checkTypedPackageCommentRangeIntegrity
      [typedTopologyWitnessDefinition] typedRangeTopologyWitness = true := by decide

set_option maxRecDepth 100000 in
theorem typed_duplicate_reference_witness_rejected :
    checkTypedPackageCommentRangeIntegrity [typedTopologyWitnessDefinition]
      (retainedOrIndependentTypedMarkerScanV7
        typedDuplicateReferenceRequestV7 .original) =
      false := by decide

set_option maxRecDepth 100000 in
theorem typed_orphan_endpoint_witness_rejected :
    checkTypedPackageCommentRangeIntegrity [typedTopologyWitnessDefinition]
      (retainedOrIndependentTypedMarkerScanV7
        typedOrphanEndpointRequestV7 .original) =
      false := by decide

set_option maxRecDepth 100000 in
theorem typed_reversed_range_witness_rejected :
    checkTypedPackageCommentRangeIntegrity [typedTopologyWitnessDefinition]
      (retainedOrIndependentTypedMarkerScanV7
        typedReversedRangeRequestV7 .original) =
      false := by decide

set_option maxRecDepth 100000 in
theorem typed_cross_story_range_witness_rejected :
    checkTypedPackageCommentRangeIntegrity [typedTopologyWitnessDefinition]
      (retainedOrIndependentTypedMarkerScanV7
        typedCrossStoryRangeRequestV7 .original) =
      false := by decide

set_option maxRecDepth 100000 in
theorem typed_duplicate_reference_witness_definitions_exact :
    typedDefinitionsV7 typedDuplicateReferenceRequestV7 .original =
      [typedTopologyWitnessDefinition] := by decide

set_option maxRecDepth 100000 in
theorem typed_orphan_endpoint_witness_definitions_exact :
    typedDefinitionsV7 typedOrphanEndpointRequestV7 .original =
      [typedTopologyWitnessDefinition] := by decide

set_option maxRecDepth 100000 in
theorem typed_reversed_range_witness_definitions_exact :
    typedDefinitionsV7 typedReversedRangeRequestV7 .original =
      [typedTopologyWitnessDefinition] := by decide

set_option maxRecDepth 100000 in
theorem typed_cross_story_range_witness_definitions_exact :
    typedDefinitionsV7 typedCrossStoryRangeRequestV7 .original =
      [typedTopologyWitnessDefinition] := by decide

theorem typed_invalid_topology_witnesses_are_canonical :
    typedDefinitionsV7 typedDuplicateReferenceRequestV7 .original =
        [typedTopologyWitnessDefinition] ∧
    typedDefinitionsV7 typedOrphanEndpointRequestV7 .original =
        [typedTopologyWitnessDefinition] ∧
    typedDefinitionsV7 typedReversedRangeRequestV7 .original =
        [typedTopologyWitnessDefinition] ∧
    typedDefinitionsV7 typedCrossStoryRangeRequestV7 .original =
        [typedTopologyWitnessDefinition] ∧
    typedPointTopologyWitness.inputStories =
        canonicalTypedCommentSourcesV7 typedPointTopologyRequestV7 .original ∧
    typedRangeTopologyWitness.inputStories =
        canonicalTypedCommentSourcesV7 typedRangeTopologyRequestV7 .original ∧
    (retainedOrIndependentTypedMarkerScanV7
      typedDuplicateReferenceRequestV7 .original).inputStories =
        canonicalTypedCommentSourcesV7 typedDuplicateReferenceRequestV7 .original ∧
    (retainedOrIndependentTypedMarkerScanV7
      typedOrphanEndpointRequestV7 .original).inputStories =
        canonicalTypedCommentSourcesV7 typedOrphanEndpointRequestV7 .original ∧
    (retainedOrIndependentTypedMarkerScanV7
      typedReversedRangeRequestV7 .original).inputStories =
        canonicalTypedCommentSourcesV7 typedReversedRangeRequestV7 .original ∧
    (retainedOrIndependentTypedMarkerScanV7
      typedCrossStoryRangeRequestV7 .original).inputStories =
        canonicalTypedCommentSourcesV7 typedCrossStoryRangeRequestV7 .original := by
  exact ⟨typed_duplicate_reference_witness_definitions_exact,
    typed_orphan_endpoint_witness_definitions_exact,
    typed_reversed_range_witness_definitions_exact,
    typed_cross_story_range_witness_definitions_exact,
    retained_or_independent_typed_marker_scan_v7_input_stories _ _,
    retained_or_independent_typed_marker_scan_v7_input_stories _ _,
    retained_or_independent_typed_marker_scan_v7_input_stories _ _,
    retained_or_independent_typed_marker_scan_v7_input_stories _ _,
    retained_or_independent_typed_marker_scan_v7_input_stories _ _,
    retained_or_independent_typed_marker_scan_v7_input_stories _ _⟩

theorem typed_missing_definition_association_witness_rejected :
    checkTypedPackageCommentRangeIntegrity [] typedPointTopologyWitness = false := by decide

theorem typed_comment_range_aggregate_pass_requires_integrity
    (request : TypedRequestV7) (response : TypedProtocolV7Response)
    (hAggregate : TypedCommentRangeAggregatePassOf request response)
    (side : Side) :
    TypedPackageCommentRangeIntegrity
      (typedDefinitionsV7 request side)
      (retainedOrIndependentTypedMarkerScanV7 request side) :=
  (hAggregate.2.2.2 side).2.2.2.2.2.2

theorem typed_package_comment_range_integrity_check_true
    (definitions : List TypedCommentDefinition)
    (scan : TypedMarkerScanEvidence)
    (hIntegrity : TypedPackageCommentRangeIntegrity definitions scan) :
    checkTypedPackageCommentRangeIntegrity definitions scan = true := by
  unfold checkTypedPackageCommentRangeIntegrity
  change scan.crossing.isNone = true ∧
    checkTypedCommentIdsTopologyV7
      (typedDirectDefinitionCountTrieV7 definitions .empty)
      (typedMarkerAssociationTrieFromOccurrencesV7 .empty scan.occurrences)
      (typedAllCommentIdsV7 definitions scan) = true at hIntegrity
  rw [hIntegrity.1, hIntegrity.2]
  rfl

set_option maxRecDepth 100000 in
theorem typed_duplicate_reference_aggregate_witness_rejected
    (response : TypedProtocolV7Response) :
    ¬TypedCommentRangeAggregatePassOf
      typedDuplicateReferenceRequestV7 response := by
  intro hAggregate
  have hIntegrity :=
    typed_comment_range_aggregate_pass_requires_integrity
      typedDuplicateReferenceRequestV7 response hAggregate .original
  have hAccepted :=
    typed_package_comment_range_integrity_check_true _ _ hIntegrity
  cases typed_duplicate_reference_witness_definitions_exact
  have hRejected := typed_duplicate_reference_witness_rejected
  change checkTypedPackageCommentRangeIntegrity [typedTopologyWitnessDefinition]
    (scanTypedCommentMarkersV7
      (typedMarkerScanInputV7 typedDuplicateReferenceRequestV7 .original)) = false at hRejected
  exact Bool.false_ne_true (hRejected.symm.trans hAccepted)

set_option maxRecDepth 100000 in
theorem typed_orphan_endpoint_aggregate_witness_rejected
    (response : TypedProtocolV7Response) :
    ¬TypedCommentRangeAggregatePassOf
      typedOrphanEndpointRequestV7 response := by
  intro hAggregate
  have hIntegrity :=
    typed_comment_range_aggregate_pass_requires_integrity
      typedOrphanEndpointRequestV7 response hAggregate .original
  have hAccepted :=
    typed_package_comment_range_integrity_check_true _ _ hIntegrity
  cases typed_orphan_endpoint_witness_definitions_exact
  have hRejected := typed_orphan_endpoint_witness_rejected
  change checkTypedPackageCommentRangeIntegrity [typedTopologyWitnessDefinition]
    (scanTypedCommentMarkersV7
      (typedMarkerScanInputV7 typedOrphanEndpointRequestV7 .original)) = false at hRejected
  exact Bool.false_ne_true (hRejected.symm.trans hAccepted)

set_option maxRecDepth 100000 in
theorem typed_reversed_range_aggregate_witness_rejected
    (response : TypedProtocolV7Response) :
    ¬TypedCommentRangeAggregatePassOf
      typedReversedRangeRequestV7 response := by
  intro hAggregate
  have hIntegrity :=
    typed_comment_range_aggregate_pass_requires_integrity
      typedReversedRangeRequestV7 response hAggregate .original
  have hAccepted :=
    typed_package_comment_range_integrity_check_true _ _ hIntegrity
  cases typed_reversed_range_witness_definitions_exact
  have hRejected := typed_reversed_range_witness_rejected
  change checkTypedPackageCommentRangeIntegrity [typedTopologyWitnessDefinition]
    (scanTypedCommentMarkersV7
      (typedMarkerScanInputV7 typedReversedRangeRequestV7 .original)) = false at hRejected
  exact Bool.false_ne_true (hRejected.symm.trans hAccepted)

set_option maxRecDepth 100000 in
theorem typed_cross_story_range_aggregate_witness_rejected
    (response : TypedProtocolV7Response) :
    ¬TypedCommentRangeAggregatePassOf
      typedCrossStoryRangeRequestV7 response := by
  intro hAggregate
  have hIntegrity :=
    typed_comment_range_aggregate_pass_requires_integrity
      typedCrossStoryRangeRequestV7 response hAggregate .original
  have hAccepted :=
    typed_package_comment_range_integrity_check_true _ _ hIntegrity
  cases typed_cross_story_range_witness_definitions_exact
  have hRejected := typed_cross_story_range_witness_rejected
  change checkTypedPackageCommentRangeIntegrity [typedTopologyWitnessDefinition]
    (scanTypedCommentMarkersV7
      (typedMarkerScanInputV7 typedCrossStoryRangeRequestV7 .original)) = false at hRejected
  exact Bool.false_ne_true (hRejected.symm.trans hAccepted)

def typedInjectedMarkerEvidenceV7 : TypedMarkerScanEvidence :=
  { typedPointTopologyWitness with
    inputStories := canonicalTypedCommentSourcesV7 typedNegativeRequestV7 .original }

theorem typed_injected_marker_inventory_v7_rejected :
    ¬TypedCommentMarkerScanOf typedNegativeRequestV7 .original
      typedInjectedMarkerEvidenceV7 := by
  intro h
  have hDifferent : typedInjectedMarkerEvidenceV7 ≠
      scanTypedCommentMarkersV7
        (typedMarkerScanInputV7 typedNegativeRequestV7 .original) := by decide
  exact hDifferent h.1

theorem typed_omitted_story_v7_rejected :
    ¬TypedCompleteCommentSourceSetV7Of typedNegativeRequestV7 .original [] := by
  intro h
  have hDifferent : [] ≠
      canonicalTypedCommentSourcesV7 typedNegativeRequestV7 .original := by decide
  exact hDifferent h.1

theorem typed_copied_story_identity_v7_rejected :
    ¬TypedCompleteCommentSourceSetV7Of typedNegativeRequestV7 .original
      [typedInjectedSource] := by
  intro h
  have hDifferent : [typedInjectedSource] ≠
      canonicalTypedCommentSourcesV7 typedNegativeRequestV7 .original := by decide
  exact hDifferent h.1

def typedSubstitutedEventsRequestV7 : TypedRequestV7 :=
  { typedNegativeRequestV7 with
    original := { (typedNegativePackageViewForSide .original) with
      mainSource := { typedNegativeSource with
        parsed := typedSubstitutedParsedPart } } }

theorem typed_substituted_visited_events_v7_rejected :
    ¬TypedCompleteCommentSourceSetV7Of typedSubstitutedEventsRequestV7 .original
      (canonicalTypedCommentSourcesV7 typedNegativeRequestV7 .original) := by
  intro h
  have hDifferent : canonicalTypedCommentSourcesV7 typedNegativeRequestV7 .original ≠
      canonicalTypedCommentSourcesV7 typedSubstitutedEventsRequestV7 .original := by decide
  exact hDifferent h.1

def typedDetachedRealizationEvaluationV7 : TypedSideCommentEvaluationV7 :=
  { evaluateTypedCommentSideV7 typedNegativeRequestV7 .original with
    realization := .ok (some typedNegativeRealization) }

theorem typed_detached_selected_realization_v7_rejected :
    ¬TypedSelectionToRealizationV7Of typedNegativeRequestV7 .original
      typedDetachedRealizationEvaluationV7 := by
  intro h
  have hRealization := congrArg TypedSideCommentEvaluationV7.realization h.1
  have hCanonical :
      (evaluateTypedCommentSideV7 typedNegativeRequestV7 .original).realization =
        .ok none := by rfl
  rw [hCanonical] at hRealization
  change Except.ok (some typedNegativeRealization) = Except.ok none at hRealization
  injection hRealization with hOption
  cases hOption

def typedForgedCompleteEvaluationV7 : TypedSideCommentEvaluationV7 :=
  { evaluateTypedCommentSideV7 typedNegativeRequestV7 .original with
    status := .passed
    sources := canonicalTypedCommentSourcesV7 typedNegativeRequestV7 .original
    markerScan := typedInjectedMarkerEvidenceV7
    definitions := [typedTopologyWitnessDefinition] }

theorem typed_forged_completion_v7_rejected :
    ¬TypedSelectionToRealizationV7Of typedNegativeRequestV7 .original
      typedForgedCompleteEvaluationV7 := by
  intro h
  have hMarker := congrArg TypedSideCommentEvaluationV7.markerScan h.1
  have hCanonical :
      (evaluateTypedCommentSideV7 typedNegativeRequestV7 .original).markerScan =
        scanTypedCommentMarkersV7
          (typedMarkerScanInputV7 typedNegativeRequestV7 .original) := by rfl
  rw [hCanonical] at hMarker
  have hDifferent : typedInjectedMarkerEvidenceV7 ≠
      scanTypedCommentMarkersV7
        (typedMarkerScanInputV7 typedNegativeRequestV7 .original) := by decide
  exact hDifferent hMarker

def typedV7ProjectionWitnessResponse : TypedProtocolV7Response :=
  canonicalTypedResponseV7 typedNegativeRequestV7

set_option maxRecDepth 100000 in
theorem typed_v7_inherited_field_drift_changes_projection :
    independentProtocolV7Projection
        { typedV7ProjectionWitnessResponse with fixedStories := .array [.nat 1] } ≠
      independentProtocolV7Projection typedV7ProjectionWitnessResponse := by decide

set_option maxRecDepth 100000 in
theorem typed_v7_encoder_drift_changes_projection :
    independentProtocolV7Projection
        { typedV7ProjectionWitnessResponse with protocolVersion := .nat 6 } ≠
      independentProtocolV7Projection typedV7ProjectionWitnessResponse := by decide

end Tier2.CommentReferenceIntegrity.Typed
