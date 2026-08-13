## ADDED Requirements

### Requirement: Explicit run formatting is scoped and additive

The system SHALL permit a canonical replacement operation to declare direct
character formatting for newly generated text using a closed, domain-neutral
property vocabulary. The compiler SHALL clone the admitted inherited source
template first and apply only the explicitly declared overlay afterward.

#### Scenario: [SDX-MDOC-21] Plain source text becomes an explicitly formatted replacement
- **GIVEN** one plain source date and one replacement operation that generates a single blank
- **AND** the operation explicitly declares yellow highlight and single underline
- **WHEN** the operation compiles
- **THEN** only the generated blank SHALL carry direct yellow highlight and single underline
- **AND** undeclared inherited run properties SHALL remain unchanged

#### Scenario: [SDX-MDOC-22] Formatting is never inferred from replacement text
- **GIVEN** a replacement that generates underscores or other fill-in text
- **AND** no explicit run-format declaration
- **WHEN** the operation compiles
- **THEN** the replacement SHALL inherit only its admitted source template
- **AND** the system SHALL NOT infer highlight, underline, or any document-domain formatting

#### Scenario: [SDX-MDOC-23] Explicit formatting scope fails closed when ambiguous
- **GIVEN** one operation-level run-format declaration whose before/after alignment yields multiple generated replacement hunks
- **WHEN** validation or compilation determines the generated scope
- **THEN** compilation SHALL fail before mutation with a stable ambiguity diagnostic
- **AND** unchanged or unrelated text SHALL NOT be restyled

#### Scenario: [SDX-MDOC-24] Explicit formatting supports one zero-width insertion
- **GIVEN** one operation that inserts a single generated text hunk at a deterministic source boundary
- **AND** the operation declares admitted run formatting
- **WHEN** the operation compiles
- **THEN** the generated insertion SHALL receive the declared overlay on the inherited boundary template
- **AND** neighboring source text SHALL retain its existing properties

### Requirement: Formatting inheritance and explicit formatting remain distinct

The system SHALL treat `format-source` solely as selection of an existing source
run template. Explicit run formatting SHALL be represented separately and SHALL
NOT change the source substring used for inherited formatting.

#### Scenario: [SDX-MDOC-25] Plain format source remains plain without an overlay
- **GIVEN** an operation whose `format-source` names one unique unformatted source substring
- **AND** the operation declares no run-format overlay
- **WHEN** replacement text is generated
- **THEN** that replacement SHALL remain unhighlighted and not directly underlined

#### Scenario: [SDX-MDOC-26] Overlay preserves unrelated inherited properties
- **GIVEN** an admitted source template with font, size, color, bold, or italic properties
- **AND** an explicit overlay declaring only highlight and underline
- **WHEN** replacement text is generated
- **THEN** the replacement SHALL retain every undeclared inherited property
- **AND** SHALL add exactly the declared highlight and underline values

### Requirement: Projection certification includes semantic formatting fidelity

The system SHALL verify semantic formatting fidelity between the pinned source
and reject-all projection and between the generated clean output and accept-all
projection. Both checks SHALL contribute to projection verification and delivery
readiness independently of exact text checks.

#### Scenario: [SDX-MDOC-27] Formatting survives both tracked projections
- **GIVEN** a compiled tracked document with explicit or inherited direct run formatting
- **WHEN** projection verification runs
- **THEN** reject-all formatting SHALL be semantically equivalent to the pinned source
- **AND** accept-all formatting SHALL be semantically equivalent to the generated clean output
- **AND** harmless run fragmentation or canonical XML ordering SHALL NOT alone cause failure

#### Scenario: [SDX-MDOC-28] Dropped direct formatting blocks delivery
- **GIVEN** tracked output whose accepted projection drops a declared highlight or underline while preserving exact text
- **WHEN** certification runs
- **THEN** accept-text verification MAY pass
- **BUT** formatting projection verification SHALL fail with a bounded property-specific diagnostic
- **AND** `projectionPassed`, `passed`, and `deliveryReady` SHALL be false

#### Scenario: [SDX-MDOC-29] Certificate does not invent expected formatting
- **GIVEN** plain source text and a canonical operation with no explicit new formatting declaration
- **WHEN** the clean and tracked outputs remain plain
- **THEN** formatting projection verification SHALL pass
- **AND** the system SHALL NOT report missing formatting based on the semantic appearance of the replacement text

### Requirement: Inline run formatting identifies generated spans exactly

The system SHALL permit a clean `after` state to declare direct character
formatting on one or more exact inline spans. The IR SHALL retain revised-text
offsets for each declaration, and replay SHALL apply each overlay only to its
declared generated interval.

#### Scenario: [SDX-MDOC-30] Two generated spans in one paragraph are independently formatted
- **GIVEN** one replacement operation whose alignment produces two generated hunks
- **AND** each intended blank is wrapped by its own inline run-format declaration
- **WHEN** the operation compiles
- **THEN** both declared blanks SHALL carry their declared overlays
- **AND** intervening unchanged text SHALL retain its existing formatting

#### Scenario: [SDX-MDOC-31] Repeated generated text requires no occurrence selector
- **GIVEN** two generated spans with identical visible text in one clean `after` state
- **WHEN** each occurrence is wrapped inline
- **THEN** the parser SHALL retain distinct exact revised-text offsets
- **AND** replay SHALL format each occurrence without text-search ambiguity

#### Scenario: [SDX-MDOC-32] Inline formatting cannot reach unchanged text
- **GIVEN** an inline run-format span that includes any unchanged text or crosses a generated-hunk boundary
- **WHEN** scope validation runs
- **THEN** compilation SHALL fail before mutation with a stable scope diagnostic
- **AND** no output SHALL be emitted

#### Scenario: [SDX-MDOC-33] Inline formatting spans are structurally unambiguous
- **GIVEN** an empty, nested, or overlapping inline run-format declaration
- **WHEN** canonical Markdoc validation runs
- **THEN** validation SHALL fail with a stable diagnostic
- **AND** no operation SHALL enter replay
