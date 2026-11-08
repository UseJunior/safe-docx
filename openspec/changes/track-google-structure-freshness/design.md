## Decisions
Use an explicit three-value freshness state and a per-document promise tail. Rejection releases the queue. Public methods acquire ownership once and call private steps, avoiding reentrant public writes and framework dependencies.

`executeBatchUpdate(requests)` keeps its existing absolute-request contract and marks acknowledged writes stale. Cached-index consumers use `executePlannedBatchUpdate(plan)`: refresh if needed, synchronously build requests while owning the queue, then send. Empty plans do not send a batch. Public refreshes share the same queue, preventing older reads from overwriting acknowledged writes.

Normal replacement/insertion retains its existing post-edit refresh and insertion anchor refresh. Acknowledgement updates the confirmed-write version and revision before any follow-up read. Failed refresh leaves old structure present but stale, retains the remote counters, and blocks further cached-index writes until a refresh succeeds. Anchor maintenance invalidates freshness without incrementing the user confirmed-write counter, preserving foundation F.

Synchronous cache getters remain snapshot accessors. They do not perform network I/O or promise current data. MCP selector prechecks explicitly refresh; layout builds indexes inside the queue. Direct absolute-index API callers retain responsibility for their supplied indexes.

## Risks
Operations now wait for earlier refreshes, intentionally trading concurrency for coherent indexes. External collaborators still use Google's required-revision control; there is no new cloud rollback or live-document smoke.
