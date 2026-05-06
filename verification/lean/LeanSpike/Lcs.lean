import Mathlib.Data.List.Basic
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
theorem atomsEqual_implies_eq {a b : Atom} (hEq : atomsEqual a b = true) : a = b := by
  cases a
  cases b
  simp [atomsEqual] at hEq
  rcases hEq with ⟨hHash, hText, hTag⟩
  simp [hHash, hText, hTag]
theorem rawMatches_subsequence (orig rev : List Atom) :
    matchedOriginalAtoms orig (rawMatches orig rev) <+ orig ∧
    matchedRevisedAtoms rev (rawMatches orig rev) <+ rev ∧
    matchedOriginalAtoms orig (rawMatches orig rev) = matchedRevisedAtoms rev (rawMatches orig rev) := by
  refine Nat.strong_induction_on (p := fun n => ∀ orig rev, orig.length + rev.length = n →
      matchedOriginalAtoms orig (rawMatches orig rev) <+ orig ∧
      matchedRevisedAtoms rev (rawMatches orig rev) <+ rev ∧
      matchedOriginalAtoms orig (rawMatches orig rev) = matchedRevisedAtoms rev (rawMatches orig rev))
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
            · have hAtom : o = r := atomsEqual_implies_eq hEq
              subst r
              simp [rawMatches, atomsEqual, matchedOriginalAtoms_eqBranch, matchedRevisedAtoms_eqBranch, hCommon]
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
    matchedOriginalAtoms orig (computeAtomLcs orig rev).matches =
      matchedRevisedAtoms rev (computeAtomLcs orig rev).matches := by
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
  · simpa [computeAtomLcs, computeMatches, raw, hOrigMap, hRevMap] using congrArg List.reverse hEq
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
end LeanSpike
