import Lean.Data.Json
import Tier2.XmlTripleChecker

open Lean Tier2.XmlTripleChecker

structure Request where
  originalDocumentXml : String
  revisedDocumentXml : String
  combinedDocumentXml : String

def requestFromJson (j : Json) : Except String Request := do
  let protocolVersion ← j.getObjValAs? Nat "protocolVersion"
  if protocolVersion != 1 then
    throw s!"unsupported protocolVersion: {protocolVersion}"
  return {
    originalDocumentXml := (← j.getObjValAs? String "originalDocumentXml")
    revisedDocumentXml := (← j.getObjValAs? String "revisedDocumentXml")
    combinedDocumentXml := (← j.getObjValAs? String "combinedDocumentXml")
  }

def runRequest (req : Request) : Json :=
  let original := parseXmlTokens req.originalDocumentXml
  let revised := parseXmlTokens req.revisedDocumentXml
  let combined := parseXmlTokens req.combinedDocumentXml
  let report := comparisonCheckerB original revised combined
  Json.mkObj
    [ ("protocolVersion", toJson (1 : Nat))
    , ("checker", toJson "safe-docx-lean-xml-triple-checker")
    , ("parsedTokenCounts", Json.mkObj
        [ ("original", toJson original.length)
        , ("revised", toJson revised.length)
        , ("combined", toJson combined.length)
        ])
    , ("report", reportToJson report)
    ]

def main : IO Unit := do
  let stdin ← IO.getStdin
  let raw ← stdin.readToEnd
  match Json.parse raw with
  | .error e => throw (IO.userError s!"JSON parse error: {e}")
  | .ok j =>
    match requestFromJson j with
    | .error e => throw (IO.userError s!"request parse error: {e}")
    | .ok req => IO.println (runRequest req).compress
