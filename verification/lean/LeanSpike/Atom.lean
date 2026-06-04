namespace LeanSpike

/-- A comparison-unit atom. The first three fields are the LCS-relevant
    projection — exactly the fields `atomsEqual` compares (`sha1Hash`,
    `textContent`, `tagName`). `correlationStatus` is a representative
    **LCS-irrelevant** field: the production `ComparisonUnitAtom` carries it (plus
    ancestry, part, etc.), but `atomsEqual` deliberately ignores it. Modelling at
    least one ignored field is what makes the projection faithful — it means
    `atomsEqual` correlates atoms *up to their relevant fields*, NOT up to
    structural identity, so two distinct atoms can be `atomsEqual` while differing
    in `correlationStatus`. The field defaults to `0` so existing constructions
    (e.g. the differential harness) are unaffected. -/
structure Atom where
  sha1Hash : String
  textContent : String
  tagName : String
  correlationStatus : Nat := 0
  deriving DecidableEq, Repr

/-- The LCS-relevant projection of an atom: exactly the fields `atomsEqual`
    inspects. The soundness proof's equality branch is keyed on this projection
    rather than on structural atom equality, which is what survives broadening the
    `Atom` model toward the full `ComparisonUnitAtom`. -/
def Atom.relevant (a : Atom) : String × String × String :=
  (a.sha1Hash, a.textContent, a.tagName)

end LeanSpike
