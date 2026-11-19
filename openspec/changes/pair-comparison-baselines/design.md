## Decisions
An absent WeakMap entry is idle. A loading entry owns an original-buffer identity and one promise. A ready entry owns the same source identity and a complete pair. Promises never enter cloneable session metadata. Legacy nullable fields are written together only at successful publication and never establish readiness.

The producer loads a private document from the captured original buffer, normalizes it, inserts baseline bookmarks and serializes both variants locally. Publication checks active session identity, expiry, source identity and attempt ownership without an intervening await. A failed attempt removes only its own loading entry, so a replaced source's newer attempt survives. Live document mutations do not invalidate immutable original baselines.

## Trade-offs
Legacy fields remain for internal compatibility, but consumers use the returned pair. Buffers are treated as immutable resources, as the original buffer already is. No retry timers, cancellation framework or new MCP error shape is added.
