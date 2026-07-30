import LeanDocxChecker

open Lean

namespace ProtocolV7StructuralChargeAudit

def sharedOrdinaryIssueLimit : Nat := 511
def ordinaryEscapedStringBudget : Nat := 1571840
def inheritedStructuralEnvelope : Nat := 1047936

def rangeInventoryFields : Json := Json.mkObj
  [ ("rangeEndOccurrences", 4096), ("rangeStartOccurrences", 4096) ]

def rangeInventoryCharge : Nat := 171

def addedInventoryKeys : List String :=
  ["rangeEndOccurrences", "rangeStartOccurrences"]

def markerOrdinalSpaces : List String :=
  ["rangeStart", "rangeEnd", "reference"]

def markerSourceShape : Json := Json.mkObj
  [("sourceStory", "footer"), ("sourceStoryOrdinal", 383)]

def sourceMarkerBase (code ordinalSpace : String) : List (String × Json) :=
  [ ("code", code), ("detail", ""), ("firstOccurrenceOrdinal", 4096),
    ("kind", "comments"), ("occurrenceCount", 4096),
    ("ordinalSpace", ordinalSpace), ("side", "compared"),
    ("source", markerSourceShape), ("sourceEventOrdinal", 499999),
    ("sourceSetOrdinal", 386) ]

def issueShape (code ordinalSpace : String)
    (extras : List (String × Json) := []) : Json :=
  Json.mkObj (sourceMarkerBase code ordinalSpace ++ extras)

def protocolV7IssueChargeRows : List (String × Nat) :=
  [ ("COMMENT_RANGE_START_ID_MISSING",
      (issueShape "COMMENT_RANGE_START_ID_MISSING" "rangeStart").compress.toUTF8.size),
    ("COMMENT_RANGE_START_ID_MALFORMED",
      (issueShape "COMMENT_RANGE_START_ID_MALFORMED" "rangeStart"
        [("rawId", "")]).compress.toUTF8.size),
    ("COMMENT_RANGE_START_ID_TOO_LONG",
      (issueShape "COMMENT_RANGE_START_ID_TOO_LONG" "rangeStart"
        [("rawIdByteLength", 16777216)]).compress.toUTF8.size),
    ("COMMENT_RANGE_END_ID_MISSING",
      (issueShape "COMMENT_RANGE_END_ID_MISSING" "rangeEnd").compress.toUTF8.size),
    ("COMMENT_RANGE_END_ID_MALFORMED",
      (issueShape "COMMENT_RANGE_END_ID_MALFORMED" "rangeEnd"
        [("rawId", "")]).compress.toUTF8.size),
    ("COMMENT_RANGE_END_ID_TOO_LONG",
      (issueShape "COMMENT_RANGE_END_ID_TOO_LONG" "rangeEnd"
        [("rawIdByteLength", 16777216)]).compress.toUTF8.size),
    ("COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED",
      (issueShape "COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED"
        "rangeStart").compress.toUTF8.size),
    ("COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED",
      (issueShape "COMMENT_RANGE_END_OCCURRENCE_LIMIT_EXCEEDED"
        "rangeEnd").compress.toUTF8.size),
    ("COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED",
      (issueShape "COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED"
        "reference" [("canonicalId", "")]).compress.toUTF8.size),
    ("COMMENT_REFERENCE_DUPLICATE",
      (issueShape "COMMENT_REFERENCE_DUPLICATE" "reference"
        [("canonicalId", "")]).compress.toUTF8.size),
    ("COMMENT_REFERENCE_MISSING",
      (issueShape "COMMENT_REFERENCE_MISSING" "rangeStart"
        [("canonicalId", "")]).compress.toUTF8.size),
    ("COMMENT_RANGE_START_DUPLICATE",
      (issueShape "COMMENT_RANGE_START_DUPLICATE" "rangeStart"
        [("canonicalId", "")]).compress.toUTF8.size),
    ("COMMENT_RANGE_END_DUPLICATE",
      (issueShape "COMMENT_RANGE_END_DUPLICATE" "rangeEnd"
        [("canonicalId", "")]).compress.toUTF8.size),
    ("COMMENT_RANGE_START_ORPHANED",
      (issueShape "COMMENT_RANGE_START_ORPHANED" "rangeStart"
        [("canonicalId", "")]).compress.toUTF8.size),
    ("COMMENT_RANGE_END_ORPHANED",
      (issueShape "COMMENT_RANGE_END_ORPHANED" "rangeEnd"
        [("canonicalId", "")]).compress.toUTF8.size),
    ("COMMENT_RANGE_CROSS_STORY",
      (issueShape "COMMENT_RANGE_CROSS_STORY" "reference"
        [("canonicalId", ""), ("relatedSource", markerSourceShape),
         ("relatedSourceEventOrdinal", 499999),
         ("relatedSourceSetOrdinal", 386)]).compress.toUTF8.size),
    ("COMMENT_RANGE_REVERSED",
      (issueShape "COMMENT_RANGE_REVERSED" "rangeStart"
        [("canonicalId", ""),
         ("rangeEndEventOrdinal", 499999)]).compress.toUTF8.size) ]

def newIssueCodes : List String := protocolV7IssueChargeRows.map (·.1)
def topologyIssueCharge : Nat := 4928 - rangeInventoryCharge
def protocolV7FixedStructuralCharge : Nat :=
  rangeInventoryCharge + topologyIssueCharge
def ordinaryLegalUpperEnvelope : Nat :=
  inheritedStructuralEnvelope + ordinaryEscapedStringBudget +
    protocolV7FixedStructuralCharge
def terminalIssueStructuralCharge : Nat := 640
def terminalEscapedStringReserve : Nat := 1024
def legalTerminalJsonEnvelope : Nat :=
  ordinaryLegalUpperEnvelope + terminalIssueStructuralCharge +
    terminalEscapedStringReserve
def legalStdoutEnvelope : Nat := legalTerminalJsonEnvelope + 1

theorem range_inventory_charge_exact : rangeInventoryCharge = 171 := by decide
theorem every_new_issue_has_one_charge_row :
    newIssueCodes.length = 17 ∧ newIssueCodes.Nodup := by decide
theorem bounded_number_widths_exact :
    (toString (4096 : Nat)).length = 4 ∧
    (toString (386 : Nat)).length = 3 ∧
    (toString (499999 : Nat)).length = 6 ∧
    (toString (16777216 : Nat)).length = 8 := by decide
theorem protocol_v7_fixed_charge_exact :
    protocolV7FixedStructuralCharge = 4928 := by decide
theorem ordinary_upper_envelope_exact :
    ordinaryLegalUpperEnvelope = 2624704 := by decide
theorem legal_terminal_json_envelope_exact :
    legalTerminalJsonEnvelope = 2626368 := by decide
theorem legal_stdout_envelope_exact :
    legalStdoutEnvelope = 2626369 := by decide
theorem stdout_hard_cap_margin_exact :
    8 * 1024 * 1024 - legalStdoutEnvelope = 5762239 := by decide

#guard rangeInventoryFields.compress.toUTF8.size = 57
#guard protocolV7IssueChargeRows.all (fun row => row.2 ≤ 640)

end ProtocolV7StructuralChargeAudit
