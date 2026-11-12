## 1. Generation

- [x] 1.1 Add `DocumentSpec.compatibility.doNotExpandShiftReturn`, validate
      it as an object of known boolean settings, and emit
      `w:doNotExpandShiftReturn` before the `compatibilityMode` setting in
      `w:compat` (`SDX-GEN-135`).

## 2. Creation grammar and rendering

- [x] 2.1 Admit `{% paragraph-layout %}` with `align`, `indent-left` and `indent-hanging`
      from closed lists; fail closed with `INVALID_PARAGRAPH_LAYOUT`
      (`SDX-MDOC-PARALAYOUT-01`, `-03`).
- [x] 2.2 Render each content paragraph as a body paragraph with direct
      `w:jc` and `w:ind` (`SDX-MDOC-PARALAYOUT-01`).
- [x] 2.3 Set `doNotExpandShiftReturn` on every created document
      (`SDX-MDOC-PARALAYOUT-04`).

## 3. Verification

- [x] 3.1 Project each paragraph's direct layout in the lowering and read it
      back from `w:pPr`, with a negative control (`SDX-MDOC-PARALAYOUT-02`).
- [x] 3.2 Project the layout of each `{% paragraph-layout %}` paragraph straight from the
      source and compare it with the laid-out paragraphs of the DOCX, with
      negative controls (`SDX-MDOC-PARALAYOUT-02`).
- [x] 3.3 Map `{% paragraph-layout %}` paragraphs in `pull` (`SDX-MDOC-PARALAYOUT-05`).

## 4. Documentation and validation

- [x] 4.1 Document `{% paragraph-layout %}` and the compatibility setting in the
      docx-markdoc README, CLI help and changelog; add the ECMA-376 registry
      entries for §17.3.1.12 and §17.15.3.5.
- [x] 4.2 Render a realistic agreement through `create --require-pdf` and
      check the PDF word boxes and the emitted-document schema gate.
- [x] 4.3 Run focused package tests, `openspec validate --strict` and the
      repository pre-submit chain.
