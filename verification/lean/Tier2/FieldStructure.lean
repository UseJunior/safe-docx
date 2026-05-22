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

/-- Step the field-context walk across one atom. Mirrors `pipeline.ts:374-389`:
    `begin` pushes a fresh `false`; `separate` sets the top bit (no-op on the
    empty stack, matching the `if (depth > 0)` guard at `pipeline.ts:387`);
    `end` pops (no-op on empty, matching `pipeline.ts:389`); `instrText` /
    `delInstrText` require a non-empty stack whose top bit is `false`. -/
def stepAtom (r : WalkResult) (a : Atom) : WalkResult :=
  match r with
  | .invalid => .invalid
  | .ok ctx =>
    match a with
    | .text _ => .ok ctx
    | .delText _ => .ok ctx
    | .fldChar .begin => .ok (false :: ctx)
    | .fldChar .separate =>
      match ctx with
      | [] => .ok []
      | _ :: rest => .ok (true :: rest)
    | .fldChar .endf =>
      match ctx with
      | [] => .ok []
      | _ :: rest => .ok rest
    | .instrText _ =>
      match ctx with
      | false :: _ => .ok ctx
      | _ => .invalid
    | .delInstrText _ =>
      match ctx with
      | false :: _ => .ok ctx
      | _ => .invalid

/-- Step the field-context walk across a run's atoms, left to right. -/
def stepAtoms (r : WalkResult) (as : List Atom) : WalkResult :=
  as.foldl stepAtom r

/-- Walk the field context across a block sequence in document order. Wrappers
    (`ins` / `del` / `moveFrom` / `moveTo`) and transparent containers (`other`)
    are all transparent for the walk: the walk simply descends into their
    children, because the TS `validateFieldStructure` scans every element
    regardless of tag (`pipeline.ts:396`). -/
def walkBlocks : WalkResult → List Block → WalkResult
  | r, [] => r
  | r, .run run :: rest => walkBlocks (stepAtoms r run.content) rest
  | r, .ins bs :: rest => walkBlocks (walkBlocks r bs) rest
  | r, .del bs :: rest => walkBlocks (walkBlocks r bs) rest
  | r, .moveFrom bs :: rest => walkBlocks (walkBlocks r bs) rest
  | r, .moveTo bs :: rest => walkBlocks (walkBlocks r bs) rest
  | r, .other _ bs :: rest => walkBlocks (walkBlocks r bs) rest
termination_by _ bs => sizeOf bs

/-- Walk a single block. Provided for parity with `design.md`'s stated API; the
    primary recursive object is `walkBlocks`. -/
def stepBlock (r : WalkResult) (b : Block) : WalkResult :=
  walkBlocks r [b]

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

/-- `validateFieldStructure` — definitional mirror of `pipeline.ts:352-402`. -/
def validateFieldStructure (d : Doc) : Bool :=
  fldCharBalanced d && (walkBlocks (.ok []) d.blocks).isValid

/-- A wrapper subtree's block list is *field-context-neutral* iff, scanned under
    **any** outer field context, it leaves that context unchanged and never
    produces `invalid`. Strictly stronger than per-subtree
    `validateFieldStructure`; this is the predicate the preservation lemma needs
    and the property `compareDocumentXml_output_recursivelyWellformed` asserts. -/
def fieldContextNeutral (bs : List Block) : Prop :=
  ∀ ctx, walkBlocks (.ok ctx) bs = .ok ctx

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
