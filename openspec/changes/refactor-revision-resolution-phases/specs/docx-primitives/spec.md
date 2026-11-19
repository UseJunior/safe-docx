## ADDED Requirements
### Requirement: Ordered revision resolution passes
The accept/reject implementation SHALL express its established resolution order
as private named passes, preserving selectors, counters and supported revision
results. Unsupported structural records SHALL retain their existing policy.

#### Scenario: structural and nested revisions interact
- **WHEN** accept/reject resolves rows, nested content wrappers, property history and paragraph marks
- **THEN** row topology SHALL resolve before mark discovery, bookmark analysis before content removal, and property history before final paragraph merging
- **AND** surviving objects and text SHALL retain document order

#### Scenario: selective and deferred revisions survive
- **WHEN** a filter selects only some revisions
- **THEN** foreign revision subtrees and deferred structural records SHALL retain their established representation

#### Scenario: resolution fails on an unpublished mutation fork
- **WHEN** a later story resolution throws after earlier passes changed an unpublished document fork
- **THEN** the low-level operation SHALL propagate the failure without claiming atomicity
- **AND** session publication safety SHALL remain the caller's responsibility
