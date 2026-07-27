## Context

Paragraph numbering in WordprocessingML is a paragraph property: direct list
membership is represented by `w:pPr/w:numPr`, containing `w:ilvl` followed by
`w:numId`. Safe DOCX already parses this state for `read_file` and loads
`word/numbering.xml`, but its mutation surface only changes text, spacing, table
geometry, and run formatting.

The implementation must preserve Safe DOCX's session-first behavior, stable
bookmark anchors, tracked-change policy, and ECMA-376 subset. It must also avoid
silently manufacturing or repairing numbering definitions.

## Goals / Non-Goals

### Goals

- Mutate one main-document paragraph's direct numbering deterministically.
- Cover the two common repairs: remove an unwanted direct number and join an
  existing list sequence.
- Make the common "match this paragraph" request independent of raw numeric IDs.
- Emit a reviewable paragraph-property revision and preserve unrelated OOXML.
- Reject dangling references before the document DOM is changed.

### Non-Goals

- Author or alter `word/numbering.xml`.
- Override numbering inherited only from styles.
- Infer semantic list membership or list continuation.
- Extend the tool to non-DOCX providers or auxiliary story parts.

## Decisions

### 1. Add a dedicated `format_numbering` tool

Numbering is structural formatting rather than text replacement or layout
geometry. A dedicated tool keeps its mutually exclusive operations and
numbering-specific validation visible in the schema.

The request targets one `target_paragraph_id` and supplies exactly one of:

- `remove: true`
- `match_paragraph_id: "_bk_..."`
- `num_id: "<existing decimal id>"` together with `ilvl: <existing level>`

The raw-reference form is retained for deterministic automation. The match form
is preferred for agents because it copies the source paragraph's explicit
`w:numPr` without requiring the caller to reason about package-local IDs.

### 2. Only direct paragraph numbering is in scope

`remove: true` removes a direct `w:numPr` from the target paragraph. It does not
change paragraph styles or numbering inherited through styles. If the target has
no direct `w:numPr`, the operation returns a successful no-op with a warning so
callers are not misled about inherited numbering.

The match form requires the source paragraph to have a complete direct
`w:numPr`. Pointing at an unnumbered or style-only source is rejected with a
structured error.

### 3. Existing numbering definitions are authoritative

Before either set operation, the tool validates that:

- `word/numbering.xml` is present;
- the requested `w:numId` resolves to an existing numbering instance;
- the instance resolves to an abstract numbering definition; and
- the requested `w:ilvl` exists on that definition.

The direct form accepts a positive decimal `num_id`; `0` is not overloaded as a
removal request. No numbering-part mutation is permitted.

### 4. Mutation is transactional and tracked

All validation and anchor resolution happen before mutation. The core primitive
changes only `w:pPr/w:numPr`, emits a `w:pPrChange` containing the prior paragraph
properties, and uses the session's revision author, date, and ID allocator.

The primitive uses schema-order insertion (`w:ilvl` before `w:numId`, and
`w:numPr` in its `CT_PPrBase` slot), preserves unrelated `w:pPr` children, and
keeps at most one direct `w:pPrChange` according to the existing tracked property
mutation policy. The standard AI-revision preflight guard remains mandatory.

An identical requested direct state is a no-op: it does not increment the edit
revision or append another property-change record.

### 5. Response reports both requested and resulting state

The response includes the target paragraph ID, previous direct numbering,
resulting direct numbering, whether a mutation occurred, and source paragraph ID
when match mode is used. It also includes standard session-resolution metadata.

## Risks / Trade-offs

- A caller may expect removing direct numbering to suppress style-inherited
  numbering. The tool reports a no-op warning when no direct `w:numPr` exists and
  documentation states this boundary explicitly.
- Copying a list reference joins the same numbering instance but does not promise
  a particular rendered label without the surrounding list context. Tests verify
  both the emitted reference and the label produced by the existing reader.
- Word's property-change model snapshots the previous paragraph properties rather
  than wrapping `w:numPr` alone. Reusing the established `w:pPrChange` emitter
  minimizes revision-shape drift.
- Restricting v1 to existing definitions means callers still cannot create a new
  list. This keeps the change focused and prevents package-wide relationship and
  numbering-definition mutation.

## Migration Plan

This is an additive tool and core primitive. Existing callers and documents
require no migration. If post-merge smoke reveals a fidelity or rendering
regression, the PR can be reverted without changing stored user data or existing
tool schemas.

## Open Questions

None. Style-inherited numbering, list restarts, and numbering-definition authoring
remain explicit follow-up capabilities.
