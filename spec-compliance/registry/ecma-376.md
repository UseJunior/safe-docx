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

## [ECMA-PART4-14-9-1-1] VML rich text-box content (w:txbxContent)

```yaml
edition: 5
part: 4
section: "14.9.1.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:txbxContent
verifiedBy: packages/docx-compare/src/baselines/atomizer/textBoxRevisionSafety.ts; packages/docx-compare/src/baselines/atomizer/pipeline.ts; packages/docx-compare/src/baselines/atomizer/pipeline-text-box-stories.test.ts
```

Part 4 §14.9.1.1 defines `w:txbxContent` as the rich
WordprocessingML-content container inside a drawing object. It prohibits
references to comments, footnotes, and endnotes, as well as nested
`w:txbxContent`. safe-docx compares a bounded subset of these stories
independently of the surrounding body, preserves the drawing scaffold around
each one, and rejects the prohibited nested forms before comparison.

**Text boxes authored in Microsoft Word are inside that subset.** Word stores
one modern text box twice within a single `mc:AlternateContent` — an `mc:Choice`
holding the DrawingML spelling (`a:graphic`, `wps:txbx`) and an `mc:Fallback`
holding the VML spelling (`v:textbox`) — and renders exactly one of them.
safe-docx groups the two stored copies as the one visual box a reader sees,
numbers diagnostics by that visual ordinal, compares each stored copy as its own
story, and fails closed when the two sides' storage shapes do not correspond.
Accepting every revision in the result reproduces the revised story text and
rejecting every revision reproduces the original, in both stored branches.

The claim covers main-document stories and stories in relationship-selected
header and footer parts. It does not cover a **standalone** DrawingML text box —
a `wps:txbx` with no `mc:AlternateContent` twin, and therefore no VML host
anywhere above it. Such a box has no drawing scaffold this implementation can
fingerprint, so the comparison is refused with `UnsupportedTextBoxRevisionError`,
which aborts the whole comparison rather than emitting a partial redline. The
claim likewise does not cover inserted or deleted text-box topology, nor a
change to the relationship closure of any text-box story — that check runs
ahead of the twin carve-out and applies to twinned and untwinned boxes alike —
nor a change to the containing scaffold of an untwinned box.

## [ECMA-PART4-19-1-2-22] VML text-box host (v:textbox)

```yaml
edition: 5
part: 4
section: "19.1.2.22"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/vml-main.xsd#type:CT_Textbox
verifiedBy: packages/docx-compare/src/baselines/atomizer/textBoxRevisionSafety.ts; packages/docx-compare/src/baselines/atomizer/pipeline.ts; packages/docx-compare/src/baselines/atomizer/pipeline-text-box-stories.test.ts
```

Part 4 §19.1.2.22 defines the Transitional VML `v:textbox` host. Throughout the
accepted comparison subset, safe-docx places tracked changes only in the hosted
WordprocessingML story, never around the drawing object.

The host element is derived from the schema rather than matched by name.
`v:textbox` (`CT_Textbox`) is the only declared parent of `w:txbxContent`, and it
belongs to `EG_ShapeElements`, which `CT_Shape` shares with `CT_Rect`,
`CT_RoundRect`, `CT_Oval` and others. safe-docx therefore treats the VML parent
of the nearest `v:textbox` as the host, and accepts `v:shape`, `v:rect`,
`v:roundrect` and `v:oval` alike.

Where a story's host is untwinned VML, safe-docx fingerprints that scaffold with
the story emptied out and refuses the comparison unless both sides present the
same scaffold. **That requirement is deliberately not enforced for a text box
stored inside `mc:AlternateContent`.** The DrawingML copy of a Word twin has no
VML host of its own, and failing closed on the missing fingerprint would refuse
the commonest text box Word produces. Which branch of a twin governs the scaffold
is the `mc:AlternateContent`-aware story walk's question and is not settled here,
so this claim asserts no stable-scaffold guarantee for a twinned box.

## [ECMA-PART1-17-13-5-14] Deleted run content

```yaml
edition: 5
part: 1
section: "17.13.5.14"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:del
verifiedBy: packages/docx-compare/src/baselines/atomizer/pipeline-text-box-stories.test.ts
```

Part 1 §17.13.5.14 defines `w:del` as deleted inline run content.
safe-docx emits this ordinary run-level revision form inside supported VML
text-box stories and validates that rejecting the assembled comparison
recovers the original story text.

## [ECMA-PART1-17-13-5-18] Inserted run content

```yaml
edition: 5
part: 1
section: "17.13.5.18"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:ins
verifiedBy: packages/docx-compare/src/baselines/atomizer/pipeline-text-box-stories.test.ts
```

Part 1 §17.13.5.18 defines `w:ins` as inserted inline run content.
safe-docx emits this ordinary run-level revision form inside supported VML
text-box stories and validates that accepting the assembled comparison
recovers the revised story text.

## [ECMA-PART1-17-16-13] w:delInstrText containment in tracked deletions

```yaml
edition: 5
part: 1
section: "17.16.13"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:delInstrText
verifiedBy: packages/docx-compare/src/baselines/atomizer/pipeline.ts; packages/docx-compare/src/baselines/atomizer/inPlaceModifier-deletion.ts; packages/docx-compare/src/baselines/atomizer/pipeline.field-validation.test.ts
```

Part 1 §17.16.13 requires every `w:delInstrText` run to sit inside `<w:del>`
and describes it as deleted field code within a complex field. The runtime
enforcement lives in
`packages/docx-compare/src/baselines/atomizer/pipeline.ts` (the
`validateFieldStructure` function). This requirement does not constrain the
placement of sibling `w:fldChar` runs relative to the enclosing deletion.

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

## [ECMA-PART1-17-13-6-1] Bookmark end

```yaml
edition: 5
part: 1
section: "17.13.6.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:bookmarkEnd
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

`w:bookmarkEnd` closes a bookmark range. safe-docx's advanced-record matrix
claims only bounded preservation around accept/reject and comparison, not
bookmark identity or consumer semantics.

## [ECMA-PART1-17-13-6-2] Bookmark start

```yaml
edition: 5
part: 1
section: "17.13.6.2"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:bookmarkStart
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

`w:bookmarkStart` opens a bookmark range. The matrix records sampled
preservation only; range identity and bookmark semantics are separate gaps.

## [ECMA-PART1-17-13-7-1] Permission range end

```yaml
edition: 5
part: 1
section: "17.13.7.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:permEnd
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

`w:permEnd` closes an editing-permission range. Preservation does not imply
permission enforcement or validation of range identity.

## [ECMA-PART1-17-13-7-2] Permission range start

```yaml
edition: 5
part: 1
section: "17.13.7.2"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:permStart
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

`w:permStart` opens an editing-permission range. safe-docx makes no claim that
it enforces the permission represented by this marker.

## [ECMA-PART1-17-13-8-1] Proofing error anchors

```yaml
edition: 5
part: 1
section: "17.13.8.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:proofErr
verifiedBy: packages/docx-compare/src/atomizer.ts
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

This claim is bounded to the runtime and test evidence listed above.

## [ECMA-PART1-17-16-22] w:hyperlink container preservation under tracked changes

```yaml
edition: 5
part: 1
section: "17.16.22"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:hyperlink
verifiedBy: packages/docx-compare/src/atomizer.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor.ts; packages/docx-core/src/primitives/relationships.ts; packages/docx-core/src/primitives/text.ts
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

## [ECMA-PART1-17-5-2-29] w:sdt block-level structured document tag

```yaml
edition: 5
part: 1
section: "17.5.2.29"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_SdtBlock
verifiedBy: packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-block-sdt.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-inline-sdt.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-table-sdt.test.ts
```

A block `w:sdt` surrounds one or more block-level structures and orders its
properties, optional end properties, and content under the CT_SdtBlock model.
safe-docx preserves an unchanged direct `w:body/w:sdt` as one scaffold-owned
boundary during forced rebuild and reconstructs controlled paragraphs for a
block control directly inside `w:tc`. Exact subtree/wrapper preservation is a
bounded metamorphic invariant rather than a requirement imposed by ECMA-376.

## [ECMA-PART1-17-5-2-31] w:sdt inline-level structured document tag

```yaml
edition: 5
part: 1
section: "17.5.2.31"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_SdtRun
verifiedBy: packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-inline-sdt.test.ts
```

An inline `w:sdt` is a run-level structured document tag whose ordered children
are its properties, optional end properties, and content. The issue #582 pilot
preserves an unchanged inline SDT as one opaque semantic boundary during rebuild;
it does not author or edit controls and makes no claim about row or cell SDTs.

## [ECMA-PART1-17-5-2-32] w:sdt cell-level structured document tag

```yaml
edition: 5
part: 1
section: "17.5.2.32"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_SdtCell
verifiedBy: packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-table-sdt.test.ts
```

A cell-level `w:sdt` surrounds one or more `w:tc` elements within a table row
and orders its properties, optional end properties, and content under the
CT_SdtCell model. safe-docx correlates the wrapper at its direct `w:tr` child
position while rebuilding controlled paragraphs inside the cells.

## [ECMA-PART1-17-5-2-33] w:sdtContent cell-level structured document tag content

```yaml
edition: 5
part: 1
section: "17.5.2.33"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_SdtContentCell
verifiedBy: packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-table-sdt.test.ts
```

Cell-level `w:sdtContent` contains controlled table cells. The bounded rebuild
path recognizes one or more direct `w:tc` children and fails closed on wrapper
or cell-scaffold mutation.

## [ECMA-PART1-17-5-2-34] w:sdtContent block-level structured document tag content

```yaml
edition: 5
part: 1
section: "17.5.2.34"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_SdtContentBlock
verifiedBy: packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-block-sdt.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-inline-sdt.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-table-sdt.test.ts
```

Block-level `w:sdtContent` contains the controlled block structures. The bounded
rebuild path recognizes a contiguous sequence of direct controlled paragraphs
under a direct body-level control, or direct paragraph/table children when the
block control is inside `w:tc`; nested controls remain outside the supported
placement.

## [ECMA-PART1-17-5-2-36] w:sdtContent inline-level structured document tag content

```yaml
edition: 5
part: 1
section: "17.5.2.36"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_SdtContentRun
verifiedBy: packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-inline-sdt.test.ts
```

The pilot retains the inline control's run-level `w:sdtContent` subtree and its
controlled text when that subtree is unchanged between comparison inputs.

## [ECMA-PART1-17-5-2-38] w:sdtPr structured document tag properties

```yaml
edition: 5
part: 1
section: "17.5.2.38"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_SdtPr
verifiedBy: packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-inline-sdt.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-block-sdt.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-table-sdt.test.ts
```

The pilot retains known and ignorable-extension children under `w:sdtPr` in
their source order. Retention of unknown extension payload is a metamorphic
SafeDocX invariant, not an ECMA-376 requirement.

## [ECMA-PART1-17-6-17] w:sectPr document-final section properties

```yaml
edition: 5
part: 1
section: "17.6.17"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:sectPr
verifiedBy: packages/docx-compare/src/baselines/atomizer/unrepresentedChanges.ts; packages/docx-core/src/generation/structural-checks.ts; packages/docx-core/src/generation/emit/document-part.ts
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
verifiedBy: packages/docx-core/src/primitives/sections.ts; packages/docx-core/src/generation/emit/section.ts
  - packages/docx-core/src/generation/emit/section.ts
  - packages/docx-core/src/generation/generation-skeleton.test.ts
  - packages/docx-core/src/primitives/sections.ts
  - packages/docx-core/src/primitives/sections_page_setup.test.ts
  - packages/docx-core/src/integration/canonical-emission-regression.test.ts
  - packages/docx-mcp/src/tools/format_section_page_setup.test.ts
  - packages/docx-mcp/src/integration/canonical-emission-mcp.test.ts
```

`w:pgSz` carries the page width/height in twentieths of a point and an
optional orientation. The generation section emitter
(`packages/docx-core/src/generation/emit/section.ts`) emits explicit
`w:w`/`w:h` for every section (defaulting to US Letter) and sets
`w:orient="landscape"` with swapped dimensions when the spec requests
landscape, so readers never fall back to printer-driver defaults.
The section editing primitive updates explicit width, height, and orientation
attributes atomically, preserves untargeted attributes such as paper code, and
requires both dimensions before creating a missing `w:pgSz`.

## [ECMA-PART1-17-6-11] w:pgMar page margin emission

```yaml
edition: 5
part: 1
section: "17.6.11"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pgMar
verifiedBy: packages/docx-core/src/primitives/sections.ts; packages/docx-core/src/generation/emit/section.ts
  - packages/docx-core/src/generation/emit/section.ts
  - packages/docx-core/src/generation/generation-skeleton.test.ts
  - packages/docx-core/src/primitives/sections.ts
  - packages/docx-core/src/primitives/sections_page_setup.test.ts
  - packages/docx-core/src/integration/canonical-emission-regression.test.ts
  - packages/docx-mcp/src/tools/format_section_page_setup.test.ts
  - packages/docx-mcp/src/integration/canonical-emission-mcp.test.ts
```

`w:pgMar` declares the page margins plus header/footer offsets and
gutter for a section, all in twips. The generation section emitter
always emits the full attribute set (top, right, bottom, left, header,
footer, gutter) because readers diverge in their defaults when
attributes are omitted; spec values fill in unspecified members from
the standard one-inch/half-inch defaults.
The section editing primitive permits partial updates of an existing complete
margin record, supports the signed top/bottom domains, and requires all seven
attributes before creating a missing `w:pgMar`.

## [ECMA-PART1-17-3-1-24] w:pBdr paragraph border collection

```yaml
edition: 5
part: 1
section: "17.3.1.24"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pBdr
verifiedBy: packages/docx-core/src/generation/emit/borders.ts; packages/docx-core/src/generation/generation-paragraph-borders.test.ts
```

Declared paragraph borders emit as a `w:pBdr` collection in the
`CT_PBdr` sequence (`top`, `left`, `bottom`, `right`, `between`, `bar`)
with explicit size/space/color per edge, sitting in the schema-defined
`w:pPr` child position (see [ECMA-PART1-17-3-1-26]). The generation
serializer shares one border builder with the table-border collections
so every edge carries the same explicit-attribute discipline.

## [ECMA-PART1-17-3-1-26] w:pPr child-element ordering

```yaml
edition: 5
part: 1
section: "17.3.1.26"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pPr
verifiedBy: packages/docx-core/src/generation/ordering.ts; packages/docx-core/src/generation/emit/properties.ts; packages/docx-core/src/generation/ordering-schema.test.ts; packages/docx-core/src/generation/generation-styles-formatting.test.ts
```

`w:pPr` (CT_PPr) declares its children as an ordered sequence; readers
that validate against the schema reject out-of-order properties. The
generation property-ordering discipline
(`packages/docx-core/src/generation/ordering.ts`) encodes the emitted
subset of that sequence as `PPR_ORDER` and routes every paragraph
property through `appendInOrder`, which throws on any property name
missing from the table so new properties force a conscious ordering
decision.

## [ECMA-PART1-17-3-1-20] w:outlineLvl paragraph outline level

```yaml
edition: 5
part: 1
section: "17.3.1.20"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:outlineLvl
verifiedBy: packages/docx-core/src/primitives/styles.ts; packages/docx-core/test-primitives/heading_provenance.traceability.test.ts
```

`w:outlineLvl` records a paragraph's outline level. Values 0 through 8
correspond to heading levels 1 through 9, while value 9 marks body text.
Document-view formatting resolves the direct paragraph property before the
paragraph style chain and ignores malformed or out-of-range values.

## [ECMA-PART1-17-3-2-28] w:rPr direct-property uniqueness

```yaml
edition: 5
part: 1
section: "17.3.2.28"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:rPr
verifiedBy: packages/docx-core/src/generation/ordering.ts; packages/docx-core/src/generation/emit/properties.ts; packages/docx-core/src/generation/ordering-schema.test.ts; packages/docx-core/src/generation/generation-styles-formatting.test.ts
```

`w:rPr` (CT_RPr) uses a repeatable property choice, not an ordered child
sequence. Part 1 §17.3.2.28 requires each direct formatting property to occur
at most once. The shared run-property builder keys supported children by local
name, preventing duplicate direct properties. Its stable output order is an
implementation choice, not a conformance claim. Tests assert uniqueness,
exact values, namespace-aware live attributes, and load/save preservation.

## [ECMA-PART1-17-7-3] Toggle-property evaluation

```yaml
edition: 5
part: 1
section: "17.7.3"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_RPr
verifiedBy: packages/docx-core/src/primitives/styles.ts; packages/docx-core/src/primitives/styles-toggle.test.ts; scripts/check_docx_formatting_loss.test.mjs
```

Run toggle properties accumulate differently from ordinary properties. An on
declaration in a style hierarchy inverts the previously effective value, an
off declaration leaves that value unchanged, and direct run formatting sets
the absolute result. The effective-formatting resolver evaluates the supported
toggle set independently and retains nearest-declaration resolution for
ordinary properties.

## [ECMA-PART1-17-3-2-26] Run fonts and theme-font references

```yaml
edition: 5
part: 1
section: "17.3.2.26"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_Fonts
verifiedBy: packages/docx-core/src/primitives/styles.ts; packages/docx-core/src/primitives/styles-theme.test.ts; scripts/check_docx_formatting_loss.test.mjs
```

`w:rFonts` may select concrete typefaces directly or through the document
theme's major/minor font scheme. Effective formatting dereferences the supported
ASCII, high-ANSI, East Asian, and complex-script theme attributes and retains
direct attributes as the fallback when the theme part or referenced face is
unavailable.

## [ECMA-PART1-17-3-2-6] Run color and theme transforms

```yaml
edition: 5
part: 1
section: "17.3.2.6"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_Color
verifiedBy: packages/docx-core/src/primitives/styles.ts; packages/docx-core/src/primitives/styles-theme.test.ts; scripts/check_docx_formatting_loss.test.mjs
```

`w:color/@themeColor` selects a color from the document theme. Optional
`themeTint` and `themeShade` byte transforms produce the concrete display color.
Effective formatting resolves the theme value and falls back to `w:val` when
the theme cannot supply it.

## [ECMA-PART1-17-7-4-18] w:styles style-definitions part emission

```yaml
edition: 5
part: 1
section: "17.7.4.18"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:styles
verifiedBy: packages/docx-core/src/generation/emit/styles-part.ts
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
verifiedBy: packages/docx-core/src/generation/schema-enum-domains.ts; packages/docx-core/src/generation/emit/styles-part.ts; packages/docx-core/src/generation/validate-spec.ts
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
verifiedBy: packages/docx-core/src/generation/emit/styles-part.ts
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
verifiedBy: packages/docx-core/src/generation/generation-sections-fields.test.ts; packages/docx-core/src/primitives/sections.ts; packages/docx-core/src/primitives/sections_insert_break.test.ts; packages/docx-mcp/src/tools/insert_section_break.test.ts
```

A non-final section's properties bind through a `w:sectPr` inside the
`w:pPr` of a dedicated break paragraph — the shape Word itself produces on
Insert → Section Break, and the one that sidesteps the trailing-table case
(a table cannot carry section properties). The generation document emitter
appends such a break paragraph after every non-final section's blocks;
`auditSectPr` verifies the pPr-only placement on the way back out. The editing
primitive inserts the same dedicated shape after a stable direct-body paragraph,
preserves the containing `w:sectPr`, and verifies that exactly one ordered live
section is added.

## [ECMA-PART1-17-6-22] w:type section start kind

```yaml
edition: 5
part: 1
section: "17.6.22"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_SectType
verifiedBy: packages/docx-core/src/primitives/sections.ts; packages/docx-core/src/primitives/sections_insert_break.test.ts; packages/docx-mcp/src/tools/insert_section_break.test.ts
```

The inserted paragraph-level section properties carry exactly one `w:type`
whose `w:val` is one of the schema's `nextPage`, `nextColumn`, `continuous`,
`evenPage`, or `oddPage` section marks. Invalid values fail before document
mutation. This claim covers emitted section-start markup, not pagination or
reader layout behavior.

## [ECMA-PART1-17-6-12] w:pgNumType page-numbering settings emission

```yaml
edition: 5
part: 1
section: "17.6.12"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pgNumType
verifiedBy: packages/docx-core/src/generation/generation-sections-fields.test.ts; packages/docx-core/src/primitives/sections.ts; packages/docx-core/src/primitives/sections.test.ts; packages/docx-core/src/integration/canonical-emission-regression.test.ts; packages/docx-mcp/src/tools/format_section.test.ts; packages/docx-mcp/src/integration/canonical-emission-mcp.test.ts
```

`w:pgNumType` declares a section's page-number format and restart value.
Generation emits `w:start`/`w:fmt` only when the spec requests them. The
section-formatting primitive updates only `w:start` and preserves any existing
format or chapter-number attributes. Sections without explicit numbering
inherit continuous decimal numbering.

## [ECMA-PART1-17-10-5] w:headerReference binding

```yaml
edition: 5
part: 1
section: "17.10.5"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:headerReference
verifiedBy: packages/docx-core/src/primitives/sectPrAudit.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.ts; packages/docx-core/src/integration/ancillary-field-safety.test.ts; packages/docx-core/src/integration/nvca-coi-regression.test.ts
```

Each declared header slot (first/default/even) becomes its own part bound
through a typed `w:headerReference` whose `r:id` (written namespace-aware
via `setAttributeNS`) resolves in the document's relationships. References
lead the `w:sectPr` child sequence; the structural validator rejects
dangling or missing ids.

The package audit follows each reference through `document.xml.rels`, checks
the header relationship type, resolves its target part, and requires a
`w:hdr` root. Duplicate roles within one section, duplicate relationship ids,
targets that escape the package root, and fragment-bearing targets are
rejected. Relative and package-absolute targets are normalized before lookup;
URI-fragment semantics are outside this audit's supported OPC target model.
Relationship reuse across sections is accepted. Pagination,
role inheritance when a reference is absent, and reader rendering are not
evaluated. Comparison uses this same audit to select only valid direct
section bindings; target normalization and package containment are additional
SafeDocX safety policies rather than claims made by this clause.

## [ECMA-PART1-17-10-2] w:footerReference binding

```yaml
edition: 5
part: 1
section: "17.10.2"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:footerReference
verifiedBy: packages/docx-core/src/primitives/sectPrAudit.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.ts; packages/docx-core/src/integration/ancillary-field-safety.test.ts; packages/docx-core/src/integration/nvca-coi-regression.test.ts
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
verifiedBy: packages/docx-core/src/generation/emit/section.ts
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
verifiedBy: packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.ts; packages/docx-core/src/integration/ancillary-field-safety.test.ts; packages/docx-core/src/integration/nvca-coi-regression.test.ts
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
verifiedBy: packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.ts; packages/docx-core/src/integration/ancillary-field-safety.test.ts; packages/docx-core/src/integration/nvca-coi-regression.test.ts
```

Footer parts mirror header parts as `w:ftr` documents (word/footerN.xml);
"Page X of Y" footers carry complete five-part PAGE/NUMPAGES fields with
cached results.

## [ECMA-PART1-11-3-3] Document Settings part

```yaml
edition: 5
part: 1
section: "11.3.3"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:settings
verifiedBy: packages/docx-core/src/generation/emit/settings-part.ts; packages/docx-core/src/generation/generation-baseline-settings.test.ts; packages/docx-core/src/integration/cross-implementation-suite.test.ts
```

Generated packages carry one Document Settings part, registered through the
main document relationship and package content types. The part contains the
baseline compatibility structure plus conditional even/odd-header and color
scheme settings. This entry covers part presence and package wiring, not the
Microsoft-specific meaning of compatibility mode value 15.

## [ECMA-PART1-17-15-3-4] w:compatSetting custom compatibility setting

```yaml
edition: 5
part: 1
section: "17.15.3.4"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:compatSetting
verifiedBy: packages/docx-core/src/generation/emit/settings-part.ts; packages/docx-core/src/generation/generation-baseline-settings.test.ts; packages/docx-core/src/integration/cross-implementation-suite.test.ts
```

Generation emits one custom compatibility setting under `w:compat`, carrying
the required name, URI, and value attributes in the settings sequence. ECMA-376
defines this extensibility structure; MS-DOCX §2.3.5, not ECMA-376, defines
the Microsoft `compatibilityMode` values and assigns the semantics of value 15.

## [ECMA-PART1-17-10-1] w:evenAndOddHeaders setting

```yaml
edition: 5
part: 1
section: "17.10.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:evenAndOddHeaders
verifiedBy: packages/docx-core/src/generation/emit/settings-part.ts
```

Even-page headers/footers are only honored when `w:evenAndOddHeaders` is
set in word/settings.xml. Generation always emits the baseline settings part
and conditionally adds this switch exactly when some section declares an
`even` slot, so the declared content and document-level switch cannot drift.

## [ECMA-PART1-17-16-18] w:fldChar five-part complex-field emission

```yaml
edition: 5
part: 1
section: "17.16.18"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:fldChar
verifiedBy: packages/docx-core/src/generation/emit/run.ts; packages/docx-core/src/generation/structural-checks.ts; packages/docx-core/src/shared/field-structure.ts; packages/docx-core/src/primitives/field_evaluation.ts; packages/docx-core/test-primitives/field_evaluation.test.ts; packages/docx-compare/src/baselines/atomizer/inPlaceModifier-deletion.ts; packages/docx-compare/src/baselines/atomizer/pipeline.field-validation.test.ts; packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-complex-fields.test.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts; packages/docx-core/src/integration/ancillary-field-safety.test.ts; packages/docx-core/src/integration/nvca-coi-regression.test.ts
```

This claim is bounded to the runtime and test evidence listed above.
In particular, §17.16.18 does not prohibit `w:fldChar` below `<w:del>`: the
Transitional schema permits that ancestry, and Word 16.112 and Aspose.Words
25.10 were measured on 2026-08-14 emitting deleted complex fields that way.
The former issue-#217 placement rule was therefore retracted.

## [ECMA-PART1-17-16-5-44] PAGE field instruction emission

```yaml
edition: 5
part: 1
section: "17.16.5.44"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:instrText
verifiedBy: packages/docx-core/src/generation/emit/run.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts; packages/docx-core/src/primitives/field_evaluation.ts; packages/docx-core/test-primitives/field_evaluation.test.ts; packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-complex-fields.test.ts; packages/docx-core/src/integration/ancillary-field-safety.test.ts; packages/docx-core/src/integration/nvca-coi-regression.test.ts
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
verifiedBy: packages/docx-core/src/generation/emit/run.ts; packages/docx-core/src/generation/generation-sections-fields.test.ts; packages/docx-core/src/primitives/field_evaluation.ts; packages/docx-core/test-primitives/field_evaluation.test.ts; packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-complex-fields.test.ts; packages/docx-core/src/integration/ancillary-field-safety.test.ts
```

The NUMPAGES instruction follows the same emission discipline as PAGE
(` NUMPAGES `, preserved spacing, cached result required), giving
"Page X of Y" footers structurally correct field pairs.

## [ECMA-PART1-17-16-5-45] PAGEREF field instruction classification and preservation

```yaml
edition: 5
part: 1
section: "17.16.5.45"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:instrText
verifiedBy: packages/docx-core/src/shared/field-semantics.ts; packages/docx-core/src/shared/field-semantics.test.ts; packages/docx-core/src/primitives/field_evaluation.ts; packages/docx-core/test-primitives/field_evaluation.test.ts; packages/docx-compare/src/fieldComparisonSemantics.ts; packages/docx-compare/src/fieldComparisonSemantics.test.ts; packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-complex-fields.test.ts; packages/docx-core/src/integration/ancillary-field-safety.test.ts
```

Forced main-document rebuild classifies a self-contained PAGEREF instruction
with one bookmark argument and a bounded switch vocabulary. When the complete
field range is unchanged, comparison preserves its ordered XML topology as a
SafeDocX metamorphic invariant. Safe Docx does not paginate PAGEREF. The
opt-in refresh primitive can mark its begin marker dirty for a layout-capable
host, and TOC comparison uses the same instruction classifier to distinguish
its volatile cached result. The unchanged-rebuild invariant does not claim
pagination, cached-result correctness, or complete field-engine equivalence.

## [ECMA-PART1-17-16-5-51] REF field instruction classification and preservation

```yaml
edition: 5
part: 1
section: "17.16.5.51"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:instrText
verifiedBy: packages/docx-core/src/shared/field-semantics.ts; packages/docx-core/src/shared/field-semantics.test.ts; packages/docx-core/src/primitives/field_evaluation.ts; packages/docx-core/test-primitives/field_evaluation.test.ts; packages/docx-compare/src/fieldComparisonSemantics.ts; packages/docx-compare/src/fieldComparisonSemantics.test.ts; packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.ts; packages/docx-compare/src/baselines/atomizer/ancillaryFieldSafety.test.ts; packages/docx-compare/src/baselines/atomizer/documentReconstructor-complex-fields.test.ts; packages/docx-core/src/integration/ancillary-field-safety.test.ts; packages/docx-core/src/integration/nvca-coi-regression.test.ts
```

Forced main-document rebuild classifies a self-contained REF instruction with
one bookmark argument and a bounded switch vocabulary; the `\d` switch requires
and consumes one separator argument. When the complete field range is unchanged,
comparison preserves its ordered XML topology as a SafeDocX metamorphic
invariant. The scoped refresh primitive resolves a unique, ID-paired bookmark
and refreshes the cached result only for the admitted bookmarked-text
projection; numbering, position, separator, and unknown projections remain
unsupported. Because Word writes a REF result structurally, the primitive also
declines any projection carrying a tab, a break, or a paragraph transition
rather than flattening it into literal characters. That separately tested
capability does not broaden unchanged rebuild preservation into complete
field-engine equivalence.

## [ECMA-PART1-17-4-37] w:tbl table emission

```yaml
edition: 5
part: 1
section: "17.4.37"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tbl
verifiedBy: packages/docx-core/src/generation/emit/table.ts; packages/docx-core/src/generation/validate-spec.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/schema-enum-domains.ts; packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts; packages/docx-core/src/generation/validate-spec.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/ordering.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/structural-checks.ts; packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/primitives/layout.ts; packages/docx-core/src/generation/emit/table.ts
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
verifiedBy: packages/docx-core/src/generation/emit/borders.ts
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
verifiedBy: packages/docx-core/src/generation/emit/numbering-part.ts
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
verifiedBy: packages/docx-core/src/generation/emit/numbering-part.ts
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
verifiedBy: packages/docx-core/src/generation/emit/numbering-part.ts
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
verifiedBy: packages/docx-core/src/generation/emit/numbering-part.ts
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
verifiedBy: packages/docx-core/src/primitives/paragraph_numbering.ts; packages/docx-core/src/primitives/paragraph_numbering.test.ts
```

List paragraphs reference their instance via `w:numId` inside `w:numPr`.
Generation and paragraph mutation validate that the instance exists before
emitting or changing document XML.

## [ECMA-PART1-17-9-3] w:ilvl numbering level reference

```yaml
edition: 5
part: 1
section: "17.9.3"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:ilvl
verifiedBy: packages/docx-core/src/primitives/paragraph_numbering.ts; packages/docx-core/src/primitives/paragraph_numbering.test.ts
```

The paragraph's level reference is emitted before `w:numId` per the
CT_NumPr sequence. Generation and paragraph mutation require the referenced
level to exist in the bound definition.

## [ECMA-PART1-17-9-6] w:lvl numbering level definition

```yaml
edition: 5
part: 1
section: "17.9.6"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:lvl
verifiedBy: packages/docx-core/src/primitives/numbering.ts; packages/docx-core/src/generation/emit/numbering-part.ts
```

Level definitions follow the CT_Lvl child sequence (start, numFmt, suff,
lvlText, lvlJc, pPr, rPr); level indents emit through `w:pPr`/`w:ind` and
level run properties reuse the shared rPr builder.

## [ECMA-PART1-17-9-22] w:pStyle numbering-level paragraph style

```yaml
edition: 5
part: 1
section: "17.9.22"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pStyle
verifiedBy: packages/docx-core/src/primitives/numbering.ts; packages/docx-core/test-primitives/heading_provenance.traceability.test.ts
```

An optional `w:pStyle` on `w:lvl` associates that exact numbering level with
a paragraph style. The numbering model retains the association and exposes a
read-only active-level lookup so heading classification never consults an
unrelated level or mutates list counters.

## [ECMA-PART1-17-9-17] w:numFmt numbering format

```yaml
edition: 5
part: 1
section: "17.9.17"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:numFmt
verifiedBy: packages/docx-core/src/generation/schema-enum-domains.ts; packages/docx-core/src/generation/emit/numbering-part.ts; packages/docx-core/src/generation/validate-spec.ts
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
verifiedBy: packages/docx-core/src/generation/emit/numbering-part.ts
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
verifiedBy: packages/docx-core/src/generation/emit/numbering-part.ts
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
verifiedBy: packages/docx-core/src/generation/emit/numbering-part.ts; packages/docx-core/src/generation/validate-spec.ts
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
verifiedBy: packages/docx-core/src/generation/emit/numbering-part.ts
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
verifiedBy: packages/docx-core/src/generation/emit/numbering-part.ts
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
verifiedBy: packages/docx-core/src/primitives/paragraph_numbering.ts; packages/docx-core/src/primitives/paragraph_numbering.test.ts
```

List paragraphs carry `w:numPr` (ilvl then numId) at its CT_PPrBase slot.
Generation binds deterministic handles; paragraph mutation can remove or
re-point a direct reference while preserving the numbering definitions.

## [ECMA-PART1-17-13-4-6] w:comments comment-collection part emission

```yaml
edition: 5
part: 1
section: "17.13.4.6"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:comments
verifiedBy: packages/docx-core/src/generation/emit/comments-part.ts; packages/docx-core/src/generation/generation-drafting-notes.test.ts
```

This claim is bounded to the runtime and test evidence listed above.

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
The compiled checker additionally validates bounded canonical IDs and requires
definitions to be direct `w:comments` children. Extension thread graphs remain
outside scope.

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
The compiled checker recognizes the schema-bound decimal `w:id` on this
`CT_MarkupRange` element in every retained physical story. It accepts
cross-paragraph and crossing ranges. Safe-DOCX additionally rejects an orphan
start under its stronger paired-or-point verification profile; ECMA-376 does
not require that pairing.

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
The compiled checker recognizes the schema-bound decimal `w:id` on this
`CT_MarkupRange` element in every retained physical story. Safe-DOCX
additionally rejects an orphan end under its stronger paired-or-point
verification profile; ECMA-376 does not require that pairing.

## [ECMA-PART1-17-13-4-5] w:commentReference comment reference mark

```yaml
edition: 5
part: 1
section: "17.13.4.5"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:commentReference
verifiedBy: packages/docx-core/src/generation/emit/paragraph.ts; packages/docx-core/src/generation/generation-drafting-notes.test.ts
```

This claim is bounded to the runtime and test evidence listed above.

## [ECMA-PART1-17-13-5-15] Deleted paragraph mark (w:del under w:pPr/w:rPr)

```yaml
edition: 5
part: 1
section: "17.13.5.15"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:del
verifiedBy: packages/docx-core/src/primitives/accept_changes.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.test.ts; packages/docx-release-verifier/src/xml.ts; packages/docx-release-verifier/src/paragraph-mark-projection.test.ts
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
verifiedBy: packages/docx-core/src/primitives/sections.ts; packages/docx-core/src/primitives/sections_insert_break.test.ts; packages/docx-core/src/primitives/reject_changes.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.test.ts; packages/docx-mcp/src/tools/insert_section_break.test.ts; packages/docx-release-verifier/src/xml.ts; packages/docx-release-verifier/src/paragraph-mark-projection.test.ts
```

ECMA-376 Part 1 §17.13.5.20 defines `w:ins` inside `w:pPr/w:rPr` as a tracked
insertion of the *paragraph mark*, not of the paragraph's contents. Rejecting
the revision removes the inserted paragraph break, so the paragraph's
surviving content merges into the following paragraph; the contents disappear
only where they carry their own run-level `w:ins` wrappers. safe-docx's reject
paths implement this merge in
`packages/docx-core/src/primitives/reject_changes.ts` and
`packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts`.
Section-break insertion uses the same paragraph-mark form on a dedicated empty
boundary paragraph so rejecting removes the new topology and accepting retains
the boundary.

## [ECMA-PART1-17-13-5-4] Custom XML deletion range end

```yaml
edition: 5
part: 1
section: "17.13.5.4"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:customXmlDelRangeEnd
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

`w:customXmlDelRangeEnd` is retained by ordinary accept/reject and sampled
in-place reconstruction. Rebuild retention and custom-XML semantics are gaps.

## [ECMA-PART1-17-13-5-5] Custom XML deletion range start

```yaml
edition: 5
part: 1
section: "17.13.5.5"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:customXmlDelRangeStart
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

`w:customXmlDelRangeStart` has the same preservation-only boundary as its end
marker; balanced IDs are validated without interpreting deletion semantics.

## [ECMA-PART1-17-13-5-6] Custom XML insertion range end

```yaml
edition: 5
part: 1
section: "17.13.5.6"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:customXmlInsRangeEnd
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

This entry records bounded preservation and pairing validation for
`w:customXmlInsRangeEnd`, not custom-XML revision semantics.

## [ECMA-PART1-17-13-5-7] Custom XML insertion range start

```yaml
edition: 5
part: 1
section: "17.13.5.7"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:customXmlInsRangeStart
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

This entry records bounded preservation and pairing validation for
`w:customXmlInsRangeStart`, not custom-XML revision semantics.

## [ECMA-PART1-17-13-5-8] Custom XML move-source range end

```yaml
edition: 5
part: 1
section: "17.13.5.8"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:customXmlMoveFromRangeEnd
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

safe-docx validates balanced IDs and preserves the sampled marker outside
rebuild mode; it does not interpret custom-XML move identity.

## [ECMA-PART1-17-13-5-9] Custom XML move-source range start

```yaml
edition: 5
part: 1
section: "17.13.5.9"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:customXmlMoveFromRangeStart
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

This start marker has the same bounded validation and preservation posture as
its §17.13.5.8 end marker.

## [ECMA-PART1-17-13-5-10] Custom XML move-destination range end

```yaml
edition: 5
part: 1
section: "17.13.5.10"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:customXmlMoveToRangeEnd
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

safe-docx validates balanced IDs and preserves the sampled marker outside
rebuild mode; it does not interpret custom-XML move identity.

## [ECMA-PART1-17-13-5-11] Custom XML move-destination range start

```yaml
edition: 5
part: 1
section: "17.13.5.11"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:customXmlMoveToRangeStart
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

This start marker has the same bounded validation and preservation posture as
its §17.13.5.10 end marker.

## [ECMA-PART1-17-13-5-21] Move source paragraph (w:moveFrom)

```yaml
edition: 5
part: 1
section: "17.13.5.21"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:moveFrom
verifiedBy: packages/docx-core/src/primitives/accept_changes.ts; packages/docx-core/src/primitives/reject_changes.ts; packages/docx-core/src/integration/advanced-revision-classification.test.ts; packages/docx-release-verifier/src/xml.ts; packages/docx-release-verifier/src/paragraph-mark-projection.test.ts
```

This claim is bounded to the runtime and test evidence listed above.

## [ECMA-PART1-17-13-5-22] Move source run content (w:moveFrom)

```yaml
edition: 5
part: 1
section: "17.13.5.22"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:moveFrom
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

Run-level move-source content is emitted and resolved in the bounded comparison
surface. Pair identity and arbitrary nested move semantics are not claimed.

## [ECMA-PART1-17-13-5-23] Move source range end

```yaml
edition: 5
part: 1
section: "17.13.5.23"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:moveFromRangeEnd
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts; packages/docx-compare/src/baselines/atomizer/inplace-move-range-coalesce.test.ts
```

The engine coalesces generated source markers to one pair per logical move.
The compiled fixed-story checker requires each end to close the currently open
source range with the same unique id. Individual `w:moveFrom` revision ids are
not associated with range ids.

## [ECMA-PART1-17-13-5-24] Move source range start

```yaml
edition: 5
part: 1
section: "17.13.5.24"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:moveFromRangeStart
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts; packages/docx-compare/src/baselines/atomizer/inplace-move-range-coalesce.test.ts
```

The engine emits one source start per logical move. In both the Strict and
Transitional schemas, `w:id` is an `ST_DecimalNumber` and the required `w:name`
is an `ST_String`, which permits the empty string. The compiled fixed-story
checker applies a stronger SafeDocX verifier policy: names must be non-empty,
source ids and names must be unique, and a destination identity with the same
name must exist. Non-empty `w:name` is not attributed to ECMA-376.

## [ECMA-PART1-17-13-5-25] Move destination run content (w:moveTo)

```yaml
edition: 5
part: 1
section: "17.13.5.25"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:moveTo
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

Run-level move-destination content is emitted and resolved in the bounded
comparison surface. Complete pair semantics are not claimed.

## [ECMA-PART1-17-13-5-26] Move destination paragraph (w:moveTo)

```yaml
edition: 5
part: 1
section: "17.13.5.26"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:moveTo
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts; packages/docx-release-verifier/src/xml.ts; packages/docx-release-verifier/src/paragraph-mark-projection.test.ts
```

Paragraph-level move-destination content has the same bounded support and
pairing caveat as run-level content.

## [ECMA-PART1-17-13-5-27] Move destination range end

```yaml
edition: 5
part: 1
section: "17.13.5.27"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:moveToRangeEnd
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts; packages/docx-compare/src/baselines/atomizer/inplace-move-range-coalesce.test.ts
```

The engine coalesces generated destination markers to one pair per logical move.
The compiled fixed-story checker requires each end to close the currently open
destination range with the same unique id. Individual `w:moveTo` revision ids
are not associated with range ids.

## [ECMA-PART1-17-13-5-28] Move destination range start

```yaml
edition: 5
part: 1
section: "17.13.5.28"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:moveToRangeStart
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts; packages/docx-compare/src/baselines/atomizer/inplace-move-range-coalesce.test.ts
```

The engine emits one destination start per logical move. In both the Strict and
Transitional schemas, `w:id` is an `ST_DecimalNumber` and the required `w:name`
is an `ST_String`, which permits the empty string. The compiled fixed-story
checker applies a stronger SafeDocX verifier policy: names must be non-empty,
destination ids and names must be unique, and a source identity with the same
name must exist. Non-empty `w:name` is not attributed to ECMA-376.

## [ECMA-PART1-17-13-5-29] Paragraph-property revisions (w:pPrChange)

```yaml
edition: 5
part: 1
section: "17.13.5.29"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:pPrChange
verifiedBy: packages/docx-core/src/primitives/accept_changes.ts; packages/docx-core/src/primitives/reject_changes.ts; packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

safe-docx emits bounded `w:pPrChange` snapshots for supported paragraph-layout
mutations and consumes existing records through accept/reject. This does not
claim complete paragraph formatting or computed style semantics.

## [ECMA-PART1-17-13-5-30] Paragraph-mark run-property revisions (w:rPrChange)

```yaml
edition: 5
part: 1
section: "17.13.5.30"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:rPrChange
verifiedBy: packages/docx-core/src/primitives/track-changes-emitter.ts; packages/docx-core/src/primitives/accept_changes.ts; packages/docx-core/src/primitives/reject_changes.ts; packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

This claim is bounded to the runtime and test evidence listed above.

## [ECMA-PART1-17-13-5-31] Run-property revisions (w:rPrChange)

```yaml
edition: 5
part: 1
section: "17.13.5.31"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:rPrChange
verifiedBy: packages/docx-core/src/primitives/track-changes-emitter.ts; packages/docx-core/src/primitives/accept_changes.ts; packages/docx-core/src/primitives/reject_changes.ts; packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

safe-docx emits bounded run-formatting snapshots and consumes existing
`w:rPrChange` records. It does not claim complete run-property semantics.

## [ECMA-PART1-17-13-5-32] Section-property revisions (w:sectPrChange)

```yaml
edition: 5
part: 1
section: "17.13.5.32"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:sectPrChange
verifiedBy: packages/docx-core/src/primitives/track-changes-emitter.ts; packages/docx-core/src/primitives/sections.ts; packages/docx-core/src/primitives/accept_changes.ts; packages/docx-core/src/primitives/reject_changes.ts; packages/docx-core/src/primitives/sections.test.ts; packages/docx-core/src/primitives/sections_insert_break.test.ts; packages/docx-core/src/integration/advanced-revision-classification.test.ts; packages/docx-core/src/integration/canonical-emission-regression.test.ts; packages/docx-mcp/src/integration/canonical-emission-mcp.test.ts; packages/docx-mcp/src/tools/insert_section_break.test.ts
```

This claim is bounded to the runtime and test evidence listed above.

## [ECMA-PART1-17-13-5-34] Table-property revisions (w:tblPrChange)

```yaml
edition: 5
part: 1
section: "17.13.5.34"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblPrChange
verifiedBy: packages/docx-core/src/primitives/accept_changes.ts; packages/docx-core/src/primitives/reject_changes.ts; packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

This claim is bounded to the runtime and test evidence listed above.

## [ECMA-PART1-17-13-5-36] Table-cell-property revisions (w:tcPrChange)

```yaml
edition: 5
part: 1
section: "17.13.5.36"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tcPrChange
verifiedBy: packages/docx-core/src/primitives/track-changes-emitter.ts; packages/docx-core/src/primitives/accept_changes.ts; packages/docx-core/src/primitives/reject_changes.ts; packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

This claim is bounded to the runtime and test evidence listed above.

## [ECMA-PART1-17-13-5-37] Table-row-property revisions (w:trPrChange)

```yaml
edition: 5
part: 1
section: "17.13.5.37"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:trPrChange
verifiedBy: packages/docx-core/src/primitives/track-changes-emitter.ts; packages/docx-core/src/primitives/accept_changes.ts; packages/docx-core/src/primitives/reject_changes.ts; packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

This claim is bounded to the runtime and test evidence listed above.

## [ECMA-PART1-17-3-3-30] Symbol character run content (w:sym)

```yaml
edition: 5
part: 1
section: "17.3.3.30"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_Sym
verifiedBy: packages/docx-core/src/primitives/symbol_run_content.ts; packages/docx-compare/src/fieldComparisonSemantics.ts; packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts; packages/docx-core/src/primitives/symbol_run_content.test.ts; packages/docx-compare/src/symbolCharacterProjection.test.ts
```

Part 1 §17.3.3.30 defines `w:sym` as run content that specifies a single
character by font (`@w:font`) and codepoint (`@w:char`), rather than by
character data. safe-docx's comparison text projections resolve `@w:char` to
that codepoint, so a symbol glyph contributes the same characters whether it is
spelled as `w:sym` or written literally inside `w:t` under a symbol font, and a
document that lost a symbol no longer projects identically to one that kept it.
`@w:font` is deliberately excluded from the projected value: these are text
projections, which exclude `w:rFonts` as well, and including it would make the
two legal spellings of one glyph unequal by construction. A change confined to
`@w:font` is therefore outside this claim, as are rendering, font substitution,
and any mapping between a symbol font's private-use codepoints and Unicode
characters with the same appearance.

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

This claim is bounded to the runtime and test evidence listed above.

This claim is bounded to the runtime and test evidence listed above.

This claim is bounded to the runtime and test evidence listed above.

Within Part 1 §17.3, safe-docx targets the direct-formatting properties exposed
by `ParagraphSpec` and `RunProps`: paragraph style references, keep controls,
page breaks, tabs, spacing, indentation, alignment, fonts, bold/italic/caps,
color, size, highlight, and underline. The shared builders emit that bounded
subset in `CT_PPr` sequence order and emits each supported `CT_RPr` direct
property at most once. Runtime validation rejects values outside the exposed
enum and numeric domains before emission, and ordinary load/save preserves the
authored XML. This does not claim
support for every §17.3 property, Word rendering or layout, theme/font
resolution, style inheritance or cascade, computed formatting equivalence, or
semantic comparison of formatting across document versions. Property revision
records are limited to the separately enumerated §17.13.5 behavior; wrappers do
not broaden this §17.3 claim.

A source `@conformance` JSDoc tag that points at one of these Non-Goal IDs fails
the citation lint. For a deliberate divergence *inside a targeted section*, use
`@conformance-gap` with a reason instead.

## [ECMA-PART1-17-13-5-1] Table cell deletion (w:cellDel)

```yaml
edition: 5
part: 1
section: "17.13.5.1"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:cellDel
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

safe-docx validates placement and preserves sampled `w:cellDel` records, but
does not apply table-topology deletion semantics.

## [ECMA-PART1-17-13-5-2] Table cell insertion (w:cellIns)

```yaml
edition: 5
part: 1
section: "17.13.5.2"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:cellIns
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

safe-docx validates placement and preserves sampled `w:cellIns` records, but
does not apply table-topology insertion semantics.

## [ECMA-PART1-17-13-5-3] Vertically merged or split table cells (w:cellMerge)

```yaml
edition: 5
part: 1
section: "17.13.5.3"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:cellMerge
verifiedBy: packages/docx-core/src/integration/advanced-revision-classification.test.ts
```

safe-docx validates placement and preserves sampled `w:cellMerge` records,
but does not interpret vertical merge/split topology.

## [ECMA-PART1-17-13-5-33] Table-grid revisions (w:tblGridChange)

```yaml
edition: 5
part: 1
section: "17.13.5.33"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblGridChange
verifiedBy:
```

safe-docx recognizes `w:tblGridChange` metadata and placement but does not emit,
accept, or reject its grid semantics.

## [ECMA-PART1-17-13-5-35] Table-property-exception revisions (w:tblPrExChange)

```yaml
edition: 5
part: 1
section: "17.13.5.35"
url: https://ecma-international.org/publications-and-standards/standards/ecma-376/
schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:tblPrExChange
verifiedBy:
```

safe-docx recognizes `w:tblPrExChange` metadata but does not emit, accept, or
reject table-level property-exception semantics.

Across the targeted Part 1 §17.4, §17.7, and §17.9 generation subset,
safe-docx validates its documented API-supported enum and safe-integer subset,
duplicate declarations, table-grid arithmetic, and style/numbering references
before emission, then preserves the authored parts through package load/save.
The XML Schema integer domains can exceed JavaScript's exact-number range;
numeric claims therefore stop at `Number.MIN_SAFE_INTEGER` and
`Number.MAX_SAFE_INTEGER`. For every table, numbering, and style enum validated
by this surface, the full lexical domain is pinned to the vendored transitional
XSD. Schema-valid values outside the API subset, such as `ST_Border=thick`,
`ST_VerticalJc=both`, `ST_NumberFormat=ordinal`, wave underlining, `auto` run
color, and table/numbering style types, are reported as unsupported API
features rather than schema-invalid XML. Values absent from the applicable XSD
domain are reported as invalid. These
claims do not cover Word's
table layout algorithm or pagination, numbering rendering or complete
override/counter behavior, style cascade or latent-style semantics,
theme/font resolution, rendering, or tracked table-topology and
property-revision records. Preservation does not imply semantic
interpretation of unknown third-party markup.
