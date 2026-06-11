# Design: cross-implementation OOXML conformance suite

## Context

Issue #283 scoped a wpt.fyi-style comparison for the spec-anchored subset of our scenarios and left five open questions (scenario expression, adapter shape, spec anchor, results UI, maintenance). This design resolves them. The plan was peer-reviewed pre-approval (codex + agy); their blockers — npm-bin sequencing, OpenSpec delta format, find-replace match-scope ambiguity — are folded in below.

## Goals / Non-Goals

- Goals: a neutral forkable suite repo; a language-neutral scenario DSL with ECMA-376 citations on every scenario; honest `unsupported` semantics so library gaps render as matrix asymmetry, not failure noise; safe-docx self-check wired into CI; a published results JSON any renderer can consume.
- Non-Goals: schema validation (deferred assertion kind; see #214), tracked moves/table revisions (future scenarios), porting safe-docx algorithms to other libraries, LibreOffice adapter (named stretch), per-test-page renderer joins (#391).

## Decisions

- **Suite home `open-agreements/docx-platform-tests`, BSD-3-Clause.** Separate repo because neutrality is critical — researchers fork the suite without forking safe-docx; wpt's license maximizes reuse. ECMA-376 is cited by section number only, never reproduced.
- **Scenario DSL: XML pairs + assertions.** Per-scenario directory: `scenario.json` (self-disambiguating 3–4-word camelCase keys: `operationDescriptor`, `assertionList`, `specCitation` with edition/part/section mirroring `spec-compliance/registry/ecma-376.md`, optional `wordBehaviorNote` for MS-OE376 deviations), `input/document.xml` (reviewable source of truth), committed generated `input.docx` (interchange — python-docx/LibreOffice/Word only open full packages; CI verifies fragment↔package sync).
- **Operations v1 (closed enum):** `acceptAllTrackedChanges`, `rejectAllTrackedChanges`, `replaceFirstTextOccurrence {findText, replaceText}`. Match semantics pinned: first *paragraph-local* occurrence in document order; cross-paragraph matches out of scope in v1 (paragraph-scoped primitives would otherwise legitimately diverge).
- **Assertions v1:** `xpathQueryCount`, `xpathQueryExists`, `documentTextContainsAtOffset` (projection pinned: body `w:t` only, `w:delText` excluded, paragraphs joined with `\n`), `canonicalXmlEquals`, `schemaValidAgainstWml` (defined-but-deferred; runner reports `unimplemented-assertion`). Authoring rule: prefer the weakest assertion that captures the conformance claim; every `canonicalXmlEquals` is paired with xpath assertions because run merge/split is legal post-accept — the canonicalizer additionally applies `mergeAdjacentIdenticalRuns` for tracked-change scenarios.
- **Canonicalization:** normalize inter-element whitespace, attribute order, namespace-prefix spelling; strip the rsid attribute family and revision-wrapper `w:id` (implementation-chosen identifiers, not conformance signals). Never normalize text content or element order.
- **Adapter protocol v1 (file-based CLI):** `<adapter-cmd> --protocol-version 1 --operation operation.json --input input.docx --output output.docx`. The runner extracts `operationDescriptor` to a temp `operation.json`; adapters never see assertions. Exit codes: 0 success, 2 unsupported (one-line reason to stdout), 1 error, 3 protocol-mismatch. One process per scenario (isolation over batching at this scale; the Lean harness's batch-stdin pattern is the fallback at ~100+ scenarios). `registry/adapters.json` records invocation commands; runtime exit codes outrank static declarations.
- **M1 scenarios:** `acceptInsertionsUnwrapsInsWrappers` (ECMA-376 edition 5, Part 1 § 17.13.5.18; fixture mirrors `packages/docx-core/test-primitives/accept_changes.test.ts:32`), `acceptDeletionsRemovesDelContent` (§ 17.13.5.14; mirrors `accept_changes.test.ts:60`), `replaceFirstOccurrencePreservesOffsets` (single-run paragraph fixture, modeled on `packages/docx-core/src/primitives/text.test.ts` offset cases). The single-run constraint keeps the python-docx adapter an intra-run replace — testing the library, not the adapter author; a future run-spanning scenario may legitimately show python-docx `unsupported`.
- **safe-docx adapter is a docx-core bin**, not a new package (a package would only re-import docx-core). New compiled entrypoint with shebang + explicit `"safe-docx-conformance-adapter": "dist/cli/conformance-adapter.js"` bin (existing bins both point at `dist/cli/index.js`, so this is a new bin file, not a dispatch case).
- **Self-check gating:** `DOCX_PLATFORM_TESTS_DIR` env var + `existsSync`, `describeMaybe = available ? describe : describe.skip` (pattern: `lean-differential-lcs.test.ts:256`). Suite SHA pinned in `docx-platform-tests.pin.json`; mismatch warns, absence skips, disagreement fails. Test carries `TEST_FEATURE`, single-line `.openspec()` tags, and `.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '…' })` (citation lint fails any ECMA-376 mention without it).
- **Results publishing:** suite CI (push + weekly cron, so upstream library releases get re-tested) publishes `results/latest.json` to gh-pages + artifact; snapshot committed on tagged releases. Statuses: `pass | fail | unsupported | error | protocol-mismatch`, with per-assertion detail.
- **npm sequencing:** the suite's safe-docx adapter installs from a pinned-SHA `npm pack` tarball until the next safe-docx release publishes the bin, then flips to npm in a follow-up suite commit.

## Risks / Trade-offs

- Canonical equality across implementations is brittle (legal run merging/splitting) → `mergeAdjacentIdenticalRuns` + paired xpath assertions + "weakest assertion" authoring rule.
- Adapter upkeep when upstream libraries change → weekly cron surfaces breakage as `error` cells, not silent rot; per-adapter README states maintenance policy (best-effort, matrix shows staleness honestly).
- New-capability scenarios are not machine-enforced by existing coverage validators (only `docx-primitives`/`mcp-server` spec paths are discovered) → over-disclosure accepted for M0; extending a validator rides with the archive PR (#390).
- Self-check is vacuous on dev machines without the suite checkout → CI clones the suite at the pinned SHA so the gate is live where it matters (Lean-harness precedent).

## Migration Plan

M0 (this change, PR 1) → suite repo scaffold + M1 scenarios → M2 adapter + self-check (safe-docx PR 2, #389) → suite registers safe-docx (tarball) + python-docx adapters (M3) → tests-renderer matrix page (M4, UseJunior/tests-renderer#62) → archive (#390). Rollback: the adapter bin and self-check are additive; deleting them restores the status quo. The suite repo stands alone regardless.

## Open Questions

- LibreOffice headless as the third adapter (it genuinely implements accept/reject; recipe in `openspec/changes/add-libreoffice-accept-reject-oracle/`) — when, and macOS-vs-CI hosting.
- Whether `documentTextContainsAtOffset` should ever include footnote/endnote stories (v1: body only).
- Coverage-validator extension for the `cross-implementation-conformance` capability (tracked in #390).
