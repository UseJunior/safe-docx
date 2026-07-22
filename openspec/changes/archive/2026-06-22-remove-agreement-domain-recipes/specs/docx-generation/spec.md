## REMOVED Requirements

### Requirement: Legal-document recipes
**Reason**: `coverTermsTable` and `signatureBlock` baked one downstream
consumer's agreement-document concepts (cover terms, parties/signatories, print
name, title, date, entity-legal-name-above-the-line) into a general OOXML
library. They added no primitive over the existing `TableSpec` / `BorderSpec` /
`RunProps` grammar — only a domain iteration loop, which belongs in the consumer.
**Migration**: Compose the equivalent `TableSpec` directly from the general
grammar in the consumer. A cover-terms block is a fixed-layout two-column table;
a signature block is a table whose signing line is a cell with a bottom
`BorderSpec` and whose fillable values carry `RunProps.highlight`. The
openagreements DOCX adapter already builds its signature grid this way and moves
its cover-terms table to the same pattern.
