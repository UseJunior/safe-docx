# Change: DOCX → ODT conversion phase 3 — richer style fidelity

## Why

The lossiness telemetry from the phase 1+2 converter (#401) shows font face/size/color runs are
by far the dominant fidelity gap on real documents: converting the NVCA COI drops 185 `<font …>`
runs and the Common Paper NDA drops 32. Paragraph alignment/indents are already carried by the
document view but unused by the converter; heading styles use generic template sizes instead of
the source's; non-yellow highlights normalize to yellow; tables get a uniform invented border;
and text-empty spacing paragraphs are dropped. Issue #406 covers all six classes.

## What Changes

- Map full-mode `<font color size face>` TOON tags to ODF automatic text styles
  (`fo:color`, `fo:font-size`, `style:font-name`) with `office:font-face-decls` entries,
  removing the `font-formatting-dropped` lossiness class.
- Emit automatic paragraph styles carrying `fo:text-align` / `fo:margin-left` / `fo:text-indent`
  from the view's `paragraph_alignment` + `paragraph_indents_pt` (alignment only on list items,
  where the list nesting already supplies indentation).
- Seed `styles.xml` named styles (`Heading_20_1..6`, `Standard`) from the source document's
  style definitions instead of the fixed template.
- Enrich full-mode TOON highlight tags with the source `w:highlight` value
  (`<highlight color="green">`) and map the ECMA-376 highlight palette to ODF
  `fo:background-color` hex values. Compact-mode TOON output is unchanged.
- Read `w:tblBorders` / `w:tblGrid` from the source table directly: borderless tables stay
  borderless, declared border size/color is honored, and `table:table-column` widths follow
  the source grid.
- Preserve text-empty body-level paragraphs (vertical spacing) as empty `text:p` elements
  instead of reporting them dropped; anything else the view fails to surface stays reported.
- docx-core additions in service of the above: `DocxDocument.getStylesModel()`,
  `extractStyleRunFormatting` (tri-state style-chain run formatting), and the full-mode
  highlight value plumbing.

## Impact

- Affected specs: `odf-core` (conversion fidelity scenarios CONV-14..CONV-19),
  `docx-primitives` (full-mode highlight tag value, style-chain formatting extraction)
- Affected code: `packages/odf-core/src/convert/**`,
  `packages/docx-core/src/primitives/{formatting_tags,semantic_tags,styles,document,document_view-comments,serialize_html}.ts`
- Ref: #406 (phase 3), #331 (phasing), #401 (phases 1+2)
