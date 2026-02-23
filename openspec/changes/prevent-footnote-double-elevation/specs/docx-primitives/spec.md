## ADDED Requirements

### Requirement: Prevent Double Elevation on Reference Styles
The system SHALL detect and fix double-elevation defects on allowlisted reference styles (`FootnoteReference`, `EndnoteReference`) where both `w:vertAlign="superscript"` and a positive `w:position` are present. The effective property values SHALL be resolved using nearest-in-chain-wins semantics along the `basedOn` inheritance chain. Parent/ancestor styles SHALL never be mutated.

#### Scenario: [SDX-DE-001] remove position when vertAlign superscript is present on same style
- **GIVEN** a `FootnoteReference` style with `w:vertAlign="superscript"` and `w:position="6"` in its rPr
- **WHEN** `preventDoubleElevation()` is called
- **THEN** `w:position` SHALL be removed from the style's rPr
- **AND** `w:vertAlign` SHALL be preserved
- **AND** `doubleElevationsFixed` SHALL be 1

#### Scenario: [SDX-DE-002] no-op when only vertAlign is present
- **GIVEN** a `FootnoteReference` style with only `w:vertAlign="superscript"`
- **WHEN** `preventDoubleElevation()` is called
- **THEN** the style SHALL be unchanged
- **AND** `doubleElevationsFixed` SHALL be 0

#### Scenario: [SDX-DE-003] no-op when only position is present
- **GIVEN** a `FootnoteReference` style with `w:position="6"` but no `w:vertAlign`
- **WHEN** `preventDoubleElevation()` is called
- **THEN** the style SHALL be unchanged
- **AND** `doubleElevationsFixed` SHALL be 0

#### Scenario: [SDX-DE-004] detect vertAlign through basedOn inheritance chain
- **GIVEN** a parent style with `w:vertAlign="superscript"` and a `FootnoteReference` style with `w:position="6"` based on that parent
- **WHEN** `preventDoubleElevation()` is called
- **THEN** the child's `w:position` SHALL be removed
- **AND** `doubleElevationsFixed` SHALL be 1

#### Scenario: [SDX-DE-005] child baseline overrides ancestor superscript (no fix)
- **GIVEN** a parent style with `w:vertAlign="superscript"` and a `FootnoteReference` style with `w:vertAlign="baseline"` + `w:position="6"` based on that parent
- **WHEN** `preventDoubleElevation()` is called
- **THEN** the style SHALL be unchanged (child baseline overrides ancestor superscript)
- **AND** `doubleElevationsFixed` SHALL be 0

#### Scenario: [SDX-DE-006] inherited position neutralized locally
- **GIVEN** a parent style with `w:position="6"` and a `FootnoteReference` style with `w:vertAlign="superscript"` based on that parent (no local position)
- **WHEN** `preventDoubleElevation()` is called
- **THEN** `w:position w:val="0"` SHALL be added to the `FootnoteReference` style's rPr
- **AND** the parent style's `w:position` SHALL be unchanged
- **AND** `doubleElevationsFixed` SHALL be 1

#### Scenario: [SDX-DE-007] shared parent not mutated (sibling safety)
- **GIVEN** a parent style with `w:position="6"`, a `FootnoteReference` child with `w:vertAlign="superscript"`, and a `SiblingStyle` child (no vertAlign), both based on the parent
- **WHEN** `preventDoubleElevation()` is called
- **THEN** `FootnoteReference` SHALL get `w:position="0"` locally
- **AND** parent's `w:position="6"` SHALL be preserved
- **AND** `SiblingStyle` SHALL be unaffected

#### Scenario: [SDX-DE-008] idempotent on already-fixed styles
- **GIVEN** a styles document that has already been fixed
- **WHEN** `preventDoubleElevation()` is called a second time
- **THEN** `doubleElevationsFixed` SHALL be 0

#### Scenario: [SDX-DE-009] preserve subscript with position
- **GIVEN** a `FootnoteReference` style with `w:vertAlign="subscript"` and `w:position="6"`
- **WHEN** `preventDoubleElevation()` is called
- **THEN** both properties SHALL be preserved
- **AND** `doubleElevationsFixed` SHALL be 0

#### Scenario: [SDX-DE-010] negative position preserved
- **GIVEN** a `FootnoteReference` style with `w:vertAlign="superscript"` and `w:position="-4"`
- **WHEN** `preventDoubleElevation()` is called
- **THEN** both properties SHALL be preserved
- **AND** `doubleElevationsFixed` SHALL be 0

#### Scenario: [SDX-DE-011] non-target style is not modified
- **GIVEN** a custom character style "MyStyle" with `w:vertAlign="superscript"` and `w:position="6"` (not in the default allowlist)
- **WHEN** `preventDoubleElevation()` is called with default options
- **THEN** the style SHALL be unchanged
- **AND** `doubleElevationsFixed` SHALL be 0

#### Scenario: [SDX-DE-012] handles both FootnoteReference and EndnoteReference
- **GIVEN** both `FootnoteReference` and `EndnoteReference` styles with double elevation
- **WHEN** `preventDoubleElevation()` is called
- **THEN** both SHALL be fixed
- **AND** `doubleElevationsFixed` SHALL be 2
