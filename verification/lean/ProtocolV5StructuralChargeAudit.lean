import LeanDocxChecker

namespace ProtocolV5StructuralChargeAudit

open Lean

def ordinaryIssueLimit : Nat := 511
def ordinaryEscapedStringBytes : Nat := 1571840
def structuralChargeBytes : Nat := 1047936
def maximumOrdinaryResponseBytes : Nat :=
  structuralChargeBytes + ordinaryEscapedStringBytes
def terminalReserveBytes : Nat := 1024
def legalJsonBytes : Nat := 2621440
def stdoutNewlineBytes : Nat := 1
def legalResponseBytes : Nat := 2621441

def emptyIdentity : Json :=
  Json.mkObj [("relationshipId", ""), ("normalizedPartPath", "")]

def relationshipSlotShape : Json :=
  Json.mkObj
    [ ("slotOrdinal", 383), ("sectionOrdinal", 63), ("kind", "header"),
      ("role", "default"), ("original", emptyIdentity), ("revised", emptyIdentity),
      ("compared", emptyIdentity), ("physicalStoryOrdinal", 383) ]

def checksShape : Json :=
  Json.mkObj
    [ ("acceptPreservesFieldStructure", true), ("rejectPreservesFieldStructure", true),
      ("acceptTextMatchesRevised", true), ("rejectTextMatchesOriginal", true),
      ("combinedHasNoFldCharInsideDel", true), ("combinedHasValidMoveRanges", true) ]

def relationshipStoryShape : Json :=
  Json.mkObj
    [ ("physicalStoryOrdinal", 383), ("kind", "header"), ("originalPartPath", ""),
      ("revisedPartPath", ""), ("comparedPartPath", ""),
      ("selectingSlotOrdinals", Json.arr #[383]),
      ("parsedTokenCounts", Json.mkObj [("original", 500000), ("revised", 500000),
        ("combined", 500000)]),
      ("report", Json.mkObj [("passed", true), ("checks", checksShape)]) ]

def referenceSourceShape : Json :=
  Json.mkObj
    [ ("sourceOrdinal", 384), ("sourceStory", "header"),
      ("physicalStoryOrdinal", 383), ("normalizedPartPath", "") ]

def noteIssueShape : Json :=
  Json.mkObj
    [ ("code", "NOTE_ID_INVALID_DECIMAL"), ("side", "compared"),
      ("kind", "endnotes"), ("detail", ""), ("ordinalSpace", "reference"),
      ("firstOccurrenceOrdinal", 8192), ("occurrenceCount", 8192),
      ("source", Json.mkObj [("sourceStory", "header"), ("sourceStoryOrdinal", 383)]),
      ("canonicalId", ""), ("rawId", ""), ("rawIdByteLength", 16777216),
      ("rawIdDigest", "00000000"), ("referencedKind", "footnotes"),
      ("relationshipId", ""), ("rawTarget", ""), ("normalizedPartPath", "") ]

def selectionIssueShape : Json :=
  Json.mkObj
    [ ("code", "UNSAFE_TARGET"), ("detail", ""), ("side", "compared"),
      ("sectionOrdinal", 63), ("kind", "footer"), ("role", "even"),
      ("relationshipId", ""), ("rawTarget", ""), ("normalizedPartPath", "") ]

theorem ordinary_shape_exact :
    maximumOrdinaryResponseBytes = 2619776 := by decide

theorem ordinary_shape_with_terminal_reserve_fits :
    maximumOrdinaryResponseBytes + terminalReserveBytes ≤ legalJsonBytes := by decide

theorem json_plus_newline_is_stdout_envelope :
    legalJsonBytes + stdoutNewlineBytes = legalResponseBytes := by decide

theorem legal_response_fits_hard_stdout_cap :
    legalResponseBytes < 8 * 1024 * 1024 := by decide

#guard relationshipSlotShape.compress.toUTF8.size ≤ 320
#guard relationshipStoryShape.compress.toUTF8.size ≤ 640
#guard referenceSourceShape.compress.toUTF8.size ≤ 192
#guard noteIssueShape.compress.toUTF8.size ≤ 640
#guard selectionIssueShape.compress.toUTF8.size ≤ 640

#guard firstAggregateIssueCrossing 1571839
  (List.replicate 511 0) [2] = some "NOTE_ISSUE_LIMIT_EXCEEDED"
#guard firstAggregateIssueCrossing 1571840 [] [1] =
  some "NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED"
#guard firstAggregateIssueCrossing 1571839
  (List.replicate 510 0) [2, 0] =
  some "NOTE_EVIDENCE_STRING_BUDGET_EXCEEDED"
#guard firstAggregateIssueCrossing 0
  (List.replicate 511 0) [0] = some "NOTE_ISSUE_LIMIT_EXCEEDED"

end ProtocolV5StructuralChargeAudit
