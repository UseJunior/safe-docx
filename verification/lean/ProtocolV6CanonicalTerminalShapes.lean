import Lean.Data.Json

open Lean

def checks : Json :=
  Json.mkObj
    [ ("acceptPreservesFieldStructure", true)
    , ("rejectPreservesFieldStructure", true)
    , ("acceptTextMatchesRevised", true)
    , ("rejectTextMatchesOriginal", true)
    , ("combinedHasNoFldCharInsideDel", true)
    , ("combinedHasValidMoveRanges", true)
    ]

def mainStory : Json :=
  Json.mkObj
    [ ("name", "main")
    , ("presence", Json.mkObj
        [("original", true), ("revised", true), ("combined", true)])
    , ("parsedTokenCounts", Json.mkObj
        [("original", 1), ("revised", 1), ("combined", 1)])
    , ("report", Json.mkObj [("passed", true), ("checks", checks)])
    ]

def absentDefinitionStory (kind : String) : Json :=
  Json.mkObj [("kind", kind), ("partPresent", false)]

def partition (side : String) : Json :=
  Json.mkObj
    [ ("side", side)
    , ("status", "incomplete")
    , ("sources", Json.arr #[
        Json.mkObj
          [ ("sourceOrdinal", 0)
          , ("sourceStory", "main")
          , ("normalizedPartPath", "word/document.xml")
          ]
      ])
    , ("definitionStories", Json.arr #[
        absentDefinitionStory "footnotes", absentDefinitionStory "endnotes"
      ])
    ]

def noteStory (kind : String) : Json :=
  Json.mkObj
    [ ("kind", kind)
    , ("status", "not_evaluated")
    , ("original", absentDefinitionStory kind)
    , ("revised", absentDefinitionStory kind)
    , ("compared", absentDefinitionStory kind)
    , ("parsedTokenCounts", Json.mkObj
        [("original", 0), ("revised", 0), ("combined", 0)])
    ]

def inventory (side kind : String) : Json :=
  Json.mkObj
    [ ("side", side)
    , ("kind", kind)
    , ("status", "not_evaluated")
    , ("referenceOccurrences", 0)
    , ("uniqueReferenceIds", 0)
    , ("definitions", Json.mkObj
        [ ("user", 0)
        , ("separator", 0)
        , ("continuationSeparator", 0)
        , ("continuationNotice", 0)
        ])
    , ("forbiddenDefinitionStoryReferences", 0)
    ]

def terminalIssue (code detail : String) : Json :=
  Json.mkObj
    [ ("code", code)
    , ("side", "original")
    , ("kind", "comments")
    , ("detail", detail)
    , ("ordinalSpace", "aggregate")
    , ("firstOccurrenceOrdinal", 0)
    , ("occurrenceCount", 1)
    ]

def terminalCommentSide : Json :=
  Json.mkObj
    [ ("status", "not_evaluated")
    , ("relationship", Json.null)
    , ("partPresent", false)
    ]

def terminalCommentStory : Json :=
  Json.mkObj
    [ ("status", "not_evaluated")
    , ("original", terminalCommentSide)
    , ("revised", terminalCommentSide)
    , ("compared", terminalCommentSide)
    , ("parsedTokenCounts", Json.mkObj
        [("original", 0), ("revised", 0), ("combined", 0)])
    ]

def terminalCommentInventory (side : String) : Json :=
  Json.mkObj
    [ ("side", side)
    , ("status", "not_evaluated")
    , ("relationship", Json.null)
    , ("referenceOccurrences", 0)
    , ("uniqueReferenceIds", 0)
    , ("definitions", 0)
    , ("unreferencedDefinitions", 0)
    , ("nonDirectDefinitions", 0)
    ]

def terminalResponse (code detail : String) : Json :=
  Json.mkObj
    [ ("protocolVersion", 6)
    , ("checker", "safe-docx-lean-conventional-main-comment-integrity-checker")
    , ("passed", false)
    , ("fixedStories", Json.arr #[mainStory])
    , ("presenceMismatches", Json.arr #[])
    , ("fixedStoryIssues", Json.arr #[])
    , ("relationshipSlots", Json.arr #[])
    , ("relationshipStories", Json.arr #[])
    , ("selectionIssues", Json.arr #[])
    , ("referenceSourcePartitions", Json.arr #[
        partition "original", partition "revised", partition "compared"
      ])
    , ("noteStories", Json.arr #[noteStory "footnotes", noteStory "endnotes"])
    , ("noteInventories", Json.arr #[
        inventory "original" "footnotes", inventory "original" "endnotes",
        inventory "revised" "footnotes", inventory "revised" "endnotes",
        inventory "compared" "footnotes", inventory "compared" "endnotes"
      ])
    , ("noteIntegrityIssues", Json.arr #[])
    , ("commentStory", terminalCommentStory)
    , ("commentInventories", Json.arr #[
        terminalCommentInventory "original",
        terminalCommentInventory "revised",
        terminalCommentInventory "compared"
      ])
    , ("commentIntegrityIssues", Json.arr #[terminalIssue code detail])
    ]

def main : IO Unit := do
  let stdin ← IO.getStdin
  let mode := (← stdin.readToEnd).trimAscii.toString
  let response :=
    if mode == "strings" then
      terminalResponse "COMMENT_EVIDENCE_STRING_BUDGET_EXCEEDED"
        "protocol v6 escaped evidence string budget exceeded"
    else
      terminalResponse "COMMENT_ISSUE_LIMIT_EXCEEDED"
        "protocol v6 aggregate ordinary issue limit exceeded"
  if response.compress.toUTF8.size > 2626368 ||
      (response.compress ++ "\n").toUTF8.size > 2626369 then
    throw (IO.userError "canonical terminal exceeds protocol-v6 legal envelope")
  IO.println response.compress
