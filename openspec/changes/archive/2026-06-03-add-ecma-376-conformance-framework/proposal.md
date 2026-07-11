# Change: Add ECMA-376 conformance framework

## Why
safe-docx makes ECMA-376 conformance claims as prose comments that co-cite the
spec with internal GitHub issues (e.g. `// ECMA-376 Part 4 fragmentation (issue #217)`).
A repo-wide grep finds 28 ECMA-376 mentions; zero disambiguate the edition. Per
issue [#227](https://github.com/UseJunior/safe-docx/issues/227), conformance is a
foundational property of this repo and should be auditable, structured, and
elevated above any particular issue-tracking process — modeled on the WHATWG
DOM ecosystem (spec text co-located, tests structurally bound, gaps explicit).

## What Changes
- **NEW: Top-level `spec-compliance/` tree** containing `README.md`, `AGENTS.md`,
  generated `CONFORMANCE.md`, the registry under `registry/`, and vendored
  ECMA-376 5th-edition XSDs (Strict, Transitional, OPC) plus informative
  RELAX NG schemas under `ecma-376/schemas/` (~3.3 MB total, in-tree, no LFS).
- **NEW: Registry format** at `spec-compliance/registry/ecma-376.md` —
  Markdown headings with stable `[ECMA-PART<N>-<section>]` IDs and fenced
  YAML metadata (edition, part, section, url, schemaRef, optional verifiedBy).
  Independent of OpenSpec scenario grammar so the registry can outlive
  OpenSpec.
- **NEW: `@conformance` / `@conformance-gap` JSDoc tag grammar** for source
  code: `@conformance ECMA-376 edition <N>, Part <N> § <section>`.
- **NEW: `testAllure.conformance({…})` test helper** in
  `packages/allure-test-factory`, mirroring the existing `.openspec(…)`
  pattern and emitting a structured `label('conformance', …)`.
- **NEW: AST-based citation-hygiene lint** at
  `scripts/check_conformance_citations.mjs` using `@typescript-eslint/parser`
  (a deliberate departure from the existing regex-based scripts; JSDoc
  parsing via regex is brittle). Resolves `schemaRef:` against vendored
  XSDs via `fast-xml-parser`, accepting both `xsd:` and `xs:` prefixes.
- **NEW: Generator + drift gate** for `spec-compliance/CONFORMANCE.md` and
  the `<!-- AUTO-GENERATED:conformance-summary -->` block in every
  `README*.md`, wired through `npm run check:conformance-doc` (sibling
  of the existing `check:tool-docs` / `check:trust-metrics` package-script
  drift pairs).
- **NEW: Three seed entries** in the registry, each annotated at one source
  site and exercised by one test:
  - `[ECMA-PART1-17-16-13]` — deleted field-code containment constraints.
  - `[ECMA-PART1-17-13-5]` — `atomizer.ts` paragraph-level OOXML markers.
  - `[ECMA-PART1-17-11]`   — `footnotes.ts` + `core-types.ts` reserved IDs.
- **NEW: OpenSpec capability `spec-compliance`** (this change's delta spec)
  that documents the *framework* contract — annotation grammar, lint rules,
  registry format — not the registry's contents. Registry edits do not
  require an OpenSpec change; framework edits do.
- **MODIFIED: Root `AGENTS.md`** — new `## ECMA-376 conformance` section
  near the top; `check:conformance-citations` and `check:conformance-doc`
  appended explicitly to the mandated pre-submit chain.
- **MODIFIED: Root `README.md`** + 4 localized variants — new
  `## Standards Conformance` section with an HTML-comment-delimited
  auto-generated block written by `generate_conformance_doc.mjs` from the
  registry.
- **MODIFIED: `packages/allure-test-factory/src/index.{js,d.ts}`** — the
  `.conformance(…)` helper, type signatures, label emission.
- **MODIFIED: Root `package.json`** — `check:conformance-citations`,
  `check:conformance-doc`, both wired into `preflight:ci`.

## Non-Goals
- **PDF vendoring is out of scope.** ~48 MB across four parts requires a
  vehicle decision (Git LFS vs sibling repo via submodule); tracked
  separately as `vendor-ecma-376-pdfs`.
- **Backfilling the remaining ~25 ECMA-376 mentions** in source. The
  framework ships with three worked examples; backfill is the follow-up
  `backfill-ecma-376-citations` change. Bundling 25 interpretation calls
  with framework review violates one-concern-per-PR.
- **Renaming test files by section.** Allure labels already enable
  section-bound discovery; file renames are cosmetic and deferred.
- **CI-gating coverage thresholds.** Coverage is reportable in this
  change; making it enforced is a follow-up after the registry stabilizes.
- **Runtime XSD validation of emitted XML.** Vendored XSDs make this
  possible — but the focus here is *citation* binding, not output
  validation. Filed for a follow-up.

## Impact
- **Affected specs:**
  - `spec-compliance` (NEW capability)
- **Affected code:**
  - `spec-compliance/**` (new directory tree)
  - `packages/allure-test-factory/src/index.js`, `src/index.d.ts`
  - `scripts/check_conformance_citations.mjs` (new)
  - `scripts/generate_conformance_doc.mjs` (new)
  - `scripts/check_conformance_doc.mjs` (new)
  - `package.json` (root)
  - `AGENTS.md` (root)
  - `README.md` (root) + `README.{es,zh,pt-br,de}.md`
  - `packages/docx-core/src/baselines/atomizer/pipeline.ts` (seed annotation)
  - `packages/docx-core/src/atomizer.ts` (seed annotation)
  - `packages/docx-core/src/footnotes.ts` (seed annotation)
  - `packages/docx-core/src/core-types.ts` (seed annotation, duplicate site)
  - Three corresponding `*.test.ts` files (one `.conformance(…)` call each)

Ref: #227.
