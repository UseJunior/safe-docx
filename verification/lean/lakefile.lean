import Lake
open Lake DSL

package «lean-spike» where

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git" @ "v4.29.1"

@[default_target]
lean_lib LeanSpike

@[default_target]
lean_lib Tier2

lean_lib EmittedRedlineMinimality

-- Differential harness executable: runs the genuine `LeanSpike.computeAtomLcs`
-- over batched JSON stdin/stdout so the TS bridge can assert Lean↔TS LCS
-- extensional equivalence (Tier 2.5). Plain executable code with no proof
-- placeholders, so the zero-proof-placeholder audit is unaffected.
@[default_target]
lean_exe leanDifferential where
  root := `Differential

-- Tier 2-helper differential harness executable: runs the genuine
-- `Tier2.AcceptReject.accept` / `.reject` and `Tier2.FieldStructure.validateFieldStructure`
-- over batched JSON stdin/stdout so the TS bridge can assert Lean↔TS accept/reject/validate
-- extensional equivalence (Tier 2.5, second increment). Plain executable code with no proof
-- placeholders, so the zero-proof-placeholder audit is unaffected.
@[default_target]
lean_exe leanHelperDifferential where
  root := `DifferentialHelpers

-- Runtime fixed-story verifier: extracts the selected WordprocessingML parts
-- from the actual original/revised/combined DOCX packages and checks them.
@[default_target]
lean_exe leanDocxChecker where
  root := `LeanDocxChecker

-- Protocol-v4 maximum-shape audit producer. It uses the same outer response
-- constructor as the production checker and is consumed by the strict TS decoder tests.
@[default_target]
lean_exe protocolV4MaximumShape where
  root := `ProtocolV4MaximumShape

@[default_target]
lean_exe protocolV5MaximumOrdinaryShape where
  root := `ProtocolV5MaximumOrdinaryShape

@[default_target]
lean_exe protocolV5CanonicalTerminalShapes where
  root := `ProtocolV5CanonicalTerminalShapes

@[default_target]
lean_exe protocolV6OrdinaryEnvelopeWitness where
  root := `ProtocolV6OrdinaryEnvelopeWitness

@[default_target]
lean_exe protocolV6CanonicalTerminalShapes where
  root := `ProtocolV6CanonicalTerminalShapes

lean_lib ProtocolV7StructuralChargeAudit

lean_lib ProtocolV7ProjectionDriftWitnesses

@[default_target]
lean_exe protocolV7OrdinaryEnvelopeWitness where
  root := `ProtocolV7OrdinaryEnvelopeWitness

@[default_target]
lean_exe protocolV7CanonicalTerminalShapes where
  root := `ProtocolV7CanonicalTerminalShapes
