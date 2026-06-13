# Change: Lock the author→compare round-trip guarantee with tests

## Why

`docx-core` both authors documents (`generateDocx`) and compares/redlines them
(`compareDocuments`). The strategic value of owning both halves is that an authored
document and a comparable document share one AST/OOXML model, so a freshly generated
contract should be a first-class citizen of the redline workflow. Today that synergy is
**assumed but never asserted**: the generation suite proves determinism and clone
stability, but nothing proves `generateDocx` output flows cleanly through
`compareDocuments` + accept/reject. This change locks that guarantee with real (no-mock)
tests and documents it in the generation capability spec (issue #483).

## What Changes

- Add a new requirement to `docx-generation`: **Author-to-compare round-trip guarantee**,
  with five scenarios (`SDX-GEN-100`..`SDX-GEN-104`).
- Add a real round-trip test surface
  (`packages/docx-core/src/generation/generation-compare-roundtrip.test.ts`) exercising
  `generateDocx` → `compareDocuments` → accept/reject against the actual implementations.
- Include a self-contained negative-control test that injects a malformed field into an
  authored document and asserts the round-trip guard catches it — proving the assertions
  have teeth.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement).
- Affected code: one new test file under `packages/docx-core/src/generation/`. No
  production-source changes — this change only asserts and documents existing behavior.
