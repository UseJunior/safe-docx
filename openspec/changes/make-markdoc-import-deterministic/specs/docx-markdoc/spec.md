## ADDED Requirements

### Requirement: Import output depends only on the input bytes

`importDocxToMarkdoc` SHALL write every entry of the anchored package with a
fixed date rather than the time of import, so that the anchored source, its
`source sha256` and the emitted Markdoc are byte-identical for byte-identical
input regardless of when the import runs. The `source sha256` SHALL remain the
SHA-256 of the anchored package bytes that `compileMarkdoc` receives.

#### Scenario: [SDX-MDOC-154] Imports across a ZIP timestamp tick are byte-identical and still compile
- **GIVEN** a DOCX whose body and a selected header both receive anchors on import
- **WHEN** it is imported twice with the system clock advanced by more than two seconds between the imports
- **THEN** the two anchored sources SHALL be byte-identical
- **AND** the two Markdoc outputs SHALL be byte-identical, including `source sha256`
- **AND** every entry of the anchored package SHALL carry the fixed date
- **AND** the Markdoc of the first import SHALL compile against the anchored source of the second without `SOURCE_HASH_DRIFT`
