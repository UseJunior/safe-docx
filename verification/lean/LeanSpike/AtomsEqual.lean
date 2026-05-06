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
    atomsEqual returns true ONLY when textContent and tagName match,
    regardless of whether sha1Hash matches. -/
theorem atomsEqual_implies_text_and_tag_eq :
    ∀ a b : Atom, atomsEqual a b = true →
      a.textContent = b.textContent ∧ a.tagName = b.tagName := by
  intro a b hEq
  by_cases hHash : a.sha1Hash = b.sha1Hash
  · simp [atomsEqual, hHash] at hEq
    exact hEq
  · simp [atomsEqual, hHash] at hEq

end LeanSpike
