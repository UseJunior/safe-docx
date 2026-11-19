## ADDED Requirements

### Requirement: DOCX Header and Footer Read Tool
The Safe-DOCX MCP server SHALL provide a read-only DOCX `get_headers_footers`
tool that returns, for every section, the default, first and even header and
footer in effect, with relationship id, part name, whether it is inherited
from an earlier section, and its paragraphs with session `_bk_*` ids usable as
edit anchors.

#### Scenario: Distinct first-page and default footers are read with paragraph ids
- **GIVEN** a DOCX section with `w:titlePg`, a first-page footer and a default footer
- **WHEN** `get_headers_footers` is called
- **THEN** the section SHALL report both footers with their relationship ids, part names and paragraph text
- **AND** each paragraph SHALL carry a `_bk_*` id

#### Scenario: An inheriting section reports the inherited part
- **GIVEN** a two-section DOCX whose second section has no footer reference
- **WHEN** `get_headers_footers` is called
- **THEN** the second section SHALL report the first section's footer part with `inherited: true` and `source_section_index: 0`

### Requirement: Header and Footer Paragraph Edits
`replace_text` and `insert_paragraph` SHALL accept a header/footer paragraph
id from `get_headers_footers` and edit that header or footer part. In a
tracked session the edit SHALL be written as `w:ins`/`w:del` in the part.
A clean save SHALL keep every part the session did not change byte-identical.

#### Scenario: A tracked footer replacement accepts and rejects to the new and old text
- **GIVEN** a tracked session and a footer paragraph id
- **WHEN** `replace_text` replaces footer text and the session is saved
- **THEN** the footer part of the tracked output SHALL hold `w:del` and `w:ins`
- **AND** accepting all changes SHALL give the new footer text and rejecting all SHALL give the old

#### Scenario: A clean save keeps untouched parts byte-identical
- **GIVEN** a session that read headers and footers and edited one footer
- **WHEN** the session is saved clean
- **THEN** every package part other than document.xml and the edited footer SHALL be byte-identical to the input

#### Scenario: batch_edit refuses header and footer anchors
- **WHEN** `batch_edit` is given a header/footer paragraph id
- **THEN** it SHALL fail validation with a message naming replace_text and insert_paragraph

### Requirement: Header and Footer Attach Tool
The Safe-DOCX MCP server SHALL provide a DOCX `set_header_footer` tool that
creates a header or footer part from text and PAGE/NUMPAGES fields, or reuses
an existing part, or links a section to the previous one, and sets one
section's reference while every other section keeps the header or footer it
showed.

#### Scenario: Per-section footers after a section break
- **GIVEN** a single-section DOCX with no footers and a nextPage section break inserted before the last page
- **WHEN** `set_header_footer` gives section 0 a centred PAGE footer and section 1 a centred "Signature Page" footer
- **THEN** the package SHALL hold two footer parts, each with one document relationship and one content-type override
- **AND** section 0 SHALL reference the PAGE footer and section 1 the "Signature Page" footer
- **AND** the save report SHALL list the part creation in the non-revision change manifest

#### Scenario: Attaching to a middle section keeps the following sections
- **GIVEN** three sections sharing the first section's footer by inheritance
- **WHEN** `set_header_footer` gives the middle section a new footer
- **THEN** the third section SHALL be given an explicit reference to the original footer and still show it

#### Scenario: Tracked mode records the section change
- **GIVEN** a tracked session
- **WHEN** `set_header_footer` attaches a first-page footer
- **THEN** the section SHALL gain `w:titlePg` and a `w:sectPrChange` holding its previous properties
