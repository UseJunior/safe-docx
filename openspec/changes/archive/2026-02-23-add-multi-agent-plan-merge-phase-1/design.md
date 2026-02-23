## Context
Users run parallel sub-agent reviews (termination, dispute resolution, governing law, finance definitions, etc.) and then merge edits back into one document. Current fan-out/replay flow works but is expensive and does not provide first-class deterministic conflict analysis artifacts.

## Goals / Non-Goals
- Goals:
  - Provide a minimal, deterministic coordination harness for multi-agent editing.
  - Produce auditable merge artifacts before mutation.
  - Preserve local-first trust boundaries and avoid new remote state requirements.
- Non-Goals:
  - Build a full agent orchestration runtime.
  - Auto-resolve semantic/legal conflicts.
  - Replace atomic apply behavior (handled in separate apply workflow).

## Decisions
- Decision: Terraform-like staged workflow in Phase 1.
  - `init_plan`: emit a plan context artifact with base revision metadata.
  - `merge_plans`: analyze and merge sub-agent plans into one master plan.
  - `apply_plan`: unchanged from separate execution workflow.
- Decision: Hard conflicts block merge by default.
  - Default `fail_on_conflict=true`.
  - Optionally allow callers to inspect a partial merged artifact with `fail_on_conflict=false`.
- Decision: Deterministic scope.
  - Conflict checks are structural and span-based, not semantic/legal reasoning.
  - Unknown replace spans in the same paragraph are treated as hard conflicts for safety.
- Decision: Stateless plan artifacts.
  - Plan context and merged plan are returned to caller; no new server-side long-lived plan registry.

## Conflict Model (Phase 1)
- Base revision conflict: plans claim different `base_revision` values.
- Duplicate step ID conflict: same `step_id` appears more than once.
- Overlapping replace range conflict: same paragraph, overlapping `[start,end)` spans.
- Unknown replace range conflict: same paragraph, one or more replace steps missing explicit span metadata.
- Insert slot collision: same anchor paragraph + same position (`BEFORE`/`AFTER`).

## Risks / Trade-offs
- Risk: False positives from unknown replace ranges may require more pre-resolution work.
  - Mitigation: require explicit spans for high-throughput merges; keep diagnostics actionable.
- Risk: No semantic conflict detection.
  - Mitigation: preserve review step after deterministic merge and before apply.

## Migration Plan
1. Add `init_plan` and `merge_plans` tools.
2. Add tests for deterministic conflict detection and merged artifact output.
3. Wire into MCP tool catalog and server dispatch.
4. Keep orchestration/runtime features for a future Phase 2 proposal.
