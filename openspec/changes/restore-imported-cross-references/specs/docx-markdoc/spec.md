## MODIFIED Requirements

### Requirement: Cross-references in created documents

The creation grammar SHALL admit a `{% #id %}` annotation on a heading or list
item and an inline self-closing `{% xref to="id" /%}` tag with optional
`number="full" | "paragraph"` and `format="section"`. An id SHALL become a
bookmark on its paragraph. An xref SHALL become a REF field to a numbered list
item, showing the number Word shows. `docx-markdoc create` SHALL verify each
reference's number in its read-back, round-trip and PDF checks.

#### Scenario: [SDX-MDOC-XREF-01] ids and xref tags create bookmarks and REF fields with the numbers Word shows
- **GIVEN** a source with ids on a heading and on nested list items, and xrefs in both number forms, with `format="section"`, in a body paragraph, a table cell and a footnote
- **WHEN** the source is created
- **THEN** each id SHALL be a bookmark on its paragraph, named with hyphens mapped to underscores
- **AND** each xref SHALL be a ` REF <name> \w \h ` or ` REF <name> \n \h ` field whose cached result is the number Word shows (`2(a)(i)`, `(i)`, `2`)
- **AND** `format="section"` SHALL write `Section ` as literal text before the field
- **AND** the read-back SHALL read each field as its cached result and record where it sits, its instruction and each bookmark's paragraph, and the certificate SHALL pass, with a cross-reference check whose negative controls are detected
- **AND** a list's 28th nested item SHALL be referenced as `(bb)`
- **AND** a source without ids or xrefs SHALL produce no bookmark

#### Scenario: [SDX-MDOC-XREF-02] malformed ids and cross-references fail closed with a code and a line
- **GIVEN** sources with an xref to an unknown id, to a heading, to a bullet item, a duplicated id, an id that is not kebab-case, an id on a plain paragraph, an unknown `number` or `format`, an xref with content or without `to`, and an xref inside `{% fill %}` or `{% literal %}`
- **WHEN** each is created
- **THEN** creation SHALL fail before writing any output, with `XREF_UNKNOWN_ID`, `XREF_TARGET_NOT_NUMBERED`, `DUPLICATE_ID`, `INVALID_ID`, `ID_PLACEMENT` or `INVALID_CROSS_REFERENCE`, and with the source line where the error is
- **AND** the message for an unknown id SHALL name the id
- **AND** a source holding a C0 control character other than tab, line feed or carriage return SHALL fail with `INVALID_CHARACTER` and its line

#### Scenario: [SDX-MDOC-XREF-03] verification checks each cross-reference's number and destination against the source
- **GIVEN** a created document, and the same source built through lowerings that point a reference at the wrong item, at another item showing the same number, change its number switch where both forms show the same number, move a bookmark to another paragraph, or move the field onto an equal literal number elsewhere
- **WHEN** each is verified
- **THEN** the first SHALL pass
- **AND** a wrong number SHALL pass the read-back check but fail the round trip, which numbers the targets from the source
- **AND** each of the others SHALL fail the cross-reference check, which compares every REF instruction and where it sits (story, paragraph and the text either side) with the `{% xref /%}` it came from, and every named bookmark's paragraph with the item marked with that id, although the document's text is unchanged
- **AND** a target item that holds a footnote reference SHALL compare by its text without the note
- **AND** every xref tag in the source's syntax tree SHALL be counted, so a tag the source text walker never reached would fail the build; a tag after a signer's name, which the signature block never rendered, SHALL be refused with `INVALID_SIGNER` before anything is built

#### Scenario: [SDX-MDOC-XREF-04] the PDF checks expect the number as LibreOffice renders it
- **GIVEN** a source with full-context references to nested list items
- **WHEN** its PDF expectations are projected
- **THEN** the word check and the required-text needles SHALL expect LibreOffice's form, which keeps the period of `1.` before `(` (`2.(a)(i)`), while the DOCX checks expect Word's form (`2(a)(i)`)
- **AND** a real LibreOffice PDF of the source SHALL pass the PDF checks

#### Scenario: [SDX-MDOC-XREF-05] cross-references survive import and compile as REF fields
- **GIVEN** a created document with cross-references in the body and a footnote
- **WHEN** it is imported to Markdoc and compiled back, preserving annotations
- **THEN** each reference SHALL import as an `{% xref %}` tag over its number text, and `format="section"` SHALL stay literal text before it
- **AND** the footnote SHALL keep its text and its REF field, and the body SHALL keep every field's instruction
- **AND** a footnote holding a field other than REF, an unbalanced field, a second separator or instruction text in a field's result SHALL fail closed with `ANNOTATION_IMPORT_UNSUPPORTED`

#### Scenario: [SDX-MDOC-XREF-06] the CLI summary reports the cross-reference check
- **GIVEN** sources with several cross-references, with a single cross-reference target, and with none
- **WHEN** each is created through the CLI
- **THEN** the summary SHALL report `cross-references ok (N references; negative controls ok)` after the footnotes entry
- **AND** a negative control that is not applicable (no other target to point a reference at) SHALL be named as not applicable, never counted as ok
- **AND** a source without cross-references SHALL have no cross-references entry

### Requirement: Text cross-references in created documents

The creation grammar SHALL admit `show="number" | "text"` on `{% xref /%}`.
`show="number"` is the default. `{% xref to="id" show="text" /%}` SHALL
become a REF field with no number switch, showing the text of the heading or
list item marked `{% #id %}`, numbered or not: its text without its number
and without footnote reference marks, with the target's own formatting.
`show="text"` SHALL take neither `number` nor `format`, and SHALL not sit
inside bold, italic or underline. `docx-markdoc create` SHALL verify each
text reference against text the oracle reads from the source.

#### Scenario: [SDX-MDOC-XREFTEXT-01] show="text" cross-references show the target text without its number or footnote marks
- **GIVEN** a source with `heading-numbers: legal` and text references, in the body, a table cell and a footnote, to an Article, a Section holding a footnote reference and a fill, a clause holding an italic word, and a bullet item, beside number references
- **WHEN** the source is created
- **THEN** each text reference SHALL be a ` REF <name> \h ` field that reads back as its target's text, without "ARTICLE I", "Section 1.01" or a list label, and without footnote marks, and a fill SHALL keep its brackets
- **AND** its cached result SHALL keep the target's run formatting (the italic word, the highlighted fill)
- **AND** the certificate SHALL pass, with a cross-reference check that counts 8 text references and detects every negative control, the text-extent control included

#### Scenario: [SDX-MDOC-XREFTEXT-02] malformed text cross-references fail closed with a code and a line
- **GIVEN** sources with `show="page"`, `show="text"` with `number` or `format`, a text reference inside bold, italic or `{% u %}`, a text reference to an unknown id, and text targets holding an xref or a line break
- **WHEN** each is created
- **THEN** creation SHALL fail with `INVALID_CROSS_REFERENCE`, `XREF_UNKNOWN_ID` or `XREF_TEXT_TARGET_UNSUPPORTED` and the line of the reference
- **AND** a text reference to an unnumbered heading or a bullet item SHALL be created, while a number reference to one still fails with `XREF_TARGET_NOT_NUMBERED`

#### Scenario: [SDX-MDOC-XREFTEXT-03] verification checks each text cross-reference's instruction, target and bookmarked text
- **GIVEN** lowerings that point a text reference at another heading, turn it into a number reference, or point it at a heading with the same text
- **WHEN** each is verified
- **THEN** a reference retargeted to a different text SHALL pass the read-back check but fail the round trip, which reads the target's text from the source
- **AND** each SHALL fail the cross-reference check on its instruction, although a same-text twin leaves every paragraph's text unchanged
- **AND** with only same-text targets the retargeting control SHALL be not applicable, while the text-extent control, which shortens a bookmark by one character, SHALL be detected

#### Scenario: [SDX-MDOC-XREFTEXT-04] the CLI summary counts text cross-references
- **GIVEN** sources with number and text references, with number references only, and with a single text reference
- **WHEN** each is created through the CLI
- **THEN** the summary SHALL read `cross-references ok (12 references: 4 number, 8 text; negative controls ok)` for the first
- **AND** a source with number references only SHALL keep the summary it had before, without a text-extent control

#### Scenario: [SDX-MDOC-XREFTEXT-05] text cross-references import as xref tags and the PDF checks expect the same text
- **GIVEN** a created document with text references
- **WHEN** it is imported, compiled back, and its PDF expectations are projected for LibreOffice
- **THEN** each text reference SHALL import as an `{% xref show="text" %}` tag over its text, and compile SHALL write the same ` REF <name> \h ` field back
- **AND** the LibreOffice projection SHALL expect the same text as Word's, adding a period after a leading number only for full-context number references

#### Scenario: [SDX-MDOC-XREFTEXT-06] a real LibreOffice PDF of text cross-references passes the PDF checks
- **GIVEN** the source of SDX-MDOC-XREFTEXT-01
- **WHEN** it is created with `--require-pdf`
- **THEN** the PDF SHALL render and pass the word check

## ADDED Requirements

### Requirement: Cross-references in imported documents

Import SHALL restore a REF field whose bookmark marks one paragraph, in a body
paragraph, a table cell, a footnote or a comment, as an inline
`{% xref %}…{% /xref %}` tag over the field's cached result: ` REF <name> \w \h `
as the full number, ` REF <name> \n \h ` as `number="paragraph"`,
` REF <name> \r \h ` as `number="relative"`, and ` REF <name> \h ` as
`show="text"`, with `hyperlink=false` for a field without `\h`. The tag SHALL name its target by `to="id"` where the bookmark name maps
back to one kebab-case id, and by `bookmark="name"` otherwise. A REF field
the dialect cannot carry SHALL stay text and be reported with a reason, and
compile SHALL refuse to rewrite a paragraph or note that holds one. Compile
SHALL write each tag back as the source's field, with the same instruction,
bookmark and target, SHALL admit edits to the text around a reference only,
and SHALL fail closed with a specific code on any tag that disagrees with the
source or that it cannot write.

#### Scenario: [SDX-MDOC-XREFIMPORT-01] import restores each REF field as an xref tag and compile writes the same fields back
- **GIVEN** a created agreement with `heading-numbers: legal` and full, paragraph and text references in body paragraphs, a table cell and a footnote
- **WHEN** it is imported and compiled back unedited, preserving annotations
- **THEN** each of the seven fields SHALL import as an `{% xref %}` tag over its cached result, and the parsed scaffold SHALL record each reference's offsets, text and form
- **AND** the compiled document SHALL hold the same REF fields, with the same instructions and results, in the body and the footnote, and the same bookmarks on the same paragraphs
- **AND** importing the compiled document SHALL give the same tags

#### Scenario: [SDX-MDOC-XREFIMPORT-02] an edit beside cross-references changes the text around each field and keeps the field
- **GIVEN** the imported agreement, with edits that add words before, between and after references, at the very start of a paragraph that opens with one, and in the table cell holding only one
- **WHEN** it is compiled
- **THEN** the certificate SHALL pass, and the clean document SHALL hold the source's fields, with the same instructions and results, in the edited paragraphs
- **AND** the tracked document's inserted words SHALL sit outside every field result
- **AND** the clean document SHALL import again with the references in the edited paragraphs
- **AND** an edit of a paragraph whose REF field marker shares its run with text outside the field SHALL fail with `XREF_EDIT_UNSUPPORTED` (reason `shared-marker-run`), while the paragraph left unedited SHALL compile

#### Scenario: [SDX-MDOC-XREFIMPORT-03] the tag names its target by id where the bookmark name maps back, and by the bookmark name otherwise
- **GIVEN** fields naming a kebab-case id's bookmark, Word's hidden `_Ref…` bookmark (one without `\h`), and the shortened, hashed bookmark of a long id
- **WHEN** they are imported and compiled
- **THEN** the first SHALL import as `to="id"`, the others as `bookmark="name"`, and the one without `\h` with `hyperlink=false`
- **AND** a name that is not kebab-case mapped to underscores, or that ends in a hash, SHALL never map back to an id
- **AND** compile SHALL write each field back with its instruction, and `to="id"` and `bookmark="name"` SHALL denote the same reference

#### Scenario: [SDX-MDOC-XREFIMPORT-04] a REF field the dialect cannot carry stays text, and compile refuses to rewrite it
- **GIVEN** copies of the created agreement whose REF field has a `\p` or `\* MERGEFORMAT` switch or two number switches (`\w \n`, `\r \w`), names a missing or a repeated bookmark, nests a field, holds a tracked insertion or a tab, or has an empty result or none
- **WHEN** each is imported and compiled, unedited and with an edit to the field's paragraph
- **THEN** import SHALL keep the field as text and report it in `crossReferences.keptAsText` with its reason
- **AND** an unedited compile SHALL keep the field as it is, and an edit of its paragraph SHALL fail with `XREF_SOURCE_UNSUPPORTED` naming the reason
- **AND** a source whose REF field sits in its own tracked deletion SHALL compile unedited
- **AND** such a field in a footnote SHALL fail with `XREF_SOURCE_UNSUPPORTED` even unedited, a non-REF field in a footnote SHALL still fail import with `ANNOTATION_IMPORT_UNSUPPORTED`, and a reference unlinked to plain text SHALL import as text

#### Scenario: [SDX-MDOC-XREFIMPORT-05] compile fails closed on xref tags that disagree with the source or that it cannot write
- **GIVEN** the imported agreement with a tag retargeted, switched to another form or removed; an edit that retypes, drops or adds a reference or formats runs beside one; a reference in an inserted or a header paragraph; malformed tags; a note reference to no bookmark; and the deletion of a referenced paragraph
- **WHEN** each is compiled
- **THEN** compile SHALL fail with `XREF_DRIFT`, `XREF_EDIT_UNSUPPORTED`, `INVALID_MARKDOC` (`XREF_UNSUPPORTED_LOCATION`, `INVALID_CROSS_REFERENCE`) or `XREF_TARGET_MISSING` respectively, before writing output

#### Scenario: [SDX-MDOC-XREFIMPORT-06] a document Word edited and updated fields in imports with live references, and compile keeps each field
- **GIVEN** the created agreement after Word 16.114.3 inserted a clause before a referenced one, updated every field and saved (`scripts/oracle/word/evidence/issue-1260-word-16.114.json`)
- **WHEN** the saved copy is imported and compiled with an edit beside a reference
- **THEN** the results `create` cached SHALL equal Word's results for the unedited document
- **AND** every field SHALL import as a tag over the renumbered result Word wrote (`Section 1.01(c)`), with none kept as text
- **AND** the compiled document SHALL hold every field with its instruction and result, and every bookmark on its paragraph

#### Scenario: [SDX-MDOC-XREFIMPORT-07] relative references import as number="relative" beside full and text references, and compile keeps each field
- **GIVEN** the legal-headings source of `scripts/oracle/word/evidence/issue-1258-word-16.114.json`, with relative references in clauses, a table cell and a footnote, and a paragraph holding a full, a text and a relative reference to the same Section's clause
- **WHEN** it is created, imported, and compiled with edits beside references
- **THEN** every REF field SHALL be restored, each ` REF <name> \r \h ` as `number="relative"` over its cached result (`(b)` inside the target's Section, `Section 2.02(b)` elsewhere)
- **AND** the compiled document SHALL hold every field with its instruction and result, the footnote's ` REF adjustment_b \r \h ` included, and every bookmark on its paragraph
- **AND** the compiled document SHALL import again with the same relative tags
