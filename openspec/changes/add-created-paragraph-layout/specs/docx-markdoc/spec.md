## ADDED Requirements

### Requirement: Paragraph layout in created documents

The creation grammar SHALL admit a block tag `{% paragraph-layout %}…{% /paragraph-layout %}` whose
paragraphs are body paragraphs with their own direct alignment and indents,
from a closed vocabulary: `align` (`left`, `center`, `right` or `justify`,
written as `w:jc` `left`, `center`, `right` or `both`), `indent-left` and
`indent-hanging` (each `0.25`, `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75` or
`2` inches, written as `w:ind` `w:left` and `w:hanging` in twips). The tag
SHALL need at least one attribute and some text, and an `indent-hanging`
SHALL need an `indent-left` at least as large. Its content SHALL be what
`{% center %}` admits: one line of inline text, or paragraphs of it,
including line breaks. Each content paragraph SHALL become one paragraph in
the `BodyText` style carrying the tag's layout in its own `w:pPr`; no other
body paragraph SHALL carry direct `w:jc` or `w:ind`.

The build SHALL verify the layout twice. The read-back SHALL compare each
body paragraph's direct `w:jc` and `w:ind` with the lowering's projection,
with a negative control. The round trip SHALL compare each `{% paragraph-layout %}`
paragraph's text and the layout its attributes call for, read straight from
the source, with the layout each body paragraph of the DOCX sets in its own
`w:pPr`, position by position over the non-empty body paragraphs, with
negative controls that change, drop and move one expected layout. A missing, misplaced, changed or extra layout SHALL fail the
build with `CREATION_VERIFICATION_FAILED`.

#### Scenario: [SDX-MDOC-PARALAYOUT-01] a paragraph-layout tag gives each of its paragraphs its own alignment and indents
- **GIVEN** a justified agreement with a definitions list in `{% paragraph-layout indent-left="0.5" indent-hanging="0.5" %}`, an address block written with line breaks in `{% paragraph-layout align="left" indent-left=1 %}`, and a notice line in `{% paragraph-layout align="left" %}`
- **WHEN** the source is created
- **THEN** each definition paragraph SHALL carry `w:ind` `w:left="720"` `w:hanging="720"`, the address block `w:jc="left"` and `w:ind` `w:left="1440"`, and the notice line `w:jc="left"`, while the other body paragraphs carry neither
- **AND** the address block SHALL keep its line breaks and every paragraph SHALL stay a body paragraph
- **AND** the read-back layout comparison and the round-trip layout comparison SHALL pass with their negative controls detected
- **AND** each `align` word SHALL be written as its `w:jc` value, and `create --help` SHALL list the tag with its values

#### Scenario: [SDX-MDOC-PARALAYOUT-02] verification fails when a layout is lost, changed or added on the way
- **GIVEN** a lowering whose spec loses a hanging indent, a lowering that changes an alignment in both its spec and its projection, a lowering that adds an alignment to a paragraph the source never laid out, and a lowering that moves an alignment, in both its spec and its projection, to the next paragraph, which holds the same text
- **WHEN** each is created
- **THEN** the first SHALL fail the read-back and the round trip, naming the paragraph and both layouts
- **AND** the second SHALL pass the read-back and fail the round trip
- **AND** the third SHALL fail the round trip with an extra laid-out paragraph and its negative controls not applicable
- **AND** the fourth SHALL pass the read-back and fail the round trip at both paragraphs, while the same source built as written passes with its moved-layout negative control detected

#### Scenario: [SDX-MDOC-PARALAYOUT-03] a malformed paragraph-layout tag fails closed before any output
- **GIVEN** sources with a `{% paragraph-layout %}` without attributes, an `align` or `indent-left` outside its list, an `indent-hanging` larger than its `indent-left` or without one, no text, an unknown attribute, and a list inside the tag
- **WHEN** each is created
- **THEN** creation SHALL fail before writing any output with `INVALID_PARAGRAPH_LAYOUT` for the first six, `UNSUPPORTED_CREATION_ATTRIBUTE` for the unknown attribute, and `UNSUPPORTED_CREATION_SYNTAX` for the list

#### Scenario: [SDX-MDOC-PARALAYOUT-04] created documents do not stretch justified lines that end in a line break
- **GIVEN** a justified paragraph whose lines end in `\` line breaks, and a document built with `"justify": false`
- **WHEN** each is created
- **THEN** `word/settings.xml` SHALL hold `w:doNotExpandShiftReturn` before the `compatibilityMode` setting in `w:compat`, in both documents

#### Scenario: [SDX-MDOC-PARALAYOUT-05] pull carries a wording edit inside a paragraph-layout tag back into the tag
- **GIVEN** a created agreement holding `{% paragraph-layout %}` paragraphs, edited in Word to change the wording of one and, separately, to delete one paragraph of a two-paragraph tag, and one-paragraph tags whose every word is retyped
- **WHEN** each edit is pulled
- **THEN** the changed wording SHALL be written inside the tag, leaving its attributes unchanged, and the pull SHALL be complete
- **AND** the deleted paragraph SHALL be removed from the source while the tag keeps its other paragraph
- **AND** each retyped paragraph SHALL be written in a `{% paragraph-layout %}` tag with the same attributes, and the pull SHALL be complete
