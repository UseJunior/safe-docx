# ECMA-376 conformance registry

This file is the **source of truth** for safe-docx's conformance posture
against ECMA-376, 5th Edition (Office Open XML File Formats). Every entry
below maps a stable serial ID to a section identifier, a vendored schema
declaration, and the prose summary that appears in `CONFORMANCE.md`.

The format is independent of any change-management tool so the registry can
outlive a future migration off OpenSpec. Entries are parsed by
`scripts/check_conformance_citations.mjs` and rendered into
`spec-compliance/CONFORMANCE.md` by `scripts/generate_conformance_doc.mjs`.

## Targeted sections

## [ECMA-PART4-17-16-5] w:delInstrText and w:fldChar placement in tracked deletions

```yaml
edition: 5
part: 4
section: "17.16.5"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:delInstrText
verifiedBy:
```

When the engine emits deletions that cross complex-field boundaries: every
`w:delInstrText` run sits inside `<w:del>` (the DeletedFieldCode schema
constraint), and every `w:fldChar` run remains at sibling level — Word
treats `w:fldChar` inside `<w:del>` as fatal and discards the field state
machine. The runtime enforcement lives in
`packages/docx-core/src/baselines/atomizer/pipeline.ts` (the
`validateFieldStructure` function); the related (and parallel)
`w:fldChar`-placement check appears at the same site under the same
section.

## [ECMA-PART1-17-13-5] Paragraph-level OOXML markers

```yaml
edition: 5
part: 1
section: "17.13.5"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pPrChange
verifiedBy:
```

Specific OOXML elements (notably `w:commentRangeStart`, `w:commentRangeEnd`,
`w:bookmarkStart`, `w:bookmarkEnd`, and the `pPrChange`/`rPrChange`
revision markers) are valid as direct children of `<w:p>` (and of revision
wrappers like `<w:ins>` / `<w:del>` / `<w:moveFrom>` / `<w:moveTo>`) but
never inside `<w:r>`. safe-docx's rebuild reconstructor emits them as
siblings of `<w:r>`, not as leaves wrapped in a synthetic run. The
authoritative list lives in `packages/docx-core/src/atomizer.ts`.

## [ECMA-PART1-17-11-14] w:footnoteReference identifier vs display number

```yaml
edition: 5
part: 1
section: "17.11.14"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:footnoteReference
verifiedBy:
```

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

Sections explicitly **out of scope** for safe-docx. Annotations pointing
at these IDs via `@conformance` or `.conformance(…)` fail the lint;
contributors must use `@conformance-gap` for known deliberate divergence
within targeted sections instead.

_None yet. As the registry grows, Non-Goals will be enumerated here using
the same `[ECMA-PART<N>-<section>]` ID grammar so the framework treats
"we explicitly do not target this" as a first-class statement._
