# Design: ECMA-376 conformance framework

## Context

[Issue #227](https://github.com/UseJunior/safe-docx/issues/227) memorialized
that safe-docx makes ECMA-376 conformance claims as prose comments with
no structured binding to the normative spec, and listed six solution
categories. This change bundles four of them (machine-readable
annotations, scope statement, citation hygiene, coverage reporting) into a
coherent framework, vendors the ECMA-376 normative XSDs in-repo, and
defers two (co-located PDF text, full test-file renaming) to named
follow-ups.

The user is a WHATWG participant and explicitly invoked the WHATWG DOM
ecosystem as the model: spec text co-located, tests structurally bound to
spec assertions, gaps explicit rather than implicit. The design centers
on that property.

## Goals / Non-Goals

**Goals**
- Every ECMA-376 conformance claim in source carries a stable identifier
  resolvable to a vendored normative artifact.
- Tests advertise their conformance assertions via structured Allure
  labels, not prose `describe` strings.
- A single source of truth (the registry) drives a generated user-facing
  summary (`README.md` section) and a generated contributor-facing
  surface (`spec-compliance/CONFORMANCE.md`).
- Out-of-scope sections (Non-Goals) are first-class statements the lint
  enforces against accidental claim creep.
- The framework is multi-spec by design (WHATWG DOM, Google Docs API
  surface, etc., can land later without restructuring).

**Non-Goals**
- Vendoring the PDF narrative (separate vehicle decision).
- Backfilling every existing ECMA-376 mention (separate change).
- Runtime XSD validation of emitted XML (vendoring positions us for it
  later).
- Coverage thresholds gating CI (reportable only in phase 1).

## Decisions

### D1. Top-level `spec-compliance/` rather than `openspec/specs/*`

The conformance machinery must survive a future migration off OpenSpec.
The OpenSpec capability spec at `openspec/specs/spec-compliance/spec.md`
describes the **framework** (annotation grammar, lint rules, registry
format); the **data** lives outside `openspec/`. Registry edits do not
require an OpenSpec change; framework edits do.

### D2. JSDoc `@conformance` (not `@ecma`)

`@conformance` generalizes to other specs (`WHATWG-DOM`, `OOXML-EC-101`)
without a second tag namespace. The repo has no TypeDoc usage, so
custom-tag rendering is not currently a constraint. A complementary
`@conformance-gap` escape hatch lets code/tests document intentional
divergence with an explicit reason.

**Grammar** (lint-enforced):
`@conformance <SPEC> edition <N>, Part <N> § <SECTION>`

Edition is **required** because Part 4 § 17.16.5 exists in both the 4th
and 5th editions and may differ. A repo-wide grep at design time found
28 ECMA-376 mentions; zero disambiguate the edition.

### D3. Registry format independent of OpenSpec scenario grammar

Each entry is a `## ` heading with a stable `[ECMA-PART<N>-<section>]` ID,
followed by a fenced YAML block of metadata, followed by prose. This
format is parseable by a small Node script and survives OpenSpec process
changes. Fields:

- `edition` (required, integer)
- `part` (required, integer)
- `section` (required, dotted-string)
- `url` (required, canonical Ecma URL)
- `schemaRef` (required, repo-local `path#qualified-fragment`)
- `verifiedBy` (optional, repo-local path to a Lean file or other proof)

### D4. `schemaRef:` qualified-fragment grammar

`<path>#<kind>:<name>` where `<kind>` is one of `element`, `type`,
`attribute`. This avoids the ambiguity exposed by the round-1 peer review,
where `wml.xsd#CT_DelText` did not resolve (the element `delInstrText`
has `type="CT_Text"`, and `CT_Text` is also reused by `w:t`).

The validator parses XSDs via `fast-xml-parser` and looks up declarations
by `@name`. It accepts both `xsd:` and `xs:` namespace prefixes — Part 1
and Part 4 use `xsd:`, OPC uses `xs:`.

### D5. AST-based lint (departure from regex precedent)

The existing peer scripts (`scripts/validate_allure_test_labels.mjs`,
`scripts/check_allure_test_filename_policy.mjs`) are regex-based string
scanners. This change uses `@typescript-eslint/parser` (already in root
`devDependencies` for the test-import ESLint rule). Justification: JSDoc
block parsing via regex is error-prone — block comments inside template
literals, nested `*/`, and disjoint comment-attachment all trip up
regex-only walkers. The lint script documents this decision inline so
future maintainers do not regress to regex.

### D6. Generator-plus-`git diff --exit-code` drift gate

The drift check follows the existing `check:tool-docs` /
`check:trust-metrics` package-script pattern — a script entry in
`package.json` that runs a generator then `git diff --exit-code` on the
expected outputs. (Note: these are package scripts, not standalone
`*.mjs` files, as round-1 peer review confirmed.) The generator writes
two outputs from one registry pass:

1. `spec-compliance/CONFORMANCE.md` (full doc).
2. The HTML-comment-delimited auto-section in the canonical `README.md`.
   Localized READMEs are deliberately excluded — see `tasks.md` task 8
   and #233 for the rationale (hand-translated static content vs. dynamic
   English marker block).

The drift check runs the generator and fails if either output disagrees
with the committed version, catching both "I edited the registry but
forgot to regenerate" and "I edited the README marker block by hand".

### D7. Scope of the citation-hygiene lint

Production TS only, under `packages/*/src/`. **In scope**: JSDoc blocks
(a) attached to top-level declarations and (b) the first `/** … */` in
each file even when not attached (so module-leading prose can carry
canonical conformance claims, e.g. `footnotes.ts:6`). **Excluded**: test
files, `__tests__/` directories, `docs/`, `verification/`,
`packages/docx-core/SUPPORT.md`, and OpenSpec change/spec markdown.

Five rules:
1. `@conformance` tag value matches the grammar and resolves to a
   registry section ID.
2. In-scope JSDoc that mentions "ECMA-376" but lacks `@conformance` or
   `@conformance-gap` → fail (lead-with-spec rule).
3. `@conformance` value containing `#NNN` → fail (issue refs must move
   to `@see`).
4. Tests mentioning "ECMA-376" in `describe`/`it`/filename without a
   `.conformance(…)` label → fail.
5. `@conformance` or `.conformance(…)` pointing at a Non-Goal section
   → fail.

### D8. Allure helper architecture

`testAllure.conformance({ spec, edition, part, section })` is a new
method on the factory wrapper. It registers a default that emits
`label('conformance', '<SPEC>/edition-<N>/part-<N>/<SECTION>')` via the
existing `mergeAllureDefaults` hook in
`packages/allure-test-factory/src/index.js`. It does **not** overload
the `story` label (reserved for OpenSpec scenario stories). The type
surface gains an additive signature; existing `.openspec(…)` callers
are unaffected.

### D9. Seed sites

Three worked examples in this change. Backfill is a separate change.

- `pipeline.ts:418` — `validateFieldStructure`, the three Part 4
  constraints on complex fields. Anchors `[ECMA-PART4-17-16-5]`.
- `atomizer.ts:219` — paragraph-level OOXML markers list. Anchors
  `[ECMA-PART1-17-13-5]`.
- `footnotes.ts:6` (file-leading JSDoc) and `core-types.ts:340`
  (`RESERVED_FOOTNOTE_IDS`). Both anchor `[ECMA-PART1-17-11]`. Each
  site keeps its own annotation; local readers see the canonical
  citation without chasing imports.

### D10. Lean proof coordination is two registry fields

The in-flight `add-ooxml-doc-subset-and-inv-field-001-proof` change
formally verifies field-structure preservation. The TS runtime is
`pipeline.ts:418` (seed 1). Coordination: the registry's
`verifiedBy:` field points at the canonical Lean file path **as a
file-level pointer**, not naming specific predicate names (those are
still evolving — round-2 review found that the proof's predicate names
had already changed from earlier drafts). The Lean change adds an
outbound doc comment naming `[ECMA-PART4-17-16-5]` when its files land.
Either change can land first; the dependency is one-directional and
non-blocking.

## Risks / Trade-offs

- **R1: AST lint adds a hot path that didn't exist.** Mitigation: parse
  XSDs and registry once at startup and reuse indexes. The Allure label
  validator's filesystem-walk pattern is reusable.
- **R2: README marker drift on translation-only edits.** The generator
  writes the same English block to all `README*.md`; translator edits
  to that block fail the drift check. Mitigation: phase 1 is English-only
  by design; localized translation of the block is a follow-up.
- **R3: ECMA-376 5th edition section numbering may differ from earlier
  editions in code that imports the 4th-edition section numbers.** The
  `edition: <N>` field per registry entry is the disambiguator; the lint
  enforces it on tag values. Mitigation: explicit edition in citation
  prevents silent drift.
- **R4: `schemaRef:` fragment syntax is custom and not native to XSD
  tooling.** Trade-off accepted because it's repo-local, unambiguous
  (`element:` / `type:` / `attribute:`), and resolved by a small
  in-repo validator. Native XSD URI fragments (`xsd:complexType[@name=…]`
  XPath) would be more standards-aligned but harder to read.

## Migration Plan

This is an additive change. No existing code paths change semantics; no
data migrations. The three seed sites gain `@conformance` annotations
that the lint validates. Existing ECMA-376 mentions outside the seeds
remain unannotated and are flagged for backfill in the follow-up change.

## OpenSpec CLI expectation

OpenSpec **1.3.1** at `/opt/homebrew/bin/openspec` is required for the
`openspec validate --strict` step in the pre-submit chain. Developer
setup docs should reference `npm install -g openspec@^1.3`. Round-2 peer
review confirmed `openspec validate add-ecma-376-conformance-framework
--strict` accepts the proposed capability name `spec-compliance` on a
stub directory.

## Open Questions

- Should the registry distinguish between Strict-conformance and
  Transitional-conformance claims? For now `schemaRef:` paths name the
  variant directory (`schemas/transitional/wml.xsd` vs
  `schemas/strict/wml.xsd`); this is sufficient.
- Should `verifiedBy:` accept multiple values (Lean + property-based
  test, for instance)? Phase 1 is single-valued; the YAML shape allows
  a future array without breaking parsers.
