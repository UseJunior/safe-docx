## ADDED Requirements

### Requirement: Document mutation history and versioned views
DocxDocument SHALL maintain a monotonically increasing, instance-local mutation
version covering body, selected story, and package-part edits. It SHALL expose
`markMutated(): void` for callers that mutate exposed DOM elements and
`getMutationVersion(): number` for observing history. Cached views SHALL be
reused only when their version and all rendering options match. Reads and
serialization SHALL NOT reset or decrease mutation history. Versions are
invalidation tokens, not exact counts of edits; conservative advancement after
a failed operation is allowed, and callers SHALL NOT infer transactional rollback
from a version.

#### Scenario: Reads preserve mutation history and valid cache identity
- **GIVEN** an edited document with a cached view
- **WHEN** the caller reads the view repeatedly or changes rendering options
- **THEN** the mutation version SHALL remain unchanged
- **AND** a view with matching options and version SHALL reuse its nodes.

#### Scenario: Built-in and notified edits invalidate older views
- **WHEN** a body, selected story, or package-part edit succeeds, or an exposed
  DOM edit is followed by `markMutated()`
- **THEN** the version SHALL increase and older cached views SHALL NOT be reused
- **AND** proofing-marker-only and rsid-only normalization SHALL count as edits.

#### Scenario: Temporary story contexts restore body state without rewinding history
- **WHEN** a synchronous temporary-story callback reads or mutates a story,
  including a callback that throws
- **THEN** the body DOM and bookmark reservation SHALL be restored
- **AND** a body cache SHALL NOT be served inside the temporary story
- **AND** the prior body cache SHALL be restored only if its version still matches
- **AND** an observed mutation version SHALL never decrease.

#### Scenario: Serialization failure preserves mutation history and baseline
- **WHEN** isolated serialization fails and is retried
- **THEN** the live cache, mutation version, and original minimal-reserialization
  baseline SHALL remain intact.
