## 1. Engine: stop stripping unresolvable row markers

- [x] 1.1 `accept_changes.ts`: add a row-property-marker predicate (parent is `w:trPr`) and exclude `w:trPr > w:del`
      from the Phase B `removeAllByLocalName(root, 'del')` sweep. Leave `w:trPr > w:ins` alone — accepting an
      inserted row correctly keeps the row and drops the marker.
- [x] 1.2 `reject_changes.ts`: mirror it — exclude `w:trPr > w:ins` from the Phase C
      `removeAllByLocalName(root, 'ins')` sweep, leaving `w:trPr > w:del` handled as before.
- [x] 1.3 Count the preserved markers and return them as `unresolvedRowRevisions` on `AcceptChangesResult` /
      `RejectChangesResult`. Respect the `RevisionFilter`, so a selective accept/reject only counts markers it
      would otherwise have touched.
- [x] 1.4 `document.ts`: extend `emptyAcceptChangesResult` / `addAcceptChangesResult` and the reject equivalents to
      carry the counter across the body and side stories. `hasAcceptedChanges` / `hasRejectedChanges` SHALL NOT
      treat a preserved marker as a change.

## 2. MCP surface

- [x] 2.1 Confirmed: `packages/docx-mcp/src/tools/accept_changes.ts` spreads the primitive result into its
      response, so `unresolvedRowRevisions` reaches the caller with no tool change. There is no `reject_changes`
      MCP tool today; the library result carries the counter for direct callers.

## 3. Tests

- [x] 3.1 New test file with `TEST_FEATURE = 'guard-row-level-revision-resolution'` covering: accept over a
      deleted row (marker + row + attributes preserved, `deletionsAccepted` unchanged, `unresolvedRowRevisions` 1),
      reject over an inserted row (mirror), both correctly-resolved directions (marker removed, row kept, counter 0),
      and a no-row-revision control asserting the counter is 0 and output is unchanged.
- [x] 3.2 Assert the selective (`filter`) path counts only markers the filter selects.
- [x] 3.3 Full `@usejunior/docx-core` suite green; `[XIMPL-08]` conformance classification still passes unchanged.

## 4. Gates

- [x] 4.1 `npm run build && npm run lint:workspaces && npm run test:run && npm run check:spec-coverage &&
      npm run check:conformance-citations && npm run check:conformance-doc`
- [x] 4.2 `openspec validate guard-row-level-revision-resolution --strict`

## 5. Verification performed

- Red/green confirmed: with the four source edits stashed, all four new tests fail on the exact assertions
  (`expected null not to be null` for the stripped marker, `expected undefined to be +0` for the counter).
- Full workspace suite green (`npm run test:run`, exit 0), including `[XIMPL-08]`, which pins the conformance
  adapter's `supported: false` classification for both unresolvable combinations.

## 6. Peer review follow-ups (Codex, 2026-08-14)

- [x] 6.1 P1 — reject-side ordering leak. Phase F restored a `w:trPrChange` snapshot by replacing the whole
      `w:trPr`, destroying a marker Phase C had preserved while still reporting it in `unresolvedRowRevisions`.
      Reproduced, then fixed by carrying surviving row markers into the restored `w:trPr`. The accept side was
      checked and is unaffected (Phase D removes the change record without replacing the parent).
- [x] 6.2 P1/P2 — the `mcp-server` requirement promised "no revision markup in the body". Added a MODIFIED
      delta, updated the `tool_catalog.ts` description, and regenerated `tool-reference.generated.md`.
- [x] 6.3 P2 — documented the source-level breaking change for external TypeScript that constructs the exported
      result types, and the reasoning for keeping the field required.
- [x] 6.4 P2 — added `[SDX-ROWREV-05]` (trPrChange collision) and `[SDX-ROWREV-06]` (selective reject preserves
      foreign markers) plus an MCP-level test `[SDX-ROWREV-MCP-01]`. Both new primitive tests verified red
      against the un-fixed Phase F.
- Codex confirmed assumptions 1 and 2 against the vendored strict/transitional schemas: `CT_TrPr` admits only
  `ins`/`del`/`trPrChange` as revision children, paragraph-mark markers live under `pPr > rPr`, cell topology uses
  distinct `cellIns`/`cellDel` names, and nested tables do not change the direct-parent test. No Word or
  LibreOffice projection oracle was run, so application-specific normalization remains unverified.

## 7. Oracle attempt (2026-08-14)

- [x] 7.1 LibreOffice: ran the committed oracle harness over all four directions plus an `identity` control.
      Result — LO discards `w:trPr > w:ins|w:del` on IMPORT (`<w:trPr></w:trPr>` after a plain load+save), so it
      cannot validate this class. A content deletion in the same cell was imported and resolved correctly,
      confirming the harness works and isolating the failure to row-level markers.
- [x] 7.2 Microsoft Word via AppleScript: attempted, blocked. `open file name` left Word on its start screen and
      no fixture was rewritten. The `scripts/oracle/word/` helpers referenced elsewhere do not exist on this
      branch. Abandoned rather than pursued further.
- Consequence: the four-direction asymmetry is supported by the schemas and by `conformance-adapter.ts`, not by an
  observed projection. Sufficient for a preserve-and-report guard; NOT sufficient to implement the semantics.
