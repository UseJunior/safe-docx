## ADDED Requirements

### Requirement: Baseline settings part

Every package produced by `generateDocx` SHALL include `word/settings.xml`,
registered with a content-type Override and a document relationship that
resolves, so authored output carries the settings part a Word-authored document
carries. The part SHALL always contain a `w:compat` block with a
`compatibilityMode=15` compatSetting (Word 2013+ / mode 15) so Microsoft Word
opens the document in the current format rather than legacy "Compatibility
Mode". Conditional settings — `w:evenAndOddHeaders` when a section declares an
even-page header or footer, and `w:clrSchemeMapping` when theme-relative
authoring or a custom theme is used — SHALL be folded into the same part when
needed, ordered before the `w:compat` block. The part SHALL be static so the
determinism guarantee continues to hold, and SHALL be registered exactly once
even though it is now emitted unconditionally.

#### Scenario: [SDX-GEN-094] the baseline settings part is emitted with compatibilityMode=15
- **GIVEN** any generated package
- **WHEN** its parts, content types, and relationships are enumerated
- **THEN** it SHALL contain `word/settings.xml`
- **AND** it SHALL carry a content-type Override in `[Content_Types].xml` and a relationship in `word/_rels/document.xml.rels` whose target resolves to the part
- **AND** `word/settings.xml` SHALL contain a `w:compat` element holding a `w:compatSetting` with `w:name="compatibilityMode"`, `w:uri="http://schemas.microsoft.com/office/word"`, and `w:val="15"`
- **AND** the package SHALL pass the structural checks (closed relationship graph) and compile byte-identically across two runs
- **AND** when a section declares an even-page header the settings part SHALL still emit `w:evenAndOddHeaders` alongside the compat block
