## ADDED Requirements

### Requirement: DOCX to ODT conversion style fidelity

`convertDocxToOdt` SHALL map the style classes the phase 1+2 converter downgraded, removing
their lossiness entries on documents where the source data is available. Font face, size, and
color runs SHALL become deduped automatic text styles (`style:font-name`, `fo:font-size`,
`fo:color`) with every used font face declared in `office:font-face-decls`. Paragraph alignment
and indentation from the document view SHALL become deduped automatic paragraph styles
(`fo:text-align`, `fo:margin-left`, `fo:text-indent`); list-item paragraphs receive alignment
only. Named heading styles and `Standard` in `styles.xml` SHALL be seeded from the source
document's style definitions when present. Highlight runs SHALL carry the source highlight
color mapped from the ECMA-376 palette rather than normalizing to yellow. Table cell borders
SHALL honor an explicit `w:tblBorders` (including explicitly borderless tables) and
`table:table-column` widths SHALL follow `w:tblGrid`. Text-empty body-level paragraphs SHALL be
preserved as empty `text:p` elements; any paragraph the view fails to surface that is not a
text-empty body paragraph remains reported in the lossiness report.

#### Scenario: [CONV-14] Font face, size, and color runs become automatic text styles
- **WHEN** runs carrying `w:rFonts`/`w:sz`/`w:color` (e.g. 22pt Georgia, red text) are converted in full formatting mode
- **THEN** each run is wrapped in a `text:span` whose automatic style carries the matching `style:font-name`, `fo:font-size` (points), and `fo:color` (`#RRGGBB`), every used face is declared in `office:font-face-decls`, identical font tuples share one style, and no `font-formatting-dropped` lossiness entry is reported

#### Scenario: [CONV-15] Paragraph alignment and indentation become automatic paragraph styles
- **WHEN** paragraphs with center/right/justify alignment and left or first-line indents are converted
- **THEN** each emits a `text:p` referencing an automatic paragraph style with the mapped `fo:text-align` (`center`/`end`/`justify`) and `fo:margin-left`/`fo:text-indent` in points, deviating-format paragraphs share deduped styles, and default left-aligned unindented paragraphs keep the plain named style

#### Scenario: [CONV-16] Named styles are seeded from the source document
- **WHEN** a source whose `styles.xml` defines `Heading1` (e.g. 20pt, non-bold, colored) and `Normal` (e.g. 11pt Georgia) is converted
- **THEN** the output `styles.xml` `Heading_20_1` carries the source font size, weight, and color, `Standard` carries the source body font, and properties the source style chain does not specify fall back to the template defaults

#### Scenario: [CONV-17] Highlight colors are preserved
- **WHEN** runs highlighted `green` and `cyan` are converted
- **THEN** their `text:span` automatic styles carry `fo:background-color` `#00ff00` and `#00ffff` respectively instead of normalizing to yellow

#### Scenario: [CONV-18] Table borders and column widths follow the source
- **WHEN** a table with explicit `w:tblBorders` set to `none` and a `w:tblGrid` with unequal column widths is converted alongside a table with a declared 1pt border
- **THEN** the borderless table's cell style carries `fo:border="none"`, the bordered table's cell style carries the declared width and color, and `table:table-column` elements reference automatic styles whose `style:column-width` matches the source grid proportions in points

#### Scenario: [CONV-19] Text-empty body paragraphs are preserved as spacing
- **WHEN** a document with text-empty paragraphs between body paragraphs (leading, mid-document, and trailing) is converted
- **THEN** each body-level empty paragraph emits an empty `text:p` at its source position and no `unsurfaced-paragraphs-dropped` entry is reported
