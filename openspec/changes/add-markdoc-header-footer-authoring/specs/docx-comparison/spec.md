## ADDED Requirements

### Requirement: Ordinary selected header and footer stories compare independently

The comparison engine SHALL independently compare ordinary paragraph content in
each paired header/footer story when original and revised packages retain the
same semantically selected story topology and admitted scaffold. It SHALL use
the shared tagged-tree semantics and splice tracked paragraph/run revisions into
the preserved revised story root. Physical package filenames SHALL NOT
establish story identity.

#### Scenario: [SDX-CMP-STORY-01] Ordinary selected header text receives native revisions
- **GIVEN** original and revised packages with the same selected default header scaffold and one changed ordinary paragraph
- **WHEN** the packages are compared
- **THEN** tracked insertion/deletion markup SHALL be emitted inside the selected header part
- **AND** accept-all SHALL recover the revised header text
- **AND** reject-all SHALL recover the original header text
- **AND** the represented header SHALL NOT remain in `unrepresentedChanges`

#### Scenario: [SDX-CMP-STORY-02] Semantic identity survives physical part renumbering
- **GIVEN** corresponding selected stories whose physical package filenames differ but whose semantic bindings and admitted scaffolds pair uniquely
- **WHEN** their ordinary paragraph content is compared
- **THEN** the engine SHALL treat them as one corresponding story
- **AND** SHALL NOT model the change as whole-story deletion and insertion

#### Scenario: [SDX-CMP-STORY-03] Shared selected story compares once
- **GIVEN** several section selectors that resolve to one physical header/footer part on each side
- **WHEN** that story's admitted paragraph text changes
- **THEN** the engine SHALL compare and splice the physical story exactly once
- **AND** accept/reject validation SHALL preserve the complete selector binding closure

### Requirement: Selected-story scaffold changes remain explicit and fail closed

Ordinary selected-story comparison SHALL preserve the story root, relationship
closure, fields, tables, drawings, content controls, and nested story scaffold.
Creation, deletion, rebinding, ambiguous pairing, or unsupported scaffold
mutation SHALL produce a typed diagnostic or `unrepresentedChanges` entry and
MUST NOT be silently represented as an ordinary text edit.

#### Scenario: [SDX-CMP-STORY-04] Field-bearing running text preserves field structure
- **GIVEN** a paired selected story containing an unchanged PAGE-family field and an admitted neighboring text edit
- **WHEN** comparison completes
- **THEN** the complete field structure and cached-result policy SHALL remain valid
- **AND** only the neighboring text change SHALL receive revision markup

#### Scenario: [SDX-CMP-STORY-05] Unsupported topology remains unrepresented
- **GIVEN** selected stories with creation, deletion, rebinding, ambiguous pairing, structural table mutation, drawing/content-control mutation, or nested-story change outside the admitted subset
- **WHEN** comparison is attempted
- **THEN** the engine SHALL return a typed unsupported-story diagnostic or retain a precise `unrepresentedChanges` entry
- **AND** SHALL NOT publish a tracked artifact that claims to represent the unsupported change
