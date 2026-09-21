## 1. Canonical syntax and IR

- [x] 1.1 Add `insert-table-rows`, `row`, `cell`, and `delete-table-row` Markdoc grammar.
- [x] 1.2 Add structural row operation IR variants with exact self-closing `cell text="..."` string values, supported quote/backslash escapes, and CR/LF/tab rejection.
- [x] 1.3 Cover malformed nesting, empty batches, absent cell tags, inconsistent cell counts, non-string/control-character values, duplicate operation IDs, and orphan rationales.

## 2. Compiler integration

- [x] 2.1 Preflight all structural anchors and table shapes transactionally before artifact construction.
- [x] 2.2 Apply ordered clean batch insertion and source-row deletion through the docx-core row primitives.
- [x] 2.3 Reject duplicate/deleted structural anchors, paragraph edits or formatting sources within a deleted row, and non-rationale annotations anchored there.
- [x] 2.4 Attribute the full inserted/deleted row range to the structural operation for rationale projection.
- [x] 2.5 Prove mixed structural-row and ordinary paragraph operations compile in one build.

## 3. Tracked output and certification

- [x] 3.1 Extend tagged whole-row serialization to emit independent paragraph-mark and run-content revisions, then pin pure insertion/deletion marker sets through `SDX_SCHEMA_CORPUS_DIR` and the emitted-schema gate.
- [x] 3.2 Pin projection-correct in-row revision output for legal equal-row-count delete/insert builds and duplicate-content alignment.
- [x] 3.3 Add an optional normalized source/reject and clean/accept table-topology report with the documented ignore set.
- [x] 3.4 Gate projection and delivery verdicts on text, formatting, topology equality, and zero unresolved row revisions; keep marker counts informational.
- [x] 3.5 Put structural-operation provenance only on run-content wrappers, bind rationales to those revisions, and make comment materialization reject `w:trPr` or `w:rPr` parents; schema-validate the result.
- [x] 3.6 Cover accept/reject text, topology, formatting-shell, bookmarks (including `_safe_docx_original_*`), and unrelated-part fidelity.

## 4. Documentation and integration evidence

- [x] 4.1 Document syntax, operation ordering, and bounded topology in the Markdoc README.
- [x] 4.2 Update `packages/docx-core/SUPPORT.md` and rename the Markdoc certificate exclusion to `table-grid-operations`.
- [x] 4.3 Add Table A canonical-emission rows/tests for tracked `insertTableRow` and `deleteTableRow`; document that MCP row editing remains outside this change.
- [x] 4.4 Compile a public real-world DOCX with a multi-row insertion and row deletion; validate schema and LibreOffice rendering of clean/accepted/rejected states.
- [x] 4.5 Re-run real-corpus comparison gates and refresh only revision-count baselines legitimately changed by complete row-content marking.

## 5. Gates

- [x] 5.1 Run the mandatory full repository pre-submit command.
- [x] 5.2 Run strict OpenSpec validation and scratch-archive validation.
- [x] 5.3 Obtain Claude Fable review and resolve all actionable findings.
- [ ] 5.4 Run `/automerge-smoke` after merge against a real DOCX.
