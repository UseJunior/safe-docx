# Change: Add run highlight generation

## Why

`generateDocx` cannot currently author text highlight on `RunProps`, which
forces OpenAgreements templates to approximate highlighted placeholder tokens
such as `{employer_name}` with less faithful muted-grey text. Issue #491 tracks
this gap, surfaced by legal-explainer#720 and the OpenAgreements offer-letter
visual-parity work under #482.

## What Changes

- Add a closed `HighlightColor` union and `RunProps.highlight` to the
  document-generation type surface.
- Emit `RunProps.highlight` as `w:highlight` with the authored enumerated value
  in the existing ordered run-property sequence.
- Add a `Run highlight` requirement to `docx-generation` with scenario
  `SDX-GEN-105`.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement).
- Affected code: `packages/docx-core/src/generation/types.ts`,
  `packages/docx-core/src/generation/emit/properties.ts`, and a focused
  generation test.
- Out of scope: arbitrary-color run fill via run shading.
