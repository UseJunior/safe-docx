# Change: Remove accepted ghost section breaks

## Why

Accepting a tracked removal of a paragraph-level section break currently removes
the `w:sectPrChange` record but leaves its now-empty `w:sectPr` container. That
container remains a real section break in the accepted projection, so source-
projected formatting fidelity correctly fails even when the revised source has
no corresponding break.

This was reproduced with wholly invented OOXML and with a private document pair;
the private observation is limited to structural metrics and is not a source of
committed fixture content.

## What Changes

- Treat a paragraph-owned `w:sectPr` whose only element child is its
  `w:sectPrChange` snapshot as a tracked removal of that section break when
  accepting revisions.
- Remove that paragraph-level section-properties container in the accept-all
  projection while preserving body-level final section properties and live
  section formatting.
- Add an invented regression proving both accept and reject projections retain
  exact formatting fidelity without lowering or bypassing the fidelity gate.

## Impact

- Affected specs: `docx-comparison`
- Affected code: `packages/docx-compare/src/tagged/trackChangesAcceptorAst.ts`
- Affected tests: tagged accept/reject projection and formatting-fidelity tests
- Dependency: UseJunior/legal-context#918
- Base: UseJunior/safe-docx `31b1d8fd2e9f0f285cc6167906ef6e2c9f220699`

