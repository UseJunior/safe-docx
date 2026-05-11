import LeanSpike.Atom

namespace LeanSpike

def atomsEqual (a b : Atom) : Bool :=
  if a.sha1Hash = b.sha1Hash then
    if a.textContent = b.textContent then
      if a.tagName = b.tagName then
        true
      else
        false
    else
      false
  else
    false

/-- INV-ATOMSEQ-001: hash-collision safety.
    `atomsEqual` short-circuits on `sha1Hash` inequality for efficiency, but it
    does NOT trust hashes alone: when it returns `true`, `textContent` and
    `tagName` have also been verified equal. So a hypothetical SHA-1 collision
    (two atoms with the same `sha1Hash` but differing `textContent` or
    `tagName`) cannot cause `atomsEqual` to return `true`. The conclusion of
    this theorem deliberately omits hash equality — that fact is consumed
    inside the proof but is not what the safety property is about. -/
theorem atomsEqual_implies_text_and_tag_eq :
    ∀ a b : Atom, atomsEqual a b = true →
      a.textContent = b.textContent ∧ a.tagName = b.tagName := by
  intro a b hEq
  by_cases hHash : a.sha1Hash = b.sha1Hash
  · simp [atomsEqual, hHash] at hEq
    exact hEq
  · simp [atomsEqual, hHash] at hEq

end LeanSpike
