## ADDED Requirements

### Requirement: DOCX to ODT conversion

`@usejunior/odf-core` SHALL export `convertDocxToOdt(docx: Buffer, options?)` returning
`{ odt: Buffer, lossiness: LossinessEntry[] }`. The conversion SHALL be native (no external binary
at runtime) and semantic: it traverses the docx-core document view
(`buildDocumentView({ showFormatting: true, formattingMode: 'full' })`) and emits a fresh ODT
package. Constructs without a mapped equivalent SHALL be downgraded and recorded in the lossiness
report, never dropped silently.

The produced package SHALL satisfy ODF packaging rules: `mimetype` first and STORED, a complete
`META-INF/manifest.xml`, `office:version="1.3"` document roots, and a passing
`validateOdfArchiveSafety`. Visible body text SHALL be preserved, including multi-space runs and
tabs (`text:s`/`text:tab`). Word-style headings SHALL become `text:h` with the mapped outline
level; bold/italic/underline runs SHALL become `text:span`s referencing deduped automatic styles;
hyperlinks SHALL become `text:a` with an XML-unescaped `xlink:href` vetted by the shared href
safety check. Auto-numbered and bullet lists SHALL become nested `text:list` structures with
synthesized `text:list-style`s; manually-labelled (legal-numbered) paragraphs SHALL keep their
literal label as plain paragraph text. Tables SHALL become `table:table` with a complete
rectangular grid.

#### Scenario: [CONV-01] Conversion produces a safe, valid ODT package
- **WHEN** a `.docx` buffer is converted
- **THEN** the output's first ZIP entry is an uncompressed `mimetype` of `application/vnd.oasis.opendocument.text`, `META-INF/manifest.xml` enumerates every part, and `validateOdfArchiveSafety` returns `ok: true`

#### Scenario: [CONV-02] Body paragraph visible text is preserved
- **WHEN** a `.docx` with plain body paragraphs (including multi-space runs and tabs) is converted
- **THEN** the `.odt` paragraphs' visible text (with `text:s`/`text:tab` expanded) matches the source paragraphs' visible text

#### Scenario: [CONV-03] Word-style headings become text:h with mapped outline level
- **WHEN** a paragraph styled `Heading1`..`Heading6` (and one heuristic title paragraph) is converted
- **THEN** the Word-style headings emit `<text:h text:outline-level="1..6">` referencing `Heading_20_N` styles while the heuristic title remains a `text:p`

#### Scenario: [CONV-04] Bold, italic, and underline runs become deduped text:span styles
- **WHEN** runs carrying bold, italic, underline, and nested combinations (e.g. bold+italic) are converted
- **THEN** each formatted run is wrapped in `text:span` referencing an automatic style whose `style:text-properties` carry the matching `fo:font-weight`/`fo:font-style`/`style:text-underline-style`, and identical format sets share one style name

#### Scenario: [CONV-05] Hyperlinks become text:a and unsafe schemes degrade
- **WHEN** a run inside a `w:hyperlink` with an `https:` target and another with a `javascript:` target are converted
- **THEN** the safe link becomes `<text:a xlink:type="simple" xlink:href="…">` with the URL not double-escaped, and the unsafe link degrades to plain text with a lossiness entry

#### Scenario: [CONV-06] Auto-numbered lists become nested text:list with mapped number formats
- **WHEN** auto-numbered paragraphs spanning multiple `ilvl` levels (including a level jump) and OOXML `numFmt` values `decimal`/`lowerLetter`/`upperRoman` are converted
- **THEN** the output nests `text:list`/`text:list-item` to the matching depth without malformed structure, and the synthesized `text:list-style` levels carry `style:num-format` `1`/`a`/`I` respectively

#### Scenario: [CONV-07] Bullet lists become text:list with a bullet list style
- **WHEN** bullet-list paragraphs are converted
- **THEN** they emit `text:list` items whose list style uses `text:list-level-style-bullet`

#### Scenario: [CONV-08] Manual and legal list labels stay literal paragraph text
- **WHEN** paragraphs with manual labels (e.g. `Section 2.1`, `(a)`) that are not auto-numbered are converted
- **THEN** they emit plain `text:p` elements whose visible text includes the literal label, and no `text:list` wraps them

#### Scenario: [CONV-09] Tables become a complete rectangular grid
- **WHEN** a table with header rows, a multi-paragraph cell, and grid gaps is converted
- **THEN** the output `table:table` declares the full column count, leading header rows sit in `table:table-header-rows`, grid gaps are filled with empty cells (recorded in the lossiness report), and the multi-paragraph cell keeps separate `text:p` children

#### Scenario: [CONV-10] Dropped constructs are reported, not silent
- **WHEN** a document containing unmappable constructs (e.g. font/color formatting, grid gaps) is converted
- **THEN** the result's `lossiness` array names each downgraded construct with a count

#### Scenario: [CONV-11] Converted output reopens through odf-core with matching text
- **WHEN** the converted buffer is reloaded via `OdfArchive.load` and `OdfDocument.fromContentXml`
- **THEN** loading succeeds and `getParagraphs()` visible text matches the source document's visible text

#### Scenario: [CONV-12] A real contract document converts end-to-end
- **WHEN** the bundled NVCA `.docx` fixture (and the open-agreements NDA fixtures) are converted
- **THEN** each output passes `validateOdfArchiveSafety`, reopens via `OdfDocument`, and its visible text matches the source document view's visible text

#### Scenario: [CONV-13] Output structurally agrees with a LibreOffice-converted reference
- **WHEN** LibreOffice is available and usable (a trivial preflight oracle job succeeds) and the same `.docx` is converted both natively and via the LibreOffice oracle
- **THEN** the two `.odt` outputs agree on visible text and paragraph/heading/list/table structure; when soffice is absent or the preflight probe fails, the test skips with a logged warning instead of failing
