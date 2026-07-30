## ADDED Requirements

### Requirement: Shared field classification governs comparison cache identity

The comparison system SHALL use the same switch-aware field instruction
classifier as deterministic field refresh when recognizing PAGEREF fields for
TOC cache suppression. Replacing the classifier SHALL NOT broaden suppression
to ordinary PAGEREF fields outside TOC paragraphs or to REF cached results.

#### Scenario: [SDX-FIELD-EVAL-06] TOC PAGEREF identity uses shared classification

- **GIVEN** a PAGEREF instruction with admitted whitespace, case, quoted target,
  and presentation-switch variations inside a TOC paragraph
- **WHEN** comparison constructs its cache-insensitive round-trip projection
- **THEN** it SHALL derive the stable identity through the shared classifier
- **AND** differing cached page numbers SHALL NOT become authored revisions

#### Scenario: [SDX-FIELD-EVAL-07] Suppression boundary remains narrow

- **GIVEN** an ordinary non-TOC PAGEREF field or any REF field
- **WHEN** comparison constructs its round-trip projection
- **THEN** the existing visible cached-result behavior SHALL remain unchanged

### Requirement: Cache suppression never narrows

Comparison cache suppression SHALL recognize every PAGEREF instruction that
keyword matching recognizes. Where the shared classifier declines an
instruction, comparison SHALL still derive a stable identity, because an
unclassifiable instruction still has a volatile page-number cache.

A field instruction SHALL be read from its surviving text; instruction text
inside a deletion revision SHALL NOT be concatenated with it.

#### Scenario: [SDX-FIELD-EVAL-12] Retargeted TOC PAGEREF keeps its cache suppressed

- **GIVEN** a TOC PAGEREF whose instruction was rewritten under tracked changes
- **AND** only its cached page number differs between two revisions
- **WHEN** comparison constructs its round-trip projection
- **THEN** both projections SHALL be identical

#### Scenario: [SDX-FIELD-EVAL-13] Unclassifiable PAGEREF still suppresses its cache

- **GIVEN** a TOC PAGEREF instruction carrying a switch the classifier rejects
- **WHEN** comparison constructs its round-trip projection
- **THEN** it SHALL still derive a stable cache-insensitive identity
