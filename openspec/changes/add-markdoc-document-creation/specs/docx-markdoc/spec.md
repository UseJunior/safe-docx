## ADDED Requirements

### Requirement: Markdoc document creation without a template

`docx-markdoc` SHALL create a new DOCX from a `.mdoc` source and an optional
house-style profile, without a template, by lowering a closed Markdoc grammar
onto `generateDocx` through the generic markdocx engine. Formatting SHALL
come from named paragraph styles over document defaults.

#### Scenario: [SDX-MDOC-CREATE-01] block grammar lowers to named styles over house defaults
- **GIVEN** a source with a title, headings, body paragraphs, a quote, centred text, a legend and bold and italic runs
- **WHEN** it is created with the default profile
- **THEN** the document defaults SHALL pin Times New Roman 11pt on all four font channels with 8pt after and 1.15 line spacing
- **AND** each block SHALL reference its documented paragraph style, and body runs SHALL carry no direct font or size

#### Scenario: [SDX-MDOC-CREATE-02] only explicit fill-in markup is highlighted; bare brackets are literal
- **GIVEN** a paragraph with nested `{% fill %}` markup, a fill-in inside bold text, a quoted alteration `[t]he`, `[sic]`, a bracketed cross-reference, unbalanced brackets, and a legend containing brackets
- **WHEN** it is created with the default `fill-ins: markup`
- **THEN** each `{% fill %}` SHALL render as its text wrapped in brackets, with the brackets and text highlighted yellow, including nested and inside bold text
- **AND** every bare bracket SHALL be literal text, never highlighted and never an error, balanced or not
- **AND** `{% fill %}` inside `{% literal %}`, inside a legend, or with no text SHALL fail with `INVALID_FILL_IN`

#### Scenario: [SDX-MDOC-CREATE-02] fill-ins: brackets restores automatic bracket highlighting
- **GIVEN** frontmatter `fill-ins: brackets`
- **WHEN** a paragraph with nested brackets, brackets inside bold text, a legend and a `literal` tag is created
- **THEN** every character from an opening bracket to its matching closing bracket SHALL be highlighted, as in v0.24
- **AND** the legend and `literal` content SHALL carry no highlight
- **AND** an unbalanced bracket outside those exemptions SHALL fail with `UNBALANCED_FILL_IN` and a line number

#### Scenario: [SDX-MDOC-CREATE-03] unsupported and legacy syntax fails closed
- **GIVEN** sources containing a link, an image, a code span, an unknown tag, unknown frontmatter, an unclosed tag, inline HTML outside `{% literal %}`, a nested ordered list that does not start at 1, and whole-paragraph `<center>`, `<signer>` or `<!-- pagebreak -->` markup outside `{% literal %}`
- **WHEN** each is created
- **THEN** creation SHALL fail before writing any output, with a stable error code and the source line, and legacy markup SHALL name the Markdoc tag to use

### Requirement: Signature blocks, sections and footers

The creation grammar SHALL lay out signature blocks with a tab-aligned date
column and paragraph spacing rather than empty paragraphs, and SHALL create
next-page sections whose footers are either linked to the previous section or
unlinked with declared content.

#### Scenario: [SDX-MDOC-CREATE-04] signer blocks align dates without spacer paragraphs
- **GIVEN** a lead-in paragraph followed by two consecutive signers with dates
- **WHEN** it is created
- **THEN** each signer SHALL be one paragraph containing the signature line, a line break, the name, a tab and the date, with a left tab stop at the profile position
- **AND** the first signer SHALL have 42pt before and the second 30pt, both SHALL keep lines together, and the lead-in SHALL keep with next
- **AND** the document SHALL contain no empty paragraphs

#### Scenario: [SDX-MDOC-CREATE-05] sections carry linked or unlinked footers and page numbers
- **GIVEN** frontmatter `page-numbers: true`, a `section` tag with a footer, and a later `section` tag with no footer attributes
- **WHEN** it is created
- **THEN** the document SHALL have three sections, and each non-final `w:sectPr` SHALL sit on the last paragraph of its section
- **AND** the first footer SHALL contain a centred PAGE field, the second SHALL be unlinked with the declared centred italic text, and the third SHALL have no footer reference so it inherits the second
- **AND** a section declaring only `page-numbers=false` SHALL get an unlinked empty footer instead of inheriting

### Requirement: Lists and tables in created documents

The creation grammar SHALL bind ordered and bullet lists to real `w:numbering`
definitions and SHALL create rectangular tables.

#### Scenario: [SDX-MDOC-CREATE-06] ordered lists use legal multilevel numbering
- **GIVEN** a three-level nested ordered list, a second top-level list starting at 3, and a bullet list
- **WHEN** it is created
- **THEN** list paragraphs SHALL carry `w:numPr` and no literal number text
- **AND** the levels SHALL render `1.`, `(a)` and `(i)`, the second list SHALL start at 3, and the bullet list SHALL use a bullet format

#### Scenario: [SDX-MDOC-CREATE-07] tables lower with a repeated bold header row
- **GIVEN** a `table` tag with a header row, two body rows and `widths="30,70"`
- **WHEN** it is created
- **THEN** the table SHALL have a two-column grid split 30/70 of the text width, single borders, and a first row marked as a repeating header with bold text
- **AND** a ragged table SHALL fail with a line number

### Requirement: Verified creation output

Every creation SHALL verify its own output and SHALL publish no output when
any verification fails.

#### Scenario: [SDX-MDOC-CREATE-08] read-back, footer and determinism checks have negative controls
- **GIVEN** a source that uses every construct in the grammar
- **WHEN** it is created
- **THEN** the paragraph text read back from the DOCX bytes SHALL equal the plain-text projection of the lowered DocumentSpec, and the comparator SHALL reject a one-character perturbation of that projection
- **AND** the footer inventory SHALL equal its projection, and the comparator SHALL reject a perturbed footer
- **AND** a second compilation SHALL be byte-identical
- **AND** the certificate SHALL record the source, profile and output SHA-256 and every check outcome

#### Scenario: [SDX-MDOC-CREATE-09] a created document is a brownfield source
- **GIVEN** a created document
- **WHEN** it is imported with `docx-markdoc import` and a body paragraph is changed with a `change` block
- **THEN** every body paragraph SHALL be anchored and compilation SHALL produce a redline whose only revision is that change

#### Scenario: [SDX-MDOC-CREATE-10] the CLI writes docx, text mirror and certificate, and the PDF check is honest
- **GIVEN** the `create` command with an existing output directory
- **WHEN** it runs without `--replace` against existing outputs, including a stale PDF
- **THEN** it SHALL refuse and leave the existing files unchanged
- **AND** a failure while publishing SHALL leave every existing output byte-identical, and a file appearing at an output path during the build SHALL never be overwritten without `--replace`
- **AND** with `--replace` a stale artifact the build does not produce SHALL be removed
- **AND** an output that aliases an input through a symlinked directory or a hard link SHALL be refused
- **AND** a second run publishing to the same output directory and stem while one is active SHALL fail with `CREATION_LOCKED`, leaving the first run's outputs intact
- **AND** a rollback SHALL remove an output only if, when checked, its inode is that of the file this run staged, so a file another writer placed there earlier is kept, and an original that cannot be restored SHALL be kept in a named recovery directory rather than deleted
- **AND** a lock whose initialization fails SHALL be closed and removed, so the stem can be retried at once
- **AND** a successful run SHALL write `<stem>.docx`, `<stem>.txt` from the read-back, and `<stem>.verification.json`
- **AND** when LibreOffice or `pdftotext` is unavailable the PDF check SHALL be recorded as `not_run`, and `--require-pdf` SHALL make that a failure

#### Scenario: [SDX-MDOC-CREATE-11] the created DOCX re-imports to the source text, with negative controls
- **GIVEN** a source that uses every construct in the grammar
- **WHEN** it is created
- **THEN** the body and footer paragraphs of the DOCX re-imported through `docx-markdoc import` SHALL equal, after Unicode NFC and whitespace collapsing only, plain text read from the original Markdoc without the lowering or the DocumentSpec
- **AND** a deleted word, paragraph, table cell and footer text SHALL each be detected as negative controls
- **AND** a lowering that drops a paragraph, word, table cell or footer text from both the DocumentSpec and its projection SHALL fail this check while the read-back check passes, and the certificate SHALL record each mismatch with its source line and the missing and extra word spans

#### Scenario: [SDX-MDOC-CREATE-12] the PDF text layer matches the source word for word
- **GIVEN** a rendered PDF that passed the required-text check
- **WHEN** its text layer is aligned word by word with the source text
- **THEN** a missing source word SHALL fail with `CREATION_PDF_WORDS_MISMATCH`, including a word that also appears in a footer or next to a repeated copy of itself
- **AND** an extra word SHALL fail unless it is the page's declared footer text or page number at the start or end of the page, or a list number
- **AND** texts too different to align SHALL fail rather than pass
- **AND** a real LibreOffice PDF of every construct, including a table whose cells wrap, SHALL pass

#### Scenario: [SDX-MDOC-CREATE-13] a failed verification leaves a mismatch report and publishes nothing
- **GIVEN** a build whose verification finds a mismatch
- **WHEN** it fails
- **THEN** it SHALL publish nothing and leave every existing output, including `<stem>.verification.json`, byte-identical
- **AND** it SHALL write `<stem>.failed-verification.json` with the failing checks and mismatches, and the error SHALL name that path or say why it could not be written
- **AND** the next successful build SHALL remove the report
