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

## Impact

- Affected specs: `docx-comparison` (ADDED: one requirement + `[LEAN-HELP-09..11]`).
- Affected code: new `packages/docx-core/src/integration/libreoffice-oracle.ts`;
  `packages/docx-core/src/integration/lean-differential-helpers.test.ts` (oracle describe block + imports).
- **No production-engine change**; this strengthens the differential's evidence only.
- **Local-only**: gated on a LibreOffice binary via `resolveSoffice()`. CI does not install LibreOffice, so the
  voter skips cleanly there (exactly like `odf-core`'s LibreOffice round-trip test); it runs for any developer
  who has LibreOffice installed. The mechanism (Basic-macro injection, `macro:///` invocation after a
  profile-init convert) follows the `reference_libreoffice_macos_oracle` recipe.
