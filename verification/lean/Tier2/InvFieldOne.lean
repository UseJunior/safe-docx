/-
Tier 2 — the preservation lemma.

`field_structure_preserved`: for any document satisfying `recursivelyWellformed`,
both `accept` and `reject` produce output that satisfies `validateFieldStructure`.

This is the core machine-checked content of the `inv_field_001` closure. The
proof consumes the generic walk lemmas from `WalkLemmas.lean`:

  * `accept` drops `del` / `moveFrom` subtrees and unwraps `ins` / `moveTo`.
    Unwrapping is walk-transparent unconditionally (it is just list append, L1);
    dropping a `fieldContextNeutral` subtree is a walk no-op (L2). Begin/end
    balance survives because a context-neutral subtree is begin/end-balanced
    (`neutral_balanced`).
  * `reject` is symmetric; its global `delInstrText → instrText` rename pass is
    walk- and count-transparent because `stepAtom` does not distinguish the two
    atoms (L3, `delInstrText_rewrite_safe`).
-/
import Tier2.AcceptReject
import Tier2.WalkLemmas

namespace Tier2.InvFieldOne

open Tier2.OoxmlModel Tier2.FieldStructure Tier2.AcceptReject Tier2.WalkLemmas

/-! ### `allNeutral` decomposition -/

theorem allNeutral_run {r : Run} {rest : List Block}
    (h : allNeutral (.run r :: rest)) : allNeutral rest := by
  unfold allNeutral at h ⊢
  simpa only [wrapperSubtreesBlocks] using h

theorem allNeutral_ins {bs rest : List Block} (h : allNeutral (.ins bs :: rest)) :
    fieldContextNeutral bs ∧ allNeutral bs ∧ allNeutral rest := by
  unfold allNeutral at h
  simp only [wrapperSubtreesBlocks, List.mem_append, List.mem_cons] at h
  refine ⟨h bs (Or.inl (Or.inl rfl)), ?_, ?_⟩
  · intro sub hsub; exact h sub (Or.inl (Or.inr hsub))
  · intro sub hsub; exact h sub (Or.inr hsub)

theorem allNeutral_del {bs rest : List Block} (h : allNeutral (.del bs :: rest)) :
    fieldContextNeutral bs ∧ allNeutral bs ∧ allNeutral rest := by
  unfold allNeutral at h
  simp only [wrapperSubtreesBlocks, List.mem_append, List.mem_cons] at h
  refine ⟨h bs (Or.inl (Or.inl rfl)), ?_, ?_⟩
  · intro sub hsub; exact h sub (Or.inl (Or.inr hsub))
  · intro sub hsub; exact h sub (Or.inr hsub)

theorem allNeutral_moveFrom {bs rest : List Block}
    (h : allNeutral (.moveFrom bs :: rest)) :
    fieldContextNeutral bs ∧ allNeutral bs ∧ allNeutral rest := by
  unfold allNeutral at h
  simp only [wrapperSubtreesBlocks, List.mem_append, List.mem_cons] at h
  refine ⟨h bs (Or.inl (Or.inl rfl)), ?_, ?_⟩
  · intro sub hsub; exact h sub (Or.inl (Or.inr hsub))
  · intro sub hsub; exact h sub (Or.inr hsub)

theorem allNeutral_moveTo {bs rest : List Block}
    (h : allNeutral (.moveTo bs :: rest)) :
    fieldContextNeutral bs ∧ allNeutral bs ∧ allNeutral rest := by
  unfold allNeutral at h
  simp only [wrapperSubtreesBlocks, List.mem_append, List.mem_cons] at h
  refine ⟨h bs (Or.inl (Or.inl rfl)), ?_, ?_⟩
  · intro sub hsub; exact h sub (Or.inl (Or.inr hsub))
  · intro sub hsub; exact h sub (Or.inr hsub)

/-- `.other` is NOT a track-change wrapper: its child block list is not added
    as a wrapper subtree (only wrappers nested inside it are). So `allNeutral`
    decomposes into `allNeutral` on children and on rest, with no extra
    `fieldContextNeutral` obligation on the container's children. -/
theorem allNeutral_other {tag : String} {bs rest : List Block}
    (h : allNeutral (.other tag bs :: rest)) :
    allNeutral bs ∧ allNeutral rest := by
  unfold allNeutral at h
  simp only [wrapperSubtreesBlocks, List.mem_append] at h
  refine ⟨?_, ?_⟩
  · intro sub hsub; exact h sub (Or.inl hsub)
  · intro sub hsub; exact h sub (Or.inr hsub)

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

/-! ### `renameBlocks` is walk- and count-transparent (L3) -/

theorem stepAtom_renameAtom (r : WalkResult) (a : Atom) :
    stepAtom r (renameAtom a) = stepAtom r a := by
  cases a with
  | text s => rfl
  | delText s => cases r <;> rfl
  | instrText s => rfl
  | delInstrText s => exact delInstrText_rewrite_safe r s s
  | fldChar k => rfl

theorem stepAtoms_renameAtom (r : WalkResult) (as : List Atom) :
    stepAtoms r (as.map renameAtom) = stepAtoms r as := by
  induction as generalizing r with
  | nil => rfl
  | cons a as ih =>
    rw [List.map_cons, stepAtoms_cons, stepAtoms_cons, stepAtom_renameAtom]
    exact ih _

theorem walkBlocks_renameBlocks (r : WalkResult) (bs : List Block) :
    walkBlocks r (renameBlocks bs) = walkBlocks r bs := by
  have key : ∀ (bs : List Block) (r : WalkResult),
      walkBlocks r (renameBlocks bs) = walkBlocks r bs := by
    intro bs
    induction bs using renameBlocks.induct with
    | case1 => intro r; simp only [renameBlocks]
    | case2 r' rest ih =>
      intro r
      simp only [renameBlocks, walkBlocks]
      rw [stepAtoms_renameAtom]
      exact ih _
    | case3 bs rest ih1 ih2 =>
      intro r
      simp only [renameBlocks, walkBlocks]
      rw [ih1]
      exact ih2 _
    | case4 bs rest ih1 ih2 =>
      intro r
      simp only [renameBlocks, walkBlocks]
      rw [ih1]
      exact ih2 _
    | case5 bs rest ih1 ih2 =>
      intro r
      simp only [renameBlocks, walkBlocks]
      rw [ih1]
      exact ih2 _
    | case6 bs rest ih1 ih2 =>
      intro r
      simp only [renameBlocks, walkBlocks]
      rw [ih1]
      exact ih2 _
    | case7 _ bs rest ih1 ih2 =>
      intro r
      simp only [renameBlocks, walkBlocks]
      rw [ih1]
      exact ih2 _
  exact key bs r

theorem countBlocks_renameBlocks (p : Atom → Bool)
    (hp : ∀ a, p (renameAtom a) = p a) (bs : List Block) :
    countBlocks p (renameBlocks bs) = countBlocks p bs := by
  induction bs using renameBlocks.induct with
  | case1 => simp [renameBlocks, countBlocks]
  | case2 r rest ih =>
    simp only [renameBlocks, countBlocks]
    rw [List.countP_map]
    have hfun : p ∘ renameAtom = p := funext hp
    rw [hfun, ih]
  | case3 bs rest ih1 ih2 =>
    simp only [renameBlocks, countBlocks]; rw [ih1, ih2]
  | case4 bs rest ih1 ih2 =>
    simp only [renameBlocks, countBlocks]; rw [ih1, ih2]
  | case5 bs rest ih1 ih2 =>
    simp only [renameBlocks, countBlocks]; rw [ih1, ih2]
  | case6 bs rest ih1 ih2 =>
    simp only [renameBlocks, countBlocks]; rw [ih1, ih2]
  | case7 _ bs rest ih1 ih2 =>
    simp only [renameBlocks, countBlocks]; rw [ih1, ih2]

theorem isBegin_renameAtom (a : Atom) : Atom.isBegin (renameAtom a) = Atom.isBegin a := by
  cases a <;> rfl

theorem isEnd_renameAtom (a : Atom) : Atom.isEnd (renameAtom a) = Atom.isEnd a := by
  cases a <;> rfl

/-! ### Walk preservation for `acceptBlocks` / `rejectBlocks` -/

theorem walkBlocks_acceptBlocks :
    ∀ (bs : List Block), allNeutral bs →
      ∀ r, walkBlocks r (acceptBlocks bs) = walkBlocks r bs := by
  intro bs
  induction bs using acceptBlocks.induct with
  | case1 => intro _ r; simp only [acceptBlocks]
  | case2 r' rest ih =>
    intro hn r
    simp only [acceptBlocks, walkBlocks]
    exact ih (allNeutral_run hn) _
  | case3 bs rest ih1 ih2 =>
    intro hn r
    obtain ⟨_, hnbs, hnrest⟩ := allNeutral_ins hn
    simp only [acceptBlocks, walkBlocks]
    rw [walkBlocks_append, ih1 hnbs, ih2 hnrest]
  | case4 bs rest ih1 ih2 =>
    intro hn r
    obtain ⟨_, hnbs, hnrest⟩ := allNeutral_moveTo hn
    simp only [acceptBlocks, walkBlocks]
    rw [walkBlocks_append, ih1 hnbs, ih2 hnrest]
  | case5 bs rest ih =>
    intro hn r
    obtain ⟨hcn, _, hnrest⟩ := allNeutral_del hn
    simp only [acceptBlocks, walkBlocks]
    rw [ih hnrest, walkBlocks_neutral_ok hcn r]
  | case6 bs rest ih =>
    intro hn r
    obtain ⟨hcn, _, hnrest⟩ := allNeutral_moveFrom hn
    simp only [acceptBlocks, walkBlocks]
    rw [ih hnrest, walkBlocks_neutral_ok hcn r]
  | case7 _ bs rest ih1 ih2 =>
    intro hn r
    obtain ⟨hnbs, hnrest⟩ := allNeutral_other hn
    simp only [acceptBlocks, walkBlocks]
    rw [ih1 hnbs, ih2 hnrest]

theorem walkBlocks_rejectBlocks :
    ∀ (bs : List Block), allNeutral bs →
      ∀ r, walkBlocks r (rejectBlocks bs) = walkBlocks r bs := by
  intro bs
  induction bs using rejectBlocks.induct with
  | case1 => intro _ r; simp only [rejectBlocks]
  | case2 r' rest ih =>
    intro hn r
    simp only [rejectBlocks, walkBlocks]
    exact ih (allNeutral_run hn) _
  | case3 bs rest ih =>
    intro hn r
    obtain ⟨hcn, _, hnrest⟩ := allNeutral_ins hn
    simp only [rejectBlocks, walkBlocks]
    rw [ih hnrest, walkBlocks_neutral_ok hcn r]
  | case4 bs rest ih =>
    intro hn r
    obtain ⟨hcn, _, hnrest⟩ := allNeutral_moveTo hn
    simp only [rejectBlocks, walkBlocks]
    rw [ih hnrest, walkBlocks_neutral_ok hcn r]
  | case5 bs rest ih1 ih2 =>
    intro hn r
    obtain ⟨_, hnbs, hnrest⟩ := allNeutral_del hn
    simp only [rejectBlocks, walkBlocks]
    rw [walkBlocks_append, ih1 hnbs, ih2 hnrest]
  | case6 bs rest ih1 ih2 =>
    intro hn r
    obtain ⟨_, hnbs, hnrest⟩ := allNeutral_moveFrom hn
    simp only [rejectBlocks, walkBlocks]
    rw [walkBlocks_append, ih1 hnbs, ih2 hnrest]
  | case7 _ bs rest ih1 ih2 =>
    intro hn r
    obtain ⟨hnbs, hnrest⟩ := allNeutral_other hn
    simp only [rejectBlocks, walkBlocks]
    rw [ih1 hnbs, ih2 hnrest]

/-! ### Count rebalancing for `acceptBlocks` / `rejectBlocks` -/

theorem countBlocks_acceptBlocks_balance :
    ∀ (bs : List Block), allNeutral bs →
      countBlocks Atom.isBegin (acceptBlocks bs) + countBlocks Atom.isEnd bs
        = countBlocks Atom.isEnd (acceptBlocks bs) + countBlocks Atom.isBegin bs := by
  intro bs
  induction bs using acceptBlocks.induct with
  | case1 => intro _; simp [acceptBlocks, countBlocks]
  | case2 r' rest ih =>
    intro hn
    simp only [acceptBlocks, countBlocks]
    have := ih (allNeutral_run hn)
    omega
  | case3 bs rest ih1 ih2 =>
    intro hn
    obtain ⟨_, hnbs, hnrest⟩ := allNeutral_ins hn
    simp only [acceptBlocks, countBlocks]
    rw [countBlocks_append, countBlocks_append]
    have h1 := ih1 hnbs
    have h2 := ih2 hnrest
    omega
  | case4 bs rest ih1 ih2 =>
    intro hn
    obtain ⟨_, hnbs, hnrest⟩ := allNeutral_moveTo hn
    simp only [acceptBlocks, countBlocks]
    rw [countBlocks_append, countBlocks_append]
    have h1 := ih1 hnbs
    have h2 := ih2 hnrest
    omega
  | case5 bs rest ih =>
    intro hn
    obtain ⟨hcn, _, hnrest⟩ := allNeutral_del hn
    simp only [acceptBlocks, countBlocks]
    have hbal := neutral_balanced hcn
    have := ih hnrest
    omega
  | case6 bs rest ih =>
    intro hn
    obtain ⟨hcn, _, hnrest⟩ := allNeutral_moveFrom hn
    simp only [acceptBlocks, countBlocks]
    have hbal := neutral_balanced hcn
    have := ih hnrest
    omega
  | case7 _ bs rest ih1 ih2 =>
    intro hn
    obtain ⟨hnbs, hnrest⟩ := allNeutral_other hn
    simp only [acceptBlocks, countBlocks]
    have h1 := ih1 hnbs
    have h2 := ih2 hnrest
    omega

theorem countBlocks_rejectBlocks_balance :
    ∀ (bs : List Block), allNeutral bs →
      countBlocks Atom.isBegin (rejectBlocks bs) + countBlocks Atom.isEnd bs
        = countBlocks Atom.isEnd (rejectBlocks bs) + countBlocks Atom.isBegin bs := by
  intro bs
  induction bs using rejectBlocks.induct with
  | case1 => intro _; simp [rejectBlocks, countBlocks]
  | case2 r' rest ih =>
    intro hn
    simp only [rejectBlocks, countBlocks]
    have := ih (allNeutral_run hn)
    omega
  | case3 bs rest ih =>
    intro hn
    obtain ⟨hcn, _, hnrest⟩ := allNeutral_ins hn
    simp only [rejectBlocks, countBlocks]
    have hbal := neutral_balanced hcn
    have := ih hnrest
    omega
  | case4 bs rest ih =>
    intro hn
    obtain ⟨hcn, _, hnrest⟩ := allNeutral_moveTo hn
    simp only [rejectBlocks, countBlocks]
    have hbal := neutral_balanced hcn
    have := ih hnrest
    omega
  | case5 bs rest ih1 ih2 =>
    intro hn
    obtain ⟨_, hnbs, hnrest⟩ := allNeutral_del hn
    simp only [rejectBlocks, countBlocks]
    rw [countBlocks_append, countBlocks_append]
    have h1 := ih1 hnbs
    have h2 := ih2 hnrest
    omega
  | case6 bs rest ih1 ih2 =>
    intro hn
    obtain ⟨_, hnbs, hnrest⟩ := allNeutral_moveFrom hn
    simp only [rejectBlocks, countBlocks]
    rw [countBlocks_append, countBlocks_append]
    have h1 := ih1 hnbs
    have h2 := ih2 hnrest
    omega
  | case7 _ bs rest ih1 ih2 =>
    intro hn
    obtain ⟨hnbs, hnrest⟩ := allNeutral_other hn
    simp only [rejectBlocks, countBlocks]
    have h1 := ih1 hnbs
    have h2 := ih2 hnrest
    omega

/-! ### The preservation lemma -/

/-- **`field_structure_preserved`.** For any document satisfying the recursive
    well-formedness precondition, both `accept` and `reject` produce output that
    passes `validateFieldStructure`. This is the Tier 2 result that closes
    `inv_field_001` once composed with the residual axiom in `Spec.lean`. -/
theorem field_structure_preserved (d : Doc) (h : recursivelyWellformed d) :
    validateFieldStructure (accept d) = true ∧
    validateFieldStructure (reject d) = true := by
  obtain ⟨hv, hn⟩ := h
  rw [validateFieldStructure, Bool.and_eq_true] at hv
  obtain ⟨hvbal, hvwalk⟩ := hv
  rw [fldCharBalanced, beq_iff_eq] at hvbal
  refine ⟨?_, ?_⟩
  · -- accept
    rw [validateFieldStructure, Bool.and_eq_true]
    refine ⟨?_, ?_⟩
    · rw [fldCharBalanced, accept_blocks, beq_iff_eq]
      have hbal := countBlocks_acceptBlocks_balance d.blocks hn
      omega
    · rw [accept_blocks, walkBlocks_acceptBlocks d.blocks hn]
      exact hvwalk
  · -- reject
    rw [validateFieldStructure, Bool.and_eq_true]
    refine ⟨?_, ?_⟩
    · rw [fldCharBalanced, reject_blocks, beq_iff_eq,
          countBlocks_renameBlocks _ isBegin_renameAtom,
          countBlocks_renameBlocks _ isEnd_renameAtom]
      have hbal := countBlocks_rejectBlocks_balance d.blocks hn
      omega
    · rw [reject_blocks, walkBlocks_renameBlocks,
          walkBlocks_rejectBlocks d.blocks hn]
      exact hvwalk

end Tier2.InvFieldOne
