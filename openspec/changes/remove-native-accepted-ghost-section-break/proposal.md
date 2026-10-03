# Change: Remove ghost section breaks on native accept

## Why

Native `acceptChanges` in docx-core removes every selected `w:sectPrChange`
record but leaves the paragraph-level `w:sectPr` that held it. When that
container's only child was the change record, the revision recorded the
removal of a section break; the empty `w:sectPr` left behind is still an
active section break, so the accepted document keeps a ghost break the
revised document does not have (#1143). `remove-accepted-ghost-section-break`
(#981) fixed the same shape in docx-compare's `acceptAllChanges`.

## What Changes

- Export `acceptedSectionBreakRemovalContainer` from docx-core: given a
  `w:sectPrChange`, it returns the live paragraph's `w:p > w:pPr > w:sectPr` to remove when
  that container's only element child is the change record and the record's
  snapshot carries at least one prior section property; otherwise `null`.
- Native `acceptChanges` removes those containers for selected
  `w:sectPrChange` records. Body-level final section properties, sections
  with a live property child, and an added default-property break (empty live
  `w:sectPr` over an empty snapshot) are kept, as in #981.
- docx-compare's `acceptAllChanges` uses the same predicate, so both accept
  paths apply one rule.
- Selective accept (`acceptAIEdits`, author filters) only removes the
  container of a selected record; foreign section history is untouched.
- `propertyChangesResolved` is unchanged: the container goes with the one
  revision it recorded.

## Impact

- Affected specs: `docx-primitives`
- Affected code: `packages/docx-core/src/primitives/accept_changes.ts`,
  `packages/docx-compare/src/tagged/trackChangesAcceptorAst.ts`
- The design limitations recorded in `remove-accepted-ghost-section-break`
  (removal of a break that had no properties; a kept break emptied of its
  properties) apply equally to native accept.
