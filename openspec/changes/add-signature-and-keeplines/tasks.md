> Note: the two-column signature tasks were dropped — that recipe was removed in
> `remove-agreement-domain-recipes`. Only the keep-lines work remains.

## 1. Spec

- [x] 1.1 Add the `Paragraph keep-lines pagination` requirement with scenario
      `SDX-GEN-108` to the `docx-generation` delta.

## 2. Paragraph keep-lines

- [x] 2.1 Add `keepLines?: boolean` to `ParagraphSpec` and `W.keepLines` to the
      namespace map.
- [x] 2.2 Add `keepLines` to the `ParagraphProps` pick and emit `w:keepLines`
      after `w:keepNext` in `buildParagraphPropsElement` (ordered by
      `PPR_ORDER`).

## 3. Tests

- [x] 3.1 Add `generation-keep-lines.test.ts` with
      `TEST_FEATURE = 'add-signature-and-keeplines'` and `.openspec` scenario
      `[SDX-GEN-108]`.
- [x] 3.2 Assert keepLines emission order, absence when unset, and style-level
      emission.

## 4. Verify

- [ ] 4.1 Focused package build/test, spec coverage, workspace lint, and strict
      OpenSpec validation pass.
