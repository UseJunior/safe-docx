## ADDED Requirements

### Requirement: Composite anchors align by semantic span

The comparison engine SHALL classify supported parenthetical list markers as
composite contextual anchors and SHALL determine their atom-level match
eligibility from the paragraph-local item spans they introduce. The engine SHALL
not match only a proper subset of an anchor across incompatible item spans.
Compatible item spans SHALL retain ordinary minimal token-level comparison.

#### Scenario: Rewritten item replaces its complete marker

- **GIVEN** original and revised paragraphs reuse the same parenthetical marker for semantically incompatible item text
- **WHEN** their atoms are aligned
- **THEN** the complete original marker is deleted and the complete revised marker is inserted

#### Scenario: Local edit preserves an unchanged marker

- **GIVEN** corresponding list items have the same parenthetical marker and compatible item text with a local edit
- **WHEN** their atoms are aligned
- **THEN** the marker remains unchanged and ordinary token LCS isolates the local edit

#### Scenario: Marker families share one policy

- **GIVEN** equivalent list-item changes using numeric, alphabetic, or Roman parenthetical markers
- **WHEN** their atoms are aligned
- **THEN** the same contextual-anchor policy determines marker alignment for every family

#### Scenario: Prose parenthetical remains ordinary text

- **GIVEN** a parenthetical token used as a prose reference rather than at a list-item boundary
- **WHEN** nearby prose changes
- **THEN** ordinary token LCS preserves the unchanged parenthetical

