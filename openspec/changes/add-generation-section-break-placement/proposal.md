# Change: Bind a section break to the section's last paragraph

## Why

`generateDocx` ends every non-final section with a dedicated empty paragraph
that holds the section's `w:sectPr`. That is what Word's Insert → Section Break
writes. In a generated instrument, though, it is an extra empty paragraph that
the source never asked for: a text read-back against the source finds a
paragraph the source does not have, and the brownfield `docx-markdoc import`
scaffold anchors an empty paragraph an author never wrote. A resolution whose
signature page is its own section, the main case in #1162, needs a section
break that adds no paragraph, which is how the per-matter python-docx renderer
places it. In LibreOffice 25.8, both placements paginate identically, so this
change makes no pagination claim.

## What Changes

- Add `SectionSpec.breakPlacement?: 'ownParagraph' | 'lastParagraph'`.
  - `'ownParagraph'` is the default and keeps today's output.
  - `'lastParagraph'` binds the `w:sectPr` as the last `w:pPr` child of the
    section's final paragraph, creating the `w:pPr` when the paragraph has
    none.
- Reject `'lastParagraph'` on a non-final section that is empty or ends with a
  table: a paragraph-level `w:sectPr` cannot sit on a table. The final
  section's properties always bind at body level, so the field has no effect
  there.
- Add scenario `SDX-GEN-111`.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement).
- Affected code: `packages/docx-core/src/generation/types.ts`,
  `emit/document-part.ts`, `validate-spec.ts`, and
  `generation-section-break-placement.test.ts`.
- Output for specs that do not set `breakPlacement` is unchanged.
