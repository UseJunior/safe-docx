## ADDED Requirements

### Requirement: Style Source Decoupling for insert_paragraph
The `insert_paragraph` tool SHALL accept an optional `style_source_id` parameter to decouple formatting source from positional anchor.

#### Scenario: style_source_id clones formatting from specified paragraph
- **GIVEN** a document with paragraph A (heading style) and paragraph B (body style)
- **WHEN** `insert_paragraph` is called with `positional_anchor_node_id: A`, `position: AFTER`, and `style_source_id: B`
- **THEN** the inserted paragraph SHALL be positioned after A
- **AND** paragraph properties (`w:pPr`) and template run formatting SHALL be cloned from B, not A

#### Scenario: style_source_id falls back to anchor with warning
- **GIVEN** a `style_source_id` that does not match any paragraph in the document
- **WHEN** `insert_paragraph` is called with that `style_source_id`
- **THEN** the server SHALL fall back to cloning formatting from the positional anchor
- **AND** SHALL include a `style_source_warning` field in the response explaining the fallback

#### Scenario: style_source_id omitted uses anchor formatting (backward compatible)
- **WHEN** `insert_paragraph` is called without `style_source_id`
- **THEN** the server SHALL clone formatting from the positional anchor paragraph
- **AND** behavior SHALL be identical to the current implementation
