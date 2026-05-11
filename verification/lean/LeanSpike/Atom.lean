namespace LeanSpike

structure Atom where
  sha1Hash : String
  textContent : String
  tagName : String
  deriving DecidableEq, Repr

end LeanSpike
