## 1. Spec

- [ ] 1.1 Add the `Standard ancillary parts` requirement with scenario
      `SDX-GEN-093` to the `docx-generation` delta.

## 2. Emitters

- [ ] 2.1 Add `emit/theme-part.ts` emitting `word/theme/theme1.xml` (canonical
      Office theme: clrScheme + fontScheme + complete fmtScheme).
- [ ] 2.2 Add `emit/font-table-part.ts` emitting `word/fontTable.xml`, enumerating
      the distinct fonts the spec references (styles, runs, numbering) plus the
      Calibri default.
- [ ] 2.3 Add `emit/web-settings-part.ts` emitting `word/webSettings.xml`
      (`optimizeForBrowser` + `allowPNG`).
- [ ] 2.4 Wire all three into `compile.ts` after `emitSettingsPartIfNeeded` and
      before `emitPackageParts`.

## 3. Tests

- [ ] 3.1 Add `packages/docx-core/src/generation/generation-ancillary-parts.test.ts`
      with `TEST_FEATURE = 'add-generation-ancillary-parts'` and `.openspec` ID
      `[SDX-GEN-093]`.
- [ ] 3.2 Assert all three parts present, content types + resolving rels, structural
      checks pass, well-formedness (theme schemes, font enumeration, webSettings),
      and round-trip preservation through `DocxDocument.load`/`toBuffer` and
      `compareDocuments(gen, gen)`.

## 4. Matrix

- [ ] 4.1 Bump the emitter revision in `generation-manual-compat-checklist.md`; add
      dated LibreOffice + Word-for-Mac notes; leave manual cells `—`.

## 5. Verify

- [ ] 5.1 `openspec validate add-generation-ancillary-parts --strict` passes.
- [ ] 5.2 Regenerate output fixtures (`SDX_WRITE_OUTPUT_FIXTURES=1`).
- [ ] 5.3 `npm run build`, `npm run test:run`, `npm run check:spec-coverage`
      (incl. `check:spec-coverage-generation` for this feature) pass.
