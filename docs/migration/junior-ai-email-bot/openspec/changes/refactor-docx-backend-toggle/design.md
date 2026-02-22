## Context
The codebase currently imports `aspose.words` directly across many modules (workflows, services, report generation, tool_router). This undermines the `DOCUMENT_BACKEND` toggle and forces ad hoc conditional logic. Recent bugs surfaced when protocol wrappers were passed into Aspose-only APIs (e.g., `get_ancestor`), or when NodeType enums were used against raw Aspose nodes.

## Goals / Non-Goals
- Goals:
  - Enforce a single backend abstraction for .docx operations.
  - Minimize conditional logic in modules outside backend implementations.
  - Provide clear capability checks for Aspose-only features.
  - Maintain feature parity between Aspose and python-docx where declared.
- Non-Goals:
  - Rewriting redline/compare subsystems in docx backend in this change.
  - Removing Aspose dependency entirely.

## Decisions
- Decision: Use `app/shared/document_primitives` as the single entry point for document operations.
  - Rationale: It already defines protocol types, NodeType mapping, and backend selection.
- Decision: Isolate Aspose-only operations behind adapter functions and capability flags.
  - Rationale: Prevents scattered `if is_aspose_backend()` checks and avoids raw Aspose usage in higher layers.

## Alternatives considered
- Keep existing conditional logic and patch per failure.
  - Rejected: high maintenance cost and recurring regressions.
- Duplicate logic per backend in each module.
  - Rejected: not DRY and increases divergence risk.

## Risks / Trade-offs
- Risk: Migration churn across many modules.
  - Mitigation: Do a phased migration by subsystem and add focused regression tests.
- Risk: Some Aspose-only capabilities may not have docx equivalents.
  - Mitigation: Gate via `BackendCapabilities` and provide safe fallbacks.

## Migration Plan
1. Inventory all direct `aspose.words` imports and map to primitives capabilities.
2. Add adapter helpers for the most common raw Aspose APIs used (e.g., layout collector, comments, track changes, get_ancestor).
3. Migrate high-risk modules first (document_edit_utils, smart_edit/insert, document_view ingestion).
4. Migrate report generation and pipeline processors.
5. Enforce lint/CI check to block new direct Aspose imports outside primitives/backends.

## Open Questions
- Which subsystems are explicitly allowed to remain Aspose-only (e.g., redline/comparer)?
- Do we want a lightweight facade for redline-only operations or leave them as explicit Aspose components?
