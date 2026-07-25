import Tier2.RelationshipStorySelector

open Lean Tier2.RelationshipStorySelector

def quoteFill (beginning ending : String) (limit : Nat) : String :=
  let used := (beginning ++ ending).toUTF8.size
  beginning ++ String.ofList (List.replicate (limit - min limit used) '"') ++ ending

def checksJson : Json :=
  Json.mkObj
    [ ("acceptPreservesFieldStructure", true)
    , ("rejectPreservesFieldStructure", true)
    , ("acceptTextMatchesRevised", true)
    , ("rejectTextMatchesOriginal", true)
    , ("combinedHasNoFldCharInsideDel", true)
    , ("combinedHasValidMoveRanges", true)
    ]

def passingReportJson : Json :=
  Json.mkObj [("passed", true), ("checks", checksJson)]

def countsJson : Json :=
  Json.mkObj [("original", 0), ("revised", 0), ("combined", 0)]

def mainStoryJson : Json :=
  Json.mkObj
    [ ("name", "main")
    , ("presence", Json.mkObj [("original", true), ("revised", true), ("combined", true)])
    , ("parsedTokenCounts", countsJson)
    , ("report", passingReportJson)
    ]

def kindForOrdinal (ordinal : Nat) : StoryKind :=
  if ordinal % 6 < 3 then .header else .footer

def roleForOrdinal (ordinal : Nat) : StoryRole :=
  match ordinal % 3 with
  | 0 => .first
  | 1 => .default
  | _ => .even

def distinctPaths (ordinal : Nat) : String × String × String :=
  let originalSuffix := s!"o{ordinal % 256}"
  let revisedSuffix := s!"r{ordinal / 256}"
  let comparedSuffix := "c0"
  (quoteFill "word/h" originalSuffix 256,
   quoteFill "word/h" revisedSuffix 256,
   quoteFill "word/h" comparedSuffix 256)

def sharedPaths : String × String × String :=
  let path := quoteFill "word/h" "shared.xml" 256
  (path, path, path)

def identityJson (ordinal : Nat) (path : String) : Json :=
  Json.mkObj
    [ ("relationshipId", quoteFill "r" s!"{ordinal}" 128)
    , ("normalizedPartPath", path)
    ]

def zeroPaddedNat (width value : Nat) : String :=
  let rendered := toString value
  String.ofList (List.replicate (width - min width rendered.length) '0') ++ rendered

def maximumIssueJson (ordinal : Nat) : Json :=
  let suffix := zeroPaddedNat 3 ordinal
  Json.mkObj
    [ ("code", "MISSING_RELATIONSHIP")
    , ("detail", quoteFill "" "" 256)
    , ("relationshipId", quoteFill "r" suffix 128)
    , ("rawTarget", quoteFill "t" suffix 256)
    , ("normalizedPartPath", quoteFill "word/h" suffix 256)
    ]

def maximumSlotJson (shared : Bool) (ordinal : Nat) : Json :=
  let paths := if shared then sharedPaths else distinctPaths ordinal
  Json.mkObj
    [ ("slotOrdinal", ordinal)
    , ("sectionOrdinal", (if shared then ordinal / 3 else ordinal / 6 : Nat))
    , ("kind", (if shared then StoryKind.header else kindForOrdinal ordinal).toString)
    , ("role", (roleForOrdinal ordinal).toString)
    , ("original", identityJson ordinal paths.1)
    , ("revised", identityJson ordinal paths.2.1)
    , ("compared", identityJson ordinal paths.2.2)
    , ("physicalStoryOrdinal", if shared then 0 else ordinal)
    ]

def maximumStoryJson (shared : Bool) (ordinal : Nat) : Json :=
  let paths := if shared then sharedPaths else distinctPaths ordinal
  let selectors := if shared then List.range 192 else [ordinal]
  Json.mkObj
    [ ("physicalStoryOrdinal", if shared then 0 else ordinal)
    , ("kind", (kindForOrdinal ordinal).toString)
    , ("originalPartPath", paths.1)
    , ("revisedPartPath", paths.2.1)
    , ("comparedPartPath", paths.2.2)
    , ("selectingSlotOrdinals", toJson selectors)
    , ("parsedTokenCounts", countsJson)
    , ("report", passingReportJson)
    ]

def maximumResponse (shared : Bool) : Json :=
  let slots := (List.range (if shared then 192 else 384)).map (maximumSlotJson shared)
  let stories :=
    if shared then [maximumStoryJson true 0]
    else (List.range 384).map (maximumStoryJson false)
  let issues := (List.range (if shared then 899 else 332)).map maximumIssueJson
  protocolV4ResponseJson false [mainStoryJson] [] slots stories issues

def main : IO Unit := do
  let stdin ← IO.getStdin
  let mode ← stdin.readToEnd
  let shared := mode.trimAscii.toString == "shared"
  IO.println (maximumResponse shared).compress
