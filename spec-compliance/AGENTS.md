# Citation hygiene rules for `spec-compliance/`

This file governs how source code and tests cite external specifications.
The repo-wide lint `npm run check:conformance-citations` enforces these
rules; the goal is that every conformance claim in safe-docx is auditable
against a vendored normative artifact without ambiguity.

## TL;DR

1. **Lead with the spec.** A code comment that claims OOXML conformance
   MUST carry a `@conformance` JSDoc tag naming the edition, part, and
   section. Internal GitHub issue references are not co-equal authorities
   and must move to `@see` or to a separate sentence.
2. **Edition is part of the citation.** "ECMA-376" without an edition is
   ambiguous — Part 4 § 17.16.5 exists in both the 4th and 5th editions
   and may differ. Tags MUST be of the form
   `@conformance ECMA-376 edition <N>, Part <N> § <section>`.
3. **Annotate intentional divergence with `@conformance-gap`.** Code that
   deliberately does not conform to a cited spec MUST use
   `@conformance-gap <SPEC> <citation> — <reason>` instead of
   `@conformance`. The coverage report classifies these as known gaps.
4. **Tests carry structured labels, not prose.** Use
   `testAllure.conformance({ spec, edition, part, section })` (see
   `packages/allure-test-factory`); do not rely on `describe` strings.

## The `@conformance` tag

```ts
/**
 * Per the field-state-machine rule: w:fldChar runs stay at sibling level
 * while w:delInstrText payload runs are wrapped in <w:del>.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 17.16.5
 * @see https://github.com/UseJunior/safe-docx/issues/217
 */
```

The grammar enforced by the lint:

- `@conformance <SPEC> edition <N>, Part <N> § <SECTION>`
- `<SPEC>` is one token, no spaces (e.g. `ECMA-376`).
- `<SECTION>` is a dot-separated number sequence (e.g. `17.16.5`).
- The whole value MUST resolve to a registry scenario ID. Unknown sections
  fail CI.
- The value MUST NOT contain `#NNN` — issue references belong on a `@see`
  line or in surrounding prose, never co-equal with the spec citation.

## The `@conformance-gap` escape hatch

```ts
/**
 * Word emits a non-conformant field structure on Mac builds (see #217);
 * the engine tolerates this for legacy fixtures.
 *
 * @conformance-gap ECMA-376 edition 5, Part 4 § 17.16.5 — legacy Word output deviates here
 */
```

The reason text after the em-dash is required so reviewers and the coverage
report can interpret the gap.

## Scope of the hygiene check

The citation-hygiene lint runs against TypeScript source under
`packages/*/src/` only. It excludes:

- `**/*.test.ts` and `**/__tests__/**` (tests use `.conformance(…)` labels
  instead).
- `docs/`, `verification/`, and `packages/docx-core/SUPPORT.md` (these
  enumerate element vocabulary or design notes, not normative claims).
- Lessons-learned files and namespace-reference comments where ECMA-376
  is named for context, not claimed.

Inside in-scope files, the lint examines:

- JSDoc blocks attached to top-level declarations (functions, classes,
  exported constants).
- File-leading JSDoc blocks — the first `/** … */` in the file — even
  when not attached to a declaration. This lets module-leading prose
  carry conformance claims for files like `footnotes.ts`.

If such a block mentions `"ECMA-376"` in prose without a matching
`@conformance` or `@conformance-gap` tag, the lint fails. This is the
"lead with the spec" rule in code.

## When the spec citation cannot live on a `@conformance` tag

If the surrounding code is in a context the lint does not scope (a test
description, an inline comment in the middle of a function, a markdown
file), do not invent a synthetic JSDoc block to satisfy the lint. Instead:

- For tests, attach the canonical citation via `testAllure.conformance(…)`.
- For prose docs, link to the registry entry by its `[ECMA-PART…]` ID.
- For inline comments, move the claim to the nearest enclosing JSDoc.

## Adding a new spec family

The framework is multi-spec. If you need to bind claims to WHATWG DOM,
Google Docs API, or another spec, add a sibling file
`registry/<spec-slug>.md` using the same entry shape and update the lint's
spec-family allowlist. The annotation grammar generalizes:
`@conformance WHATWG-DOM § 4.2.1` will work once the registry includes a
`whatwg-dom.md` with a `[WHATWG-DOM-4-2-1]` entry.
