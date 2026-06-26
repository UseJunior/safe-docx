# Design: removing the agreement-domain recipes cleanly

## Scope principle (the rule this enforces)

safe-docx implements Microsoft Word / OOXML functionality, plus an explicit
allowlist of LLM affordances (e.g. an outline/TOC view sized for a context
window). It must not contain names or concepts specific to a single downstream
consumer's domain. `coverTermsTable` / `signatureBlock` were such names; they are
removed. A guardrail (CONTRIBUTING "Library scope" + an LLM-gate checklist item)
is added so the drift does not recur.

## Coverage-gate consequences (why this change touches more than canonical)

`packages/docx-core/scripts/validate_generation_openspec_coverage.mjs` validates
the canonical `docx-generation` spec **and every active and archived change
delta** against the `[SDX-GEN-NNN]` test tags, under `--strict`. The recipe
scenarios are declared in several places, so removing the recipe tests requires
clearing each declaration or the gate goes red:

- **Canonical** `openspec/specs/docx-generation/spec.md` — `Legal-document
  recipes` (SDX-GEN-070/071). Removed by this change's REMOVED delta (applied to
  canonical at archive time).
- **Archived foundational delta** `changes/archive/2026-06-11-add-docx-generation`
  also declares SDX-GEN-070/071. The validator enforces archived deltas, and the
  archiver only edits canonical — so this requirement was excised from the
  archived spec.md directly. This is a deliberate, validator-mandated amendment
  to historical record: the capability no longer exists, and there is no way to
  keep the gate green without either this edit or retaining a recipe-exercising
  test (which would re-introduce the coupling we are removing).
- **Active styling deltas** (never archived): `add-cover-terms-house-style`
  (106), `add-oa-recipe-styling` (110/111), `add-oa-recipe-borders-header`
  (112/113) are recipe-only and were deleted. `add-signature-and-keeplines` is
  mixed — its general keep-lines requirement (SDX-GEN-108) and test are kept; the
  two-column signature requirement (SDX-GEN-109) was removed from its delta.

## Archive-in-PR

This change is archived in the same PR (`openspec archive`) because the coverage
gate requires the canonical spec to be consistent with the test set within the
PR; a half-applied removal cannot pass CI. The archiver removes the
`Legal-document recipes` requirement from canonical and records this change under
`changes/archive/`.

## Alternative considered

Keep the recipes but rename them to domain-neutral primitives. Rejected: the
value the recipes added over raw `TableSpec` was the agreement iteration loop,
which is consumer logic; a domain-neutral wrapper with a single consumer earns
nothing and re-imports the coupling. The general grammar already suffices.
