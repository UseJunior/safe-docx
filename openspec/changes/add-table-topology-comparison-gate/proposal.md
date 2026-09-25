# Change: Guard unsupported table topology in two-file comparison

## Why

Issue #1043 is reproducible: comparing a 2×2 table to a 2×3 table returns success but emits `w:ins` directly inside `w:tblGrid` and `w:tr`, which is invalid against the vendored Transitional schema. A one-row horizontal cell merge similarly emits an invalid direct `w:tc`; a grid-column width change emits `w:del` in `w:tblGrid`. Fable review also reproduced schema-invalid `w:ins`/`w:del` wrapping an entire `w:tbl` under `w:body` for whole-table additions/deletions. Whole-row insertion already emits valid `w:trPr/w:ins`. Text range statistics do not distinguish that supported structural row change from cell-text edits.

## What Changes

- Encode main-body whole-table additions/deletions natively by marking every row and its content, including nested tables; do not wrap `w:tbl` in a revision under `w:body`. Make the comparator's accept/reject engine remove only a table actually emptied by row resolution, counting wrapped row containers as surviving rows.
- Add a main-body pre-publication table-topology guard that permits ordinary cell-text/property edits and whole-row insertion/deletion, but throws a typed coordinate-level diagnostic for unsupported grid, cell-count, span, or offset changes in matched tables. Selected header/footer stories retain their existing precise `unrepresentedChanges` contract for unsupported scaffold changes.
- Count emitted whole-row insertions/deletions separately from text/range metrics in `CompareStats`, including rows of whole-table changes. Do not pretend unsupported body column/cell changes produced a result or `unrepresentedChanges` record.
- Add regression tests with shared synthetic DOCX fixtures for whole-table and whole-row revisions, ordinary text changes (including unsupported but structurally unchanged table shapes), and fail-closed column/cell/grid-width changes. Assert structural accepted/rejected projections with both acceptors and schema validity.
- Leave native tracked column/cell comparison to the #1041/#1042 Word-oracle and unresolved-revision follow-ups; this phase prevents invalid successful output.

## Impact

- Affected specs: `docx-comparison`.
- Affected code: tagged construction/publication pipeline, comparator AST acceptor and projection gate, `CompareStats` and its aggregation, typed diagnostics, tests, and public result metadata.
- References: #1043, #764, #998.
