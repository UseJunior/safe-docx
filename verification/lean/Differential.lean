/-
Lean↔TS LCS differential harness — executable entry point.

Reads a batched JSON document from stdin, runs the GENUINE `LeanSpike.computeAtomLcs`
(`LeanSpike/Lcs.lean`) on each case, and writes the results as JSON to stdout. A
TypeScript harness (`packages/docx-core/src/integration/lean-differential-lcs.test.ts`)
feeds the same generated inputs to the production TS `computeAtomLcs`
(`packages/docx-core/src/baselines/atomizer/atomLcs.ts`) and asserts identical output,
establishing Lean↔TS extensional equivalence of the LCS as a reproducible CI gate
(Tier 2.5, first increment; see `openspec/changes/add-lean-ts-lcs-differential-harness/`).

Each case is run through BOTH the recursive `LeanSpike.computeAtomLcs` and the
functional Wagner–Fischer DP `LeanSpike.computeAtomLcsDP` (`LeanSpike/LcsDP.lean`).
The TS harness asserts (a) the recursive result equals the production TS LCS and
(b) the DP result equals the recursive one. The DP↔recursive equality is *proven*
universally (`computeAtomLcsDP_eq_computeAtomLcs`); emitting it here is a runtime
regression guard over the exact functions the theorem is about.

Wire protocol (one process spawn amortized over the whole batch):

  stdin : { "cases":   [ { "orig": [Atom], "rev": [Atom] } ] }
  stdout: { "results": [ { "classic": <Lcs>, "dp": <Lcs> } ] }
          where <Lcs> = { "matches": [[origIdx, revIdx]], "deletedIndices": [Nat], "insertedIndices": [Nat] }

where Atom is the 3-field projection { sha1Hash, textContent, tagName }. `matches`
uses the array shape `[origIdx, revIdx]` because Lean's `Match = Nat × Nat` serializes
each `Prod` as a 2-element JSON array; the TS side normalizes its object-shaped matches
to this form before comparing.

The JSON instances for `LeanSpike.Atom` are defined locally here so the proved modules
(`LeanSpike/Atom.lean`, `LeanSpike/Lcs.lean`) stay pristine. This file is plain
executable code carrying no proof placeholders, so the spike's zero-proof-placeholder
audit (which scans `.lean` modules for the proof-hole keyword) is unaffected.

NOTE: `import Lean.Data.Json` (not `import Lean` / `import Lean.Data.Json.FromToJson`)
is required under the pinned toolchain — it brings both `Json.parse` and the
`FromJson`/`ToJson` deriving handlers and typeclasses into scope.
-/
import Lean.Data.Json
import LeanSpike.Lcs
import LeanSpike.LcsDP

open Lean

instance : ToJson LeanSpike.Atom where
  toJson a := Json.mkObj
    [ ("sha1Hash", toJson a.sha1Hash)
    , ("textContent", toJson a.textContent)
    , ("tagName", toJson a.tagName) ]

instance : FromJson LeanSpike.Atom where
  fromJson? j := do
    let sha1Hash ← j.getObjValAs? String "sha1Hash"
    let textContent ← j.getObjValAs? String "textContent"
    let tagName ← j.getObjValAs? String "tagName"
    return { sha1Hash := sha1Hash, textContent := textContent, tagName := tagName }

structure CaseIn where
  orig : List LeanSpike.Atom
  rev : List LeanSpike.Atom
  deriving FromJson

structure Input where
  cases : List CaseIn
  deriving FromJson

/-- Serialize an `LcsResult` to the canonical wire shape. `«matches» : List (Nat × Nat)`
    serializes via the core `ToJson (Prod _ _)` instance as `[[origIdx, revIdx], …]`. -/
def encodeResult (r : LeanSpike.LcsResult) : Json :=
  Json.mkObj
    [ ("matches", toJson r.«matches»)
    , ("deletedIndices", toJson r.deletedIndices)
    , ("insertedIndices", toJson r.insertedIndices) ]

/-- Emit both the recursive and the functional-DP results for a case, so the TS
    harness can cross-check DP↔recursive (proven by `computeAtomLcsDP_eq_computeAtomLcs`)
    alongside recursive↔TS. -/
def runCase (c : CaseIn) : Json :=
  Json.mkObj
    [ ("classic", encodeResult (LeanSpike.computeAtomLcs c.orig c.rev))
    , ("dp", encodeResult (LeanSpike.computeAtomLcsDP c.orig c.rev)) ]

def main : IO Unit := do
  let stdin ← IO.getStdin
  let raw ← stdin.readToEnd
  match Json.parse raw with
  | .error e => throw (IO.userError s!"JSON parse error: {e}")
  | .ok j =>
    match (fromJson? j : Except String Input) with
    | .error e => throw (IO.userError s!"FromJson error: {e}")
    | .ok input =>
      let results := input.cases.map runCase
      let out := Json.mkObj [("results", Json.arr results.toArray)]
      IO.println out.compress
