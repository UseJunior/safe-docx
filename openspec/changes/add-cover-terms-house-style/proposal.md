# Change: Add cover-terms table house style

## Why

OpenAgreements cover pages need a horizontal-rule cover-terms table with grouped
rows, subordinate rows, and taller row rhythm. Today `coverTermsTable` only
produces a compact full-grid label/value table, which forces adapters to build
the cover table by hand.

## What Changes

- Add optional `coverTermsTable` controls for full-grid versus horizontal-rules
  table borders.
- Allow cover-terms entries to include full-width group rows and italic
  subordinate rows while keeping plain label/value rows unchanged.
- Add optional row-height and uniform cell-padding controls for cover-terms
  vertical rhythm.
- Add scenario `SDX-GEN-106` covering the recipe output, emitted XML, and
  default compatibility.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement).
- Affected code: `packages/docx-core/src/generation/recipes.ts` and a focused
  generation test.
- Out of scope: signature-block layout and paragraph grammar changes.
