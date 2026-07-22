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
observation that the banner is gone. Pages and Google Docs retain the dated
`#482` observations below as historical evidence; they have not been rerun on
the `#487` bytes.

| Artifact | Emitter revision | Word for Mac | Pages | Google Docs import | LibreOffice |
|---|---|---|---|---|---|
| `generation-phase1-minimal.docx` (plain paragraphs + explicit page setup) | #487 (+ compat settings) | — | clean (#482 bytes, 2026-07-06) | clean (#482 bytes, 2026-07-07) | clean (identity + PDF probes, 2026-07-22) |
| `generation-phase2-styled.docx` (named style + run formatting + tabs/indent/justify) | #487 (+ compat settings) | — | clean (#482 bytes, 2026-07-06) | clean (#482 bytes, 2026-07-07) | clean (identity + PDF probes, 2026-07-22) |
| `generation-phase3-cover-body.docx` (titlePg cover header → body header, Page X of Y field footer, page break) | #487 (+ compat settings) | — | clean (#482 bytes, 2026-07-06) | clean (#482 bytes, 2026-07-07) | clean (identity + PDF probes, 2026-07-22) |
| `generation-phase4-tables.docx` (fixed-grid bordered table, shaded merged header row, repeating-header flag) | #487 (+ compat settings) | — | clean (#482 bytes, 2026-07-06) | clean (#482 bytes, 2026-07-07) | clean (identity + PDF probes, 2026-07-22) |
| `generation-phase5-numbering.docx` (three-level legal numbering through the document façade) | #487 (+ compat settings) | — | clean (#482 bytes, 2026-07-06) | clean (#482 bytes, 2026-07-07) | clean (identity + PDF probes, 2026-07-22) |
| `generation-phase6-drafting-notes.docx` (anchored comments with commentsExtended/people ancillary parts) | #487 (+ compat settings) | — | clean (#482 bytes, 2026-07-06) | clean (#482 bytes, 2026-07-07) | clean (identity + PDF probes, 2026-07-22) |

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
- #487 (implementation): `generateDocx` now emits a baseline `word/settings.xml`
  on every package with a `w:compat` → `compatibilityMode=15` compatSetting.
  Word-for-Mac cells above are reset to `—` pending the manual re-check that the
  Compatibility-Mode banner is gone AND no repair dialog appears — re-run
  `~/.claude/skills/word-fidelity-check/probe.sh --screenshots
  packages/docx-core/src/testing/outputs/generation-phase*.docx`.

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
  and PDF probes passed against the new bytes (no dialogs, no content loss).
  Gating caveat: those probes are gated **only** on `resolveSoffice()`
  (`const describeProbes = soffice ? describe : describe.skip`), so they run
  whenever a `soffice` binary is present. Headless `soffice` on macOS is
  intermittently unusable (an `Abort trap: 6` crash was observed in a parallel
  run); when the binary is present but crashes, these two probes **fail rather
  than skip** — so a red identity/PDF result there is the known `soffice` flake,
  not a generation regression (re-run to confirm). CI installs no `soffice`, so
  `resolveSoffice()` is null and the probes skip; this remains a local-only
  signal. (A future hardening could gate on `probeSofficeUsable()` too, so an
  installed-but-crashing binary skips instead of failing.)
- #487 (2026-07-22, LibreOffice headless on macOS): all six deterministic
  compatibility-settings artifacts passed both load→save identity and PDF
  conversion. The first parallel test attempt hit the documented macOS
  `Abort trap: 6`; the isolated retry passed, followed by a sequential all-six
  artifact run with non-empty DOCX and PDF outputs.
