import LeanSpike.Lcs
/-!
# Functional Wagner–Fischer DP and its equivalence to the recursive LCS

This module closes the final Tier 2.5 item: a fully discharged proof (no proof
placeholders) that an iterative-style Wagner–Fischer LCS agrees *exactly* with the recursive
`LeanSpike.computeAtomLcs` (`Lcs.lean`). The two shipped differential harnesses
(`Differential.lean` + `lean-differential-lcs.test.ts`) established this
empirically (1,194,649 pairs, zero divergence); this module makes it universal.

## What this is (and is not)

The Wagner–Fischer DP is expressed here as a **recursive functional recurrence**,
not a bottom-up mutable 2-D array: `lcsLen` is the length recurrence
(`dp[i][j]`) and `dpMatches` is the backtracker that consults it. This proves
**DP-recurrence equivalence**. It is deliberately *not* a memoized/bottom-up
implementation — the recurrence form is what makes the equivalence proof
tractable and keeps it in the same `List`-recursion style the rest of the spike
is proven in.

## Why exact-output equality holds despite different tie-breaks

`computeAtomLcs` (recursive) and a Wagner–Fischer DP break LCS ties by different
*surface* rules, yet pick the same canonical LCS. The reconciliation is:
`(rawMatches orig rev).length` already satisfies the Wagner–Fischer length
recurrence **definitionally** (equal head → `+1`; else → `max` of the two drops,
because `rawMatches`'s `else` branch keeps the longer drop). So `lcsLen` and
`rawMatches.length` agree (`lcsLen_eq_rawMatches_length`), and therefore the
backtracker's comparison `lcsLen os (r::rs) > lcsLen (o::os) rs` is the *same*
boolean `rawMatches` tests on its two drop lengths. Identical decisions at every
step give `dpMatches = rawMatches` and hence `computeAtomLcsDP = computeAtomLcs`.
-/
namespace LeanSpike
open List

/-- Wagner–Fischer LCS **length** recurrence (`dp[i][j]`), expressed recursively.
    Mirrors `rawMatches`'s control flow exactly: equal heads contribute one match;
    otherwise the longer of the two single-drop subproblems wins. -/
def lcsLen : List Atom → List Atom → Nat
  | [], _ => 0
  | _, [] => 0
  | o :: os, r :: rs =>
      if atomsEqual o r then
        lcsLen os rs + 1
      else
        max (lcsLen os (r :: rs)) (lcsLen (o :: os) rs)
termination_by orig rev => orig.length + rev.length

/-- Wagner–Fischer **backtracker**: rebuilds the match list, consulting `lcsLen`
    to choose which input to drop on a mismatch. The decision rule and tie-break
    (`>` → drop original head, else → drop revised head) mirror `rawMatches`. -/
def dpMatches : List Atom → List Atom → List Match
  | [], _ => []
  | _, [] => []
  | o :: os, r :: rs =>
      if atomsEqual o r then
        (0, 0) :: (dpMatches os rs).map (fun p => (p.1 + 1, p.2 + 1))
      else
        let dropOrig := (dpMatches os (r :: rs)).map (fun p => (p.1 + 1, p.2))
        let dropRev := (dpMatches (o :: os) rs).map (fun p => (p.1, p.2 + 1))
        if lcsLen os (r :: rs) > lcsLen (o :: os) rs then dropOrig else dropRev
termination_by orig rev => orig.length + rev.length

/-- DP analogue of `computeMatches`: reverse, backtrack, map indices back, reverse. -/
def computeMatchesDP (orig rev : List Atom) : List Match :=
  (dpMatches orig.reverse rev.reverse).map (mapBack orig.length rev.length) |>.reverse

/-- DP analogue of `computeAtomLcs`. Same `LcsResult` field construction. -/
def computeAtomLcsDP (orig rev : List Atom) : LcsResult :=
  let ms := computeMatchesDP orig rev
  let matchedOriginal := ms.map Prod.fst
  let matchedRevised := ms.map Prod.snd
  {
    «matches» := ms
    deletedIndices := (List.range orig.length).filter (fun idx => !(matchedOriginal.contains idx))
    insertedIndices := (List.range rev.length).filter (fun idx => !(matchedRevised.contains idx))
  }

/-- **Stage 2 — length equality.** The Wagner–Fischer length recurrence agrees
    with the length of the recursive LCS. Proved by strong induction; crucially
    this needs only `rawMatches`'s *definition* (the `else` branch keeps the
    longer drop, so its length is the `max`), **not** the optimality theorem
    `rawMatches_are_longest`. -/
theorem lcsLen_eq_rawMatches_length (orig rev : List Atom) :
    lcsLen orig rev = (rawMatches orig rev).length := by
  refine Nat.strong_induction_on (p := fun n => ∀ orig rev, orig.length + rev.length = n →
      lcsLen orig rev = (rawMatches orig rev).length)
    (orig.length + rev.length) ?_ orig rev rfl
  intro n ih orig rev hLen
  cases orig with
  | nil => simp [lcsLen, rawMatches]
  | cons o os =>
      cases rev with
      | nil => simp [lcsLen, rawMatches]
      | cons r rs =>
          by_cases hEq : atomsEqual o r = true
          · have hSmall : os.length + rs.length < n := by
              simp only [List.length_cons] at hLen ⊢; omega
            have ih' := ih (os.length + rs.length) hSmall os rs rfl
            simp [lcsLen, rawMatches, hEq, ih']
          · have hSmallLeft : os.length + (r :: rs).length < n := by
              simp only [List.length_cons] at hLen ⊢; omega
            have hSmallRight : (o :: os).length + rs.length < n := by
              simp only [List.length_cons] at hLen ⊢; omega
            have ihLeft := ih (os.length + (r :: rs).length) hSmallLeft os (r :: rs) rfl
            have ihRight := ih ((o :: os).length + rs.length) hSmallRight (o :: os) rs rfl
            by_cases hChoose : (rawMatches (o :: os) rs).length < (rawMatches os (r :: rs)).length
            · -- mismatch, original-drop strictly longer ⇒ both sides take that length
              rw [lcsLen, ihLeft, ihRight, Nat.max_eq_left (Nat.le_of_lt hChoose)]
              simp [rawMatches, hEq, hChoose, List.length_map]
            · -- tie or revised-drop longer ⇒ both sides take the revised-drop length
              rw [lcsLen, ihLeft, ihRight, Nat.max_eq_right (Nat.le_of_not_gt hChoose)]
              simp [rawMatches, hEq, hChoose, List.length_map]

/-- **Stage 3 — exact match-list equality.** The backtracker produces exactly the
    same match list as the recursive LCS. The crux is the mismatch branch: the DP
    consults `lcsLen os (r::rs) > lcsLen (o::os) rs`, which `lcsLen_eq_rawMatches_length`
    turns into `(rawMatches os (r::rs)).length > (rawMatches (o::os) rs).length` — the
    *very* comparison `rawMatches` performs on its two drops. Same decision, same
    tie-break, so the two agree step for step. -/
theorem dpMatches_eq_rawMatches (orig rev : List Atom) :
    dpMatches orig rev = rawMatches orig rev := by
  refine Nat.strong_induction_on (p := fun n => ∀ orig rev, orig.length + rev.length = n →
      dpMatches orig rev = rawMatches orig rev)
    (orig.length + rev.length) ?_ orig rev rfl
  intro n ih orig rev hLen
  cases orig with
  | nil => simp [dpMatches, rawMatches]
  | cons o os =>
      cases rev with
      | nil => simp [dpMatches, rawMatches]
      | cons r rs =>
          by_cases hEq : atomsEqual o r = true
          · have hSmall : os.length + rs.length < n := by
              simp only [List.length_cons] at hLen ⊢; omega
            have ih' := ih (os.length + rs.length) hSmall os rs rfl
            simp [dpMatches, rawMatches, hEq, ih']
          · have hSmallLeft : os.length + (r :: rs).length < n := by
              simp only [List.length_cons] at hLen ⊢; omega
            have hSmallRight : (o :: os).length + rs.length < n := by
              simp only [List.length_cons] at hLen ⊢; omega
            have ihLeft := ih (os.length + (r :: rs).length) hSmallLeft os (r :: rs) rfl
            have ihRight := ih ((o :: os).length + rs.length) hSmallRight (o :: os) rs rfl
            have hLenLeft := lcsLen_eq_rawMatches_length os (r :: rs)
            have hLenRight := lcsLen_eq_rawMatches_length (o :: os) rs
            by_cases hChoose : (rawMatches (o :: os) rs).length < (rawMatches os (r :: rs)).length
            · -- original-drop strictly longer ⇒ both keep `dropOrig` (uses `ihLeft`)
              simp [dpMatches, rawMatches, hEq, ihLeft, hLenLeft, hLenRight, hChoose,
                    List.length_map]
            · -- tie or revised-drop longer ⇒ both keep `dropRev` (uses `ihRight`)
              simp [dpMatches, rawMatches, hEq, ihRight, hLenLeft, hLenRight, hChoose,
                    List.length_map]

/-- The DP backtracker agrees with `computeMatches` after the reverse/mapBack wrapper. -/
theorem computeMatchesDP_eq_computeMatches (orig rev : List Atom) :
    computeMatchesDP orig rev = computeMatches orig rev := by
  simp [computeMatchesDP, computeMatches, dpMatches_eq_rawMatches]

/-- **Stage 3 (closing artifact) — full `LcsResult` equality.** The functional
    Wagner–Fischer DP and the recursive LCS produce byte-identical results
    (matches, deletedIndices, insertedIndices) on every input. This is the
    universal counterpart to the 1,194,649-pair differential. -/
theorem computeAtomLcsDP_eq_computeAtomLcs (orig rev : List Atom) :
    computeAtomLcsDP orig rev = computeAtomLcs orig rev := by
  simp [computeAtomLcsDP, computeAtomLcs, computeMatchesDP_eq_computeMatches]

/-- Length equality as an immediate corollary, in `LcsResult` terms. -/
theorem computeAtomLcsDP_matches_length_eq (orig rev : List Atom) :
    (computeAtomLcsDP orig rev).matches.length = (computeAtomLcs orig rev).matches.length := by
  rw [computeAtomLcsDP_eq_computeAtomLcs]

/-! ## Stage 4 — `atomsEqual`-level optimality (strengthening INV-LCS-002)

`rawMatches_are_longest` (`Lcs.lean`) bounds the length of every *structural*
common subsequence (`s <+ orig ∧ s <+ rev`, literal sublists). After broadening
`Atom` with LCS-irrelevant fields, that is *strictly weaker* than optimality under
`atomsEqual`: two atoms can be `atomsEqual` (agree on `Atom.relevant`) while
differing structurally, so an `atomsEqual`-matchable common subsequence need not be
a structural sublist of both inputs. The theorem below closes that gap — it bounds
every common subsequence of the **relevant projections** (`orig.map Atom.relevant`,
`rev.map Atom.relevant`), which is exactly optimality at the `atomsEqual` level. -/

/-- Converse of `atomsEqual_implies_relevant_eq`: agreeing on the relevant
    projection is *sufficient* for `atomsEqual` (the projection is precisely the
    fields `atomsEqual` inspects). Together they give `atomsEqual a b ↔ a.relevant = b.relevant`. -/
lemma atomsEqual_of_relevant_eq (a b : Atom) (h : a.relevant = b.relevant) :
    atomsEqual a b = true := by
  simp only [Atom.relevant, Prod.mk.injEq] at h
  simp [atomsEqual, h.1, h.2.1, h.2.2]

/-- A mismatch (`atomsEqual a b = false`) means the relevant projections differ. -/
lemma relevant_ne_of_not_atomsEqual (a b : Atom) (h : atomsEqual a b ≠ true) :
    a.relevant ≠ b.relevant := fun hRel => h (atomsEqual_of_relevant_eq a b hRel)

/-- Generic head-drop for a list sitting under two cons-lists (the type-polymorphic
    core of `commonSubseq_drop_heads`; heads need not match). -/
lemma sublist_drop_heads {α : Type} {a b : α} {os rs s : List α}
    (hOrig : s <+ a :: os) (hRev : s <+ b :: rs) :
    ∃ t, t <+ os ∧ t <+ rs ∧ s.length ≤ t.length + 1 := by
  cases s with
  | nil => exact ⟨[], by simp, by simp, by simp⟩
  | cons x xs =>
      rcases List.cons_sublist_cons'.1 hOrig with hOrigTail | ⟨_, hXsOrig⟩
      · rcases List.cons_sublist_cons'.1 hRev with hRevTail | ⟨_, hXsRev⟩
        · exact ⟨x :: xs, hOrigTail, hRevTail, by simp⟩
        · exact ⟨xs, tail_sublist_of_cons_sublist hOrigTail, hXsRev, by simp⟩
      · rcases List.cons_sublist_cons'.1 hRev with hRevTail | ⟨_, hXsRev⟩
        · exact ⟨xs, hXsOrig, tail_sublist_of_cons_sublist hRevTail, by simp⟩
        · exact ⟨xs, hXsOrig, hXsRev, by simp⟩

/-- A common subsequence at the `atomsEqual` / `Atom.relevant` level: a sequence of
    relevant-projections that is a sublist of both inputs' projections. Strictly more
    permissive than the structural `isCommonSubseq` (`Lcs.lean`). -/
def isRelevantCommonSubseq (t : List (String × String × String)) (orig rev : List Atom) : Prop :=
  t <+ orig.map Atom.relevant ∧ t <+ rev.map Atom.relevant

/-- **INV-LCS-002 strengthened — optimality under `atomsEqual`.** Every common
    subsequence of the relevant projections is no longer than `rawMatches`. Mirrors
    the structure of `rawMatches_are_longest`, lifted to projected lists via
    `sublist_drop_heads` and `relevant_ne_of_not_atomsEqual`. -/
theorem rawMatches_are_longest_relevant (orig rev : List Atom)
    (t : List (String × String × String)) :
    isRelevantCommonSubseq t orig rev → t.length ≤ (rawMatches orig rev).length := by
  refine Nat.strong_induction_on
    (p := fun n => ∀ orig rev, orig.length + rev.length = n →
      ∀ t, isRelevantCommonSubseq t orig rev →
        t.length ≤ (rawMatches orig rev).length)
    (orig.length + rev.length) ?_ orig rev rfl t
  intro n ih orig rev hLen t hCommon
  rcases hCommon with ⟨hOrig, hRev⟩
  cases orig with
  | nil =>
      rw [List.map_nil, List.sublist_nil] at hOrig
      simp [hOrig]
  | cons o os =>
      cases rev with
      | nil =>
          rw [List.map_nil, List.sublist_nil] at hRev
          simp [hRev]
      | cons r rs =>
          by_cases hEq : atomsEqual o r = true
          · have hSmall : os.length + rs.length < n := by
              simp only [List.length_cons] at hLen ⊢; omega
            rw [List.map_cons] at hOrig hRev
            rcases sublist_drop_heads hOrig hRev with ⟨t', ht'o, ht'r, hDrop⟩
            have hRec := ih (os.length + rs.length) hSmall os rs rfl t' ⟨ht'o, ht'r⟩
            have hBound : t.length ≤ (rawMatches os rs).length + 1 :=
              le_trans hDrop (Nat.succ_le_succ hRec)
            simpa [rawMatches, hEq] using hBound
          · have hSmallLeft : os.length + (r :: rs).length < n := by
              simp only [List.length_cons] at hLen ⊢; omega
            have hSmallRight : (o :: os).length + rs.length < n := by
              simp only [List.length_cons] at hLen ⊢; omega
            have hNe : o.relevant ≠ r.relevant := relevant_ne_of_not_atomsEqual o r (by simp [hEq])
            cases t with
            | nil => simp
            | cons x xs =>
                rw [List.map_cons] at hOrig
                rcases List.cons_sublist_cons'.1 hOrig with hOrigTail | ⟨hxo, hXsOrig⟩
                · -- original head dropped: `x :: xs` is still a relevant-common-subseq of `(os, r::rs)`
                  have hRec := ih (os.length + (r :: rs).length) hSmallLeft os (r :: rs) rfl
                    (x :: xs) ⟨hOrigTail, hRev⟩
                  have hChooseLeft :
                      (rawMatches os (r :: rs)).length ≤ (rawMatches (o :: os) (r :: rs)).length := by
                    by_cases hChoose : (rawMatches (o :: os) rs).length <
                        (rawMatches os (r :: rs)).length
                    · simp [rawMatches, hEq, hChoose]
                    · have hLe : (rawMatches os (r :: rs)).length ≤ (rawMatches (o :: os) rs).length :=
                        Nat.le_of_not_gt hChoose
                      simp [rawMatches, hEq, hChoose, hLe]
                  exact le_trans hRec hChooseLeft
                · -- head matches `o.relevant`; on the revised side `r.relevant ≠ x` must be dropped
                  subst hxo
                  rw [List.map_cons] at hRev
                  have hRevTail : o.relevant :: xs <+ rs.map Atom.relevant :=
                    List.Sublist.of_cons_of_ne hNe hRev
                  have hOrigFull : o.relevant :: xs <+ (o :: os).map Atom.relevant := by
                    rw [List.map_cons]; exact List.Sublist.cons₂ o.relevant hXsOrig
                  have hRec := ih ((o :: os).length + rs.length) hSmallRight (o :: os) rs rfl
                    (o.relevant :: xs) ⟨hOrigFull, hRevTail⟩
                  have hChooseRight :
                      (rawMatches (o :: os) rs).length ≤ (rawMatches (o :: os) (r :: rs)).length := by
                    by_cases hChoose : (rawMatches (o :: os) rs).length <
                        (rawMatches os (r :: rs)).length
                    · have hLe : (rawMatches (o :: os) rs).length ≤ (rawMatches os (r :: rs)).length :=
                        Nat.le_of_lt hChoose
                      simp [rawMatches, hEq, hChoose, hLe]
                    · simp [rawMatches, hEq, hChoose]
                  exact le_trans hRec hChooseRight

end LeanSpike
