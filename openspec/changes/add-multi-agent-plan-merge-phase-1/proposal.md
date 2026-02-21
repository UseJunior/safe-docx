# Change: Add Multi-Agent Plan Coordination (Phase 1)

## Why
Parallel legal review by multiple sub-agents is valuable for latency and context quality, but current merge behavior is mostly empirical (fan out full document copies, replay opcodes, observe failures). That is expensive, noisy, and not fully auditable.

We need a lightweight first phase that improves determinism without overbuilding orchestration infrastructure.

## What Changes
- Add a coordination bootstrap tool (`init_plan`) that emits a reusable plan context artifact from the active document/session.
- Add a deterministic merge/analyze tool (`merge_plans`) that combines multiple sub-agent plans into one master plan artifact.
- Add hard conflict detection for known unsafe cases (shared-base mismatch, duplicate step IDs, overlapping replace spans, unknown replace spans in same paragraph, same-slot insert collisions).
- Keep Phase 1 stateless beyond existing session storage (no remote plan memory service).
- Keep AI orchestration out of scope; this is a harness for external orchestrators and agents.

## Impact
- Affected specs: `mcp-server`
- Affected code:
  - `packages/safe-docx/src/server.ts`
  - `packages/safe-docx/src/tools/` (new `init_plan`, `merge_plans`)
  - `packages/safe-docx/src/**/*.test.ts`
