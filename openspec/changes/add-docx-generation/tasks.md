# Tasks: add-docx-generation

Each numbered section is one phase PR (`Ref: #280`); the final phase closes with
`Fixes: #280`. Every phase runs the full pre-submit gate plus
`node packages/docx-core/scripts/validate_generation_openspec_coverage.mjs --feature add-docx-generation --report-only`
and `openspec validate add-docx-generation --strict`.

## 1. Skeleton + spec plumbing (PR 1) — scenarios SDX-GEN-001..003, 010..013, 020, 090, 091
- [x] 1.1 OpenSpec change directory (proposal, design, tasks, full docx-generation delta)
- [x] 1.2 `src/generation/types.ts` — complete DocumentSpec type surface (plain data, discriminated unions, unit-suffixed numbers)
- [x] 1.3 `validate-spec.ts` (referential integrity + reject-unimplemented), `context.ts`, `ordering.ts` (+ `appendInOrder` throw-on-unknown)
- [x] 1.4 `compile.ts` + minimal emitters: document part, paragraph, text runs, single-section `pgSz`/`pgMar`, package parts ([Content_Types].xml first, rels, docProps)
- [x] 1.5 `structural-checks.ts`: `auditSectPr` component + required-final-body-sectPr + package closure (owning-part-relative targets, skip External) + `<?xml` prefix check
- [x] 1.6 Full-package LibreOffice probe helper (identity load→save + `--convert-to pdf`), local-only skip
- [x] 1.7 `validate_generation_openspec_coverage.mjs` (delta discovery, generation scan roots, `--report-only`), npm script `check:spec-coverage-generation`, root chain wiring without `--strict`
- [x] 1.8 Conformance registry entries for sections cited by PR 1 emitters (verified against vendored spec/XSDs)
- [x] 1.9 PR 1 tests (`TEST_FEATURE = 'add-docx-generation'`) + `docs/generation-manual-compat-checklist.md` + review artifacts

## 2. Run/paragraph formatting + styles emission (PR 2) — SDX-GEN-004, 040..043
- [x] 2.1 `emit/styles-part.ts` (docDefaults, Normal, StyleSpec[])
- [x] 2.2 Full RunProps via `RPR_ORDER`; paragraph pPr (alignment/spacing/indent/tabs) via `PPR_ORDER`
- [x] 2.3 XSD relative-order cross-check test; registry entries for styles/rPr/pPr sections

## 3. Sections, headers/footers, fields, page numbering (PR 3) — SDX-GEN-021..024, 030..032
- [x] 3.1 `emit/header-footer-part.ts` + reference wiring + content types + `w:titlePg`
- [x] 3.2 Mid-document section-break paragraphs; `w:pgNumType`; settings.xml for even headers
- [x] 3.3 `FieldSpec` (PAGE/NUMPAGES, required cachedResult); cross-story field-pairing structural check
- [x] 3.4 Cover→body acceptance fixture; registry entries for sectPr/header/field sections

## 4. Tables (PR 4) — SDX-GEN-050..053
- [x] 4.1 `emit/table.ts`: tblPr/tblGrid/trPr/tcPr per schema order; blocks-in-cells with trailing `w:p`
- [x] 4.2 Grid-arithmetic validation (gridSpan/vMerge); table structural checks; registry entries

## 5. Numbering + recipes (PR 5, after PR 4) — SDX-GEN-060..062, 070, 071
- [x] 5.1 `emit/numbering-part.ts` (abstractNum/num, numeric id assignment); `w:numPr` wiring
- [x] 5.2 Label round-trip against the read-side list-label computation
- [x] 5.3 `recipes.ts` (`coverTermsTable`, `signatureBlock`) + recipe artifacts; registry entries

## 6. Drafting-note layer (PR 6) — SDX-GEN-080..083
- [x] 6.1 `emit/comments-part.ts` + anchors + `includeDraftingNotes` switch; deterministic ids/dates
- [x] 6.2 Resolve ancillary-part and content-type sub-decisions against a Word-authored document
- [x] 6.3 Body-identical-with/without test; post-hoc strip test via `deleteComment`

## 7. Compatibility sign-off + repositioning (PR 7, closes #280) — SDX-GEN-092
- [x] 7.1 Full manual matrix recorded for all artifact classes; public export from `src/index.ts`
- [x] 7.2 Repositioning sweep: README, site FAQ, docx-editing skill, AGENTS.md, LLM-gate prompt, conformance-registry prose
- [x] 7.3 Flip `check:spec-coverage-generation` to `--strict` on its own explicit invocation
- [x] 7.4 Follow-up issues: translated READMEs; ODT generation parity (odf-core)

## 8. Post-deploy
- [ ] 8.1 `openspec archive add-docx-generation --yes` (separate PR); fix stale package names in `openspec/project.md` opportunistically
