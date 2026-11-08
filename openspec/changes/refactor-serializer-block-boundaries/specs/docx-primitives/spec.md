## ADDED Requirements

### Requirement: Shared semantic serializer boundaries

HTML, Markdown and DOCX-to-ODF serialization SHALL share document-order table
runs and list boundaries while preserving format-specific headings, empty
paragraphs, table-cell paragraph grouping, and nesting. The block iterator SHALL
be exported from docx-core without mutating its input. Tables SHALL take precedence
over heading and list metadata; format-specific heading predicates SHALL take
precedence over list predicates.

#### Scenario: repeated noncontiguous table IDs remain separate groups
- **WHEN** a table ID reappears after an intervening block
- **THEN** the iterator emits separate table runs in document order
- **AND** adjacent different table IDs also remain separate

#### Scenario: format-specific list interruptions preserve spacing and labels
- **WHEN** headings, paragraphs, tables, or an ODF spacing/manual-label boundary interrupt list items
- **THEN** each renderer closes the current list before the interruption
- **AND** nested levels and table-cell paragraphs retain their existing format-specific representation

#### Scenario: public iterator preserves input identity and empty paragraphs
- **WHEN** a package consumer iterates a readonly document view
- **THEN** it receives the original nodes exactly once in document order
- **AND** empty paragraphs remain explicit paragraph blocks
