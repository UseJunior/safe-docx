## ADDED Requirements

### Requirement: Table of contents and TC entries

`generateDocx` SHALL accept an inline `{ kind: 'tableOfContentsEntry', text, level }`
and write it as a TC field (ECMA-376 5th edition Part 1 §17.16.5.63): fldChar
begin, the instruction `TC "<text>" \l <level>`, fldChar end, with no result.
TC entries SHALL follow every other inline of their paragraph and SHALL be
written after the paragraph's bookmark, so a text cross-reference to the
paragraph does not copy them. An entry's text SHALL be non-blank, on one
line, without a double quote or backslash, and its level an integer from 1
to 9; an entry SHALL sit only in a body paragraph.

`generateDocx` SHALL accept `ParagraphSpec.tableOfContents`, marking the
paragraphs that hold a TOC field's cached result (§17.16.5.68): the paragraph
that `opens` it carries fldChar begin, the instruction
`TOC \f \l "<from>-<to>" \n` and fldChar separate before its runs, and the
paragraph that `closes` it carries fldChar end after its runs (one paragraph
may do both). The paragraphs SHALL be consecutive top-level body paragraphs
of one section holding only text and tabs, with no bookmark, list or
drafting note, and tables of contents SHALL NOT nest. Any other shape SHALL
be refused before compilation with a `GenerationSpecError`.

#### Scenario: [SDX-GEN-137] a table of contents and its TC entries are written as complex fields
- **GIVEN** a spec with a bookmarked heading paragraph carrying a trailing TC entry, a second TC entry in a body paragraph, and two paragraphs marked as a table of contents with levels 1 to 3
- **WHEN** it is compiled
- **THEN** each TC entry SHALL be a begin/instruction/end field with `TC "<text>" \l <level>`, written after the paragraph's bookmark end
- **AND** the first table-of-contents paragraph SHALL open with begin, `TOC \f \l "1-3" \n` and separate before its text, and the last SHALL end with fldChar end after its text
- **AND** the package SHALL pass the structural checks and compile byte-identically across two runs
- **AND** a TC entry that is not last in its paragraph, a TC entry in a footer, text holding a double quote, a table of contents that never closes, nested tables of contents, and a table-of-contents paragraph holding a cross-reference SHALL each be refused with a `GenerationSpecError`
