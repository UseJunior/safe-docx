/-
Tier 2 — definitional `accept` / `reject`.

Mirrors `acceptAllChanges` / `rejectAllChanges` in
`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:368-659`
at the granularity the `OoxmlModel` subset exposes.

  * `accept` (`trackChangesAcceptorAst.ts:368-506`): drop `del` / `moveFrom`
    subtrees entirely; unwrap `ins` / `moveTo` (keep children); drop paragraphs
    whose body collapses to empty.
  * `reject` (`trackChangesAcceptorAst.ts:509-659`): drop `ins` / `moveTo`;
    unwrap `del` / `moveFrom`; THEN rewrite `delText → text` and
    `delInstrText → instrText` globally over the result — matching the TS line
    ordering at `trackChangesAcceptorAst.ts:602-616`, which performs both
    unwraps before the rename pass. Locality of `delInstrText` to deleted-content
    wrappers is enforced by `recursivelyWellformed` on the *input*, not by the
    bare `OoxmlModel` datatype.
-/
import Tier2.FieldStructure

namespace Tier2.AcceptReject

open Tier2.OoxmlModel Tier2.FieldStructure

/-! ### accept -/

/-- Accept track changes within a block sequence. `other` containers are kept;
    their children are recursively accepted. -/
def acceptBlocks : List Block → List Block
  | [] => []
  | .run r :: rest => .run r :: acceptBlocks rest
  | .ins bs :: rest => acceptBlocks bs ++ acceptBlocks rest
  | .moveTo bs :: rest => acceptBlocks bs ++ acceptBlocks rest
  | .del _ :: rest => acceptBlocks rest
  | .moveFrom _ :: rest => acceptBlocks rest
  | .other tag bs :: rest => .other tag (acceptBlocks bs) :: acceptBlocks rest
termination_by bs => sizeOf bs

/-- Accept all track changes in a document, dropping paragraphs that collapse to
    an empty body. -/
def accept : Doc → Doc
  | [] => []
  | p :: ps =>
    if (acceptBlocks p.body).isEmpty then accept ps
    else ⟨p.pPr, acceptBlocks p.body⟩ :: accept ps

/-! ### reject -/

/-- Reject the wrapper structure within a block sequence: drop `ins` / `moveTo`,
    unwrap `del` / `moveFrom`. `other` containers are kept; their children are
    recursively rejected. The `delText` / `delInstrText` rename is a separate
    global pass (`renameBlocks`). -/
def rejectBlocks : List Block → List Block
  | [] => []
  | .run r :: rest => .run r :: rejectBlocks rest
  | .ins _ :: rest => rejectBlocks rest
  | .moveTo _ :: rest => rejectBlocks rest
  | .del bs :: rest => rejectBlocks bs ++ rejectBlocks rest
  | .moveFrom bs :: rest => rejectBlocks bs ++ rejectBlocks rest
  | .other tag bs :: rest => .other tag (rejectBlocks bs) :: rejectBlocks rest
termination_by bs => sizeOf bs

/-- Rewrite a single deleted-content atom back to its accepted form. -/
def renameAtom : Atom → Atom
  | .delText s => .text s
  | .delInstrText s => .instrText s
  | a => a

/-- The global `delText → text` / `delInstrText → instrText` rename pass. Applied
    to every run after `rejectBlocks` completes (`trackChangesAcceptorAst.ts:602-616`).
    Descends through `other` containers transparently, preserving their tags. -/
def renameBlocks : List Block → List Block
  | [] => []
  | .run r :: rest => .run ⟨r.rPr, r.content.map renameAtom⟩ :: renameBlocks rest
  | .ins bs :: rest => .ins (renameBlocks bs) :: renameBlocks rest
  | .del bs :: rest => .del (renameBlocks bs) :: renameBlocks rest
  | .moveFrom bs :: rest => .moveFrom (renameBlocks bs) :: renameBlocks rest
  | .moveTo bs :: rest => .moveTo (renameBlocks bs) :: renameBlocks rest
  | .other tag bs :: rest => .other tag (renameBlocks bs) :: renameBlocks rest
termination_by bs => sizeOf bs

/-- Reject all track changes in a document: unwrap then global rename. -/
def reject : Doc → Doc
  | [] => []
  | p :: ps => ⟨p.pPr, renameBlocks (rejectBlocks p.body)⟩ :: reject ps

/-! ### Document-level preservation predicate

`preservationFriendly` is the precondition needed to prove that `accept` and
`reject` both produce output that satisfies `validateFieldStructure`. It is
**strictly weaker** than the per-subtree `Tier2.FieldStructure.recursivelyWellformed`
(which required `∀ ctx` neutrality of every wrapper subtree): we only require
that the *composed walk* over `acceptBlocks`/`renameBlocks ∘ rejectBlocks` ends
in the same state as the walk over the original block sequence, and that
begin/end counts balance in the outputs.

This shape is future-compatible with ECMA-376-conformant field fragmentation
(see #217): a `<w:ins>` wrapping only `[w:instrText]` is not neutral under
`∀ ctx`, but a document containing such a wrapper can still be
`preservationFriendly` if its overall walk is preserved by accept/reject. -/

/-- A document is *preservation-friendly* if accept and reject leave the
    document-level field walk and begin/end balance unchanged. Replaces
    `Tier2.FieldStructure.recursivelyWellformed`. -/
def preservationFriendly (d : Doc) : Prop :=
  validateFieldStructure d = true ∧
  walkBlocks (.ok []) (acceptBlocks d.blocks)
    = walkBlocks (.ok []) d.blocks ∧
  walkBlocks (.ok []) (renameBlocks (rejectBlocks d.blocks))
    = walkBlocks (.ok []) d.blocks ∧
  countBlocks Atom.isBegin (acceptBlocks d.blocks)
    = countBlocks Atom.isEnd (acceptBlocks d.blocks) ∧
  countBlocks Atom.isBegin (renameBlocks (rejectBlocks d.blocks))
    = countBlocks Atom.isEnd (renameBlocks (rejectBlocks d.blocks))

end Tier2.AcceptReject
