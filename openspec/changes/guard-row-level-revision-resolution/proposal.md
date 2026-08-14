# Change: Preserve row-level revision markers the acceptance engine cannot resolve

## Why

`acceptChanges` and `rejectChanges` sweep revision wrappers by local name only. `removeAllByLocalName(root, 'del')`
(`packages/docx-core/src/primitives/accept_changes.ts`) and `removeAllByLocalName(root, 'ins')`
(`packages/docx-core/src/primitives/reject_changes.ts`) collect every `w:del` / `w:ins` in the story and delete it
without inspecting the parent.

Row-level revision markers live at `w:tr > w:trPr > w:del` and `w:tr > w:trPr > w:ins`. They are *property markers
describing a row*, not wrappers around deleted or inserted content. Both sweeps match them, so the marker is removed
and the `w:tr` it described is left in place.

Two directions are genuinely unresolvable today:

- **accept** over `w:trPr > w:del` — the row should disappear; the engine keeps it.
- **reject** over `w:trPr > w:ins` — the inserted row should disappear; the engine keeps it.

The other two directions are already correct by construction: accepting an inserted row means keeping the row and
dropping its marker, and rejecting a deleted row means the same. Stripping the marker is the right outcome there.

The failure is silent and unrecoverable. The marker carrying `w:id`, `w:author` and `w:date` is destroyed, so no
later pass can tell the row was ever tracked — and the returned stats count the marker as a resolved revision, so a
caller checking the result is told the operation succeeded:

```
acceptChanges over a row marked deleted
  result: {"deletionsAccepted":1, ...}
  rows remaining: 2   (the row Word removes survives)
  trPr marker survives: false
```

The repository already classifies exactly these two combinations as unimplemented.
`packages/docx-core/src/cli/conformance-adapter.ts` returns `supported: false` with the reason "safe-docx adapter
does not implement accepting deleted table-row revisions", and `[XIMPL-08]` in
`cross-implementation-suite.test.ts` pins that classification. That honesty stops at the conformance harness:
`DocxDocument.acceptChanges` / `rejectChanges` and the `accept_changes` MCP tool call the primitives unconditionally.

This change makes the engine agree with what the conformance adapter already says, using the same
preserve-and-report convention the codebase already applies to other unresolved advanced records
(`ADV-UNRESOLVED-RECORDS-01`, `ADV-TOPOLOGY-PRESERVATION-01`): leaving a record in place is a visible gap a caller
can detect, whereas removing it while keeping the content is silent divergence.

Implementing the row semantics themselves is deliberately out of scope — see `## Out of scope`.

## What Changes

- `acceptChanges` SHALL NOT remove a `w:del` whose parent is `w:trPr`, and `rejectChanges` SHALL NOT remove a
  `w:ins` whose parent is `w:trPr`. The marker and its row are both preserved.
- The directions the engine resolves correctly are unchanged: `acceptChanges` still strips `w:trPr > w:ins`, and
  `rejectChanges` still strips `w:trPr > w:del`.
- `AcceptChangesResult` and `RejectChangesResult` gain `unresolvedRowRevisions: number`, counting the markers left
  in place. It is reported separately from the resolved-revision counters and does not make a document count as
  changed.
- `DocxDocument.acceptChanges` / `rejectChanges` aggregate the new counter across the body and every revisionable
  side story.
- The `accept_changes` MCP response carries the count through as `unresolvedRowRevisions`, so an agent driving the
  server can see that the document still holds unresolved row revisions.

## Impact

- Affected specs: `docx-primitives` (ADDED: `Unresolvable Row-Level Revision Preservation`). The existing
  `Tracked Change Acceptance Engine` scenarios are unchanged: each is scoped by its own GIVEN to `w:del`/`w:ins`
  elements *wrapping content*, which a row-property marker is not.
- Affected code: `packages/docx-core/src/primitives/accept_changes.ts`,
  `packages/docx-core/src/primitives/reject_changes.ts`, `packages/docx-core/src/primitives/document.ts`
- Behavior change is confined to documents containing row-level revision markers. Every other document produces
  byte-identical output and an unchanged result shape apart from the added zero-valued counter.
- Callers destructuring the result are unaffected (additive field). Callers that relied on row markers being
  stripped now see them preserved — that is the point of the change, and the output was wrong before.
- Refs #845.

## Out of scope

Resolving row-level revisions semantically (accept-deletes-the-row, reject-removes-the-inserted-row). That needs an
oracle pass over Microsoft Word's actual projection first — `w:vMerge` chains and cells carrying their own content
revisions have to be settled before the projection can be called correct — and it overlaps issue #764, which owns
structural table changes and lists accept/reject round trips in its scope. This change deliberately makes the gap
visible rather than guessing at the semantics.

Extending `extract_revisions` to report row and cell topology, so a caller can inspect a document *before* deciding
to accept it, is also left out; today the counter reports the gap after the fact.
