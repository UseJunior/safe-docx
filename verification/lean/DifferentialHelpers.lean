/-
Lean↔TS Tier 2-helper differential harness — executable entry point.

Reads a batched JSON document from stdin, runs the GENUINE Tier 2 helpers
`Tier2.FieldStructure.validateFieldStructure`, `Tier2.AcceptReject.accept`, and
`Tier2.AcceptReject.reject` (`verification/lean/Tier2/`) on each modeled `Doc`, and
writes the results as JSON to stdout. A TypeScript harness
(`packages/docx-core/src/integration/lean-differential-helpers.test.ts`) renders the
same generated `Doc`s to `document.xml`, feeds them to the production engine
(`acceptAllChanges` / `rejectAllChanges` / `validateFieldStructure`,
`packages/docx-core/src/baselines/atomizer/`), and asserts agreement on a canonical
token projection — extending the Tier 2.5 differential to the accept/reject/validate
surface (second increment; see `openspec/changes/add-lean-ts-helper-differential-harness/`).

Wire protocol (one process spawn amortized over the whole batch):

  stdin : { "cases":   [ { "doc": Doc } ] }
  stdout: { "results": [ { "validate": Bool, "accept": Doc, "reject": Doc } ] }

where Doc is the tagged-union encoding of `Tier2.OoxmlModel.Doc` defined below
(paragraphs → blocks → runs → atoms, with ins/del/moveFrom/moveTo/other wrappers;
the opaque pPr/rPr markers carry no cross-boundary meaning and are fixed to defaults).

The JSON instances are defined locally here so the proved Tier 2 modules
(`Tier2/OoxmlModel.lean`, `FieldStructure.lean`, `AcceptReject.lean`) stay pristine.
This file is plain executable code carrying no proof placeholders, so the spike's
zero-proof-placeholder audit (which scans `.lean` modules for the proof-hole keyword)
is unaffected.

NOTE: `import Lean.Data.Json` (not `import Lean` / `import Lean.Data.Json.FromToJson`)
is required under the pinned toolchain — it brings `Json.parse`, the array/object
accessors, and the `FromJson`/`ToJson` typeclasses into scope.
-/
import Lean.Data.Json
import Tier2.AcceptReject

open Lean Tier2.OoxmlModel Tier2.FieldStructure Tier2.AcceptReject

/-! ### Encoders (`Doc` → JSON), matching the wire grammar in `design.md`. -/

instance : ToJson FldCharKind where
  toJson
    | .begin => Json.str "begin"
    | .separate => Json.str "separate"
    | .endf => Json.str "end"

instance : ToJson Atom where
  toJson
    | .text s => Json.mkObj [("text", toJson s)]
    | .delText s => Json.mkObj [("delText", toJson s)]
    | .instrText s => Json.mkObj [("instrText", toJson s)]
    | .delInstrText s => Json.mkObj [("delInstrText", toJson s)]
    | .fldChar k => Json.mkObj [("fldChar", toJson k)]

/-- `Block` is recursive (`List Block` children), so the encoder is `partial`; this is
    an executable, not a proof — no termination obligation is incurred. -/
partial def blockToJson : Block → Json
  | .run r => Json.mkObj [("run", Json.mkObj [("content", toJson r.content)])]
  | .ins bs => Json.mkObj [("ins", Json.arr ((bs.map blockToJson)).toArray)]
  | .del bs => Json.mkObj [("del", Json.arr ((bs.map blockToJson)).toArray)]
  | .moveFrom bs => Json.mkObj [("moveFrom", Json.arr ((bs.map blockToJson)).toArray)]
  | .moveTo bs => Json.mkObj [("moveTo", Json.arr ((bs.map blockToJson)).toArray)]
  | .other tag bs =>
    Json.mkObj [("other", Json.mkObj
      [ ("tag", toJson tag)
      , ("children", Json.arr ((bs.map blockToJson)).toArray) ])]

instance : ToJson Block where toJson := blockToJson

def paragraphToJson (p : Paragraph) : Json :=
  Json.mkObj [("body", Json.arr ((p.body.map blockToJson)).toArray)]

def docToJson (d : Doc) : Json :=
  Json.arr ((d.map paragraphToJson)).toArray

/-! ### Decoders (JSON → `Doc`). -/

def fldCharKindFromJson (j : Json) : Except String FldCharKind :=
  match j.getStr? with
  | .ok "begin" => .ok .begin
  | .ok "separate" => .ok .separate
  | .ok "end" => .ok .endf
  | .ok other => .error s!"unknown fldCharType: {other}"
  | .error e => .error e

instance : FromJson Atom where
  fromJson? j :=
    match j.getObjVal? "text" with
    | .ok v => do return Atom.text (← fromJson? v)
    | .error _ =>
    match j.getObjVal? "delText" with
    | .ok v => do return Atom.delText (← fromJson? v)
    | .error _ =>
    match j.getObjVal? "instrText" with
    | .ok v => do return Atom.instrText (← fromJson? v)
    | .error _ =>
    match j.getObjVal? "delInstrText" with
    | .ok v => do return Atom.delInstrText (← fromJson? v)
    | .error _ =>
    match j.getObjVal? "fldChar" with
    | .ok v => do return Atom.fldChar (← fldCharKindFromJson v)
    | .error _ => .error s!"unknown Atom: {j.compress}"

/-- Recursive decoder; `partial` for the same reason as `blockToJson`. -/
partial def blockFromJson (j : Json) : Except String Block := do
  match j.getObjVal? "run" with
  | .ok v => return Block.run { content := (← v.getObjValAs? (List Atom) "content") }
  | .error _ =>
  match j.getObjVal? "ins" with
  | .ok v => return Block.ins (← (← v.getArr?).toList.mapM blockFromJson)
  | .error _ =>
  match j.getObjVal? "del" with
  | .ok v => return Block.del (← (← v.getArr?).toList.mapM blockFromJson)
  | .error _ =>
  match j.getObjVal? "moveFrom" with
  | .ok v => return Block.moveFrom (← (← v.getArr?).toList.mapM blockFromJson)
  | .error _ =>
  match j.getObjVal? "moveTo" with
  | .ok v => return Block.moveTo (← (← v.getArr?).toList.mapM blockFromJson)
  | .error _ =>
  match j.getObjVal? "other" with
  | .ok v => do
    let tag ← v.getObjValAs? String "tag"
    let children ← v.getObjVal? "children"
    return Block.other tag (← (← children.getArr?).toList.mapM blockFromJson)
  | .error _ => .error s!"unknown Block: {j.compress}"

def paragraphFromJson (j : Json) : Except String Paragraph := do
  let body ← j.getObjVal? "body"
  return { body := (← (← body.getArr?).toList.mapM blockFromJson) }

def docFromJson (j : Json) : Except String Doc := do
  (← j.getArr?).toList.mapM paragraphFromJson

/-! ### Batch I/O. -/

structure CaseIn where
  doc : Doc

def caseFromJson (j : Json) : Except String CaseIn := do
  return { doc := (← docFromJson (← j.getObjVal? "doc")) }

/-- Run the three modeled helpers on one `Doc` and encode the results. -/
def encodeResult (d : Doc) : Json :=
  Json.mkObj
    [ ("validate", toJson (validateFieldStructure d))
    , ("accept", docToJson (accept d))
    , ("reject", docToJson (reject d)) ]

def main : IO Unit := do
  let stdin ← IO.getStdin
  let raw ← stdin.readToEnd
  match Json.parse raw with
  | .error e => throw (IO.userError s!"JSON parse error: {e}")
  | .ok j =>
    match j.getObjVal? "cases" with
    | .error e => throw (IO.userError s!"missing cases: {e}")
    | .ok casesJson =>
      match casesJson.getArr? with
      | .error e => throw (IO.userError s!"cases not an array: {e}")
      | .ok arr =>
        match arr.toList.mapM caseFromJson with
        | .error e => throw (IO.userError s!"case parse error: {e}")
        | .ok cases =>
          let results := cases.map (fun c => encodeResult c.doc)
          let out := Json.mkObj [("results", Json.arr results.toArray)]
          IO.println out.compress
