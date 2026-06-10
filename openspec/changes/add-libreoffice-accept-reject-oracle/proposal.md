# Change: Add a LibreOffice accept/reject oracle voter to the Lean↔TS differential harness

## Why

The Lean↔TS helper differential (`add-lean-ts-helper-differential-harness`) validates that the genuine Lean
model and the production TS engine *agree*, but it has no **independent ground truth** — both could be wrong
the same way. The paragraph-collapse cases the harness pins (G3/G4/G5, closed by
`broaden-lean-accept-keep-empty-paragraphs`, `make-reject-paragraph-collapse-mark-based`, and
`make-accept-paragraph-collapse-mark-based`) rest on a claim about how a real word processor behaves: an
**untracked paragraph mark is kept** (as an empty `<w:p>`) on accept/reject, while a **PPR-INS/PPR-DEL mark is
dropped**. That claim was confirmed once, manually, against LibreOffice and recorded in memory; it was never a
committed, reproducible check.

LibreOffice is the native engine for the `.uno:AcceptAllTrackedChanges` / `.uno:RejectAllTrackedChanges`
dispatches, so its paragraph-structure output is authoritative for the mark-based rule. Wiring it in as a
**third voter** makes the accept/reject claims oracle-backed, not just Lean↔TS self-consistent, and turns the
throwaway `.tmp` oracle script into a committed, on-demand developer test.

## What Changes

- Add a committed helper `packages/docx-core/src/integration/libreoffice-oracle.ts`: `resolveSoffice()`
  (binary discovery, `SAFE_DOCX_SOFFICE_BIN` override), `packMinimalDocx` / `extractDocumentXml`,
  `runLibreOfficeOracle` (drives LibreOffice headless via an injected Basic macro in a throwaway profile —
  pyuno is blocked on macOS by Launch Constraints — batching all jobs in one launch), and `paragraphShape`
  (the structural projection).
- Add a gated oracle voter to `lean-differential-helpers.test.ts` (`[LEAN-HELP-09..11]`) asserting LibreOffice
  agrees with the TS engine on **paragraph structure** for the pinned fixtures: kept-not-dropped on G3/G4/G5,
  full empty-collapse structure on the clean single-level G4/G5, and a PPR-marked **drop** control.
- The comparison is structural (paragraph count + which paragraphs collapsed to empty), NOT the full token
  projection: LibreOffice rewrites styles, and on the contrived nested G3 fixture (`w:ins` wrapping `w:del`)
  it keeps the inserted-then-deleted text on accept where Lean/TS collapse to empty. The paragraph *count*
  still agrees (the kept-not-dropped claim); that content divergence is **pinned** in `[LEAN-HELP-09]`.

- Characterize the oracle's **trust boundary** as committed gated tests
  (`packages/docx-core/src/integration/libreoffice-oracle-trust-boundary.test.ts`, promoting the
  `.tmp/lo-oracle-vet/` vetting fixtures) plus an `identity` op on `OracleJob` (load→save, no dispatch) —
  see Risks / Limitations below. (Ref: #362)

## Risks / Limitations (oracle trust boundary)

Vetted on LibreOffice 25.8.7.3 (2026-06, `.tmp/lo-oracle-vet/`, promoted to
`libreoffice-oracle-trust-boundary.test.ts`):

- **The oracle IS a trustworthy accept/reject text/shape voter, including for stacked multi-author inputs**
  (`w:del A` + `w:ins B` siblings; inline `w:del`-nested-in-`w:ins`, fully or partially deleted). The
  accept/reject dispatch runs BEFORE `storeToURL`, so no unresolved tracked change ever reaches LibreOffice's
  DOCX save — the save defect below cannot contaminate the voting path. Prior oracle-confirmed results
  (G3/G4/G5) stand.
- **LibreOffice's save round-trip MUST NOT be used to validate fully-deleted-insertion shapes.** For
  `<w:ins authorA><w:del authorB>…all of the inserted text…</w:del></w:ins>` a plain load→save silently drops
  the `<w:ins>` wrapper, turning "inserted then deleted" into "original text deleted" (upstream bug tracked in
  #346; the whole-paragraph variant of the same defect family flattens BOTH redlines on import — pinned in
  `[LEAN-HELP-09]`). Non-nested stacks and partial deletions with surviving inserted text round-trip cleanly.
  The `identity` op pins the defect so a future LibreOffice fix trips the test and the boundary is re-vetted.
  Real-world interop caveat: preserve-campaign output that emits a fully-deleted insertion loses that
  provenance if a user opens-and-saves it in LibreOffice.
- **The oracle is formatting-blind by design.** `paragraphShape` records only paragraph count + visible-text
  presence, so the oracle cannot guard rebuild formatting loss (tracked separately by the
  formatting-fidelity-oracle work, #363).

## Impact

- Affected specs: `docx-comparison` (ADDED: one requirement + `[LEAN-HELP-09..11]`).
- Affected code: new `packages/docx-core/src/integration/libreoffice-oracle.ts`;
  `packages/docx-core/src/integration/lean-differential-helpers.test.ts` (oracle describe block + imports).
- **No production-engine change**; this strengthens the differential's evidence only.
- **Local-only**: gated on a LibreOffice binary via `resolveSoffice()`. CI does not install LibreOffice, so the
  voter skips cleanly there (exactly like `odf-core`'s LibreOffice round-trip test); it runs for any developer
  who has LibreOffice installed. The mechanism (Basic-macro injection, `macro:///` invocation after a
  profile-init convert) follows the `reference_libreoffice_macos_oracle` recipe.
