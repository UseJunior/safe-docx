# Change: Retire the Lean verification subsystem

## Why

Lean verification was expected to have been removed, but the repository still
contains an active CI workflow, a compiled checker and proof tree, public
TypeScript options, production pipeline integration, differential/bridge tests,
quality-gate rules, and normative OpenSpec requirements. The remaining verifier
also currently fails the ordinary paragraph-mark insertion case, blocking the
otherwise unrelated pre-submit suite. Removing only that test would conceal the
larger architectural inconsistency.

## What Changes

- Remove the `verification/lean` project and Lean-specific CI workflow.
- Remove the TypeScript Lean checker supervisor, public configuration/options,
  exports, certificates, and atomizer pipeline branch.
- Remove Lean-only bridge, differential, and integration tests and scripts.
- Remove or rewrite quality-gate, traceability, and documentation references.
- Retire active Lean-specific OpenSpec changes and remove Lean-specific
  normative requirements from the canonical comparison specification.
- Preserve behaviorally important OOXML invariants as ordinary TypeScript
  regression/property tests before deleting any Lean-only coverage.

## Impact

- **BREAKING** for callers using `leanXmlVerifier` options or
  `runLeanXmlTripleVerifier` directly
- Affected specs: `docx-comparison`
- Affected code: `verification/lean`, `.github/workflows/lean-build.yml`,
  `packages/docx-compare`, Lean bridge/differential tests in `docx-core`, and
  Lean-specific repository documentation and scripts
- OpenSpec cleanup: active `verify-lean-*` changes must be superseded or closed
  explicitly rather than left as impossible work
