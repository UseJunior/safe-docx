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

## [ECMA-PART1-17-16-13] w:delInstrText containment in tracked deletions

```yaml
edition: 5
part: 1
section: "17.16.13"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:delInstrText
verifiedBy: packages/docx-compare/src/baselines/atomizer/pipeline.ts; packages/docx-compare/src/baselines/atomizer/inPlaceModifier-deletion.ts; packages/docx-compare/src/baselines/atomizer/pipeline.field-validation.test.ts; packages/docx-core/src/integration/lean-spec-bridge.test.ts; verification/lean/Tier2/XmlTripleChecker.lean; verification/registry/lean-xml-checker-coverage.json
```

Part 1 §17.16.13 requires every `w:delInstrText` run to sit inside `<w:del>`
and describes it as deleted field code within a complex field. The runtime
enforcement lives in
`packages/docx-compare/src/baselines/atomizer/pipeline.ts` (the
`validateFieldStructure` function). The related `w:fldChar` placement rule is
tracked separately under `ECMA-PART1-17-16-18`; Part 4 supplies the
Transitional XSD declaration but is not the prose authority for this claim.

## [ECMA-PART1-17-13-5] Paragraph-level OOXML markers

```yaml
edition: 5
part: 1
section: "17.13.5"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pPrChange
verifiedBy: packages/docx-compare/src/atomizer.ts; packages/docx-core/src/integration/cross-implementation-suite.test.ts; packages/docx-core/src/integration/libreoffice-oracle-trust-boundary.test.ts
```

Specific OOXML elements (notably `w:commentRangeStart`, `w:commentRangeEnd`,
`w:bookmarkStart`, `w:bookmarkEnd`, `w:permStart`, `w:permEnd`, and the
`pPrChange`/`rPrChange`
revision markers) are valid as direct children of `<w:p>` (and of revision
wrappers like `<w:ins>` / `<w:del>` / `<w:moveFrom>` / `<w:moveTo>`) but
never inside `<w:r>`. safe-docx's rebuild reconstructor emits them as
siblings of `<w:r>`, not as leaves wrapped in a synthetic run. The
authoritative list lives in `packages/docx-compare/src/atomizer.ts`.

## [ECMA-PART1-17-13-8-1] Proofing error anchors

```yaml
edition: 5
part: 1
section: "17.13.8.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:proofErr
verifiedBy:
```

`w:proofErr` anchors mark spelling or grammar proofing state. They are
consumer-rewritable metadata and carry no document content, so safe-docx
treats a paragraph whose only children are proofing anchors as an empty
paragraph for comparison. Rebuild reconstruction does not re-emit those
anchors.

## [ECMA-PART1-17-11-14] w:footnoteReference identifier vs display number

```yaml
edition: 5
part: 1
section: "17.11.14"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:footnoteReference
verifiedBy: packages/docx-core/src/footnotes.ts; packages/docx-core/src/footnotes.test.ts
```

`w:id` on `w:footnoteReference` is a *reference identifier*, not the
displayed footnote number. For the supported Word-conventional package
surface, display numbers are derived sequentially by document order. The
runtime ordering logic (`findReferencesInOrder` in
`packages/docx-core/src/footnotes.ts`) implements that distinction.

The current `isReservedId` helper skips numeric IDs `0` and `1`, following a
convention seen in Word-produced packages. That is a conformance gap, not a
rule of §17.11.14: the standard identifies separator and continuation-
separator notes through note type and does not normatively reserve those
numeric identifiers. Arbitrary packages that use `0` or `1` for user notes,
full `w:type` interpretation, and complete `w:customMarkFollows` display-mark
semantics are outside the present numbering claim.

The compiled Lean checker reads `word/footnotes.xml` and
`word/endnotes.xml` from the original, revised, and compared packages, but
only proves normalized text projection and field-marker structure for user
notes. It does not inspect `w:footnoteReference`/`w:endnoteReference`, match
reference IDs to definitions, or validate note relationships. Those claims
remain runtime-and-test-backed only.

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

## [ECMA-PART1-17-7-4-18] w:styles style-definitions part emission

```yaml
edition: 5
part: 1
section: "17.7.4.18"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:styles
verifiedBy:
```

`w:styles` is the root of the style-definitions part. From-scratch
generation always emits `word/styles.xml` — document defaults, a default
`Normal` paragraph style, and every declared named style — wired through a
content-type override and a styles relationship from the main document
part. The emitter lives at
`packages/docx-core/src/generation/emit/styles-part.ts`.

## [ECMA-PART1-17-7-4-17] w:style style-definition emission

```yaml
edition: 5
part: 1
section: "17.7.4.17"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:style
verifiedBy:
```

Each declared `StyleSpec` becomes a `w:style` carrying `w:type`,
`w:styleId`, `w:name`, optional `w:basedOn`/`w:next` links, and `w:pPr` /
`w:rPr` built by the same shared property builders the body emitters use —
so a style definition and direct formatting can never serialize a property
differently. Dangling `basedOn`/`next`/paragraph references are rejected
at spec validation, before any XML is built.

## [ECMA-PART1-17-7-5-1] w:docDefaults document-default properties

```yaml
edition: 5
part: 1
section: "17.7.5.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:docDefaults
verifiedBy:
```

`w:docDefaults` carries the document-wide default run and paragraph
properties that styles and direct formatting layer over. Generation emits
explicit defaults (font bound across ascii/hAnsi/cs script ranges plus an
explicit size) rather than relying on reader fallbacks, which diverge
between Word, LibreOffice, and Google Docs import.

## [ECMA-PART1-17-6-18] w:sectPr paragraph-level section break emission

```yaml
edition: 5
part: 1
section: "17.6.18"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:sectPr
verifiedBy:
```

A non-final section's properties bind through a `w:sectPr` inside the
`w:pPr` of a dedicated break paragraph — the shape Word itself produces on
Insert → Section Break, and the one that sidesteps the trailing-table case
(a table cannot carry section properties). The generation document emitter
appends such a break paragraph after every non-final section's blocks;
`auditSectPr` verifies the pPr-only placement on the way back out.

## [ECMA-PART1-17-6-12] w:pgNumType page-numbering settings emission

```yaml
edition: 5
part: 1
section: "17.6.12"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pgNumType
verifiedBy:
```

`w:pgNumType` declares a section's page-number format and restart value.
Generation emits `w:start`/`w:fmt` only when the spec requests them, so
sections without explicit numbering inherit continuous decimal numbering.

## [ECMA-PART1-17-10-5] w:headerReference binding

```yaml
edition: 5
part: 1
section: "17.10.5"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:headerReference
verifiedBy:
  packages/docx-core/src/primitives/sectPrAudit.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts
```

Each declared header slot (first/default/even) becomes its own part bound
through a typed `w:headerReference` whose `r:id` (written namespace-aware
via `setAttributeNS`) resolves in the document's relationships. References
lead the `w:sectPr` child sequence; the structural validator rejects
dangling or missing ids.

The package audit follows each reference through `document.xml.rels`, checks
the header relationship type, resolves its target part, and requires a
`w:hdr` root. Relationship reuse across sections is accepted. Pagination,
role inheritance when a reference is absent, and reader rendering are not
evaluated.

## [ECMA-PART1-17-10-2] w:footerReference binding

```yaml
edition: 5
part: 1
section: "17.10.2"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:footerReference
verifiedBy:
  packages/docx-core/src/primitives/sectPrAudit.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts
```

Footer references follow the same typed-binding discipline as header
references, emitted in a fixed first/default/even order for deterministic
output.

The package audit applies the corresponding footer relationship and `w:ftr`
target checks. It verifies explicit bindings only; it does not predict page
assignment or consumer fallback behavior for omitted roles.

## [ECMA-PART1-17-10-6] w:titlePg first-page header/footer switch

```yaml
edition: 5
part: 1
section: "17.10.6"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:titlePg
verifiedBy:
```

`w:titlePg` activates a section's first-page header/footer. Generation
implies it whenever a `first` header or footer is declared (and honors an
explicit `titlePg: true`), so a declared cover-page header can never be
silently ignored by readers.

## [ECMA-PART1-17-10-4] w:hdr header part emission

```yaml
edition: 5
part: 1
section: "17.10.4"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:hdr
verifiedBy:
```

Header parts are emitted as standalone `w:hdr` documents
(word/headerN.xml) with content-type overrides, sharing the body's
paragraph/run emitters so header content compiles through the same
formatting and field machinery as body content.

## [ECMA-PART1-17-10-3] w:ftr footer part emission

```yaml
edition: 5
part: 1
section: "17.10.3"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:ftr
verifiedBy:
```

Footer parts mirror header parts as `w:ftr` documents (word/footerN.xml);
"Page X of Y" footers carry complete five-part PAGE/NUMPAGES fields with
cached results.

## [ECMA-PART1-17-10-1] w:evenAndOddHeaders setting

```yaml
edition: 5
part: 1
section: "17.10.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:evenAndOddHeaders
verifiedBy:
```

Even-page headers/footers are only honored when `w:evenAndOddHeaders` is
set in word/settings.xml. Generation emits the settings part exactly when
some section declares an `even` slot, so the declared content and the
document-level switch can never drift apart.

## [ECMA-PART1-17-16-18] w:fldChar five-part complex-field emission

```yaml
edition: 5
part: 1
section: "17.16.18"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:fldChar
verifiedBy: packages/docx-core/src/generation/emit/run.ts; packages/docx-core/src/generation/structural-checks.ts; packages/docx-compare/src/baselines/atomizer/inPlaceModifier-deletion.ts; packages/docx-compare/src/baselines/atomizer/pipeline.field-validation.test.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts; verification/lean/Tier2/XmlTripleChecker.lean; verification/registry/lean-xml-checker-coverage.json
```

Every generated field is a complete five-run sequence — `fldChar begin`,
preserved-space `w:instrText`, `fldChar separate`, a cached-result run,
`fldChar end` — and `w:dirty` is never set. The cached result is a
required spec property, making the no-recovery-dialog guarantee
unrepresentable-by-omission; the structural validator runs a begin →
separate → end state machine over every story part. The comparison path keeps
these field-state markers outside the `w:del` payload wrappers shown by the
Part 1 complex-field and deleted-field-code syntax.

## [ECMA-PART1-17-16-5-44] PAGE field instruction emission

```yaml
edition: 5
part: 1
section: "17.16.5.44"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:instrText
verifiedBy: packages/docx-core/src/generation/emit/run.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts
```

The PAGE instruction is emitted with canonical surrounding spaces
(` PAGE `) inside a preserved-space `w:instrText`, matching the shape of
the committed field fixtures used by the comparison pipeline.

## [ECMA-PART1-17-16-5-42] NUMPAGES field instruction emission

```yaml
edition: 5
part: 1
section: "17.16.5.42"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:instrText
verifiedBy: packages/docx-core/src/generation/emit/run.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts
```

The NUMPAGES instruction follows the same emission discipline as PAGE
(` NUMPAGES `, preserved spacing, cached result required), giving
"Page X of Y" footers structurally correct field pairs.

## [ECMA-PART1-17-4-37] w:tbl table emission

```yaml
edition: 5
part: 1
section: "17.4.37"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tbl
verifiedBy:
```

Tables compile as `w:tbl` with table properties, the column grid, and rows
in schema order. The emitter lives in
`packages/docx-core/src/generation/emit/table.ts`; cells dispatch back into
the shared block emitters so nested tables reuse the same path.

## [ECMA-PART1-17-4-59] w:tblPr table-properties emission

```yaml
edition: 5
part: 1
section: "17.4.59"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblPr
verifiedBy:
```

Table-level properties are collected into a map and appended through the
`TBLPR_ORDER` table, which the ordering-schema test cross-checks against
`CT_TblPrBase` in the vendored transitional schema.

## [ECMA-PART1-17-4-63] w:tblW preferred-width consistency

```yaml
edition: 5
part: 1
section: "17.4.63"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblW
verifiedBy:
```

`w:tblW` is always emitted in `dxa` units as the sum of the declared grid
column widths, so the preferred table width and the grid never disagree —
readers that honor one or the other render the same layout.

## [ECMA-PART1-17-4-52] w:tblLayout explicit layout algorithm

```yaml
edition: 5
part: 1
section: "17.4.52"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblLayout
verifiedBy:
```

The layout algorithm is always written explicitly (`fixed` by default)
because autofit is the reader-side default when the element is omitted and
silently reflows fixed designs.

## [ECMA-PART1-17-4-38] w:tblBorders table border collection

```yaml
edition: 5
part: 1
section: "17.4.38"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblBorders
verifiedBy:
```

Declared table borders emit as a `w:tblBorders` collection whose edges
appear in the `CT_TblBorders` sequence (top, left, bottom, right, insideH,
insideV) with explicit size/space/color on every edge.

## [ECMA-PART1-17-4-48] w:tblGrid table grid emission

```yaml
edition: 5
part: 1
section: "17.4.48"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblGrid
verifiedBy:
```

Every generated table carries a `w:tblGrid` with one `w:gridCol` per
declared column width; spec validation rejects any row whose effective
span arithmetic diverges from this grid.

## [ECMA-PART1-17-4-16] w:gridCol grid-column definition

```yaml
edition: 5
part: 1
section: "17.4.16"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:gridCol
verifiedBy:
```

Grid columns carry their width in twentieths of a point, matching the
spec's `columnWidthsTwips` verbatim — widths are never redistributed or
normalized by the compiler.

## [ECMA-PART1-17-4-78] w:tr table-row emission

```yaml
edition: 5
part: 1
section: "17.4.78"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tr
verifiedBy:
```

Rows emit as `w:tr` with optional row properties followed by cells. Cell
grid offsets are tracked during emission so unspecified cell widths can be
derived from the columns each cell actually spans.

## [ECMA-PART1-17-4-81] w:trPr row-properties ordering

```yaml
edition: 5
part: 1
section: "17.4.81"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:trPr
verifiedBy:
```

Row properties are appended through the `TRPR_ORDER` table
(`trHeight` before `tblHeader`), cross-checked against `CT_TrPrBase` by
the ordering-schema test.

## [ECMA-PART1-17-4-80] w:trHeight row height

```yaml
edition: 5
part: 1
section: "17.4.80"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:trHeight
verifiedBy:
```

A declared row height emits `w:trHeight` with an explicit `w:hRule`
(`atLeast` unless the spec says `exact`), avoiding the reader-divergent
default when the rule attribute is omitted.

## [ECMA-PART1-17-4-49] w:tblHeader repeating header row

```yaml
edition: 5
part: 1
section: "17.4.49"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblHeader
verifiedBy:
```

Rows marked as header rows emit `w:tblHeader` so the row repeats at the
top of every page the table spans.

## [ECMA-PART1-17-4-65] w:tc table-cell emission and trailing paragraph

```yaml
edition: 5
part: 1
section: "17.4.65"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tc
verifiedBy:
```

Cells emit their properties then their block content, and the emitter
guarantees by construction that every cell ends with a `w:p` — an empty
cell or one whose last block is a nested table receives a closing empty
paragraph. The structural validator independently re-checks this invariant
(and that the document body never ends with a table) over the parsed
output.

## [ECMA-PART1-17-4-69] w:tcPr cell-properties ordering

```yaml
edition: 5
part: 1
section: "17.4.69"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tcPr
verifiedBy:
```

Cell properties are appended through the `TCPR_ORDER` table
(tcW, gridSpan, vMerge, tcBorders, shd, tcMar, vAlign), cross-checked
against `CT_TcPrBase` by the ordering-schema test.

## [ECMA-PART1-17-4-71] w:tcW preferred cell width

```yaml
edition: 5
part: 1
section: "17.4.71"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tcW
verifiedBy:
```

Every cell carries an explicit `w:tcW` in `dxa` units: the declared
width when given, otherwise the sum of the grid columns the cell spans —
cell widths are deterministic, never left to reader inference.

## [ECMA-PART1-17-4-17] w:gridSpan horizontal cell span

```yaml
edition: 5
part: 1
section: "17.4.17"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:gridSpan
verifiedBy:
```

Cells spanning multiple grid columns emit `w:gridSpan`; validation
rejects rows whose summed spans diverge from the declared grid with a
typed `grid_mismatch` error before any XML is produced.

## [ECMA-PART1-17-4-84] w:vMerge vertical cell merge

```yaml
edition: 5
part: 1
section: "17.4.84"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:vMerge
verifiedBy:
```

Merge starts emit `w:vMerge w:val="restart"`; continuations emit the
bare element form Word itself writes. Validation requires each
continuation to sit at exactly the grid position and span of a merge cell
in the previous row.

## [ECMA-PART1-17-4-32] w:shd table-cell shading

```yaml
edition: 5
part: 1
section: "17.4.32"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:shd
verifiedBy:
```

Cell shading emits as `w:shd w:val="clear"` with an explicit fill color
from the spec's six-digit hex value; the pattern value is never omitted.

## [ECMA-PART1-17-4-83] w:vAlign cell vertical alignment

```yaml
edition: 5
part: 1
section: "17.4.83"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:vAlign
verifiedBy:
```

Declared cell vertical alignment emits `w:vAlign` with the literal
top/center/bottom value at its `CT_TcPrBase` position.

## [ECMA-PART1-17-4-68] w:tcMar single-cell margins

```yaml
edition: 5
part: 1
section: "17.4.68"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tcMar
verifiedBy:
```

Per-cell margins emit a `w:tcMar` collection in schema edge order with
explicit `dxa` widths; only the edges the spec declares are written.

## [ECMA-PART1-17-4-66] w:tcBorders cell border collection

```yaml
edition: 5
part: 1
section: "17.4.66"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tcBorders
verifiedBy:
```

Declared cell borders emit as a `w:tcBorders` collection in the
`CT_TcBorders` sequence with explicit size/space/color per edge, sitting
between `w:vMerge` and `w:shd` in the cell-property order.

## [ECMA-PART1-17-9-16] w:numbering numbering-definitions part emission

```yaml
edition: 5
part: 1
section: "17.9.16"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:numbering
verifiedBy:
```

Declared numbering definitions compile to a word/numbering.xml part whose
root holds every abstract definition before every instance, per the
CT_Numbering sequence. The emitter lives in
`packages/docx-core/src/generation/emit/numbering-part.ts`.

## [ECMA-PART1-17-9-1] w:abstractNum abstract numbering definition

```yaml
edition: 5
part: 1
section: "17.9.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:abstractNum
verifiedBy:
```

Each NumberingSpec becomes one abstract definition with sequential
`abstractNumId` values assigned in declaration order — ids are
deterministic compile output, never random.

## [ECMA-PART1-17-9-2] w:abstractNumId abstract definition reference

```yaml
edition: 5
part: 1
section: "17.9.2"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:abstractNumId
verifiedBy:
```

Every emitted instance references its abstract definition through
`w:abstractNumId`; the pairing is 1:1 by construction so the reference can
never dangle.

## [ECMA-PART1-17-9-15] w:num numbering definition instance

```yaml
edition: 5
part: 1
section: "17.9.15"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:num
verifiedBy:
```

Instances carry sequential numeric `w:numId` values (starting at 1) in
declaration order; the spec-level string handle → numeric id map is what
paragraph references bind through.

## [ECMA-PART1-17-9-18] w:numId numbering instance reference

```yaml
edition: 5
part: 1
section: "17.9.18"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:numId
verifiedBy:
```

List paragraphs reference their instance via `w:numId` inside `w:numPr`;
spec validation rejects handles with no declared definition
(`dangling_numbering_reference`) before any XML is produced.

## [ECMA-PART1-17-9-3] w:ilvl numbering level reference

```yaml
edition: 5
part: 1
section: "17.9.3"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:ilvl
verifiedBy:
```

The paragraph's level reference is emitted before `w:numId` per the
CT_NumPr sequence, and validation requires the referenced level to exist
in the bound definition.

## [ECMA-PART1-17-9-6] w:lvl numbering level definition

```yaml
edition: 5
part: 1
section: "17.9.6"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:lvl
verifiedBy:
```

Level definitions follow the CT_Lvl child sequence (start, numFmt, suff,
lvlText, lvlJc, pPr, rPr); level indents emit through `w:pPr`/`w:ind` and
level run properties reuse the shared rPr builder.

## [ECMA-PART1-17-9-17] w:numFmt numbering format

```yaml
edition: 5
part: 1
section: "17.9.17"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:numFmt
verifiedBy:
```

Each level carries its declared format verbatim (decimal, letter, roman,
bullet, none); the generated formats round-trip through the read-side
label computation in `packages/docx-core/src/primitives/numbering.ts`.

## [ECMA-PART1-17-9-11] w:lvlText numbering level text

```yaml
edition: 5
part: 1
section: "17.9.11"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:lvlText
verifiedBy:
```

The level text pattern (e.g. `%1.` / `%1.%2` / a literal bullet glyph) is
emitted verbatim from the spec; validation requires a non-empty pattern on
every level.

## [ECMA-PART1-17-9-25] w:start numbering level starting value

```yaml
edition: 5
part: 1
section: "17.9.25"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:start
verifiedBy:
```

The starting value is always emitted explicitly (declared value or 1) so
readers never fall back to divergent defaults.

## [ECMA-PART1-17-9-28] w:suff content between numbering symbol and text

```yaml
edition: 5
part: 1
section: "17.9.28"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:suff
verifiedBy:
```

A declared suffix (tab/space/nothing) emits at its CT_Lvl position; when
absent the element is omitted and readers apply the spec default (tab),
matching the read-side parser's assumption.

## [ECMA-PART1-17-9-12] w:multiLevelType abstract definition type

```yaml
edition: 5
part: 1
section: "17.9.12"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:multiLevelType
verifiedBy:
```

Abstract definitions declare `multilevel` when more than one level exists
and `singleLevel` otherwise, so single-level bullet definitions don't
advertise unused depth.

## [ECMA-PART1-17-9-7] w:lvlJc numbering level justification

```yaml
edition: 5
part: 1
section: "17.9.7"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:lvlJc
verifiedBy:
```

Level justification is authorable per level via `NumberingSpec` (`left`,
`center`, or `right`, the transitional ST_Jc subset) and is always emitted
deterministically, defaulting to `left` when omitted. `right` aligns labels of
differing widths on their right edge — the standard legal-outline convention.

## [ECMA-PART1-17-3-1-19] w:numPr paragraph numbering reference

```yaml
edition: 5
part: 1
section: "17.3.1.19"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:numPr
verifiedBy:
```

List paragraphs carry `w:numPr` (ilvl then numId) at its CT_PPrBase slot
via the PPR_ORDER table; the numeric id comes from the numbering part's
deterministic handle map.

## [ECMA-PART1-17-13-4-6] w:comments comment-collection part emission

```yaml
edition: 5
part: 1
section: "17.13.4.6"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:comments
verifiedBy: packages/docx-core/src/generation/emit/comments-part.ts; packages/docx-core/src/generation/generation-drafting-notes.test.ts
```

Drafting notes compile to a word/comments.xml part holding one
`w:comment` per note, alongside the Word-extension commentsExtended and
people parts (content/relationship types matching what Word itself
writes, cross-checked against the Open XML SDK part constants). The
emitter lives in `packages/docx-core/src/generation/emit/comments-part.ts`.
This claim is limited to generated root-comment collections. Thread replies,
comment-resolution semantics, and arbitrary third-party comment-part repair
are not claimed. `comments.xml` is outside the compiled Lean checker scope.

## [ECMA-PART1-17-13-4-2] w:comment comment content emission

```yaml
edition: 5
part: 1
section: "17.13.4.2"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:comment
verifiedBy: packages/docx-core/src/generation/emit/comments-part.ts; packages/docx-core/src/generation/generation-drafting-notes.test.ts
```

Each comment carries deterministic metadata: sequential ids in document
order, author falling back note.author → meta.author → 'safe-docx' with
derived initials, dates only from DraftingNoteSpec.dateIso or
meta.createdIso (never the clock), and a `w14:paraId` derived from the
comment id so commentsExtended entries pair up by construction.
This does not claim validation of externally supplied comment IDs, extension
thread graphs, or comment relationships.

## [ECMA-PART1-17-13-4-4] w:commentRangeStart comment anchor opening

```yaml
edition: 5
part: 1
section: "17.13.4.4"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:commentRangeStart
verifiedBy: packages/docx-core/src/generation/emit/paragraph.ts; packages/docx-core/src/generation/generation-drafting-notes.test.ts
```

A noted paragraph opens its comment range before its first run; range
ids always match an emitted comment, and the disabled-notes compile emits
no anchors at all, keeping the body byte-identical to a never-noted spec.
Cross-paragraph ranges and repair of malformed or orphaned anchors are outside
this generation claim.

## [ECMA-PART1-17-13-4-3] w:commentRangeEnd comment anchor closing

```yaml
edition: 5
part: 1
section: "17.13.4.3"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:commentRangeEnd
verifiedBy: packages/docx-core/src/generation/emit/paragraph.ts; packages/docx-core/src/generation/generation-drafting-notes.test.ts
```

The comment range closes after the paragraph's last run, before the
reference run, so the anchored extent is exactly the paragraph content.
Cross-paragraph ranges and repair of malformed or orphaned anchors are outside
this generation claim.

## [ECMA-PART1-17-13-4-5] w:commentReference comment reference mark

```yaml
edition: 5
part: 1
section: "17.13.4.5"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:commentReference
verifiedBy: packages/docx-core/src/generation/emit/paragraph.ts; packages/docx-core/src/generation/generation-drafting-notes.test.ts
```

The trailing reference run carries `w:commentReference` with the same id
as its range anchors; the existing deleteComment editing path removes the
trio cleanly, which the strip scenario verifies on generated output.
The compiled Lean checker does not read `comments.xml` or prove anchor,
reference-ID, relationship, or thread integrity.

## [ECMA-PART1-17-13-5-15] Deleted paragraph mark (w:del under w:pPr/w:rPr)

```yaml
edition: 5
part: 1
section: "17.13.5.15"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:del
verifiedBy: packages/docx-core/src/primitives/accept_changes.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.test.ts
```

ECMA-376 Part 1 §17.13.5.15 defines `w:del` inside `w:pPr/w:rPr` as a tracked
deletion of the *paragraph mark* (the glyph ending the paragraph), not of the
paragraph's contents. Accepting the revision removes the paragraph break, so
the paragraph's remaining content merges into the following paragraph; the
contents themselves are deleted only where they carry their own run-level
`w:del` wrappers. safe-docx's accept paths implement this merge in
`packages/docx-core/src/primitives/accept_changes.ts` and
`packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts`.

## [ECMA-PART1-17-13-5-20] Inserted paragraph mark (w:ins under w:pPr/w:rPr)

```yaml
edition: 5
part: 1
section: "17.13.5.20"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:ins
verifiedBy: packages/docx-core/src/primitives/reject_changes.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.test.ts
```

ECMA-376 Part 1 §17.13.5.20 defines `w:ins` inside `w:pPr/w:rPr` as a tracked
insertion of the *paragraph mark*, not of the paragraph's contents. Rejecting
the revision removes the inserted paragraph break, so the paragraph's
surviving content merges into the following paragraph; the contents disappear
only where they carry their own run-level `w:ins` wrappers. safe-docx's reject
paths implement this merge in
`packages/docx-core/src/primitives/reject_changes.ts` and
`packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts`.

## Non-Goals

Sections explicitly **out of scope** for safe-docx. Each entry below carries the
same spec section and vendored-schema binding as a targeted section, so "we do
not target this" is a first-class, reviewable statement rather than silence.

Beyond the enumerated sections, safe-docx rejects Word template packages
(`.dotx`) and makes no rendering, layout, pagination, or
cross-editor-fidelity guarantees. (From-scratch generation, formerly a
non-goal, ships in `packages/docx-core/src/generation/` under the
`docx-generation` capability.) Those boundaries have no single ECMA-376
section; they are described under
[“What Safe Docx Is Not Optimized For”](/README.md#what-safe-docx-is-not-optimized-for)
in the root README.

Within Part 1 §17.16, safe-docx targets structural emission of complex fields
and the PAGE and NUMPAGES instructions listed above. Other field instructions,
field-code parsing and evaluation, cached-result correctness, pagination, and
equivalence to a Word application's field engine are out of scope.

Within Part 1 §17.11 and §17.13.4, safe-docx targets document-order note
display numbering for Word-conventional packages plus generated
single-paragraph root comments. It does not claim arbitrary numeric note-ID
assignment, complete `w:type` or `w:customMarkFollows` display semantics,
complete note-definition/reference integrity, relationship validation,
arbitrary cross-paragraph comment ranges, threaded-comment semantics,
resolution-state semantics, or repair of malformed third-party comment parts.
The compiled Lean checker independently covers fixed-story text projection and
field-marker structure in `word/footnotes.xml` and `word/endnotes.xml`; it does
not cover any of those excluded reference, relationship, anchor, or thread
semantics and does not read `word/comments.xml`.

Within Part 1 §17.6 and §17.10, safe-docx targets generated section-property
placement, explicit page-setup values, and explicit first/default/even
header/footer bindings. The package audit resolves those bindings through the
main-document relationships and checks the target story root. It does not
implement pagination, section inheritance or omitted-role fallback semantics,
style inheritance, layout, rendering, or assertions about arbitrary consumer
behavior. Comparison preserves ancillary parts according to its documented
in-place/rebuild rules; this registry does not claim semantic comparison of
header or footer content across document versions.

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
