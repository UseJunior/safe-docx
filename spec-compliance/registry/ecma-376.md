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

## [ECMA-PART1-17-16-22] w:hyperlink container preservation under tracked changes

```yaml
edition: 5
part: 1
section: "17.16.22"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:hyperlink
verifiedBy:
```

`w:hyperlink` (CT_Hyperlink) is a run container inside `<w:p>` whose
`r:id` attribute carries the relationship reference to the link target.
Its content model (EG_PContent) admits run-level revision wrappers, so
tracked edits to link text nest as `<w:hyperlink><w:ins>…` /
`<w:hyperlink><w:del>…`; the reverse nesting is invalid because
CT_RunTrackChange (the `w:ins` / `w:del` content model) does not admit
`w:hyperlink`. safe-docx's comparison engine preserves the wrapper and
its attributes when reconstructing paragraphs that contain hyperlinks,
and never merges text atoms across a hyperlink boundary. The enforcement
lives in `packages/docx-core/src/atomizer.ts`
(`nearestHyperlinkAncestor`) and
`packages/docx-core/src/baselines/atomizer/documentReconstructor.ts`
(hyperlink wrapper re-emission).

## [ECMA-PART1-17-6-17] w:sectPr document-final section properties

```yaml
edition: 5
part: 1
section: "17.6.17"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:sectPr
verifiedBy:
```

The final section of a document binds its properties through a `w:sectPr`
that is a direct child of `w:body`, positioned after all block-level
content. From-scratch generation always emits exactly one body-level
`w:sectPr` as the body's last child, and the generation structural
validator (`packages/docx-core/src/generation/structural-checks.ts`)
rejects packages where it is missing, duplicated, or not last —
complementing `auditSectPr`, which tolerates the zero-sectPr case for
parsed third-party documents.

## [ECMA-PART1-17-6-13] w:pgSz page size emission

```yaml
edition: 5
part: 1
section: "17.6.13"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pgSz
verifiedBy:
```

`w:pgSz` carries the page width/height in twentieths of a point and an
optional orientation. The generation section emitter
(`packages/docx-core/src/generation/emit/section.ts`) emits explicit
`w:w`/`w:h` for every section (defaulting to US Letter) and sets
`w:orient="landscape"` with swapped dimensions when the spec requests
landscape, so readers never fall back to printer-driver defaults.

## [ECMA-PART1-17-6-11] w:pgMar page margin emission

```yaml
edition: 5
part: 1
section: "17.6.11"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pgMar
verifiedBy:
```

`w:pgMar` declares the page margins plus header/footer offsets and
gutter for a section, all in twips. The generation section emitter
always emits the full attribute set (top, right, bottom, left, header,
footer, gutter) because readers diverge in their defaults when
attributes are omitted; spec values fill in unspecified members from
the standard one-inch/half-inch defaults.

## [ECMA-PART1-17-3-1-26] w:pPr child-element ordering

```yaml
edition: 5
part: 1
section: "17.3.1.26"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pPr
verifiedBy:
```

`w:pPr` (CT_PPr) declares its children as an ordered sequence; readers
that validate against the schema reject out-of-order properties. The
generation property-ordering discipline
(`packages/docx-core/src/generation/ordering.ts`) encodes the emitted
subset of that sequence as `PPR_ORDER` and routes every paragraph
property through `appendInOrder`, which throws on any property name
missing from the table so new properties force a conscious ordering
decision.

## [ECMA-PART1-17-3-2-28] w:rPr child-element ordering

```yaml
edition: 5
part: 1
section: "17.3.2.28"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:rPr
verifiedBy:
```

`w:rPr` (CT_RPr) likewise declares an ordered property sequence. The
generation discipline encodes the emitted subset as `RPR_ORDER` in
`packages/docx-core/src/generation/ordering.ts`, enforced through the
same `appendInOrder` mechanism as paragraph properties.

## Non-Goals

Sections explicitly **out of scope** for safe-docx. Each entry below carries the
same spec section and vendored-schema binding as a targeted section, so "we do
not target this" is a first-class, reviewable statement rather than silence.

Beyond the enumerated sections, safe-docx is not a from-scratch document
generator, rejects Word template packages (`.dotx`), and makes no rendering,
layout, pagination, or cross-editor-fidelity guarantees. Those boundaries have no
single ECMA-376 section; they are described under
[“What Safe Docx Is Not Optimized For”](/README.md#what-safe-docx-is-not-optimized-for)
in the root README.

A source `@conformance` JSDoc tag that points at one of these Non-Goal IDs fails
the citation lint. For a deliberate divergence *inside a targeted section*, use
`@conformance-gap` with a reason instead.

## [ECMA-PART1-17-13-5-2] Cell-topology revisions (w:cellIns / w:cellDel / w:cellMerge)

```yaml
edition: 5
part: 1
section: "17.13.5.2"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:cellIns
verifiedBy:
```

ECMA-376 Part 1 §17.13.5.1–§17.13.5.3 define tracked changes to table-cell
topology: `w:cellDel` (cell deletion), `w:cellIns` (cell insertion), and
`w:cellMerge` (vertical merge/split). safe-docx surfaces no cell-topology
mutation today — it neither authors these revision elements nor offers an
accept/reject path dedicated to them — so it makes no conformance claim over
this section.

## [ECMA-PART1-17-13-5-21] Tracked move revisions (w:moveFrom / w:moveTo)

```yaml
edition: 5
part: 1
section: "17.13.5.21"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:moveFrom
verifiedBy:
```

ECMA-376 Part 1 §17.13.5.21 onward define tracked *moves*: the `w:moveFrom` and
`w:moveTo` content wrappers plus the paired `w:moveFromRangeStart` /
`w:moveFromRangeEnd` and `w:moveToRangeStart` / `w:moveToRangeEnd` range markers.
safe-docx surfaces no move primitive today; relocating content is expressed as a
deletion plus an insertion, not as a first-class move pair. No conformance claim
is made over the move-revision section.

## [ECMA-PART1-17-13-5-30] Numbering-property revisions (w:numberingChange)

```yaml
edition: 5
part: 1
section: "17.13.5.30"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:numberingChange
verifiedBy:
```

ECMA-376 Part 1 §17.13.5.30 defines `w:numberingChange`, the revision record for
a paragraph's previous numbering properties. safe-docx surfaces no numbering
mutation today and does not author this revision element, so it makes no
conformance claim over this section.

## [ECMA-PART1-17-13-5-34] Section-property revisions (w:sectPrChange)

```yaml
edition: 5
part: 1
section: "17.13.5.34"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:sectPrChange
verifiedBy:
```

ECMA-376 Part 1 §17.13.5.34 defines `w:sectPrChange`, the revision record for a
prior set of section properties (page layout, columns, headers/footers binding).
safe-docx surfaces no section-layout mutation today and does not author this
revision element, so it makes no conformance claim over this section.

## [ECMA-PART1-17-13-5-36] Table-property and grid revisions (w:tblPrChange / w:tblPrExChange / w:tblGridChange)

```yaml
edition: 5
part: 1
section: "17.13.5.36"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblPrChange
verifiedBy:
```

ECMA-376 Part 1 §17.13.5.35–§17.13.5.37 define tracked changes to table-wide
structure: `w:tblGridChange` (grid-column definitions), `w:tblPrChange`
(table properties), and `w:tblPrExChange` (table-level property exceptions).
safe-docx surfaces no table-wide property or grid mutation today and does not
author these revision elements, so it makes no conformance claim over this
section.
