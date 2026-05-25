# Conformance

> **This document is generated** by `scripts/generate_conformance_doc.mjs`
> from `spec-compliance/registry/*.md`. Do not edit by hand — your
> changes will be reverted by `npm run check:conformance-doc`.

safe-docx targets a defined subset of **ECMA-376**.
Each entry below carries a stable serial ID, the section it claims, and a
binding into a vendored normative schema. Tests carry matching structured
Allure labels via `testAllure.conformance({…})`; source code carries
`@conformance` JSDoc tags. The citation-hygiene lint at
`scripts/check_conformance_citations.mjs` enforces both.

## Targeted sections

| ID | Title | Edition | Part | Section | Schema reference | Verified by |
| --- | --- | --- | --- | --- | --- | --- |
| `ECMA-PART4-17-16-5` | w:delInstrText and w:fldChar placement in tracked deletions | 5 | 4 | 17.16.5 | `spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:delInstrText` | — |
| `ECMA-PART1-17-13-5` | Paragraph-level OOXML markers | 5 | 1 | 17.13.5 | `spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pPrChange` | — |
| `ECMA-PART1-17-11-14` | w:footnoteReference identifier vs display number | 5 | 1 | 17.11.14 | `spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:footnoteReference` | — |

### ECMA-PART4-17-16-5 — w:delInstrText and w:fldChar placement in tracked deletions

- **Edition:** ECMA-376 5
- **Part / Section:** Part 4 § 17.16.5
- **Canonical URL:** https://ecma-international.org/publications-and-standards/standards/ecma-376/
- **Schema reference:** `spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:delInstrText`

When the engine emits deletions that cross complex-field boundaries: every
`w:delInstrText` run sits inside `<w:del>` (the DeletedFieldCode schema
constraint), and every `w:fldChar` run remains at sibling level — Word
treats `w:fldChar` inside `<w:del>` as fatal and discards the field state
machine. The runtime enforcement lives in
`packages/docx-core/src/baselines/atomizer/pipeline.ts` (the
`validateFieldStructure` function); the related (and parallel)
`w:fldChar`-placement check appears at the same site under the same
section.

### ECMA-PART1-17-13-5 — Paragraph-level OOXML markers

- **Edition:** ECMA-376 5
- **Part / Section:** Part 1 § 17.13.5
- **Canonical URL:** https://ecma-international.org/publications-and-standards/standards/ecma-376/
- **Schema reference:** `spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pPrChange`

Specific OOXML elements (notably `w:commentRangeStart`, `w:commentRangeEnd`,
`w:bookmarkStart`, `w:bookmarkEnd`, and the `pPrChange`/`rPrChange`
revision markers) are valid as direct children of `<w:p>` (and of revision
wrappers like `<w:ins>` / `<w:del>` / `<w:moveFrom>` / `<w:moveTo>`) but
never inside `<w:r>`. safe-docx's rebuild reconstructor emits them as
siblings of `<w:r>`, not as leaves wrapped in a synthetic run. The
authoritative list lives in `packages/docx-core/src/atomizer.ts`.

### ECMA-PART1-17-11-14 — w:footnoteReference identifier vs display number

- **Edition:** ECMA-376 5
- **Part / Section:** Part 1 § 17.11.14
- **Canonical URL:** https://ecma-international.org/publications-and-standards/standards/ecma-376/
- **Schema reference:** `spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:footnoteReference`

`w:id` on `w:footnoteReference` is a *reference identifier*, not the
displayed footnote number. Display numbers are derived sequentially by
document order. The 5th-edition Part 1 examples at §17.11.9 / §17.11.10
illustrate the special footnote types (separator and continuation
separator) using `w:id="0"` and `w:id="1"`; safe-docx treats those IDs
as conventional reserved values via `RESERVED_FOOTNOTE_IDS` in
`packages/docx-core/src/core-types.ts` and `isReservedId` in
`packages/docx-core/src/footnotes.ts`. The runtime ordering logic
(`findReferencesInOrder`, also in `footnotes.ts`) implements the
reference-vs-display distinction this section establishes.

## Non-Goals

_None yet. As the registry grows, sections explicitly out of scope will be
listed here so the framework treats "we do not target this" as a first-class
statement._

_Sources: `spec-compliance/registry/ecma-376.md`._
