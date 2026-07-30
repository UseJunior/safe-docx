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
