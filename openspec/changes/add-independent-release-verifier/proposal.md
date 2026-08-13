# Change: Add Independent DOCX Release Verification

## Why

Safe DOCX has strong Lean-backed model checks and generator-local projection
certificates, but a generator must not be the sole implementation certifying
its own finished artifacts. Completed legal matters exposed three independent
failure classes: semantically exact but unnecessarily broad redlines,
renderer-specific revision colors and header geometry, and green internal
checks that did not bind the final PDF to the tracked DOCX.

## What Changes

- Add a release-verifier package that reads original, intended-clean, tracked,
  and optional rendered artifacts without importing mutation or generation
  implementations.
- Aggregate separately named semantic, minimality, package, comment, rendering,
  expectation, and human-review verdicts; distinguish failure from not-run.
- Extend the compiled Lean checker with emitted-redline LCS-minimality evidence:
  every preservable token in an authored redline must remain ordinary text.
- Add an optional renderer-verifier package for disposable LibreOffice profiles,
  PDF/markup binding, conventional revision colors, negative controls, and
  review-page production.
- Commit only synthetic or minimized de-identified public fixtures. Add a
  gitignored, path-based private-corpus manifest format for real matter cases.
- Retain generator-local certificates as fast replay evidence, but reserve
  `deliveryReady` for the independent release certificate.

## Impact

- Affected specs: new `release-verification`; existing `docx-comparison` Lean
  checker behavior remains compatible and gains additive evidence.
- Affected code: new workspace packages, `verification/lean`, compiled-checker
  protocol and supervisor, fixture/corpus documentation, CI and CLI wiring.
- Compatibility: additive packages and certificate fields. Existing generator
  certificates remain readable but are no longer sufficient alone for a final
  release claim.
- Privacy: real client documents remain outside the public repository and are
  admitted only through a local gitignored manifest.
