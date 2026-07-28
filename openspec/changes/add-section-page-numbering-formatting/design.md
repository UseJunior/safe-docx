## Context

WordprocessingML stores non-final section properties in the paragraph properties
of the paragraph that terminates the section. The final section properties are a
direct, final child of `w:body`. A restart is represented by the `w:start`
attribute on `w:sectPr/w:pgNumType`; the same element may also carry unrelated
format and chapter-number settings.

The repository already preserves and audits these shapes and accepts/rejects
existing `w:sectPrChange` records. This slice adds the missing read and tracked
write surfaces without expanding into section topology or general page setup.

## Goals / Non-Goals

### Goals

- Enumerate supported main-document section boundaries deterministically.
- Expose enough read metadata for a caller to select the intended section.
- Set one section's page-number restart without replacing its `w:sectPr`.
- Emit a schema-valid, reviewable section-property revision.
- Preserve document structure and all untargeted section settings.

### Non-Goals

- Author section boundaries or auxiliary story content.
- Offer a generic raw-OOXML property editor.
- Infer which section a natural-language reference describes.
- Repair malformed or unsupported section-property placement.

## Decisions

### 1. Use document-order section indexes

`get_sections` returns `section_index` values starting at zero. Direct
`w:p/w:pPr/w:sectPr` boundaries are collected in document order, followed by the
final direct `w:body/w:sectPr`. A paragraph-boundary record includes its stable
`anchor_paragraph_id`; the final body record reports a `null` anchor and
`location: "body"`.

`format_section` targets the same `section_index`. Indexes are intentionally
session-relative selectors, not durable edit anchors: callers should call
`get_sections` again after any operation that changes section topology.

### 2. Read broadly, write narrowly

Each section record projects:

- boundary location and paragraph anchor;
- section-break type;
- page-number start and format;
- page size and orientation;
- page margins;
- header and footer relationship IDs and roles.

Missing properties are returned as `null` or empty arrays. This lets a caller
verify the target and observe preservation. Only `page_number_start` is writable
in this change.

### 3. Accept non-negative decimal restart values

`page_number_start` must be a non-negative safe integer, matching the
`ST_DecimalNumber`-backed `w:start` representation and existing documents that
legitimately use zero. The mutation creates `w:pgNumType` in schema order when
absent and otherwise updates only `w:start`, preserving `w:fmt`, `w:chapStyle`,
and `w:chapSep`.

Removal of an existing restart is deferred. The tool always receives an explicit
integer.

### 4. Snapshot the prior section properties

An effective mutation appends one `w:sectPrChange` containing a cloned prior
`w:sectPr`. Existing nested `w:sectPrChange` children are excluded so a
change-of-a-change is never emitted. Revision ID, author, and date come from the
session revision context.

The mutation uses the repository's normal AI-revision preflight. An identical
requested start is a no-op and consumes no edit accounting or revision ID.

### 5. Validate before live mutation

The tool validates the value and resolves the section index before allocating
revision metadata. It then previews the mutation through the AI revision guard
before applying it to the live session. Failures return structured errors and
leave serialized document XML unchanged.

The implementation verifies that section count, paragraph count, visible text,
and the targeted section's unrelated serialized properties remain stable.

## Risks / Trade-offs

- Section indexes can shift after a future section insertion. Describing them as
  session-relative and pairing them with boundary metadata avoids implying
  durable identity.
- Some third-party DOCX files contain invalid `w:sectPr` placements. The new
  surface enumerates only the two canonical main-document placements and does
  not silently repair malformed topology.
- Word may not visibly refresh page-number fields until pagination occurs. Smoke
  testing therefore checks OOXML, accept/reject projections, and rendered output
  after LibreOffice refresh.

## Migration Plan

This is additive. Existing sessions, tools, and documents require no migration.
The feature can be reverted without changing existing tool contracts or stored
document data.

## Open Questions

None. General page setup and section topology remain explicit follow-up slices.
