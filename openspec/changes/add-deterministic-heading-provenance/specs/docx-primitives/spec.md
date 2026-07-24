## ADDED Requirements

### Requirement: Deterministic heading metadata carries explicit provenance

The document view SHALL classify explicit DOCX heading intent using the existing
`HeadingValue` object. It SHALL retain all existing source values and add
`list_metadata` and `outline_level`. Deterministic classification SHALL use
first-match precedence `word_style` → `list_metadata` → `outline_level` before
evaluating existing heuristic detectors.

#### Scenario: [HEAD-PROV-01] Effective outline level classifies a generic paragraph

- **GIVEN** a paragraph whose effective `w:outlineLvl` is 1 and whose paragraph
  style and active numbering level do not identify a built-in heading
- **WHEN** the document view is built
- **THEN** `heading.level` SHALL be 2
- **AND** `heading.source` SHALL be `outline_level`
- **AND** a direct paragraph outline level SHALL override a style-chain value

#### Scenario: [HEAD-PROV-02] Body-text and malformed outline values do not classify

- **GIVEN** a paragraph whose effective `w:outlineLvl` is body-text value 9,
  missing, malformed, negative, or outside the supported OOXML range
- **WHEN** no higher-precedence heading evidence or heuristic applies
- **THEN** the paragraph SHALL NOT receive a heading from `outline_level`

#### Scenario: [HEAD-PROV-03] Active numbering-level style association classifies

- **GIVEN** a paragraph on numbering level 1 whose active
  `w:lvl/w:pStyle` resolves to a recognized Heading 2 style
- **WHEN** the document view is built
- **THEN** `heading.level` SHALL be 2
- **AND** `heading.source` SHALL be `list_metadata`
- **AND** a heading association on a different numbering level SHALL NOT
  classify the paragraph

#### Scenario: [HEAD-PROV-04] Built-in heading style wins conflicting metadata

- **GIVEN** a paragraph with a recognized Heading 1 paragraph style, an active
  list level associated with Heading 2, and effective outline level 2
- **WHEN** the document view is built
- **THEN** `heading.level` SHALL be 1
- **AND** `heading.source` SHALL be `word_style`

### Requirement: Built-in heading recognition is localized and bounded

The document view SHALL recognize literal Heading 1 through Heading 9 style IDs
and a maintained built-in-name alias table covering at least English, French,
German, Spanish, and Japanese. Matching SHALL be exact after documented Unicode
and whitespace normalization and SHALL NOT use fuzzy similarity.

#### Scenario: [HEAD-PROV-05] Localized built-in name maps to its heading level

- **GIVEN** a paragraph style whose display name is the French built-in name
  `Titre 1`
- **WHEN** a paragraph uses that style
- **THEN** `heading.level` SHALL be 1
- **AND** `heading.source` SHALL be `word_style`

#### Scenario: [HEAD-PROV-06] TOC style is not a built-in heading alias

- **GIVEN** a paragraph using a `TOC 1` style and no other heading evidence
- **WHEN** the document view is built
- **THEN** the paragraph SHALL NOT receive a deterministic heading

#### Scenario: [HEAD-PROV-07] Nested deterministic headings retain order and levels

- **GIVEN** three document-order paragraphs classified at levels 1, 2, and 1
  through any deterministic sources
- **WHEN** the document view is built
- **THEN** the three headings SHALL retain document order
- **AND** their levels SHALL be 1, 2, and 1 respectively
