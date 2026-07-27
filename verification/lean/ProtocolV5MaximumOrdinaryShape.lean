import Lean.Data.Json

namespace ProtocolV5MaximumOrdinaryShape

open Lean

def ordinaryEscapedStringBytes : Nat := 1571840
def maximumOrdinaryResponseBytes : Nat := 2619776

partial def evidenceStringBytes : Json → Nat
  | .null | .bool _ | .num _ => 0
  | .str value => (toJson value).compress.toUTF8.size
  | .arr values => values.toList.map evidenceStringBytes |>.sum
  | .obj values => values.toList.map (evidenceStringBytes ∘ Prod.snd) |>.sum

def padTo (base : String) (maximum : Nat) : StateM Nat String := fun remaining =>
  let capacity := maximum - min maximum base.toUTF8.size
  let escapedUsed := min capacity (remaining / 2)
  let afterEscaped := remaining - (escapedUsed * 2)
  let plainUsed := if afterEscaped > 0 && escapedUsed < capacity then 1 else 0
  let value :=
    base ++
      String.ofList (List.replicate escapedUsed '\\') ++
      String.ofList (List.replicate plainUsed 'x')
  (value, afterEscaped - plainUsed)

def fixedPad (base : String) (maximum : Nat) : String :=
  base ++ String.ofList (List.replicate (maximum - min maximum base.toUTF8.size) 'x')

def checks : Json :=
  Json.mkObj
    [ ("acceptPreservesFieldStructure", true)
    , ("rejectPreservesFieldStructure", true)
    , ("acceptTextMatchesRevised", true)
    , ("rejectTextMatchesOriginal", true)
    , ("combinedHasNoFldCharInsideDel", true)
    , ("combinedHasValidMoveRanges", true)
    ]

def report : Json := Json.mkObj [("passed", true), ("checks", checks)]

def mainStory : Json :=
  Json.mkObj
    [ ("name", "main")
    , ("presence", Json.mkObj
        [("original", true), ("revised", true), ("combined", true)])
    , ("parsedTokenCounts", Json.mkObj
        [("original", 1), ("revised", 1), ("combined", 1)])
    , ("report", report)
    ]

def storyKindRole (ordinal : Nat) : String × String :=
  match ordinal % 6 with
  | 0 => ("header", "first")
  | 1 => ("header", "default")
  | 2 => ("header", "even")
  | 3 => ("footer", "first")
  | 4 => ("footer", "default")
  | _ => ("footer", "even")

def pathKey (side ordinal : Nat) : Nat :=
  if side == 1 then ordinal / 256 else ordinal % 256

def paddedPath (side ordinal : Nat) : StateM Nat String :=
  pure <| fixedPad s!"word/s{side}-{pathKey side ordinal}.xml" 256

def paddedRelationshipId (side ordinal : Nat) : StateM Nat String :=
  pure <| fixedPad s!"rId-s{side}-{ordinal}" 128

def identity (side ordinal : Nat) : StateM Nat Json := do
  let relationshipId ← paddedRelationshipId side ordinal
  let normalizedPartPath ← paddedPath side ordinal
  return Json.mkObj
    [ ("relationshipId", relationshipId)
    , ("normalizedPartPath", normalizedPartPath)
    ]

def relationshipSlot (ordinal : Nat) : StateM Nat Json := do
  let kindRole := storyKindRole ordinal
  let original ← identity 0 ordinal
  let revised ← identity 1 ordinal
  let compared ← identity 2 ordinal
  return Json.mkObj
    [ ("slotOrdinal", toJson ordinal)
    , ("sectionOrdinal", toJson (ordinal / 6))
    , ("kind", kindRole.1)
    , ("role", kindRole.2)
    , ("original", original)
    , ("revised", revised)
    , ("compared", compared)
    , ("physicalStoryOrdinal", toJson ordinal)
    ]

def relationshipStory (ordinal : Nat) : StateM Nat Json := do
  let kind := (storyKindRole ordinal).1
  let originalPartPath ← paddedPath 0 ordinal
  let revisedPartPath ← paddedPath 1 ordinal
  let comparedPartPath ← paddedPath 2 ordinal
  return Json.mkObj
    [ ("physicalStoryOrdinal", ordinal)
    , ("kind", kind)
    , ("originalPartPath", originalPartPath)
    , ("revisedPartPath", revisedPartPath)
    , ("comparedPartPath", comparedPartPath)
    , ("selectingSlotOrdinals", Json.arr #[toJson ordinal])
    , ("parsedTokenCounts", Json.mkObj
        [("original", 1), ("revised", 1), ("combined", 1)])
    , ("report", report)
    ]

def mainSource : Json :=
  Json.mkObj
    [ ("sourceOrdinal", 0)
    , ("sourceStory", "main")
    , ("normalizedPartPath", "word/document.xml")
    ]

def physicalSource (side ordinal : Nat) : StateM Nat Json := do
  let path ← paddedPath side ordinal
  return Json.mkObj
    [ ("sourceOrdinal", toJson (ordinal + 1))
    , ("sourceStory", (storyKindRole ordinal).1)
    , ("physicalStoryOrdinal", toJson ordinal)
    , ("normalizedPartPath", path)
    ]

def noteIdentity (side : Nat) : Json :=
  Json.mkObj
    [ ("relationshipId", s!"rIdFootnotes{side}")
    , ("normalizedPartPath", s!"word/footnotes-{side}.xml")
    ]

def definitionStory (side : Nat) (kind : String) : Json :=
  if kind == "footnotes" then
    Json.mkObj
      [ ("kind", kind)
      , ("relationship", noteIdentity side)
      , ("partPresent", true)
      ]
  else Json.mkObj [("kind", kind), ("partPresent", false)]

def partition (sideOrdinal : Nat) (side : String) : StateM Nat Json := do
  let physical ← (List.range 384).mapM (physicalSource sideOrdinal)
  return Json.mkObj
    [ ("side", side)
    , ("status", "complete")
    , ("sources", Json.arr (mainSource :: physical).toArray)
    , ("definitionStories", Json.arr #[
        definitionStory sideOrdinal "footnotes",
        definitionStory sideOrdinal "endnotes"
      ])
    ]

def noteStory (kind : String) : Json :=
  Json.mkObj
    [ ("kind", kind)
    , ("status", "passed")
    , ("original", definitionStory 0 kind)
    , ("revised", definitionStory 1 kind)
    , ("compared", definitionStory 2 kind)
    , ("parsedTokenCounts", Json.mkObj
        [("original", 0), ("revised", 0), ("combined", 0)])
    , ("report", report)
    ]

def inventory (sideOrdinal : Nat) (side kind : String) (failed : Bool) : Json :=
  Json.mkObj <|
    ([ ("side", toJson side)
    , ("kind", toJson kind)
    , ("status", toJson (if failed then "failed" else "passed"))
    ] ++
    (if kind == "footnotes" then [("relationship", noteIdentity sideOrdinal)] else []) ++
    [ ("referenceOccurrences", 0)
    , ("uniqueReferenceIds", 0)
    , ("definitions", Json.mkObj
        [ ("user", 0)
        , ("separator", 0)
        , ("continuationSeparator", 0)
        , ("continuationNotice", 0)
        ])
    , ("forbiddenDefinitionStoryReferences", 0)
    ] : List (String × Json))

def selectionIssue : StateM Nat Json := do
  let detail ← padTo "selected relationship evidence" 256
  let relationshipId ← padTo "rId-selection" 128
  let rawTarget ← padTo "header-selection.xml" 256
  let normalizedPartPath ← padTo "word/header-selection.xml" 256
  return Json.mkObj
    [ ("code", "MISSING_TARGET_PART")
    , ("detail", detail)
    , ("side", "original")
    , ("sectionOrdinal", 0)
    , ("kind", "header")
    , ("role", "first")
    , ("relationshipId", relationshipId)
    , ("rawTarget", rawTarget)
    , ("normalizedPartPath", normalizedPartPath)
    ]

def noteIssue (ordinal : Nat) : StateM Nat Json := do
  let detail ← padTo "note relationship target is unsafe" 256
  let relationshipId := fixedPad s!"rId-issue-{ordinal}" 128
  let rawTarget ← padTo s!"issue-{ordinal}.xml" 256
  return Json.mkObj
    [ ("code", "NOTE_RELATIONSHIP_UNSAFE_TARGET")
    , ("side", "original")
    , ("kind", "footnotes")
    , ("detail", detail)
    , ("ordinalSpace", "relationship")
    , ("firstOccurrenceOrdinal", ordinal)
    , ("occurrenceCount", 1)
    , ("source", Json.mkObj
        [("sourceStory", "main"), ("sourceStoryOrdinal", 0)])
    , ("relationshipId", relationshipId)
    , ("rawTarget", rawTarget)
    ]

def responseWithPadding : StateM Nat Json := do
  let slots ← (List.range 384).mapM relationshipSlot
  let stories ← (List.range 384).mapM relationshipStory
  let selection ← selectionIssue
  let originalPartition ← partition 0 "original"
  let revisedPartition ← partition 1 "revised"
  let comparedPartition ← partition 2 "compared"
  let issues ← (List.range 510).mapM noteIssue
  return Json.mkObj
    [ ("protocolVersion", 5)
    , ("checker", "safe-docx-lean-conventional-main-note-integrity-checker")
    , ("passed", false)
    , ("fixedStories", Json.arr #[mainStory])
    , ("presenceMismatches", Json.arr #[])
    , ("fixedStoryIssues", Json.arr #[])
    , ("relationshipSlots", Json.arr slots.toArray)
    , ("relationshipStories", Json.arr stories.toArray)
    , ("selectionIssues", Json.arr #[selection])
    , ("referenceSourcePartitions", Json.arr #[
        originalPartition, revisedPartition, comparedPartition
      ])
    , ("noteStories", Json.arr #[noteStory "footnotes", noteStory "endnotes"])
    , ("noteInventories", Json.arr #[
        inventory 0 "original" "footnotes" true,
        inventory 0 "original" "endnotes" false,
        inventory 1 "revised" "footnotes" false,
        inventory 1 "revised" "endnotes" false,
        inventory 2 "compared" "footnotes" false,
        inventory 2 "compared" "endnotes" false
      ])
    , ("noteIntegrityIssues", Json.arr issues.toArray)
    ]

def run : IO Unit := do
  let (base, _) := responseWithPadding.run 0
  let baseCharge := evidenceStringBytes base
  if baseCharge > ordinaryEscapedStringBytes then
    throw (IO.userError s!"base evidence charge {baseCharge} exceeds ordinary budget")
  let needed := ordinaryEscapedStringBytes - baseCharge
  let (response, remaining) := responseWithPadding.run needed
  let charge := evidenceStringBytes response
  let bytes := response.compress.toUTF8.size
  if remaining != 0 then
    throw (IO.userError s!"maximum witness lacks {remaining} bytes of padding capacity")
  if charge != ordinaryEscapedStringBytes then
    throw (IO.userError s!"maximum witness charged {charge} escaped-string bytes")
  if bytes > maximumOrdinaryResponseBytes then
    throw (IO.userError s!"maximum witness serialized to {bytes} bytes")
  IO.println response.compress

end ProtocolV5MaximumOrdinaryShape

def main : IO Unit :=
  ProtocolV5MaximumOrdinaryShape.run
