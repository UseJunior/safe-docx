## ADDED Requirements

### Requirement: Generic Markdoc to DocumentSpec engine

`docx-markdoc` SHALL provide a generic engine that lowers a Markdoc AST to
docx-core `DocumentSpec` blocks through caller-supplied seams (a theme, block
and inline tag plugins, a field resolver and a block transform hook), SHALL
keep its lenient rendering contract for existing adapters, and SHALL fail
loudly on any node or tag no seam handles.

#### Scenario: [SDX-MDOC-156] the engine keeps its lenient adapter contract
- **GIVEN** Markdoc with a link, a code span, soft and hard breaks, an empty paragraph, filled and unfilled fields and a list nested five deep
- **WHEN** it is rendered with the default theme
- **THEN** the link SHALL keep only its text, the code span SHALL render as plain text, and both breaks SHALL render as spaces
- **AND** a paragraph with no runs SHALL render nothing
- **AND** the field SHALL render through the caller's resolver and theme, and an unresolved field without a resolver SHALL throw
- **AND** list levels deeper than the cap SHALL reuse the deepest level

#### Scenario: [SDX-MDOC-156] domain behaviour plugs in through tags and transformBlock
- **GIVEN** a block tag plugin and a transformBlock hook
- **WHEN** Markdoc using the tag and a paragraph matched by the hook is rendered
- **THEN** the plugin's blocks and the hook's replacement SHALL appear in document order
- **AND** an inline tag plugin SHALL render inside text, and a plugin requesting `breakLines` SHALL receive line breaks instead of spaces

#### Scenario: [SDX-MDOC-156] unhandled nodes fail loudly with a typed error
- **GIVEN** an image, a blockquote, an unknown block tag and an unknown inline tag
- **WHEN** each is rendered without a handling plugin
- **THEN** rendering SHALL throw `MarkdocxUnhandledNodeError` carrying the node type and tag name
