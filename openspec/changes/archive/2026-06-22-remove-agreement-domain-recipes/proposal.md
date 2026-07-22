# Change: Remove agreement-domain recipes (coverTermsTable, signatureBlock)

## Why

`@usejunior/docx-core` is a general OOXML library. Its public vocabulary should
be Word's vocabulary — table, row, cell, border, run — plus a small allowlist of
LLM affordances that are not in Word but exist because LLMs are the primary
consumers. The `coverTermsTable` and `signatureBlock` recipes violate that: they
bake one downstream consumer's agreement-document concepts ("cover term",
"party/signatory", "print name", "title", "date", entity-legal-name-above-the-line)
into the general library. A signature block is just a `w:tbl` — `TableSpec` /
`BorderSpec` / `RunProps` already express every property these recipes produced
(per-cell bottom border at a chosen color/weight, run `highlight`, `bold`,
`sizePt`, row height). The recipes added no primitive, only a domain iteration
loop, which belongs in the consumer.

## What Changes

- **BREAKING:** remove `coverTermsTable`, `signatureBlock`, and their option/entry
  types (`CoverTermsOptions`, `SignatureBlockOptions`, `CoverTermEntry`, …) from
  the public API. `recipes.ts` is deleted (it held only these two recipes).
- Consumers compose the equivalent `TableSpec` themselves from the existing
  general grammar (the openagreements DOCX adapter already hand-rolls its
  signature grid this way; its cover-terms table moves to the same pattern).
- Remove the `Legal-document recipes` requirement (`SDX-GEN-070`, `SDX-GEN-071`)
  from the `docx-generation` capability.

## Impact

- Affected specs: `docx-generation` (one REMOVED requirement). See `design.md`
  for the related active/archived delta cleanup the coverage gate requires.
- Affected code: delete `packages/docx-core/src/generation/recipes.ts`; drop the
  re-exports from `generation/index.ts` and `src/index.ts`; delete the six
  recipe tests; rewrite three rich-document tests
  (`generation-ancillary-parts`, `generation-compare-roundtrip`,
  `table-heavy-run-fragmented-inplace`) onto plain `TableSpec` literals; update
  the five READMEs.
- Downstream: `legal-explainer` (`lib/agreement-docx.ts`) relocates its
  cover-terms assembly into a local helper and bumps to `^0.15.0`.
