## ADDED Requirements

### Requirement: Re-emitted source comments keep their date state

When `compileMarkdoc` re-emits a source comment or reply because its author,
initials, anchor or thread parent changed, the output comment definition SHALL
carry the source comment's `w:date` when the source had one and SHALL carry no
`w:date` when the source had none. A newly authored comment with no `date`
attribute SHALL still be stamped with the compile time.

#### Scenario: [SDX-MDOC-154] An undated source thread is re-emitted without a date
- **GIVEN** a source document whose comment thread carries no `w:date`
- **WHEN** the root's `author` changes and the Markdoc is compiled
- **THEN** no `w:comment` in the output SHALL carry a `w:date`
- **AND** the re-emitted root and its replies SHALL keep their text, initials and thread linkage
- **AND** a dated source thread through the same change SHALL keep each comment's source date
- **AND** a newly authored comment with no `date` attribute SHALL carry a `w:date`
