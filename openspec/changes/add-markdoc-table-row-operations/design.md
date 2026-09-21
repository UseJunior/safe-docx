# Design: Markdoc Table-Row Operations

## Canonical syntax and IR

Insertion uses one operation tag containing rows and cells:

```markdoc
{% insert-table-rows anchor="_bk_inventory" position="after" operation="add-inventory" %}
{% row %}
{% cell text="Acme Manufacturing, Inc." /%}
{% cell text="Pending" /%}
{% /row %}
{% row %}
{% cell text="Northeast Logistics LLC" /%}
{% cell text="Approved" /%}
{% /row %}
{% /insert-table-rows %}
```

Deletion is source-anchored and self-closing:

```markdoc
{% delete-table-row anchor="_bk_obsolete" operation="remove-obsolete" /%}
```

`row` is valid only directly inside `insert-table-rows`; self-closing `cell` is
valid only directly inside `row`. Its required string `text` attribute is the
exact cell value, avoiding indentation/newline ambiguity while admitting an
empty string and intentional leading/trailing spaces. The value uses Markdoc's
quoted string grammar with `\"` and `\\` escapes; non-string values and literal
carriage returns, newlines, or tabs are invalid. Edge spaces survive through
`xml:space="preserve"`.
Cell tags admit no bodies or formatting. An insertion requires at least one row
and one cell tag in every row. All rows must have the same cell count.

The additive IR variants are:

```ts
type InsertTableRowsOperation = {
  kind: 'insert-table-rows';
  operationId: string;
  anchorId: string;
  relativePosition: 'BEFORE' | 'AFTER';
  rows: string[][];
};

type DeleteTableRowOperation = {
  kind: 'delete-table-row';
  operationId: string;
  anchorId: string;
};
```

The source scaffold remains a complete paragraph projection. Structural tags
are authored operations, not extra scaffold paragraphs, so source hashing and
fingerprint verification do not change.

## Ordered batch insertion

The compiler applies each row through `DocxDocument.insertTableRow`. For an
`after` batch, the first returned cell paragraph becomes the next row anchor;
this preserves authored order. For a `before` batch, each row is inserted
immediately before the original anchor in authored order. The returned cell
anchors are internal compilation state and are not written back into canonical
Markdoc.

One batch has one operation ID and one rationale target. Its attributable clean
range begins at the first inserted cell paragraph and ends at the final cell
paragraph of the final inserted row, using that final cell's text length as the
end offset. Duplicate operation IDs remain invalid. With duplicate-content
rows, comparison may attribute the operation to a physically different but
textually identical row; projection and topology equality, not physical-row
identity, is authoritative.
If a rationale cannot be mapped to one generated revision because an inserted
row is textually identical to adjacent source content, compilation fails with
`RATIONALE_ANCHOR_AMBIGUOUS` rather than attaching the comment heuristically.
The structural edit remains valid without that ambiguous rationale.

## Validation and operation conflicts

Parsing validates tag shape and plain-text cell bodies. Source validation
resolves every structural anchor before mutation and rejects:

- a missing or non-table anchor;
- two structural operations targeting the same physical source row;
- an insertion anchored on a row deleted by the same build;
- a paragraph edit targeting a row that the same build deletes;
- use of a paragraph in a deleted row as another operation's style or run
  formatting source;
- a non-rationale annotation anchored inside a deleted row;
- insertion/deletion against topology rejected by docx-core; and
- any invalid cell count or final-row deletion.

For atomic sets and draft completeness, each inserted cell string is an
`after` fragment that must appear in clean text; deletion contributes no clean
text. Markdoc continues to
reject operative edits when the pinned source already contains revisions, so
multiple structural passes must accept/reject and re-import between builds.

The compiler performs structural preflight on a disposable document before
building either artifact. A failure is reported as `DocxMarkdocError` with the
underlying typed table coordinate/feature detail and returns no output.

## Clean and tracked artifacts

The clean-intent builder invokes `insertTableRow`/`deleteTableRow` without a
revision context. The existing tagged comparison then compares the hash-pinned
source against that clean result. Today `markWholeTableRow` emits only
`w:trPr > w:ins|w:del`; this change extends it to independently mark cell
content as required by ECMA-376. Inserted paragraph marks and runs use `w:ins`.
Deleted non-final paragraph marks and runs use `w:del`, with `w:t` converted to
`w:delText`. The implementation shares or mirrors the tested docx-core row
emitter rules and adds serializer/shadow/schema regressions for
§§17.13.5.18/14 and §§17.13.5.20/15.

This path composes structural row operations with ordinary paragraph edits in
one canonical build. A structural rationale binds to the first through last
cell-content revision in its batch, never to `w:trPr`. The shared comment
materializer refuses any attributed revision whose parent is `w:trPr` or
`w:rPr`, so no caller can place comment range/reference markup in a property
container. Operation provenance is attached only to affected-cell run-content
wrappers; row markers and paragraph-mark markers carry none. Resolved
attribution therefore begins and ends on run-level `w:ins`/`w:del` whose parent
admits comment range markers. Tracked output with a structural rationale must
pass emitted-schema validation.

## Structural projection certificate

Text equality alone cannot prove correct row topology. The version-1
certificate gains an optional `tableTopology` report, present only for builds
with structural row operations, that compares normalized body-table structure:

- source against reject-all; and
- intended clean against accept-all.

The normalization records table order, direct row order, direct cell counts,
per-cell paragraph/run text, grid column count and widths, `gridSpan`/`vMerge`,
`w:tcW`, `w:trHeight`, and `w:tblHeader`. It ignores `_bk_*` and
`_safe_docx_original_*` bookmark identities, comment/permission/range/proof
markers, `w:rsid*` attributes, revision wrappers/markers, and property-change
snapshots. Both comparisons gate `projectionPassed`, `deliveryReady`, and
`passed` through `tableTopology?.passed ?? true`; existing text and formatting
gates remain mandatory. Diagnostics identify the first mismatching table, row,
optional cell, and both cell texts.

For pure insertion or deletion that changes row count, tests require native row
markers plus independent content markers. A legal deletion and insertion that
net to the same row count may be represented as in-row revisions instead; the
compiler does not require one row marker per operation. It requires exact
topology projections and zero unresolved row revisions, and reports row-marker
counts only as information.

## Documentation and support boundary

`packages/docx-markdoc/README.md` documents the syntax and phase-one topology
limits. `packages/docx-core/SUPPORT.md` distinguishes:

- supported lower-level rectangular row primitives;
- supported Markdoc row insertion/deletion after this change; and
- unsupported merged/offset/nested structural transformations.

Canonical-emission tests add the two docx-core Table A rows for tracked
`insertTableRow`/`deleteTableRow`, while Markdoc integration tests cover the
compiler. This resolves the SUPPORT/docx-core portion of PR #1001's advisory.
The MCP-path warning remains intentionally open: this change does not claim or
add an MCP row-edit tool.

The certificate vocabulary renames `table-structural-operations` to
`table-grid-operations`: row insertion/deletion is supported, while column,
individual-cell, span, merge, and arbitrary-grid transformations remain
unsupported. Existing table-cell tests and documentation migrate with it.

## Readability profile boundary

This change does not alter token alignment or replacement grouping. The
separate readable-redline slice will preserve meaningful common lexical and
punctuation tokens while allowing bounded, projection-safe whitespace
coalescing when that makes a replacement easier to review. Row compilation
must not hard-code a global “minimality outranks readability” policy.
