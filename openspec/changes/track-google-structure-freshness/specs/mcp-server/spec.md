## ADDED Requirements

### Requirement: Google write planning owns current structure
Google document helpers SHALL serialize writes and explicit refreshes per document. The cached structure SHALL distinguish unloaded, current and stale-after-write states. Index-based edits and MCP layout request construction SHALL refresh stale structure before computing indexes while owning the write queue. Normal edits SHALL retain their post-edit refreshes. A rejected remote write SHALL NOT count as an acknowledged mutation. An acknowledged user write SHALL remain recorded even when a subsequent refresh fails; stale local state SHALL NOT be treated as a rollback of that remote write.

#### Scenario: Raw write precedes cached-index planning
- **WHEN** an acknowledged raw write shifts paragraph indexes
- **THEN** a subsequent edit or MCP layout plan refreshes before resolving its target range
- **AND** no request based on the stale cached indexes reaches the provider

#### Scenario: Refresh fails after remote success
- **WHEN** Google acknowledges an edit and the normal post-edit refresh fails
- **THEN** confirmed-write and edit accounting remain recorded and structure remains stale
- **AND** later index-based writes require a successful refresh before sending

#### Scenario: Concurrent writes and refreshes
- **WHEN** multiple writes and explicit refreshes target the same document concurrently
- **THEN** request planning, acknowledgement and normal refresh complete in queue order
- **AND** a failed operation releases the queue for recovery
