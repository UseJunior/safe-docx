## 1. Spec

- [x] 1.1 Add the `Two-column signature block layout` requirement with scenario
      `SDX-GEN-109` and the `Paragraph keep-lines pagination` requirement with
      scenario `SDX-GEN-108` to the `docx-generation` delta (one `## ADDED
      Requirements` section, two `### Requirement:` blocks).

## 2. Paragraph keep-lines

- [x] 2.1 Add `keepLines?: boolean` to `ParagraphSpec` and `W.keepLines` to the
      namespace map.
- [x] 2.2 Add `keepLines` to the `ParagraphProps` pick and emit `w:keepLines`
      after `w:keepNext` in `buildParagraphPropsElement` (ordered by
      `PPR_ORDER`).

## 3. Two-column signature recipe

- [x] 3.1 Add optional `layout`, `totalWidthTwips`, `gutterTwips`,
      `headerColorHex`, and `ruledLineLabels` controls to `signatureBlock`.
- [x] 3.2 Build the two-column path as a 3-column grid of signer cells (centered
      uppercase muted header + nested ruled-field table, Print Name/Title
      pre-filled) with a padding cell for odd counts, composing only the
      existing table/paragraph/run grammar, without changing the single-column
      default.

## 4. Tests

- [x] 4.1 Add `generation-keep-lines.test.ts` and
      `generation-two-column-signature.test.ts`, both with
      `TEST_FEATURE = 'add-signature-and-keeplines'` and `.openspec` scenarios
      `[SDX-GEN-108]` / `[SDX-GEN-109]`.
- [x] 4.2 Assert keepLines emission order, absence when unset, and style-level
      emission; assert the two-column grid columns, caps/muted header,
      pre-filled Print Name/Title with blank ruled Signature/Date, odd-count
      padding cell, no VML, structural validity, and single-column default
      compatibility.

## 5. Verify

- [ ] 5.1 Focused package build/test, spec coverage, conformance-citation check,
      workspace lint, conformance-doc, and strict OpenSpec validation pass.
- [ ] 5.2 Real-DOCX visual confirm in Word for Mac (keep-lines block near a page
      break + odd-count two-column signature open without a repair dialog).
