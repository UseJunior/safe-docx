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

### Requirement: User-facing Google reads own current structure
Google MCP `read_file` and `grep` SHALL await current structure before returning content or matches. If refresh of known-stale structure fails, they SHALL return the existing structured read/search error rather than stale success. Current structure SHALL NOT trigger an extra fetch. Reads and searches SHALL NOT increment confirmed-write or session edit accounting and SHALL preserve existing response fields, selectors and budget semantics.

#### Scenario: Known-stale Google reads refresh before returning content
- **WHEN** a remote edit is acknowledged but its normal refresh fails
- **THEN** subsequent read_file and grep refresh and return the acknowledged document content or matches
- **AND** the confirmed write and session edit counts do not change

#### Scenario: Known-stale Google reads fail rather than serve old content
- **WHEN** the freshness retry fails before read_file or grep uses a stale snapshot
- **THEN** the tool returns READ_ERROR or SEARCH_ERROR respectively without stale content or matches
- **AND** the snapshot stays stale and the acknowledged edit remains recorded

#### Scenario: Current Google reads do not refetch
- **WHEN** read_file or grep reads already-current structure, including after a successful normal edit refresh
- **THEN** it returns its usual response without another API fetch or write
