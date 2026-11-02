## ADDED Requirements

### Requirement: Inline underline in created documents

The creation grammar SHALL admit an inline `{% u %}…{% /u %}` tag that
singly underlines exactly its content. The generic markdocx engine SHALL
render the same tag itself, passing `underline` to the theme in the inline
style, and its default preset SHALL underline the runs it builds.

#### Scenario: [SDX-MDOC-UNDERLINE-01] defined terms, run-in headings and operator words underline only the tagged text
- **GIVEN** a defined term `{% u %}Purchase Price{% /u %}.` followed by its definition, a run-in heading `Section 2.04` then a tab then `{% u %}Closing Deliveries and Payments{% /u %}.`, and an operator word `{% u %}less{% /u %} the Closing Debt Amount`
- **WHEN** the source is created
- **THEN** the runs holding "Purchase Price", "Closing Deliveries and Payments" and "less" SHALL each carry `w:u` with `w:val` `single`
- **AND** every other run, including each following period, the tab and the heading number, SHALL carry no `w:u`
- **AND** the build SHALL pass its verification checks

#### Scenario: [SDX-MDOC-UNDERLINE-02] underline nests with other inline formatting and passes the round trip
- **GIVEN** `{% u %}` around bold and italic text, inside bold text, inside another `{% u %}`, around and inside a `{% fill %}`, inside `{% literal %}`, in a heading, a list item, a table cell, a legend and a signer name, a bracket fill-in that opens inside `{% u %}` and closes outside it under `fill-ins: brackets`, and a paragraph whose only content is `{% u %}`
- **WHEN** the source is created
- **THEN** each underlined run SHALL also keep its bold, italic and highlight formatting, and adjacent runs with the same formatting SHALL merge
- **AND** a bracket fill-in SHALL stay highlighted across the `{% u %}` boundary while only the tagged text is underlined, and legend text SHALL be underlined but never highlighted
- **AND** the paragraph whose only content is `{% u %}` SHALL be a body paragraph with that text
- **AND** the round-trip comparison SHALL pass with the underlined text read as plain text

#### Scenario: [SDX-MDOC-UNDERLINE-03] malformed underline fails closed
- **GIVEN** sources with an empty `{% u %}`, a `{% u %}` with an attribute, a `{% u %}` on its own lines as a block, and inline `<u>` HTML
- **WHEN** each is created
- **THEN** creation SHALL fail before writing any output with `INVALID_UNDERLINE`, `UNSUPPORTED_CREATION_ATTRIBUTE`, `UNSUPPORTED_CREATION_TAG` and `UNSUPPORTED_HTML` respectively
- **AND** the `UNSUPPORTED_HTML` message SHALL name `{% u %}`

#### Scenario: [SDX-MDOC-UNDERLINE-04] the generic engine passes underline to the theme and the default preset underlines
- **GIVEN** a paragraph with `{% u %}` around bold text, a soft break and a code span, and a `{% field %}` inside `{% u %}`
- **WHEN** it is rendered with `renderMarkdocxToDocumentSpec` and the default preset
- **THEN** the runs inside the tag SHALL carry `underline` `single` with their bold formatting, and runs outside it SHALL carry no `underline` key
- **AND** a custom theme SHALL receive `underline` `single` in the inline style passed to its `renderText` for text inside the tag, and none outside it
