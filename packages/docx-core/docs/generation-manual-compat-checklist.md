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

Emitter revision `#482` ships the standard ancillary parts
(`theme/theme1.xml`, `fontTable.xml`, `webSettings.xml`) on every artifact (the
emission itself landed in #485). The manual cells below were refreshed against a
regeneration of that package shape on 2026-07-06 (`#482`): Word for Mac and Pages
are observed directly; Google Docs is imported via Drive conversion.

| Artifact | Emitter revision | Word for Mac | Pages | Google Docs import | LibreOffice |
|---|---|---|---|---|---|
| `generation-phase1-minimal.docx` (plain paragraphs + explicit page setup) | #482 (+ ancillary parts) | clean (2026-07-06) | clean (2026-07-06) | clean (2026-07-07) | clean (identity + PDF probes, 2026-07-06) |
| `generation-phase2-styled.docx` (named style + run formatting + tabs/indent/justify) | #482 (+ ancillary parts) | clean (2026-07-06) | clean (2026-07-06) | clean (2026-07-07) | clean (identity + PDF probes, 2026-07-06) |
| `generation-phase3-cover-body.docx` (titlePg cover header → body header, Page X of Y field footer, page break) | #482 (+ ancillary parts) | clean (2026-07-06) | clean (2026-07-06) | clean (2026-07-07) | clean (identity + PDF probes, 2026-07-06) |
| `generation-phase4-tables.docx` (fixed-grid bordered table, shaded merged header row, repeating-header flag) | #482 (+ ancillary parts) | clean (2026-07-06) | clean (2026-07-06) | clean (2026-07-07) | clean (identity + PDF probes, 2026-07-06) |
| `generation-phase5-numbering.docx` (three-level legal numbering through the document façade) | #482 (+ ancillary parts) | clean (2026-07-06) | clean (2026-07-06) | clean (2026-07-07) | clean (identity + PDF probes, 2026-07-06) |
| `generation-phase6-drafting-notes.docx` (anchored comments with commentsExtended/people ancillary parts) | #482 (+ ancillary parts) | clean (2026-07-06) | clean (2026-07-06) | clean (2026-07-07) | clean (identity + PDF probes, 2026-07-06) |

## Per-reader notes

### Word for Mac
- #485 (2026-06-13, Microsoft Word for Mac 16.x): with the ancillary parts
  present, all six artifact classes open **clean — no repair/recovery dialog**,
  verified programmatically (System Events: `count documents` = 1, zero alert
  sheets / `AXDialog` windows) and visually (full-screen `screencapture` — plain
  text, the bordered/shaded table, three-level numbering, and the two anchored
  comments all render as specified). This settled the "if Word repairs"
  hypothesis: with the parts present, Word for Mac does not repair.
- #482 (2026-07-06, Microsoft Word for Mac 16.x): re-verified on a fresh
  regeneration of all six artifacts (`word-fidelity-check` background probe) —
  every file still loads with **no repair/recovery dialog** (probe exit 0). The
  package shape is unchanged from #485, so the prior visual pass stands.
- Follow-up (not a #482 defect): Word opens the documents in **Compatibility
  Mode** because generation does not emit a `w:compat` →
  `compatibilityMode=15` `compatSetting` in `word/settings.xml`. That banner is
  cosmetic (not a repair). Tracked separately in #487.

### Pages
- #482 (2026-07-06, Apple Pages 15.1.1): all six artifact classes **import
  clean — no import-warnings window and no dialog** (AppleScript probe: front
  document present, zero sheets, no window named "Document Warnings"; PDF export
  succeeded for every file). Rendering confirmed from the Pages PDF export:
  - phase3 — the `titlePg` cover header (`CONFIDENTIAL — DRAFT`) hands off to the
    body header (`Acme / Northeast — Mutual NDA`), and the `Page X of Y` field
    footer evaluates correctly (`Page 2 of 2`).
  - phase4 — the bordered table renders with its shaded merged header row
    (`Key Terms`) intact.
  - phase5 — three-level legal numbering renders with correct
    `1. / 1.1. / 2.` labels and indentation.
  - phase6 — both anchored comments import (Pages shows a "2 Comments" indicator
    with the markers anchored to the correct ranges), Times New Roman applied,
    Track Changes preserved.

### Google Docs import
- #482 (2026-07-07, Google Docs import via Drive conversion): each `.docx` was
  uploaded to Drive and converted to `application/vnd.google-apps.document` (the
  real Google Docs import path). All six artifact classes convert **without an
  import error and with content intact**, confirmed by reading the converted
  document back (and, for the table, a browser screenshot of the rendered Google
  Doc):
  - phase1 / phase2 — plain and styled paragraphs import; the styled run
    formatting (bold heading, bold-italic run) survives conversion.
  - phase3 — the cover title and body text import; the `titlePg` header/footer
    parts convert without error (Google Docs holds headers/footers outside the
    body text stream).
  - phase4 — the bordered table imports as a native Google Docs table with its
    shaded merged header row (`Key Terms` spanning both columns) and the
    `Effective Date` / `Term` rows intact.
  - phase5 — the three-level legal numbering imports as a native multilevel list
    (`Definitions` → `Confidential Information …` → `Obligations`) with the
    trailing execution paragraph.
  - phase6 — **both anchored comments import into Google Docs' native comment
    system**, preserving author (`John Smith`, `Jane Doe`), body text, and the
    anchored ranges (`Confidentiality survives three years.` /
    `Governing law: Delaware.`).

### LibreOffice
- PR 1: identity load→save and PDF conversion exercised automatically by
  `generation-package-structure.test.ts` when a local `soffice` binary exists.
- PR 7 (2026-06-11, LibreOffice headless on macOS): all six artifact classes
  pass the identity probe (load → re-save as .docx → reload via DocxDocument
  with paragraph content intact) and convert to non-empty PDFs.
- #482 (2026-07-06, LibreOffice headless on macOS): re-run after regenerating the
  ancillary-parts package shape — `generation-package-structure.test.ts` identity
  and PDF probes pass against the new bytes (no dialogs, no content loss). Note:
  headless `soffice` is occasionally flaky (an `Abort trap: 6` was observed in a
  parallel run); the probe skips/fails-soft when the binary is unusable, and CI
  has no `soffice`, so this remains a local-only signal.
