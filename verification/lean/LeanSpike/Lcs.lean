import Mathlib.Data.List.Basic
import Mathlib.Data.List.Pairwise
import Mathlib.Tactic
import LeanSpike.Atom
import LeanSpike.AtomsEqual
namespace LeanSpike
open List
abbrev Match := Nat × Nat
structure LcsResult where
  «matches» : List Match
  deletedIndices : List Nat
  insertedIndices : List Nat
/-- A **structural** common subsequence: `s` is literally a sublist of both inputs
    (same `Atom`s, including LCS-irrelevant fields). NOTE on scope after broadening
    `Atom`: the optimality theorem `rawMatches_are_longest` (INV-LCS-002) bounds the
    length of every such *structural* common subsequence. Because `atomsEqual` now
    correlates atoms only up to `Atom.relevant`, a structural common subsequence is
    strictly rarer than an `atomsEqual`-matchable one, so this optimality claim is
    *weaker* than "longest under `atomsEqual`". The stronger, projection-level
    optimality (over `atomsEqual`-common subsequences) is left as deferred follow-up;
    the soundness theorems already speak at the `Atom.relevant` level. -/
def isCommonSubseq (s orig rev : List Atom) : Prop :=
  s <+ orig ∧ s <+ rev
def matchedOriginalAtoms (orig : List Atom) (ms : List Match) : List Atom :=
  ms.filterMap (fun p => orig[p.1]?)
def matchedRevisedAtoms (rev : List Atom) (ms : List Match) : List Atom :=
  ms.filterMap (fun p => rev[p.2]?)
def rawMatches : List Atom → List Atom → List Match
  | [], _ => []
  | _, [] => []
  | o :: os, r :: rs =>
      if atomsEqual o r then
        (0, 0) :: (rawMatches os rs).map (fun p => (p.1 + 1, p.2 + 1))
      else
        let dropOrig := (rawMatches os (r :: rs)).map (fun p => (p.1 + 1, p.2))
        let dropRev := (rawMatches (o :: os) rs).map (fun p => (p.1, p.2 + 1))
        if dropOrig.length > dropRev.length then dropOrig else dropRev
termination_by orig rev => orig.length + rev.length
def mapBack (n m : Nat) (p : Match) : Match :=
  (n - 1 - p.1, m - 1 - p.2)
def computeMatches (orig rev : List Atom) : List Match :=
  (rawMatches orig.reverse rev.reverse).map (mapBack orig.length rev.length) |>.reverse
def computeAtomLcs (orig rev : List Atom) : LcsResult :=
  let ms := computeMatches orig rev
  let matchedOriginal := ms.map Prod.fst
  let matchedRevised := ms.map Prod.snd
  {
    «matches» := ms
    deletedIndices := (List.range orig.length).filter (fun idx => !(matchedOriginal.contains idx))
    insertedIndices := (List.range rev.length).filter (fun idx => !(matchedRevised.contains idx))
  }
lemma matchedOriginalAtoms_shiftOrig (o : Atom) (os : List Atom) (ms : List Match) :
    matchedOriginalAtoms (o :: os) (ms.map (fun p => (p.1 + 1, p.2))) =
      matchedOriginalAtoms os ms := by
  induction ms with
  | nil => simp [matchedOriginalAtoms]
  | cons p ps ih =>
      rcases p with ⟨i, j⟩
      cases h : os[i]? <;> simp [matchedOriginalAtoms, h]
lemma matchedRevisedAtoms_shiftRev (r : Atom) (rs : List Atom) (ms : List Match) :
    matchedRevisedAtoms (r :: rs) (ms.map (fun p => (p.1, p.2 + 1))) =
      matchedRevisedAtoms rs ms := by
  induction ms with
  | nil => simp [matchedRevisedAtoms]
  | cons p ps ih =>
      rcases p with ⟨i, j⟩
      cases h : rs[j]? <;> simp [matchedRevisedAtoms, h]
lemma matchedOriginalAtoms_shiftRev (orig : List Atom) (ms : List Match) :
    matchedOriginalAtoms orig (ms.map (fun p => (p.1, p.2 + 1))) =
      matchedOriginalAtoms orig ms := by
  induction ms with
  | nil => simp [matchedOriginalAtoms]
  | cons p ps ih =>
      rcases p with ⟨i, j⟩
      cases h : orig[i]? <;> simp [matchedOriginalAtoms, h]
lemma matchedRevisedAtoms_shiftOrig (rev : List Atom) (ms : List Match) :
    matchedRevisedAtoms rev (ms.map (fun p => (p.1 + 1, p.2))) =
      matchedRevisedAtoms rev ms := by
  induction ms with
  | nil => simp [matchedRevisedAtoms]
  | cons p ps ih =>
      rcases p with ⟨i, j⟩
      cases h : rev[j]? <;> simp [matchedRevisedAtoms, h]
lemma matchedOriginalAtoms_eqBranch (o : Atom) (os : List Atom) (ms : List Match) :
    matchedOriginalAtoms (o :: os) ((0, 0) :: ms.map (fun p => (p.1 + 1, p.2 + 1))) =
      o :: matchedOriginalAtoms os ms := by
  simp [matchedOriginalAtoms]
lemma matchedRevisedAtoms_eqBranch (r : Atom) (rs : List Atom) (ms : List Match) :
    matchedRevisedAtoms (r :: rs) ((0, 0) :: ms.map (fun p => (p.1 + 1, p.2 + 1))) =
      r :: matchedRevisedAtoms rs ms := by
  simp [matchedRevisedAtoms]
lemma index_lt_of_getElem?_eq_some {α : Type} {l : List α} {i : Nat} {a : α}
    (h : l[i]? = some a) : i < l.length := by
  by_contra hge
  have hNone : l[i]? = none := List.getElem?_eq_none (Nat.le_of_not_lt hge)
  simp [hNone] at h
/- The former `atomsEqual_implies_eq` (which concluded *full structural equality*
   `a = b` from `atomsEqual a b`) has been RETIRED. It overfit the 3-field `Atom`
   projection: it was only sound because `Atom` exposed exactly the three fields
   `atomsEqual` inspects. Now that `Atom` also carries an LCS-irrelevant field
   (`correlationStatus`) — modelling the broader `ComparisonUnitAtom` — that
   conclusion is false (two atoms can be `atomsEqual` yet differ in
   `correlationStatus`). The soundness proof below is keyed on the surviving
   companion `atomsEqual_implies_relevant_eq` (`AtomsEqual.lean`), which concludes
   only that the two atoms share their LCS-relevant projection `Atom.relevant`. -/
lemma atomsEqual_self (a : Atom) : atomsEqual a a = true := by
  simp [atomsEqual]
lemma tail_sublist_of_cons_sublist {α : Type} {a : α} {l₁ l₂ : List α}
    (h : a :: l₁ <+ l₂) : l₁ <+ l₂ := by
  exact (List.sublist_cons_of_sublist a (List.Sublist.refl _)).trans h
/-- Drop the heads of two cons-lists a common subsequence sits under. The heads
    `a` and `b` need NOT be equal: the length bound `s.length ≤ t.length + 1` is
    head-agnostic, so this survives broadening `Atom` (where the LCS equality
    branch only gives `a.relevant = b.relevant`, not `a = b`). -/
lemma commonSubseq_drop_heads {a b : Atom} {os rs s : List Atom}
    (hOrig : s <+ a :: os) (hRev : s <+ b :: rs) :
    ∃ t, isCommonSubseq t os rs ∧ s.length ≤ t.length + 1 := by
  cases s with
  | nil =>
      refine ⟨[], by simp [isCommonSubseq], by simp⟩
  | cons x xs =>
      rcases List.cons_sublist_cons'.1 hOrig with hOrigTail | ⟨hxOrig, hXsOrig⟩
      · rcases List.cons_sublist_cons'.1 hRev with hRevTail | ⟨hxRev, hXsRev⟩
        · refine ⟨x :: xs, ⟨hOrigTail, hRevTail⟩, by simp⟩
        · refine ⟨xs, ?_, by simp⟩
          constructor
          · exact tail_sublist_of_cons_sublist hOrigTail
          · exact hXsRev
      · rcases List.cons_sublist_cons'.1 hRev with hRevTail | ⟨hxRev, hXsRev⟩
        · refine ⟨xs, ?_, by simp⟩
          constructor
          · exact hXsOrig
          · exact tail_sublist_of_cons_sublist hRevTail
        · refine ⟨xs, ⟨hXsOrig, hXsRev⟩, by simp⟩
theorem rawMatches_subsequence (orig rev : List Atom) :
    matchedOriginalAtoms orig (rawMatches orig rev) <+ orig ∧
    matchedRevisedAtoms rev (rawMatches orig rev) <+ rev ∧
    (matchedOriginalAtoms orig (rawMatches orig rev)).map Atom.relevant
      = (matchedRevisedAtoms rev (rawMatches orig rev)).map Atom.relevant := by
  refine Nat.strong_induction_on (p := fun n => ∀ orig rev, orig.length + rev.length = n →
      matchedOriginalAtoms orig (rawMatches orig rev) <+ orig ∧
      matchedRevisedAtoms rev (rawMatches orig rev) <+ rev ∧
      (matchedOriginalAtoms orig (rawMatches orig rev)).map Atom.relevant
        = (matchedRevisedAtoms rev (rawMatches orig rev)).map Atom.relevant)
    (orig.length + rev.length) ?_ orig rev rfl
  intro n ih orig rev hLen
  cases orig with
  | nil => simp [rawMatches, matchedOriginalAtoms, matchedRevisedAtoms]
  | cons o os =>
      cases rev with
      | nil => simp [rawMatches, matchedOriginalAtoms, matchedRevisedAtoms]
      | cons r rs =>
          by_cases hEq : atomsEqual o r = true
          · have hSmall : os.length + rs.length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have ih' := ih (os.length + rs.length) hSmall os rs rfl
            rcases ih' with ⟨hOrig, hRev, hCommon⟩
            constructor
            · simpa [rawMatches, hEq, matchedOriginalAtoms_eqBranch] using (List.Sublist.cons₂ o hOrig)
            constructor
            · simpa [rawMatches, hEq, matchedRevisedAtoms_eqBranch] using (List.Sublist.cons₂ r hRev)
            · have hRel : o.relevant = r.relevant := atomsEqual_implies_relevant_eq o r hEq
              simp [rawMatches, hEq, matchedOriginalAtoms_eqBranch, matchedRevisedAtoms_eqBranch,
                    List.map_cons, hRel, hCommon]
          · have hSmallLeft : os.length + (r :: rs).length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have hSmallRight : (o :: os).length + rs.length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have ihLeft := ih (os.length + (r :: rs).length) hSmallLeft os (r :: rs) rfl
            have ihRight := ih ((o :: os).length + rs.length) hSmallRight (o :: os) rs rfl
            rcases ihLeft with ⟨hOrigLeft, hRevLeft, hCommonLeft⟩
            rcases ihRight with ⟨hOrigRight, hRevRight, hCommonRight⟩
            by_cases hChoose : (rawMatches (o :: os) rs).length < (rawMatches os (r :: rs)).length
            · constructor
              · simpa [rawMatches, hEq, hChoose, matchedOriginalAtoms_shiftOrig] using
                  (List.sublist_cons_of_sublist o hOrigLeft)
              constructor
              · simpa [rawMatches, hEq, hChoose, matchedRevisedAtoms_shiftOrig] using hRevLeft
              · simpa [rawMatches, hEq, hChoose, matchedOriginalAtoms_shiftOrig, matchedRevisedAtoms_shiftOrig] using hCommonLeft
            · constructor
              · simpa [rawMatches, hEq, hChoose, matchedOriginalAtoms_shiftRev] using hOrigRight
              constructor
              · simpa [rawMatches, hEq, hChoose, matchedRevisedAtoms_shiftRev] using
                  (List.sublist_cons_of_sublist r hRevRight)
              · simpa [rawMatches, hEq, hChoose, matchedOriginalAtoms_shiftRev, matchedRevisedAtoms_shiftRev] using hCommonRight
theorem rawMatches_pair_sound (orig rev : List Atom) :
    ∀ p ∈ rawMatches orig rev, ∃ a b,
      orig[p.1]? = some a ∧ rev[p.2]? = some b ∧ atomsEqual a b = true := by
  refine Nat.strong_induction_on (p := fun n => ∀ orig rev, orig.length + rev.length = n →
      ∀ p ∈ rawMatches orig rev, ∃ a b,
        orig[p.1]? = some a ∧ rev[p.2]? = some b ∧ atomsEqual a b = true)
    (orig.length + rev.length) ?_ orig rev rfl
  intro n ih orig rev hLen p hp
  cases orig with
  | nil => simp [rawMatches] at hp
  | cons o os =>
      cases rev with
      | nil => simp [rawMatches] at hp
      | cons r rs =>
          by_cases hEq : atomsEqual o r = true
          · have hSmall : os.length + rs.length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have hp' : p = (0, 0) ∨ ∃ q : Match, q ∈ rawMatches os rs ∧ (q.1 + 1, q.2 + 1) = p := by
              simpa [rawMatches, hEq] using hp
            rcases hp' with rfl | ⟨q, hq, hpEq⟩
            · exact ⟨o, r, by simp, by simp, hEq⟩
            · rcases ih (os.length + rs.length) hSmall os rs rfl q hq with ⟨a, b, hOrig, hRev, hAtoms⟩
              rcases q with ⟨qi, qj⟩
              cases hpEq
              exact ⟨a, b, by simp [hOrig], by simp [hRev], hAtoms⟩
          · have hSmallLeft : os.length + (r :: rs).length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have hSmallRight : (o :: os).length + rs.length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            by_cases hChoose : (rawMatches (o :: os) rs).length < (rawMatches os (r :: rs)).length
            · have hp' : ∃ q : Match, q ∈ rawMatches os (r :: rs) ∧ (q.1 + 1, q.2) = p := by
                simpa [rawMatches, hEq, hChoose] using hp
              rcases hp' with ⟨q, hq, hpEq⟩
              rcases ih (os.length + (r :: rs).length) hSmallLeft os (r :: rs) rfl q hq with ⟨a, b, hOrig, hRev, hAtoms⟩
              rcases q with ⟨qi, qj⟩
              cases hpEq
              exact ⟨a, b, by simp [hOrig], hRev, hAtoms⟩
            · have hp' : ∃ q : Match, q ∈ rawMatches (o :: os) rs ∧ (q.1, q.2 + 1) = p := by
                simpa [rawMatches, hEq, hChoose] using hp
              rcases hp' with ⟨q, hq, hpEq⟩
              rcases ih ((o :: os).length + rs.length) hSmallRight (o :: os) rs rfl q hq with ⟨a, b, hOrig, hRev, hAtoms⟩
              rcases q with ⟨qi, qj⟩
              cases hpEq
              exact ⟨a, b, hOrig, by simp [hRev], hAtoms⟩
lemma pairwise_shiftBoth {ms : List Match}
    (h : ms.Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2)) :
    (ms.map (fun p => (p.1 + 1, p.2 + 1))).Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
  exact List.Pairwise.map _ (fun _ _ hRel => by simpa using hRel) h
lemma pairwise_shiftOrig {ms : List Match}
    (h : ms.Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2)) :
    (ms.map (fun p => (p.1 + 1, p.2))).Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
  exact List.Pairwise.map _ (fun _ _ hRel => by simpa using hRel) h
lemma pairwise_shiftRev {ms : List Match}
    (h : ms.Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2)) :
    (ms.map (fun p => (p.1, p.2 + 1))).Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
  exact List.Pairwise.map _ (fun _ _ hRel => by simpa using hRel) h
theorem rawMatches_strictly_increasing (orig rev : List Atom) :
    (rawMatches orig rev).Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
  refine Nat.strong_induction_on
    (p := fun n => ∀ orig rev, orig.length + rev.length = n →
      (rawMatches orig rev).Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2))
    (orig.length + rev.length) ?_ orig rev rfl
  intro n ih orig rev hLen
  cases orig with
  | nil => simp [rawMatches]
  | cons o os =>
      cases rev with
      | nil => simp [rawMatches]
      | cons r rs =>
          by_cases hEq : atomsEqual o r = true
          · have hSmall : os.length + rs.length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have hRec := ih (os.length + rs.length) hSmall os rs rfl
            have hPair :
                ((0, 0) :: (rawMatches os rs).map (fun p => (p.1 + 1, p.2 + 1))).Pairwise
                  (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
              rw [List.pairwise_cons]
              constructor
              · intro q hq
                rcases List.mem_map.1 hq with ⟨p, hp, rfl⟩
                omega
              · simpa using pairwise_shiftBoth hRec
            simpa [rawMatches, hEq] using hPair
          · have hSmallLeft : os.length + (r :: rs).length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have hSmallRight : (o :: os).length + rs.length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have hLeft := ih (os.length + (r :: rs).length) hSmallLeft os (r :: rs) rfl
            have hRight := ih ((o :: os).length + rs.length) hSmallRight (o :: os) rs rfl
            by_cases hChoose : (rawMatches (o :: os) rs).length < (rawMatches os (r :: rs)).length
            · simpa [rawMatches, hEq, hChoose] using pairwise_shiftOrig hLeft
            · simpa [rawMatches, hEq, hChoose] using pairwise_shiftRev hRight
lemma rawMatches_indices_bounded (orig rev : List Atom) :
    ∀ p ∈ rawMatches orig rev, p.1 < orig.length ∧ p.2 < rev.length := by
  intro p hp
  rcases rawMatches_pair_sound orig rev p hp with ⟨a, b, hOrig, hRev, hAtoms⟩
  exact ⟨index_lt_of_getElem?_eq_some hOrig, index_lt_of_getElem?_eq_some hRev⟩
lemma matchedOriginalAtoms_length_of_allSome (orig : List Atom) (ms : List Match)
    (hSome : ∀ p ∈ ms, ∃ a, orig[p.1]? = some a) :
    (matchedOriginalAtoms orig ms).length = ms.length := by
  induction ms with
  | nil => simp [matchedOriginalAtoms]
  | cons p ps ih =>
      rcases p with ⟨i, j⟩
      rcases hSome (i, j) (by simp) with ⟨a, ha⟩
      have hTail : ∀ q ∈ ps, ∃ a, orig[q.1]? = some a := by
        intro q hq
        exact hSome q (by simp [hq])
      simpa [matchedOriginalAtoms, ha] using congrArg Nat.succ (ih hTail)
theorem rawMatches_are_longest (orig rev s : List Atom) :
    isCommonSubseq s orig rev →
    s.length ≤ (rawMatches orig rev).length := by
  refine Nat.strong_induction_on
    (p := fun n => ∀ orig rev, orig.length + rev.length = n →
      ∀ s, isCommonSubseq s orig rev →
        s.length ≤ (rawMatches orig rev).length)
    (orig.length + rev.length) ?_ orig rev rfl s
  intro n ih orig rev hLen s hCommon
  rcases hCommon with ⟨hOrig, hRev⟩
  cases orig with
  | nil =>
      cases s with
      | nil => simp [rawMatches]
      | cons x xs =>
          have hFalse : False := by
            simp at hOrig
          exact hFalse.elim
  | cons o os =>
      cases rev with
      | nil =>
          cases s with
          | nil => simp [rawMatches]
          | cons x xs =>
              have hFalse : False := by
                simp at hRev
              exact hFalse.elim
      | cons r rs =>
          by_cases hEq : atomsEqual o r = true
          · have hSmall : os.length + rs.length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            rcases commonSubseq_drop_heads hOrig hRev with ⟨t, ht, hDrop⟩
            have hRec := ih (os.length + rs.length) hSmall os rs rfl t ht
            have hBound : s.length ≤ (rawMatches os rs).length + 1 := by
              exact le_trans hDrop (Nat.succ_le_succ hRec)
            simpa [rawMatches, hEq] using hBound
          · have hSmallLeft : os.length + (r :: rs).length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have hSmallRight : (o :: os).length + rs.length < n := by
              rw [← hLen]
              simp [Nat.add_left_comm, Nat.add_comm]
            have hNe : o ≠ r := by
              intro hAtom
              subst r
              simp [atomsEqual_self] at hEq
            cases s with
            | nil => simp [rawMatches, hEq]
            | cons x xs =>
                rcases List.cons_sublist_cons'.1 hOrig with hOrigTail | ⟨hx, hXsOrig⟩
                · have hRec := ih (os.length + (r :: rs).length) hSmallLeft os (r :: rs) rfl
                    (x :: xs) ⟨hOrigTail, hRev⟩
                  have hChooseLeft :
                      (rawMatches os (r :: rs)).length ≤ (rawMatches (o :: os) (r :: rs)).length := by
                    by_cases hChoose : (rawMatches (o :: os) rs).length <
                        (rawMatches os (r :: rs)).length
                    · simp [rawMatches, hEq, hChoose]
                    · have hLe :
                          (rawMatches os (r :: rs)).length ≤ (rawMatches (o :: os) rs).length :=
                        Nat.le_of_not_gt hChoose
                      simp [rawMatches, hEq, hChoose, hLe]
                  exact le_trans hRec hChooseLeft
                · subst x
                  have hRevTail : o :: xs <+ rs := List.Sublist.of_cons_of_ne hNe hRev
                  have hRec := ih ((o :: os).length + rs.length) hSmallRight (o :: os) rs rfl
                    (o :: xs) ⟨hOrig, hRevTail⟩
                  have hChooseRight :
                      (rawMatches (o :: os) rs).length ≤ (rawMatches (o :: os) (r :: rs)).length := by
                    by_cases hChoose : (rawMatches (o :: os) rs).length <
                        (rawMatches os (r :: rs)).length
                    · have hLe :
                          (rawMatches (o :: os) rs).length ≤ (rawMatches os (r :: rs)).length :=
                        Nat.le_of_lt hChoose
                      simp [rawMatches, hEq, hChoose, hLe]
                    · simp [rawMatches, hEq, hChoose]
                  exact le_trans hRec hChooseRight
lemma matchedOriginalAtoms_mapBack (orig : List Atom) (m : Nat) (ms : List Match)
    (hSome : ∀ p ∈ ms, ∃ a, orig.reverse[p.1]? = some a) :
    matchedOriginalAtoms orig ((ms.map (mapBack orig.length m)).reverse) =
      (matchedOriginalAtoms orig.reverse ms).reverse := by
  rw [matchedOriginalAtoms, List.filterMap_reverse, matchedOriginalAtoms]
  induction ms with
  | nil => simp
  | cons p ps ih =>
      have hpSome := hSome p (by simp)
      rcases hpSome with ⟨a, ha⟩
      have hpBound : p.1 < orig.length := by
        simpa using index_lt_of_getElem?_eq_some ha
      have hps : ∀ q ∈ ps, ∃ a, orig.reverse[q.1]? = some a := by
        intro q hq
        exact hSome q (by simp [hq])
      rcases p with ⟨i, j⟩
      have hBack : orig[orig.length - 1 - i]? = some a := by
        exact (List.getElem?_reverse (l := orig) (i := i) hpBound).symm.trans ha
      have hTail :
          filterMap (fun x => orig[orig.length - 1 - x.1]?) ps =
            filterMap (fun p => orig.reverse[p.1]?) ps := by
        apply List.reverse_injective
        simpa [mapBack] using ih hps
      simp [mapBack, hBack, hTail, ha]
lemma matchedRevisedAtoms_mapBack (n : Nat) (rev : List Atom) (ms : List Match)
    (hSome : ∀ p ∈ ms, ∃ a, rev.reverse[p.2]? = some a) :
    matchedRevisedAtoms rev ((ms.map (mapBack n rev.length)).reverse) =
      (matchedRevisedAtoms rev.reverse ms).reverse := by
  rw [matchedRevisedAtoms, List.filterMap_reverse, matchedRevisedAtoms]
  induction ms with
  | nil => simp
  | cons p ps ih =>
      have hpSome := hSome p (by simp)
      rcases hpSome with ⟨a, ha⟩
      have hpBound : p.2 < rev.length := by
        simpa using index_lt_of_getElem?_eq_some ha
      have hps : ∀ q ∈ ps, ∃ a, rev.reverse[q.2]? = some a := by
        intro q hq
        exact hSome q (by simp [hq])
      rcases p with ⟨i, j⟩
      have hBack : rev[rev.length - 1 - j]? = some a := by
        exact (List.getElem?_reverse (l := rev) (i := j) hpBound).symm.trans ha
      have hTail :
          filterMap (fun x => rev[rev.length - 1 - x.2]?) ps =
            filterMap (fun p => rev.reverse[p.2]?) ps := by
        apply List.reverse_injective
        simpa [mapBack] using ih hps
      simp [mapBack, hBack, hTail, ha]
/-- INV-LCS-001 (soundness): the matched atoms produced by `computeAtomLcs`
form a genuine common subsequence of both inputs. -/
theorem lcs_matches_are_common_subsequence (orig rev : List Atom) :
    matchedOriginalAtoms orig (computeAtomLcs orig rev).matches <+ orig ∧
    matchedRevisedAtoms rev (computeAtomLcs orig rev).matches <+ rev ∧
    (matchedOriginalAtoms orig (computeAtomLcs orig rev).matches).map Atom.relevant =
      (matchedRevisedAtoms rev (computeAtomLcs orig rev).matches).map Atom.relevant := by
  let raw := rawMatches orig.reverse rev.reverse
  have hSub := rawMatches_subsequence orig.reverse rev.reverse
  have hPair := rawMatches_pair_sound orig.reverse rev.reverse
  have hOrigMap :
      matchedOriginalAtoms orig ((raw.map (mapBack orig.length rev.length)).reverse) =
        (matchedOriginalAtoms orig.reverse raw).reverse := by
    apply matchedOriginalAtoms_mapBack orig rev.length
    intro p hp
    rcases hPair p hp with ⟨a, b, hOrig, hRev, hAtoms⟩
    exact ⟨a, hOrig⟩
  have hRevMap :
      matchedRevisedAtoms rev ((raw.map (mapBack orig.length rev.length)).reverse) =
        (matchedRevisedAtoms rev.reverse raw).reverse := by
    apply matchedRevisedAtoms_mapBack orig.length rev
    intro p hp
    rcases hPair p hp with ⟨a, b, hOrig, hRev, hAtoms⟩
    exact ⟨b, hRev⟩
  rcases hSub with ⟨hOrigSub, hRevSub, hEq⟩
  constructor
  · simpa [computeAtomLcs, computeMatches, raw, hOrigMap] using List.Sublist.reverse hOrigSub
  constructor
  · simpa [computeAtomLcs, computeMatches, raw, hRevMap] using List.Sublist.reverse hRevSub
  · simpa [computeAtomLcs, computeMatches, raw, hOrigMap, hRevMap, List.map_reverse]
      using congrArg List.reverse hEq
theorem lcs_match_pairs_are_sound (orig rev : List Atom) :
    ∀ p ∈ (computeAtomLcs orig rev).matches, ∃ a b,
      orig[p.1]? = some a ∧ rev[p.2]? = some b ∧ atomsEqual a b = true := by
  let raw := rawMatches orig.reverse rev.reverse
  have hPair := rawMatches_pair_sound orig.reverse rev.reverse
  intro p hp
  have hp' : ∃ q : Match, q ∈ raw ∧ mapBack orig.length rev.length q = p := by
    simpa [computeAtomLcs, computeMatches, raw, mapBack, List.mem_reverse] using hp
  rcases hp' with ⟨q, hq, hpEq⟩
  rcases hPair q hq with ⟨a, b, hOrigRev, hRevRev, hAtoms⟩
  have hOrigBound : q.1 < orig.length := by
    simpa using index_lt_of_getElem?_eq_some hOrigRev
  have hRevBound : q.2 < rev.length := by
    simpa using index_lt_of_getElem?_eq_some hRevRev
  have hOrig : orig[orig.length - 1 - q.1]? = some a := by
    exact (List.getElem?_reverse (l := orig) (i := q.1) hOrigBound).symm.trans hOrigRev
  have hRev : rev[rev.length - 1 - q.2]? = some b := by
    exact (List.getElem?_reverse (l := rev) (i := q.2) hRevBound).symm.trans hRevRev
  rcases q with ⟨qi, qj⟩
  cases hpEq
  exact ⟨a, b, hOrig, hRev, hAtoms⟩
lemma pairwise_mapBack_reverse {ms : List Match} {n m : Nat}
    (hPair : ms.Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2))
    (hBound : ∀ p ∈ ms, p.1 < n ∧ p.2 < m) :
    ((ms.map (mapBack n m)).reverse).Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
  have hMapped :
      (ms.map (mapBack n m)).Pairwise (fun p q => q.1 < p.1 ∧ q.2 < p.2) := by
    revert hPair hBound
    induction ms with
    | nil =>
        intro hPair hBound
        simp
    | cons p ps ih =>
        intro hPair hBound
        have hStep :
            (mapBack n m p :: ps.map (mapBack n m)).Pairwise (fun p q => q.1 < p.1 ∧ q.2 < p.2) := by
          rw [List.pairwise_cons] at hPair ⊢
          rcases hPair with ⟨hHead, hTail⟩
          constructor
          · intro q hq
            rcases List.mem_map.1 hq with ⟨q', hq', rfl⟩
            have hpBound := hBound p (by simp)
            have hqBound := hBound q' (by simp [hq'])
            have hRel := hHead q' hq'
            dsimp [mapBack]
            omega
          · apply ih hTail
            intro q hq
            exact hBound q (by simp [hq])
        simpa using hStep
  exact List.Pairwise.reverse hMapped
theorem lcs_matches_are_longest :
    ∀ (orig rev s : List Atom),
      isCommonSubseq s orig rev →
      s.length ≤ (matchedOriginalAtoms orig (computeAtomLcs orig rev).matches).length := by
  intro orig rev s hCommon
  let raw := rawMatches orig.reverse rev.reverse
  have hRawLongest : s.reverse.length ≤ raw.length := by
    apply rawMatches_are_longest (orig := orig.reverse) (rev := rev.reverse) (s := s.reverse)
    exact ⟨List.Sublist.reverse hCommon.1, List.Sublist.reverse hCommon.2⟩
  have hRawSome : ∀ p ∈ raw, ∃ a, orig.reverse[p.1]? = some a := by
    intro p hp
    rcases rawMatches_pair_sound orig.reverse rev.reverse p (by simpa [raw] using hp) with
      ⟨a, b, hOrig, hRev, hAtoms⟩
    exact ⟨a, hOrig⟩
  have hOrigMap :
      matchedOriginalAtoms orig ((raw.map (mapBack orig.length rev.length)).reverse) =
        (matchedOriginalAtoms orig.reverse raw).reverse := by
    apply matchedOriginalAtoms_mapBack orig rev.length
    intro p hp
    exact hRawSome p hp
  have hMatchLength :
      (matchedOriginalAtoms orig (computeAtomLcs orig rev).matches).length = raw.length := by
    calc
      (matchedOriginalAtoms orig (computeAtomLcs orig rev).matches).length
          = ((matchedOriginalAtoms orig.reverse raw).reverse).length := by
              simpa [computeAtomLcs, computeMatches, raw] using congrArg List.length hOrigMap
      _ = (matchedOriginalAtoms orig.reverse raw).length := by simp
      _ = raw.length := matchedOriginalAtoms_length_of_allSome _ _ hRawSome
  simpa [List.length_reverse, hMatchLength] using hRawLongest
theorem lcs_match_indices_strictly_increasing :
    ∀ (orig rev : List Atom),
      (computeAtomLcs orig rev).matches.Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
  intro orig rev
  let raw := rawMatches orig.reverse rev.reverse
  have hPair :
      raw.Pairwise (fun p q => p.1 < q.1 ∧ p.2 < q.2) := by
    simpa [raw] using rawMatches_strictly_increasing orig.reverse rev.reverse
  have hBound : ∀ p ∈ raw, p.1 < orig.length ∧ p.2 < rev.length := by
    intro p hp
    simpa [raw] using rawMatches_indices_bounded orig.reverse rev.reverse p hp
  simpa [computeAtomLcs, computeMatches, raw] using pairwise_mapBack_reverse hPair hBound
lemma matched_original_index_lt {orig rev : List Atom} {i : Nat}
    (hMem : i ∈ (computeAtomLcs orig rev).matches.map Prod.fst) : i < orig.length := by
  rcases List.mem_map.1 hMem with ⟨p, hp, rfl⟩
  rcases lcs_match_pairs_are_sound orig rev p hp with ⟨a, b, hOrig, hRev, hAtoms⟩
  exact index_lt_of_getElem?_eq_some hOrig
lemma matched_revised_index_lt {orig rev : List Atom} {i : Nat}
    (hMem : i ∈ (computeAtomLcs orig rev).matches.map Prod.snd) : i < rev.length := by
  rcases List.mem_map.1 hMem with ⟨p, hp, rfl⟩
  rcases lcs_match_pairs_are_sound orig rev p hp with ⟨a, b, hOrig, hRev, hAtoms⟩
  exact index_lt_of_getElem?_eq_some hRev
lemma mem_deletedIndices_iff {orig rev : List Atom} {i : Nat} :
    i ∈ (computeAtomLcs orig rev).deletedIndices ↔
      i < orig.length ∧ i ∉ (computeAtomLcs orig rev).matches.map Prod.fst := by
  simp [computeAtomLcs]
lemma mem_insertedIndices_iff {orig rev : List Atom} {i : Nat} :
    i ∈ (computeAtomLcs orig rev).insertedIndices ↔
      i < rev.length ∧ i ∉ (computeAtomLcs orig rev).matches.map Prod.snd := by
  simp [computeAtomLcs]
theorem lcs_partitions_inputs :
    ∀ (orig rev : List Atom),
      let r := computeAtomLcs orig rev
      (r.matches.map Prod.fst).toFinset ∪ r.deletedIndices.toFinset = Finset.range orig.length ∧
      (r.matches.map Prod.fst).toFinset ∩ r.deletedIndices.toFinset = ∅ ∧
      (r.matches.map Prod.snd).toFinset ∪ r.insertedIndices.toFinset = Finset.range rev.length ∧
      (r.matches.map Prod.snd).toFinset ∩ r.insertedIndices.toFinset = ∅ := by
  intro orig rev
  dsimp
  constructor
  · apply Finset.ext
    intro i
    by_cases hMatch : i ∈ (computeAtomLcs orig rev).matches.map Prod.fst
    · have hBound : i < orig.length := matched_original_index_lt hMatch
      simp [mem_deletedIndices_iff, hMatch, hBound]
    · by_cases hRange : i < orig.length
      · simp [mem_deletedIndices_iff, hMatch, hRange]
      · simp [mem_deletedIndices_iff, hMatch, hRange]
  constructor
  · apply Finset.ext
    intro i
    by_cases hMatch : i ∈ (computeAtomLcs orig rev).matches.map Prod.fst
    · simp [mem_deletedIndices_iff, hMatch]
    · simp [mem_deletedIndices_iff, hMatch]
  constructor
  · apply Finset.ext
    intro i
    by_cases hMatch : i ∈ (computeAtomLcs orig rev).matches.map Prod.snd
    · have hBound : i < rev.length := matched_revised_index_lt hMatch
      simp [mem_insertedIndices_iff, hMatch, hBound]
    · by_cases hRange : i < rev.length
      · simp [mem_insertedIndices_iff, hMatch, hRange]
      · simp [mem_insertedIndices_iff, hMatch, hRange]
  · apply Finset.ext
    intro i
    by_cases hMatch : i ∈ (computeAtomLcs orig rev).matches.map Prod.snd
    · simp [mem_insertedIndices_iff, hMatch]
    · simp [mem_insertedIndices_iff, hMatch]
end LeanSpike
