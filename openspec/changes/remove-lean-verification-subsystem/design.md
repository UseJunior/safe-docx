# Design: Complete Lean subsystem retirement

## Principle

Retirement is atomic at the architectural boundary: no Lean executable,
supervisor, option, certificate field, workflow, or normative requirement may
remain. Historical archived proposals may retain their record, but current
specification and live guidance must describe the post-retirement system.

## Coverage migration

Before deletion, inventory every non-duplicated behavioral invariant exercised
only through Lean. Re-express user-visible invariants—package admission limits,
relationship safety, move/comment/note topology, accept/reject behavior, and
fail-closed parsing—as TypeScript unit, property, or corpus regression tests.
Proof-internal claims with no runtime behavioral counterpart are retired rather
than translated into pretend proofs.

## API transition

Remove `leanXmlVerifier` configuration, `LeanXmlVerifierOptions`,
`runLeanXmlTripleVerifier`, and Lean certificate output. Because these are
exported surfaces, release notes must call out the breaking removal. No inert
compatibility flag remains.

## OpenSpec transition

Canonical Lean requirements are removed from `docx-comparison`; behavioral
requirements that remain product requirements are rewritten without naming an
implementation language or proof system. Active Lean proposals are marked as
superseded by this change before archival.
