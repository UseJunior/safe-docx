## ADDED Requirements

### Requirement: Replacement sibling-range preflight
Text replacement SHALL validate that its indexed endpoint runs are attached,
share a parent and form a forward-reachable inclusive sibling range before any
boundary split or other DOM write.

#### Scenario: Inconsistent endpoints fail without partial mutation
- **GIVEN** an indexed replacement range with reversed, detached, non-sibling or unreachable endpoint runs
- **WHEN** replacement is attempted
- **THEN** the operation fails before splitting runs
- **AND** the entire document DOM is unchanged

#### Scenario: A single-node range is reachable
- **GIVEN** an attached run that supplies both endpoints
- **WHEN** a valid text range or zero-length insertion is replaced
- **THEN** preflight accepts the range and existing replacement semantics apply

### Requirement: Local embedded-content deletion segments
Text replacement SHALL preserve embedded objects and sibling markers in their
original order and use private deletion-segment state that terminates at each
preserved boundary. Existing text-only revision grouping SHALL remain unchanged.

#### Scenario: Accept and reject survive DOCX serialization
- **GIVEN** text interleaved with embedded objects, including consecutive objects or mixed runs inside supported wrappers
- **WHEN** the text is replaced with tracked changes and saved/reopened
- **THEN** accepting reproduces the clean replacement's complete text/object order
- **AND** rejecting restores the original complete text/object order
- **AND** both projections survive another DOCX save/reopen
