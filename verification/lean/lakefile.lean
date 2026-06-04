import Lake
open Lake DSL

package «lean-spike» where

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git" @ "v4.29.1"

@[default_target]
lean_lib LeanSpike

@[default_target]
lean_lib Tier2

-- Differential harness executable: runs the genuine `LeanSpike.computeAtomLcs`
-- over batched JSON stdin/stdout so the TS bridge can assert Lean↔TS LCS
-- extensional equivalence (Tier 2.5). Plain executable code with no proof
-- placeholders, so the zero-proof-placeholder audit is unaffected.
@[default_target]
lean_exe leanDifferential where
  root := `Differential
