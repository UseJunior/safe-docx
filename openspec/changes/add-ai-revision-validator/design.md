## Context

SafeDocX write tools emit AI-authored tracked changes while preserving third-party redlines. Real-world Word documents often contain odd or repeated foreign revision metadata, so validation must be strict enough to protect AI mutations without rejecting documents merely because they already contain imperfect human or vendor-authored markup.

The existing session mutation model does not provide generic rollback. `SessionManager.markEdited()` updates counters and caches after a mutation has already happened, so validation must happen on a cloned mutation result before the live session is changed.

## Goals / Non-Goals

- Goals:
  - Reject malformed AI-authored revision markup before it enters the live MCP session.
  - Preserve compatibility with real redlined documents containing foreign revision anomalies.
  - Use one shared tracked-change vocabulary for validation, save diagnostics, and revision-id seeding.
  - Validate package-level side effects such as relationship targets and content-type registrations.
- Non-Goals:
  - Selectively accepting or rejecting AI revisions; that is handled by `add-selective-ai-accept-reject`.
  - Classifying every tool surface in the catalog; that is handled by `add-revision-surface-classification`.
  - Rejecting all malformed foreign revision markup.

## Decisions

- Decision: AI-authored revision failures are errors; foreign revision anomalies are warnings.
  - Rationale: the server controls AI-authored output, but should not make existing third-party redlines unusable.
- Decision: authorless structures are validated through operation context.
  - Rationale: comments, bookmarks, relationships, and content types do not carry `w:author`, so validator callers must identify which structures the current AI operation touched.
- Decision: write tools validate on a cloned document before committing to the live session.
  - Rationale: there is no generic rollback mechanism after in-place mutation.
- Decision: package invariants resolve relationship targets relative to the owning `.rels` part and exempt external targets.
  - Rationale: OOXML relationships are relative to source part location, while external links intentionally do not have package entries.

## Risks / Trade-offs

- Strict validation could block real documents if it hard-fails foreign markup.
  - Mitigation: hard errors are scoped to the configured AI author and AI-touched authorless structures; foreign anomalies remain warnings.
- Clone preflight could add write latency.
  - Mitigation: scope validation to document.xml and the operation-touched parts, and avoid full package serialization unless package invariants require it.
- Validator coverage can drift from emitted vocabulary.
  - Mitigation: expose a shared Table A vocabulary constant and add corpus tests proving current emitters validate cleanly.

## Migration Plan

1. Introduce validator and tests without changing public tool names.
2. Wire MCP write tools through clone preflight.
3. Add save-time validation failure with structured diagnostics.
4. Keep existing bulk accept/reject and extraction behavior unchanged.

## Open Questions

- Which write tools should be in the first guarded slice if full coverage is too large for one PR?
- Should warnings be returned from every write response immediately, or only from save/status surfaces in this change?
