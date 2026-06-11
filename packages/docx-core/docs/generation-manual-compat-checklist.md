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

| Artifact | Emitter revision | Word for Mac | Pages | Google Docs import | LibreOffice |
|---|---|---|---|---|---|
| `generation-phase1-minimal.docx` (plain paragraphs + explicit page setup) | PR 1 | — | — | — | clean (identity + PDF probes, 2026-06-11) |
| `generation-phase2-styled.docx` (named style + run formatting + tabs/indent/justify) | PR 2 | — | — | — | clean (identity + PDF probes, 2026-06-11) |
| `generation-phase3-cover-body.docx` (titlePg cover header → body header, Page X of Y field footer, page break) | PR 3 | — | — | — | clean (identity + PDF probes, 2026-06-11) |
| `generation-phase4-tables.docx` (fixed-grid bordered table, shaded merged header row, repeating-header flag) | PR 4 | — | — | — | clean (identity + PDF probes, 2026-06-11) |
| `generation-phase5-numbering-recipes.docx` (three-level legal numbering, cover-terms recipe table, signature blocks) | PR 5 | — | — | — | clean (identity + PDF probes, 2026-06-11) |
| `generation-phase6-drafting-notes.docx` (anchored comments with commentsExtended/people ancillary parts) | PR 6 | — | — | — | clean (identity + PDF probes, 2026-06-11) |

## Per-reader notes

### Word for Mac
_(none yet)_

### Pages
_(none yet)_

### Google Docs import
_(none yet)_

### LibreOffice
- PR 1: identity load→save and PDF conversion exercised automatically by
  `generation-package-structure.test.ts` when a local `soffice` binary exists.
- PR 7 (2026-06-11, LibreOffice headless on macOS): all six artifact classes
  pass the identity probe (load → re-save as .docx → reload via DocxDocument
  with paragraph content intact) and convert to non-empty PDFs. No dialogs, no
  content loss observed. Word for Mac, Pages, and Google Docs cells remain
  open for manual observation — they cannot be automated honestly from this
  environment.
