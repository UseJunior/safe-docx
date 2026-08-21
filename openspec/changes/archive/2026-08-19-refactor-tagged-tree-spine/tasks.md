## 0. Predecessor archive

- [x] 0.1 Validate and archive `refactor-tagged-tree-redline-construction`.
- [x] 0.2 Promote its four requirements into the live comparison spec.
- [x] 0.3 Validate all OpenSpec changes and specs after archival.

## 1. Characterization harness

- [x] 1.1 Add `strategy-differential.test.ts` over the real corpus manifest, ILPA pair, and synthetic capability fixtures.
- [x] 1.2 Record fixture hashes, capability tags, source projections, normalized package parts, stats, fallbacks, unrepresented changes, schema results, and closure checks.
- [x] 1.3 Fail on unavailable corpus, missing entries/parts, fallback, or unreviewed divergence drift.
- [x] 1.4 Add explicit divergence rows for fuzzy moves, numbering, consumer compatibility, and volatile PAGEREF caches.
- [x] 1.5 Cover field integrity, notes/comments, bookmarks, moves, formatting, relationships, auxiliary definitions, rationale leakage, text boxes, and unsupported stories.

## 2. Dead code and public API inventory

- [x] 2.1 Delete unused WmlComparer baseline adapters and regex track-change acceptor.
- [x] 2.2 Delete unused legacy move-markup generators and their isolated tests.
- [x] 2.3 Generate the wildcard-export inventory and adjudicate every symbol as stable, deprecated, or breaking removal.
- [x] 2.4 Include MCP `engine` schema changes and regenerate tool documentation.

## 3. Tagged correctness fixes

- [x] 3.1 Add tagged divergence tests for consumer compatibility and volatile TOC PAGEREF caches.
- [x] 3.2 Extract/use one revision allocator seeded from all surviving numeric revision IDs in complete tagged markup.
- [x] 3.3 Enforce consumer compatibility before serialization without repairing bookmark inventory.
- [x] 3.4 Suppress volatile PAGEREF revisions after compatibility enforcement and before final gates.
- [x] 3.5 Add overlapping bookmark/revision ID and refreshed-TOC cache regressions, then close their divergence rows.
- [x] 3.6 Disambiguate package-local bookmark IDs, rewrite original-side bookmark targets across WordprocessingML parts, and make bookmark publication gates fail closed on comparison-created anomalies.

## 4. Markdoc rationale attribution

- [x] 4.1 Carry rationale provenance on tagged nodes through alignment and serialization.
- [x] 4.2 Prove one operation maps to one exact, bounded, non-overlapping emitted range.
- [x] 4.3 Prove no rationale or sentinel text leaks into any ZIP part.
- [x] 4.4 Remove the legacy/inplace Markdoc pin only after dense rewrites and internal/external real-document smoke pass.

## 5. Tagged comparison behavior

- [x] 5.1 Extract portable text-similarity helpers without adding a dependency.
- [x] 5.2 Add exact-first, globally one-to-one deterministic fuzzy move pairing.
- [x] 5.3 Cover minimum words, containment, case, repetition, nesting, overlap, paragraph-pair exclusion, fields, ranges, tables, text boxes, notes, and preserved moves.
- [x] 5.4 Publish and complete the option-to-observable matrix, porting or explicitly removing every option.
- [x] 5.5 Port numbering virtualization and audit hyperlink, property, field, opaque, provenance, and effective-style identity.

## 6. Standalone tagged package assembler

- [x] 6.1 Assemble from an explicitly revised base without legacy result buffers, merged atoms, or output mode.
- [x] 6.2 Own package relationships/content types and every ancillary/package part listed in the design.
- [x] 6.3 Move footnote reconciliation and text-box/ancillary publication onto tagged stories.
- [x] 6.4 Replace reconstruction-mode text-box guards with per-story safety while preserving the typed error contract.
- [x] 6.5 Wire auxiliary sidecar and formatting-fidelity checks into the final publication gate.
- [x] 6.6 Run assembler in shadow and compare normalized manifests and parts for the full Phase 1 corpus.

## 7. Tagged statistics and portable property naming

- [x] 7.1 Derive range stats from final serialized markup across every wrapper transformation.
- [x] 7.2 Key modified paragraphs by tagged node and count paragraph-style deltas once.
- [x] 7.3 Version atom-named metrics as `tagged-token-v1` and document the break.
- [x] 7.4 Build footnote definitions through tagged publication rather than merged atoms.
- [x] 7.5 Extract portable property normalization/naming and replace literal direct-property reporting.

## 8. Authority flip and soak

- [x] 8.1 Make standalone tagged assembly authoritative behind a private emergency legacy switch.
- [x] 8.2 Throw `TaggedPublicationSafetyError` with retained diagnostics when no fallback is selected.
- [x] 8.3 Ship and complete at least one release/corpus soak cycle with Phase 1 telemetry.

## 9. Public breaking release

- [x] 9.1 Remove public `reconstructionMode`, `comparisonStrategy`, `engine`, `premergeRuns`, and `maxWordRefinementChangeRanges` across library, CLIs, MCP, scripts, and tests.
- [x] 9.2 Document and verify the fixed dual-projection package contract: Accept
  preserves revised semantics and Reject preserves original semantics, including
  referenced ancillary resources, with no caller-selectable package base.
- [x] 9.3 Regenerate and validate tool docs, MCPB manifest, and capability projection.

## 10. Legacy deletion

- [x] 10.1 Tag the last legacy-capable commit, retain a maintenance branch, and document the exact rollback sequence.
- [x] 10.2 Extract revision allocation/wrapping survivors into `revisionMarkup.ts` and update keeper dependencies.
- [x] 10.3 Delete atomization, atom LCS, hierarchical LCS, reconstruction, in-place, selective-refinement, and legacy format/move code plus superseded tests.
- [x] 10.4 Re-home ECMA claims, remove stale debug imports, regenerate conformance artifacts, and re-baseline Allure/coverage evidence.
- [x] 10.5 Run the complete differential, package, conformance, and cross-reader evidence without legacy fallback.

## 11. Post-rollback rename

- [x] 11.1 Rename surviving tagged modules out of `baselines/` after the rollback window.
- [x] 11.2 Update Vitest, conformance registry/docs, Allure fixtures, MCP scripts, imports, and generated evidence.

## 12. Verification per shippable phase

- [x] 12.1 Run build, docx-compare tests, spec coverage, package coverage, and strict OpenSpec validation.
- [x] 12.2 From Phase 4, run docx-markdoc tests and both rationale compilation smokes.
- [x] 12.3 From Phase 9, run all workspaces and the full repository pre-submit command.
- [x] 12.4 For Phases 2 and 9, run tool-doc, MCPB-manifest, and capability-projection checks.
- [x] 12.5 Re-run the characterization manifest after every phase and adjudicate rather than absorb drift.
- [x] 12.6 Run real MCP comparison smoke and cross-reader checks after Phases 3, 6, and 10.
