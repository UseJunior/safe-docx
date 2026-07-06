# From-scratch generation — manual cross-reader compatibility matrix

OpenSpec change: `add-docx-generation` (scenario `[SDX-GEN-092]`).

Structural checks and the LibreOffice probes are the automated proxies for
"opens cleanly"; what they cannot verify honestly is the absence of recovery /
repair dialogs in Microsoft Word for Mac, Pages import behavior, and Google
Docs import fidelity. Those observations are recorded here, per generated
artifact class, and refreshed in any PR that changes an emitter.

## How to regenerate the artifacts

```bash
SDX_WRITE_OUTPUT_FIXTURES=1 npm run test:run -w @usejunior/docx-core -- src/generation src/integration/generation-package-structure.test.ts
```

Artifacts land under `packages/docx-core/src/testing/outputs/`.

## Observation legend

- `clean` — opens with no dialog, content renders as specified
- `dialog` — reader showed a repair/recovery/recompute prompt (record the text)
- `degraded` — opens silently but content or layout deviates (record how)
- `—` — not yet checked for the current emitter revision

## Matrix

Emitter revision `#487` emits a baseline `word/settings.xml` on every artifact,
always carrying a `w:compat` → `compatibilityMode=15` compatSetting to clear
Word's legacy "Compatibility Mode" banner (building on the `#482` ancillary
parts). The manual Word for Mac cells are reset to `—` pending a fresh human
observation that the banner is gone; Pages / Google Docs stay `—` as before.

| Artifact | Emitter revision | Word for Mac | Pages | Google Docs import | LibreOffice |
|---|---|---|---|---|---|
| `generation-phase1-minimal.docx` (plain paragraphs + explicit page setup) | #487 (+ compat settings) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase2-styled.docx` (named style + run formatting + tabs/indent/justify) | #487 (+ compat settings) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase3-cover-body.docx` (titlePg cover header → body header, Page X of Y field footer, page break) | #487 (+ compat settings) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase4-tables.docx` (fixed-grid bordered table, shaded merged header row, repeating-header flag) | #487 (+ compat settings) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase5-numbering.docx` (three-level legal numbering through the document façade) | #487 (+ compat settings) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase6-drafting-notes.docx` (anchored comments with commentsExtended/people ancillary parts) | #487 (+ compat settings) | — | — | — | clean (identity + PDF probes, 2026-06-13) |

## Per-reader notes

### Word for Mac
- #482 (2026-06-13, Microsoft Word for Mac 16.x): all six artifact classes open
  **clean — no repair/recovery dialog**. Verified two ways: (1) programmatically,
  by opening each `generation-phase*.docx` via `open -a "Microsoft Word"` and
  asserting via System Events that the document registers (`count documents` = 1)
  with zero alert sheets / `AXDialog` windows on the Word process; (2) visually,
  via full-screen `screencapture` of each — plain text, the bordered/shaded table,
  three-level numbering, the signature blocks, and the two anchored comments all
  render as specified. This settles the "if Word repairs" hypothesis: with the
  ancillary parts present, Word for Mac does not repair.
- Follow-up (not a #482 defect): Word opens the documents in **Compatibility
  Mode** because generation does not emit a `w:compat` →
  `compatibilityMode=15` `compatSetting` in `word/settings.xml`. Emitting that
  (always, in a baseline settings part) would clear the legacy-format banner.
  Tracked separately from the theme/fontTable/webSettings work here.
- #487 (implementation): `generateDocx` now emits a baseline `word/settings.xml`
  on every package with a `w:compat` → `compatibilityMode=15` compatSetting.
  Word-for-Mac cells above are reset to `—` pending the manual re-check that the
  Compatibility-Mode banner is gone AND no repair dialog appears — re-run
  `~/.claude/skills/word-fidelity-check/probe.sh --screenshots
  packages/docx-core/src/testing/outputs/generation-phase*.docx`.

### Pages
_(none yet — needs a manual open of the #482 artifacts)_

### Google Docs import
_(none yet — needs a manual import of the #482 artifacts)_

### LibreOffice
- PR 1: identity load→save and PDF conversion exercised automatically by
  `generation-package-structure.test.ts` when a local `soffice` binary exists.
- PR 7 (2026-06-11, LibreOffice headless on macOS): all six artifact classes
  pass the identity probe (load → re-save as .docx → reload via DocxDocument
  with paragraph content intact) and convert to non-empty PDFs.
- #482 (2026-06-13, LibreOffice headless on macOS): re-run after adding the
  ancillary parts — `generation-package-structure.test.ts` identity and PDF
  probes pass against the new package shape (no dialogs, no content loss). Note:
  headless `soffice` is occasionally flaky (an `Abort trap: 6` was observed in a
  parallel run); the probe skips/fails-soft when the binary is unusable, and CI
  has no `soffice`, so this remains a local-only signal.
