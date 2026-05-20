/-
Tier 2 — generic lemmas about the stack-valued field-context walk.

These are the shared, operation-agnostic results consumed by `InvFieldOne.lean`:

  * `walkBlocks_append` — the walk distributes over list append (L1).
  * `walkBlocks_neutral_ok` — a `fieldContextNeutral` segment is a walk no-op
    under any starting result (L2 core).
  * `neutral_balanced` — context-neutrality implies balanced begin/end counts.
  * `delInstrText_rewrite_safe` — `stepAtom` does not distinguish `instrText`
    from `delInstrText`, so the `reject` rename pass is walk-transparent (L3).

Nothing here mentions `accept` / `reject`; the file is purely about the walk.
-/
import Tier2.FieldStructure

namespace Tier2.WalkLemmas

open Tier2.OoxmlModel Tier2.FieldStructure

/-! ### `invalid` is absorbing -/

theorem stepAtoms_invalid (as : List Atom) :
    stepAtoms .invalid as = .invalid := by
  unfold stepAtoms
  induction as with
  | nil => rfl
  | cons a as ih =>
    show as.foldl stepAtom (stepAtom .invalid a) = .invalid
    exact ih

theorem walkBlocks_invalid (bs : List Block) :
    walkBlocks .invalid bs = .invalid := by
  have key : ∀ (r : WalkResult) (bs : List Block),
      r = .invalid → walkBlocks r bs = .invalid := by
    intro r bs
    induction r, bs using walkBlocks.induct with
    | case1 r => intro h; subst h; simp only [walkBlocks]
    | case2 r run rest ih =>
      intro h; subst h
      simp only [walkBlocks]
      exact ih (stepAtoms_invalid run.content)
    | case3 r bs rest ih1 ih2 =>
      intro h; subst h
      simp only [walkBlocks]
      exact ih2 (ih1 rfl)
    | case4 r bs rest ih1 ih2 =>
      intro h; subst h
      simp only [walkBlocks]
      exact ih2 (ih1 rfl)
    | case5 r bs rest ih1 ih2 =>
      intro h; subst h
      simp only [walkBlocks]
      exact ih2 (ih1 rfl)
    | case6 r bs rest ih1 ih2 =>
      intro h; subst h
      simp only [walkBlocks]
      exact ih2 (ih1 rfl)
  exact key .invalid bs rfl

/-! ### L1 — the walk distributes over append -/

theorem walkBlocks_append (r : WalkResult) (l m : List Block) :
    walkBlocks r (l ++ m) = walkBlocks (walkBlocks r l) m := by
  induction l generalizing r with
  | nil => simp only [List.nil_append, walkBlocks]
  | cons b l ih =>
    cases b with
    | run run => simp only [List.cons_append, walkBlocks]; exact ih _
    | ins bs => simp only [List.cons_append, walkBlocks]; exact ih _
    | del bs => simp only [List.cons_append, walkBlocks]; exact ih _
    | moveFrom bs => simp only [List.cons_append, walkBlocks]; exact ih _
    | moveTo bs => simp only [List.cons_append, walkBlocks]; exact ih _

/-! ### L2 core — a context-neutral segment is a walk no-op -/

theorem walkBlocks_neutral_ok {bs : List Block} (h : fieldContextNeutral bs) :
    ∀ r, walkBlocks r bs = r := by
  intro r
  cases r with
  | invalid => exact walkBlocks_invalid bs
  | ok ctx => exact h ctx

/-! ### `countBlocks` distributes over append -/

theorem countBlocks_append (p : Atom → Bool) (l m : List Block) :
    countBlocks p (l ++ m) = countBlocks p l + countBlocks p m := by
  induction l with
  | nil => simp [countBlocks]
  | cons b l ih =>
    cases b with
    | run run => simp only [List.cons_append, countBlocks]; omega
    | ins bs => simp only [List.cons_append, countBlocks]; omega
    | del bs => simp only [List.cons_append, countBlocks]; omega
    | moveFrom bs => simp only [List.cons_append, countBlocks]; omega
    | moveTo bs => simp only [List.cons_append, countBlocks]; omega

/-! ### L3 — `stepAtom` does not distinguish `instrText` from `delInstrText` -/

theorem delInstrText_rewrite_safe (r : WalkResult) (s s' : String) :
    stepAtom r (.instrText s) = stepAtom r (.delInstrText s') := by
  cases r with
  | invalid => rfl
  | ok ctx =>
    cases ctx with
    | nil => rfl
    | cons b rest => cases b <;> rfl

/-! ### Counting helpers -/

theorem stepAtoms_cons (r : WalkResult) (a : Atom) (as : List Atom) :
    stepAtoms r (a :: as) = stepAtoms (stepAtom r a) as := by
  unfold stepAtoms; rw [List.foldl_cons]

/-! ### `neutral_balanced` — context-neutrality implies balanced begin/end counts

The walk's `end`-on-empty no-op (`pipeline.ts:389`) means a *standalone* walk
can hide an unbalanced subtree. But a *context-neutral* subtree returns to its
starting context under **every** outer stack — in particular a stack tall enough
that no `end` ever underflows. With no underflow the stack length tracks
`begins − ends` exactly, so neutrality forces `begins = ends`. -/

/-- One-atom length bookkeeping under a stack tall enough to absorb an `end`. -/
theorem stepAtom_tall (ctx : FieldCtx) (a : Atom)
    (h : (if Atom.isEnd a then 1 else 0) ≤ ctx.length) :
    stepAtom (.ok ctx) a = .invalid ∨
    ∃ ctx₁, stepAtom (.ok ctx) a = .ok ctx₁ ∧
      ctx₁.length + (if Atom.isEnd a then 1 else 0)
        = ctx.length + (if Atom.isBegin a then 1 else 0) := by
  cases a with
  | text s => exact Or.inr ⟨ctx, rfl, by simp [Atom.isEnd, Atom.isBegin]⟩
  | delText s => exact Or.inr ⟨ctx, rfl, by simp [Atom.isEnd, Atom.isBegin]⟩
  | instrText s =>
    cases ctx with
    | nil => exact Or.inl rfl
    | cons b rest =>
      cases b with
      | false => exact Or.inr ⟨false :: rest, rfl, by simp [Atom.isEnd, Atom.isBegin]⟩
      | true => exact Or.inl rfl
  | delInstrText s =>
    cases ctx with
    | nil => exact Or.inl rfl
    | cons b rest =>
      cases b with
      | false => exact Or.inr ⟨false :: rest, rfl, by simp [Atom.isEnd, Atom.isBegin]⟩
      | true => exact Or.inl rfl
  | fldChar k =>
    cases k with
    | begin => exact Or.inr ⟨false :: ctx, rfl, by simp [Atom.isEnd, Atom.isBegin]⟩
    | separate =>
      cases ctx with
      | nil => exact Or.inr ⟨[], rfl, by simp [Atom.isEnd, Atom.isBegin]⟩
      | cons b rest => exact Or.inr ⟨true :: rest, rfl, by simp [Atom.isEnd, Atom.isBegin]⟩
    | endf =>
      cases ctx with
      | nil => simp [Atom.isEnd] at h
      | cons b rest => exact Or.inr ⟨rest, rfl, by simp [Atom.isEnd, Atom.isBegin]⟩

/-- Atom-level tall-stack length tracking: under a stack at least as tall as the
    total `end` count, the walk either fails or shifts the stack length by
    exactly `begins − ends`. -/
theorem stepAtoms_tall (as : List Atom) (ctx : FieldCtx)
    (h : as.countP Atom.isEnd ≤ ctx.length) :
    stepAtoms (.ok ctx) as = .invalid ∨
    ∃ ctx', stepAtoms (.ok ctx) as = .ok ctx' ∧
      ctx'.length + as.countP Atom.isEnd = ctx.length + as.countP Atom.isBegin := by
  induction as generalizing ctx with
  | nil => exact Or.inr ⟨ctx, rfl, by simp⟩
  | cons a as' ih =>
    rw [stepAtoms_cons]
    rw [List.countP_cons] at h
    have hEndA : (if Atom.isEnd a then 1 else 0) ≤ ctx.length := by
      have := List.countP_cons (l := as') (p := Atom.isEnd) (a := a)
      omega
    rcases stepAtom_tall ctx a hEndA with hinv | ⟨ctx₁, hstep, hlenA⟩
    · rw [hinv]; exact Or.inl (stepAtoms_invalid as')
    · rw [hstep]
      have hbound : as'.countP Atom.isEnd ≤ ctx₁.length := by omega
      rcases ih ctx₁ hbound with hinv2 | ⟨ctx', hok, hlenB⟩
      · exact Or.inl hinv2
      · refine Or.inr ⟨ctx', hok, ?_⟩
        rw [List.countP_cons, List.countP_cons]
        omega

/-- Block-level tall-stack length tracking. Lifts `stepAtoms_tall` over the
    nested block tree via `walkBlocks.induct`. -/
theorem walkBlocks_tall (bs : List Block) (ctx : FieldCtx)
    (h : countBlocks Atom.isEnd bs ≤ ctx.length) :
    walkBlocks (.ok ctx) bs = .invalid ∨
    ∃ ctx', walkBlocks (.ok ctx) bs = .ok ctx' ∧
      ctx'.length + countBlocks Atom.isEnd bs
        = ctx.length + countBlocks Atom.isBegin bs := by
  have key : ∀ (r : WalkResult) (bs : List Block) (ctx : FieldCtx),
      r = .ok ctx → countBlocks Atom.isEnd bs ≤ ctx.length →
        walkBlocks r bs = .invalid ∨
        ∃ ctx', walkBlocks r bs = .ok ctx' ∧
          ctx'.length + countBlocks Atom.isEnd bs
            = ctx.length + countBlocks Atom.isBegin bs := by
    intro r bs
    induction r, bs using walkBlocks.induct with
    | case1 r =>
      intro ctx hr hb; subst hr
      exact Or.inr ⟨ctx, by simp only [walkBlocks], by simp [countBlocks]⟩
    | case2 r run rest ih =>
      intro ctx hr hb; subst hr
      simp only [walkBlocks]
      simp only [countBlocks] at hb ⊢
      rcases stepAtoms_tall run.content ctx (by omega) with hinv | ⟨ctx₁, hstep, hlenA⟩
      · rw [hinv, walkBlocks_invalid]; exact Or.inl rfl
      · rcases ih ctx₁ hstep (by omega) with hinv2 | ⟨ctx', hok, hlenB⟩
        · exact Or.inl hinv2
        · exact Or.inr ⟨ctx', hok, by omega⟩
    | case3 r bs rest ih1 ih2 =>
      intro ctx hr hb; subst hr
      simp only [walkBlocks]
      simp only [countBlocks] at hb ⊢
      rcases ih1 ctx rfl (by omega) with hinv | ⟨ctx₁, hok1, hlenA⟩
      · rw [hinv, walkBlocks_invalid]; exact Or.inl rfl
      · rcases ih2 ctx₁ hok1 (by omega) with hinv2 | ⟨ctx', hok2, hlenB⟩
        · exact Or.inl hinv2
        · exact Or.inr ⟨ctx', hok2, by omega⟩
    | case4 r bs rest ih1 ih2 =>
      intro ctx hr hb; subst hr
      simp only [walkBlocks]
      simp only [countBlocks] at hb ⊢
      rcases ih1 ctx rfl (by omega) with hinv | ⟨ctx₁, hok1, hlenA⟩
      · rw [hinv, walkBlocks_invalid]; exact Or.inl rfl
      · rcases ih2 ctx₁ hok1 (by omega) with hinv2 | ⟨ctx', hok2, hlenB⟩
        · exact Or.inl hinv2
        · exact Or.inr ⟨ctx', hok2, by omega⟩
    | case5 r bs rest ih1 ih2 =>
      intro ctx hr hb; subst hr
      simp only [walkBlocks]
      simp only [countBlocks] at hb ⊢
      rcases ih1 ctx rfl (by omega) with hinv | ⟨ctx₁, hok1, hlenA⟩
      · rw [hinv, walkBlocks_invalid]; exact Or.inl rfl
      · rcases ih2 ctx₁ hok1 (by omega) with hinv2 | ⟨ctx', hok2, hlenB⟩
        · exact Or.inl hinv2
        · exact Or.inr ⟨ctx', hok2, by omega⟩
    | case6 r bs rest ih1 ih2 =>
      intro ctx hr hb; subst hr
      simp only [walkBlocks]
      simp only [countBlocks] at hb ⊢
      rcases ih1 ctx rfl (by omega) with hinv | ⟨ctx₁, hok1, hlenA⟩
      · rw [hinv, walkBlocks_invalid]; exact Or.inl rfl
      · rcases ih2 ctx₁ hok1 (by omega) with hinv2 | ⟨ctx', hok2, hlenB⟩
        · exact Or.inl hinv2
        · exact Or.inr ⟨ctx', hok2, by omega⟩
  exact key (.ok ctx) bs ctx rfl h

/-- **L2 / counting corollary.** A field-context-neutral subtree has equal
    `w:fldChar` begin and end counts. -/
theorem neutral_balanced {bs : List Block} (h : fieldContextNeutral bs) :
    countBlocks Atom.isBegin bs = countBlocks Atom.isEnd bs := by
  have hlenrep : (List.replicate (countBlocks Atom.isEnd bs) false).length
      = countBlocks Atom.isEnd bs := by simp
  have hwalk := h (List.replicate (countBlocks Atom.isEnd bs) false)
  have htall := walkBlocks_tall bs (List.replicate (countBlocks Atom.isEnd bs) false)
    (by omega)
  rw [hwalk] at htall
  rcases htall with hinv | ⟨ctx', hok, hlen⟩
  · simp at hinv
  · simp only [WalkResult.ok.injEq] at hok
    subst hok
    rw [hlenrep] at hlen
    omega

end Tier2.WalkLemmas
