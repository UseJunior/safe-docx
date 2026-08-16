## 1. Premise gate

- [x] 1.1 Reproduce issue #742 at HEAD: clean A, tracked B (via a first comparison authored "Original Author"),
      then `compareDocuments(A, B)` — confirmed exit 0, normal stats, output authors
      `["Comparison","Original Author"]`, nested `w:ins`-in-`w:ins`. Transitional-schema gate passes the corrupt
      file, so the defect is behavioral.
- [x] 1.2 Independent Codex premise check (read-only sandbox): CONFIRMED — no refusal anywhere on the
      `compareDocuments` / `compareDocumentsAtomizer` path, reproduction reproduced.
- [x] 1.3 Corroborating corpus evidence (independent 520-document differential): rebuild mode unwraps
      pre-existing tracked changes into bare `w:delText`, the Word-unreadable shape; inplace passes them through.

## 2. Detector and guard

- [x] 2.1 New `packages/docx-compare/src/baselines/atomizer/trackedInputRevisionSafety.ts`:
      `TrackedInputRevisionError` (typed, recoverable, names operand + part + markers) and
      `assertComparisonInputsUntracked(original, revised)` scanning `word/document.xml` plus
      `enumerateRevisionStoryPartPaths` for the four content markers and six `*PrChange` records.
- [x] 2.2 Call the guard at the top of `compareDocumentsAtomizer` — the lowest public comparison boundary —
      covering `compareDocuments`, both CLIs, the MCP tool, and the benchmark runner with one scan.
- [x] 2.3 Split the orchestration into `compareDocumentsAtomizerUnguarded` so engine tests over deliberately
      pre-tracked fixtures — and a future accept-on-ingest opt-in — keep an entry below the guard. Exported from
      the package root (cross-package engine tests in docx-core need it; a relative source import violates that
      package's tsc rootDir) with JSDoc marking it as not a supported comparison entry point.
- [x] 2.4 Export `TrackedInputRevisionError`, `assertComparisonInputsUntracked`, and the detection types from
      the package root.
- [x] 2.5 Malformed story parts: guard skips what it cannot parse and defers to the ancillary safety boundary's
      precise diagnostics (`AncillaryStorySafetyError` / `NOTE_PART_XML_INVALID`), mirroring the
      `textBoxRevisionSafety` precedent.

## 3. Surface mapping

- [x] 3.1 `compare_documents` MCP tool: map `TrackedInputRevisionError` to the distinct
      `INPUT_HAS_TRACKED_CHANGES` code with a recovery hint; never the catch-all `COMPARE_ERROR`.
- [x] 3.2 CLIs: verified both entry handlers already print `error.message` and exit 1 on rejection, and the
      error message names the offending operand — no CLI code change (keeps the diff rebase-friendly vs #841).
- [x] 3.3 Regenerate the MCP tool reference (`npm run docs:generate:tools -w @usejunior/docx-mcp`) and pass
      `npm run check:tool-docs`.

## 4. Tests

- [x] 4.1 `trackedInputRevisionSafety.test.ts` (`TEST_FEATURE = add-tracked-input-comparison-guard`): all ten
      revision kinds plus the row-level `w:trPr` marker, both operands, both reconstruction modes, every story
      flavor (header, footer, footnotes, endnotes, comments, glossary), missing parts skipped, malformed part
      defers to `AncillaryStorySafetyError`, `compare(clean, clean)` unaffected, both public entry points
      guarded, and the real `runCompareCli` (no injected fake) refusing with no output written.
- [x] 4.2 `add_tracked_input_comparison_guard.test.ts` (docx-mcp): `INPUT_HAS_TRACKED_CHANGES` mapping with no
      file written, the real `runCompareCommand` rejecting with the operand named, clean-input control.
- [x] 4.3 Re-point the pre-existing engine tests that deliberately compare pre-tracked fixtures at the
      unguarded seam — six docx-compare files plus five docx-core integration files (canonical emission,
      pretracked-ins provenance, move-range preservation, [ADV-COMPARE-MODE-PRESERVATION-01], existing
      sectPrChange) — one commented site each; assertions unchanged.
- [x] 4.4 Red→green: with the source change stashed, the new guard tests fail (no error thrown) and the
      pre-change suite failures reproduce; with it restored, the full workspace suite is green.

## 5. Gates

- [x] 5.1 `npm run build && npm run lint:workspaces && npm run test:run && npm run check:spec-coverage &&
      npm run check:conformance-citations && npm run check:conformance-doc`, gated on exit codes.
- [x] 5.2 `npx openspec validate add-tracked-input-comparison-guard --strict`.
- [x] 5.3 `git diff --check` clean; rebase onto current `origin/main` before opening the draft PR.

## 6. Peer review follow-ups (Codex, 2026-08-16)

- [x] 6.1 Blocking — detector gaps. Codex execution-proved that `w:cellIns`, `w:cellDel`, `w:cellMerge`, and
      `w:numberingChange` passed the ten-name guard through public `compareDocuments` and survived in the output
      with their prior author. Added all four to the detection list, added one fixture per kind to
      `[SDX-TRKIN-04]`, and documented the range-marker family (`w:*RangeStart`/`End`, `w:customXml*Range*`) as
      classified non-triggers (Codex's probe showed an isolated range pair is dropped, not passed through).
- [x] 6.2 Blocking — package-root bypass. The root export of `compareDocumentsAtomizerUnguarded` was a live
      public bypass (execution-proved). Removed it; docx-core integration tests now import the pipeline module
      through the package's dist subpath, aliased back to the same source module graph in
      `packages/docx-core/vitest.config.ts`; `[SDX-TRKIN-06]` pins that the package root does not export the
      seam; corrected the contradictory pipeline JSDoc.
- [x] 6.3 Hint accuracy. `accept_changes` cannot clean headers or footers, so a header/footer detection no
      longer recommends it — the hint is part-aware. Added `[SDX-TRKIN-MCP-04]` (header-part hint) and, per the
      coverage recommendation, `[SDX-TRKIN-MCP-05]` (session-mode refusal).
- [x] 6.4 Re-ran the full gate sequence, both new suites, all eleven re-pointed engine suites, and
      `openspec validate --strict` after the fixes.
