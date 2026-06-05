/-
Tier 2 — the preservation lemma.

`field_structure_preserved_doc`: for any document satisfying the document-level
`preservationFriendly` precondition, both `accept` and `reject` produce output
that satisfies `validateFieldStructure`. This is the machine-checked content that
closes `inv_field_001` (composed with the residual axiom
`compareDocumentXml_output_preservation_friendly` in `Spec.lean`).

The proof is entirely document-level: `preservationFriendly` already asserts the
*composed* accept/reject walk and begin/end-balance equalities, so all this file
needs is to relate `(accept d).blocks` / `(reject d).blocks` to the block-list
operations `acceptBlocks` / `renameBlocks ∘ rejectBlocks` (the `accept_blocks` /
`reject_blocks` lemmas, proved by append-distribution — walk-free).

History: an earlier, stronger `field_structure_preserved` consumed the per-subtree
`recursivelyWellformed` precondition via a body of standalone walk lemmas
(`WalkLemmas.lean`). Modeling the OOXML DeletedFieldCode locality constraint
(`add-lean-deleted-field-code-constraint`) made the `reject` rename
`delInstrText → instrText` non-walk-invariant at del-depth 0, which falsified that
lemma body, and the constraint makes `recursivelyWellformed` exclude legal
deleted-field-code documents. The legacy theorem was non-load-bearing (audit only),
so it and its supporting lemmas were retired; the document-level theorem below is
the sole headline.
-/
import Tier2.AcceptReject

namespace Tier2.InvFieldOne

open Tier2.OoxmlModel Tier2.FieldStructure Tier2.AcceptReject

/-! ### Operations distribute over append -/

theorem acceptBlocks_append (l m : List Block) :
    acceptBlocks (l ++ m) = acceptBlocks l ++ acceptBlocks m := by
  induction l with
  | nil => simp [acceptBlocks]
  | cons b l ih => cases b <;> simp [acceptBlocks, ih, List.append_assoc]

theorem rejectBlocks_append (l m : List Block) :
    rejectBlocks (l ++ m) = rejectBlocks l ++ rejectBlocks m := by
  induction l with
  | nil => simp [rejectBlocks]
  | cons b l ih => cases b <;> simp [rejectBlocks, ih, List.append_assoc]

theorem renameBlocks_append (l m : List Block) :
    renameBlocks (l ++ m) = renameBlocks l ++ renameBlocks m := by
  induction l with
  | nil => simp [renameBlocks]
  | cons b l ih => cases b <;> simp [renameBlocks, ih]

/-! ### Document-level block extraction -/

theorem accept_blocks (d : Doc) :
    (accept d).blocks = acceptBlocks d.blocks := by
  simp only [Doc.blocks]
  induction d with
  | nil => simp [accept, acceptBlocks]
  | cons p ps ih =>
    rw [List.flatMap_cons, acceptBlocks_append]
    simp only [accept]
    split
    · next hb =>
      have hnil : acceptBlocks p.body = [] := by simpa using hb
      rw [hnil, List.nil_append]
      exact ih
    · next hb =>
      rw [List.flatMap_cons, ih]

theorem reject_blocks (d : Doc) :
    (reject d).blocks = renameBlocks (rejectBlocks d.blocks) := by
  simp only [Doc.blocks]
  induction d with
  | nil => simp [reject, rejectBlocks, renameBlocks]
  | cons p ps ih =>
    rw [List.flatMap_cons, rejectBlocks_append, renameBlocks_append]
    simp only [reject]
    rw [List.flatMap_cons, ih]

/-! ### Document-level preservation lemma (load-bearing) -/

/-- **`field_structure_preserved_doc`.** Consumes the `preservationFriendly`
    precondition (the *composed* accept/reject walk and begin/end-balance
    equalities, walked at del-depth 0) and concludes `validateFieldStructure` on
    both `accept` and `reject` outputs. This is the theorem that closes
    `inv_field_001` (composed with the residual axiom
    `compareDocumentXml_output_preservation_friendly` in `Spec.lean`). -/
theorem field_structure_preserved_doc (d : Doc) (h : preservationFriendly d) :
    validateFieldStructure (accept d) = true ∧
    validateFieldStructure (reject d) = true := by
  obtain ⟨hv, hAcceptWalk, hRejectWalk, hAcceptBal, hRejectBal⟩ := h
  rw [validateFieldStructure, Bool.and_eq_true] at hv
  obtain ⟨_, hvwalk⟩ := hv
  refine ⟨?_, ?_⟩
  · rw [validateFieldStructure, Bool.and_eq_true]
    refine ⟨?_, ?_⟩
    · rw [fldCharBalanced, accept_blocks, beq_iff_eq]; exact hAcceptBal
    · rw [accept_blocks, hAcceptWalk]; exact hvwalk
  · rw [validateFieldStructure, Bool.and_eq_true]
    refine ⟨?_, ?_⟩
    · rw [fldCharBalanced, reject_blocks, beq_iff_eq]; exact hRejectBal
    · rw [reject_blocks, hRejectWalk]; exact hvwalk

end Tier2.InvFieldOne
