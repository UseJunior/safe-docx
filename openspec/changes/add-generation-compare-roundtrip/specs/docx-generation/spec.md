## ADDED Requirements

### Requirement: Author-to-compare round-trip guarantee

A document produced by `generateDocx` SHALL be a first-class citizen of the
`compareDocuments` redline workflow: authored output SHALL flow through comparison and
accept/reject reconstruction with no impedance mismatch. Self-comparison of an authored
document SHALL report no changes; a known authored edit SHALL produce exactly that
redline; accepting all changes SHALL reproduce the revised authored document and rejecting
all changes SHALL reproduce the original; and authored fields and tables SHALL survive the
round-trip. The guarantee SHALL be enforced against the real `generateDocx` and
`compareDocuments` (no mocks), and a deliberately malformed authored field SHALL be caught
by the reconstruction safety checks rather than passing silently.

#### Scenario: [SDX-GEN-100] self-compare of an authored document is empty
- **GIVEN** a `DocumentSpec` compiled twice with `generateDocx` (deterministic, byte-identical output)
- **WHEN** the two buffers are passed to `compareDocuments`
- **THEN** the comparison SHALL report zero insertions, deletions, modifications, and format changes

#### Scenario: [SDX-GEN-101] a known single-paragraph edit produces exactly that redline
- **GIVEN** two authored documents differing by one paragraph's text (a word replacement)
- **WHEN** they are compared
- **THEN** the redline SHALL be confined to that one paragraph and report no spurious changes
- **AND** accepting all changes SHALL yield the revised text and rejecting all changes SHALL yield the original text

#### Scenario: [SDX-GEN-102] accept-all equals revised and reject-all equals original
- **GIVEN** an authored original and a revised authored document compared with the atomizer engine
- **WHEN** all tracked changes are accepted, and separately all are rejected, under both `rebuild` and `inplace` reconstruction modes
- **THEN** the accepted text SHALL match the revised authored document and the rejected text SHALL match the original authored document

#### Scenario: [SDX-GEN-103] authored fields and tables survive the compare round-trip
- **GIVEN** an authored document containing a `Page X of Y` field footer, a cover-terms table, and a signature block
- **WHEN** it is edited, compared, and round-tripped through accept/reject
- **THEN** field structure SHALL remain intact and table-cell text SHALL round-trip (accepted matches revised, rejected matches original)

#### Scenario: [SDX-GEN-104] a malformed authored field is caught by the round-trip guard
- **GIVEN** an authored document whose field is deliberately malformed (a dropped `fldChar` end marker)
- **WHEN** it is compared and reconstructed
- **THEN** the reconstruction safety checks SHALL report a `fieldStructure` failure rather than passing silently
