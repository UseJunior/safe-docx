## Context

In WordprocessingML, a non-final section ends at `w:p/w:pPr/w:sectPr`; the
terminal section uses `w:body/w:sectPr`. The properties on a paragraph boundary
describe the section that ends there, while the next live `w:sectPr` describes
the following section.

## Goals / Non-Goals

- Goals:
  - Insert one schema-valid section boundary after a stable paragraph anchor.
  - Preserve existing content, layout properties, and relationship bindings.
  - Make topology insertion and following-section overrides accept/reject cleanly.
  - Keep the mutation atomic when validation fails.
- Non-Goals:
  - Creating, editing, or detaching header/footer parts.
  - Splitting inside tables or non-body stories.
  - Moving existing content or synthesizing a visible paragraph.

## Decisions

- **Use a dedicated empty break paragraph.** The inserted paragraph receives a
  clone of the containing section's live `w:sectPr`. This matches the repository's
  generation convention and avoids mutating the caller's anchor paragraph.
- **Track the paragraph mark as inserted.** A `w:ins` marker under
  `w:pPr/w:rPr` makes reject remove the new boundary paragraph and accept retain
  it. `w:pPrChange` cannot represent this because its prior-property snapshot
  excludes `w:sectPr`.
- **Keep relationship references live.** Even when callers request a reset of
  inherited non-relationship properties, direct `w:headerReference` and
  `w:footerReference` children remain on the following section. Their parts and
  relationship graph are owned by the companion header/footer capability.
- **Apply following-section overrides atomically.** The desired following
  `w:sectPr` is prepared off-tree and validated before document mutation. When
  it differs, the live boundary receives one prior-state `w:sectPrChange`.
- **Restrict anchors to direct body paragraphs.** Section properties on nested
  table/story paragraphs are outside the canonical main-document section model.

## Risks / Trade-offs

- A reset without explicit page setup leaves Word defaults for omitted
  non-relationship properties. This is intentional and exposed explicitly.
- The inserted empty paragraph becomes a stable section boundary in clean and
  accepted documents; consumers should target returned section indexes rather
  than infer topology from visible text.

## Migration Plan

This is additive. Existing `get_sections` and `format_section` contracts remain
unchanged.

