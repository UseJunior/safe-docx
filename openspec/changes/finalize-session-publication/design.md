## Context
Sessions own parsed documents and temporary files. Production opens already require normalization and paragraph anchors, but responsibility is split between callers and the manager. This permits a candidate to become visible before preparation succeeds.

## Decisions
The manager loads, writes and finalizes a private DOCX candidate. Setting the canonical-path registry entry is the commit point. Only then does it retire the previous resource. ODF callers continue to supply loaded provider objects, with the same write/publication boundary. Google Docs reuse goes through the expiry-aware lookup.

Finalization results live in a WeakMap so legacy explicit finalization calls are inert and cannot change the initial skip-normalization policy. Comparison baselines remain lazy.

Directory removal never rejects. Concurrent requests share one attempt; unsuccessful removals retain only a directory path for a clear-all retry. Paths are forgotten only after successful removal. Synchronous expiry lookups remove the registry entry immediately and schedule cleanup; clear-all drains pending cleanup. This avoids unhandled rejection and ambiguous post-publication creation failure.

## Risks / Trade-offs
Permanent filesystem failures retain directory paths until manager disposal; clear-all retries but cannot guarantee deletion when the OS refuses it. No background timers are introduced. Open/close coordination and concurrent-open cancellation belong to dependent issue #1298.
