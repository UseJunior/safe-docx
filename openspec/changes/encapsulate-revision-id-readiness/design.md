## Decisions
Keep `createRevisionIdState`, `allocateRevisionId`, revision contexts and caller
allocation callbacks synchronous and data-only. A separate managed allocator owns
the readiness union. It exposes plain ready state only after a successful seed;
failure resets readiness for retry. It has no reset/force-seed API that could let
an older seed overwrite allocations.

MCP stores controllers in a weak map, outside cloneable session data. A fork
clones a ready counter immediately or awaits the parent's shared seed and then
captures a checkpoint before returning detached ready data. Seed caching does
not publish tentative allocations or assign the active session's state field.
No-op, failed and retired candidates never publish their state. Successful
publication checks the parent against the checkpoint and advances the existing
plain object in place, so previously returned direct contexts remain current.
An overlapping direct allocation causes the candidate to be refused with a retry
hint; it cannot publish IDs that collide or rewind an active counter.

The seed scan uses current main-story DOM and supported current side stories.
It retains existing tolerance for malformed optional side parts and ignores
non-revision IDs. It changes neither revision signatures nor splitting/grouping.

## Compatibility
No MCP names, parameters or response shapes change. An optional internal context
template still supplies author/date to batch tools; its plain counter remains
separate from readiness. Core comparison emitters and custom allocation callbacks
retain their existing APIs. No FSM framework is introduced.
