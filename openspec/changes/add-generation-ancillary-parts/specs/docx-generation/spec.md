## ADDED Requirements

### Requirement: Standard ancillary parts

Every package produced by `generateDocx` SHALL include the standard ancillary
parts that a Word-authored document carries — `word/theme/theme1.xml`,
`word/fontTable.xml`, and `word/webSettings.xml` — each registered with a
content-type Override and a document relationship that resolves, so authored
output is part-for-part comparable to genuine Word output and does not invite a
reader's repair/recovery prompt. The theme SHALL be a complete Office theme
(color scheme, font scheme, and a full format scheme); the font table SHALL
enumerate the fonts the document actually references; and the parts SHALL be
static so the determinism guarantee continues to hold.

#### Scenario: [SDX-GEN-093] standard ancillary parts are emitted and fully wired
- **GIVEN** any generated package
- **WHEN** its parts, content types, and relationships are enumerated
- **THEN** it SHALL contain `word/theme/theme1.xml`, `word/fontTable.xml`, and `word/webSettings.xml`
- **AND** each SHALL carry a content-type Override in `[Content_Types].xml` and a relationship in `word/_rels/document.xml.rels` whose target resolves to the part
- **AND** the theme SHALL contain a color scheme, a font scheme, and a format scheme, and the font table SHALL list every font the document references
- **AND** the package SHALL pass the structural checks (closed relationship graph) and compile byte-identically across two runs
