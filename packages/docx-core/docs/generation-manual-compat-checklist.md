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

Emitter revision `#482` adds the standard ancillary parts
(`theme/theme1.xml`, `fontTable.xml`, `webSettings.xml`) to every artifact, so the
manual Word for Mac / Pages / Google Docs cells are reset to `—` pending a fresh
observation of the new package shape.

| Artifact | Emitter revision | Word for Mac | Pages | Google Docs import | LibreOffice |
|---|---|---|---|---|---|
| `generation-phase1-minimal.docx` (plain paragraphs + explicit page setup) | #482 (+ ancillary parts) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase2-styled.docx` (named style + run formatting + tabs/indent/justify) | #482 (+ ancillary parts) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase3-cover-body.docx` (titlePg cover header → body header, Page X of Y field footer, page break) | #482 (+ ancillary parts) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase4-tables.docx` (fixed-grid bordered table, shaded merged header row, repeating-header flag) | #482 (+ ancillary parts) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase5-numbering-recipes.docx` (three-level legal numbering, cover-terms recipe table, signature blocks) | #482 (+ ancillary parts) | — | — | — | clean (identity + PDF probes, 2026-06-13) |
| `generation-phase6-drafting-notes.docx` (anchored comments with commentsExtended/people ancillary parts) | #482 (+ ancillary parts) | — | — | — | clean (identity + PDF probes, 2026-06-13) |

## Per-reader notes

### Word for Mac
- #482 (2026-06-13): artifacts regenerated with the three standard ancillary
  parts (`theme/theme1.xml`, `fontTable.xml`, `webSettings.xml`) so the package
  shape matches a Word-authored document. The "if Word repairs" hypothesis behind
  #482 still needs a human to open each regenerated `generation-phase*.docx` in
  Word for Mac and confirm no repair/recovery dialog appears — that cannot be
  observed from CI/headless. Cells stay `—` until that manual pass.

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
