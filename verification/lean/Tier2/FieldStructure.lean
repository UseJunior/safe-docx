/-
Tier 2 — field-structure predicate.

Definitional mirror of the two checks in `validateFieldStructure`
(`packages/docx-core/src/baselines/atomizer/pipeline.ts:352-402`):

  1. global `w:fldChar` begin/end counts are balanced;
  2. every `w:instrText` / `w:delInstrText` sits inside an open, pre-`separate`
     field body.

Check (2) walks every atom in document order carrying a *stack* of
"separator-seen" bits indexed by field depth — exactly the TS engine's
`pastSeparatorAtDepth: number[]` at `pipeline.ts:374-389`. Round 3 of peer
review (see `design.md`) showed a single mutable boolean is unsound: an inner
`End` would reset a separator bit belonging to an outer field.

`fieldContextNeutral` is the per-subtree strengthening that survives the three
round-3 counterexample families. `recursivelyWellformed` bundles the whole-doc
check with context-neutrality of every wrapper subtree.
-/
import Tier2.OoxmlModel

namespace Tier2.FieldStructure

open Tier2.OoxmlModel

/-- The field context: a stack of `pastSeparatorAtDepth` bits, innermost field on
    top. `true` means the `w:separate` for that field has already been seen. -/
abbrev FieldCtx : Type := List Bool

/-- Result of walking a span of atoms/blocks: either a live context, or a
    permanently-failed walk. `invalid` is absorbing. -/
inductive WalkResult
  | ok (ctx : FieldCtx)
  | invalid
  deriving DecidableEq, Repr, Inhabited

/-- `true` iff the walk has not failed. -/
def WalkResult.isValid : WalkResult → Bool
  | .ok _ => true
  | .invalid => false

/-- Step the field-context walk across one atom, at structural del-ancestry depth
    `delDepth` (the number of enclosing `w:del` wrappers). Mirrors the main
    `validateFieldStructure` scan at `pipeline.ts:525-560`:

    * field-context state — `begin` pushes a fresh `false`; `separate` sets the
      top bit (no-op on the empty stack, matching the `if (depth > 0)` guard at
      `pipeline.ts:548`); `end` pops (no-op on empty, `pipeline.ts:550`);
      `instrText` requires a non-empty stack whose top bit is `false`
      (`pipeline.ts:553`);
    * DeletedFieldCode locality (constraint (3)) — a `w:fldChar` of ANY
      `w:fldCharType` at `delDepth > 0` is `invalid` (`pipeline.ts:542`, G1), and a
      `w:delInstrText` at `delDepth = 0` is `invalid` (`pipeline.ts:555`, G2). The
      `delInstrText` open-pre-`separate` field check (`pipeline.ts:556`) still
      applies once the del-ancestry gate passes. -/
def stepAtom (delDepth : Nat) (r : WalkResult) (a : Atom) : WalkResult :=
  match r with
  | .invalid => .invalid
  | .ok ctx =>
    match a with
    | .text _ => .ok ctx
    | .delText _ => .ok ctx
    | .fldChar k =>
      -- constraint (3): no field characters inside a `del` ancestor (G1)
      if delDepth > 0 then .invalid
      else
        match k with
        | .begin => .ok (false :: ctx)
        | .separate =>
          match ctx with
          | [] => .ok []
          | _ :: rest => .ok (true :: rest)
        | .endf =>
          match ctx with
          | [] => .ok []
          | _ :: rest => .ok rest
    | .instrText _ =>
      match ctx with
      | false :: _ => .ok ctx
      | _ => .invalid
    | .delInstrText _ =>
      -- constraint (3): `delInstrText` only inside a `del` ancestor (G2)
      if delDepth = 0 then .invalid
      else
        match ctx with
        | false :: _ => .ok ctx
        | _ => .invalid

/-- Step the field-context walk across a run's atoms, left to right, at del-depth
    `delDepth`. -/
def stepAtoms (delDepth : Nat) (r : WalkResult) (as : List Atom) : WalkResult :=
  as.foldl (stepAtom delDepth) r

/-- Walk the field context across a block sequence in document order at
    del-ancestry depth `delDepth`. The walk descends into every wrapper and
    transparent container, because the TS `validateFieldStructure` scans every
    element regardless of tag (`pipeline.ts:528`). Only `del` is structurally
    significant: descending into a `del` subtree increments `delDepth`
    (`pipeline.ts:533-538`), so the atom-level constraint-(3) gate in `stepAtom`
    can see the del-ancestry. The linear field context flows across the `del`
    boundary unchanged, exactly as the engine shares `depth`/`pastSeparatorAtDepth`
    across the `insideDelDepth` recursion. -/
def walkBlocks (delDepth : Nat) : WalkResult → List Block → WalkResult
  | r, [] => r
  | r, .run run :: rest => walkBlocks delDepth (stepAtoms delDepth r run.content) rest
  | r, .ins bs :: rest => walkBlocks delDepth (walkBlocks delDepth r bs) rest
  | r, .del bs :: rest => walkBlocks delDepth (walkBlocks (delDepth + 1) r bs) rest
  | r, .moveFrom bs :: rest => walkBlocks delDepth (walkBlocks delDepth r bs) rest
  | r, .moveTo bs :: rest => walkBlocks delDepth (walkBlocks delDepth r bs) rest
  | r, .other _ bs :: rest => walkBlocks delDepth (walkBlocks delDepth r bs) rest
termination_by _ bs => sizeOf bs

/-- Walk a single block at top-level del-depth. Provided for parity with
    `design.md`'s stated API; the primary recursive object is `walkBlocks`. -/
def stepBlock (r : WalkResult) (b : Block) : WalkResult :=
  walkBlocks 0 r [b]

/-- Atom-level predicate: this atom is a `w:fldChar` with `w:fldCharType="begin"`. -/
def Atom.isBegin : Atom → Bool
  | .fldChar .begin => true
  | _ => false

/-- Atom-level predicate: this atom is a `w:fldChar` with `w:fldCharType="end"`. -/
def Atom.isEnd : Atom → Bool
  | .fldChar .endf => true
  | _ => false

/-- Count atoms satisfying `p` across a block sequence, descending into wrappers
    and transparent containers. -/
def countBlocks (p : Atom → Bool) : List Block → Nat
  | [] => 0
  | .run run :: rest => run.content.countP p + countBlocks p rest
  | .ins bs :: rest => countBlocks p bs + countBlocks p rest
  | .del bs :: rest => countBlocks p bs + countBlocks p rest
  | .moveFrom bs :: rest => countBlocks p bs + countBlocks p rest
  | .moveTo bs :: rest => countBlocks p bs + countBlocks p rest
  | .other _ bs :: rest => countBlocks p bs + countBlocks p rest
termination_by bs => sizeOf bs

/-- Check (1): global `w:fldChar` begin/end counts are equal. -/
def fldCharBalanced (d : Doc) : Bool :=
  countBlocks Atom.isBegin d.blocks == countBlocks Atom.isEnd d.blocks

/-- `validateFieldStructure` — definitional mirror of the main scan at
    `pipeline.ts:496-565` (begin/end balance, the open-field walk, and the
    DeletedFieldCode locality constraint). The walk starts at del-depth 0. -/
def validateFieldStructure (d : Doc) : Bool :=
  fldCharBalanced d && (walkBlocks 0 (.ok []) d.blocks).isValid

/-- A wrapper subtree's block list is *field-context-neutral* iff, scanned under
    **any** outer field context, it leaves that context unchanged and never
    produces `invalid`. Strictly stronger than per-subtree
    `validateFieldStructure`; this is the predicate the preservation lemma needs
    and the property `compareDocumentXml_output_recursivelyWellformed` asserts. -/
def fieldContextNeutral (bs : List Block) : Prop :=
  ∀ ctx, walkBlocks 0 (.ok ctx) bs = .ok ctx

/-- Every track-change wrapper child block list in a block sequence, transitively.
    `other` containers are NOT track-change wrappers — they are traversed but
    their own children are not emitted as a wrapper subtree (only any wrappers
    nested inside them are). -/
def wrapperSubtreesBlocks : List Block → List (List Block)
  | [] => []
  | .run _ :: rest => wrapperSubtreesBlocks rest
  | .ins bs :: rest => (bs :: wrapperSubtreesBlocks bs) ++ wrapperSubtreesBlocks rest
  | .del bs :: rest => (bs :: wrapperSubtreesBlocks bs) ++ wrapperSubtreesBlocks rest
  | .moveFrom bs :: rest => (bs :: wrapperSubtreesBlocks bs) ++ wrapperSubtreesBlocks rest
  | .moveTo bs :: rest => (bs :: wrapperSubtreesBlocks bs) ++ wrapperSubtreesBlocks rest
  | .other _ bs :: rest => wrapperSubtreesBlocks bs ++ wrapperSubtreesBlocks rest
termination_by bs => sizeOf bs

/-- Every wrapper subtree of `d` (transitively). -/
def allWrapperSubtrees (d : Doc) : List (List Block) :=
  wrapperSubtreesBlocks d.blocks

/-- Every wrapper subtree of a block sequence is field-context-neutral. -/
def allNeutral (bs : List Block) : Prop :=
  ∀ sub ∈ wrapperSubtreesBlocks bs, fieldContextNeutral sub

/-- The recursive well-formedness precondition of the preservation lemma:
    the whole document validates, and every wrapper subtree is context-neutral. -/
def recursivelyWellformed (d : Doc) : Prop :=
  validateFieldStructure d = true ∧ allNeutral d.blocks

end Tier2.FieldStructure
