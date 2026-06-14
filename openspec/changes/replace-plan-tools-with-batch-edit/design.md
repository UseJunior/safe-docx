## Context
Three plan-vocabulary tools (`init_plan`, `merge_plans`, `apply_plan`) implement a multi-agent edit pipeline. A single agent now emits a whole edit list in one call, so the fan-out is rarely used. This change collapses the surface to one `batch_edit` tool while preserving the two pieces that earn their keep: validate-then-apply and conflict detection.

## Goals / Non-Goals
- Goals:
  - One discoverable tool (`batch_edit`) for applying N edit steps in a single call.
  - Preserve conflict detection (duplicate ids, overlapping replace ranges, insert-slot collisions) as a pre-flight inside `batch_edit`.
  - Remove the three plan tools from the MCP server and CLI; keep the surface coherent (specs, manifest, docs, provider parity).
- Non-Goals:
  - A true all-or-nothing transaction (clone-then-commit rollback). `batch_edit` keeps `apply_plan`'s existing semantics: validation/conflict failures apply zero steps; an execution failure may leave a partial prefix applied. A real transaction can be a follow-up.
  - Multi-agent plan coordination (`init_plan`/`merge_plans` are removed, not preserved).
  - Optimistic concurrency / `base_revision` enforcement (the inert `init_plan` token pretended to offer this; it is dropped, not fixed here).

## Decisions

### Decision: Pipeline order — normalize → validate → conflict pre-flight → apply
The conflict detectors require resolved `[start,end)` ranges, but `replace_text` steps carry `old_string`/`new_string`, not ranges. Validation already resolves each `old_string` to a unique match (`findUniqueSubstringMatch`). So the order must be: normalize steps → validate all (capturing the resolved range onto each replace step) → build a conflict-view and run the detectors on real ranges → apply sequentially.
- Rationale: running detectors before validation would see missing ranges and reject legitimate same-paragraph replaces with `UNKNOWN_REPLACE_RANGE`. Because validation requires a unique match, every validated replace has a concrete range, so that path is unreachable inside `batch_edit`.

### Decision: Honest failure semantics, not "atomic"
Validation failures and conflict findings apply zero steps and return diagnostics. An execution-time failure stops at the first failing step and returns `completed_step_ids` + `failed_step_id` + `failed_step_index`; a partial prefix may have applied. The agent reapplies the full batch to the original document rather than resuming mid-batch.
- Rationale: this is the existing, proven `apply_plan` behavior. Claiming full atomicity would require a new clone-then-commit model — out of scope.

### Decision: No `fail_on_conflict` flag
Conflicts are always a hard pre-flight rejection that applies nothing. `merge_plans`' diagnostics-without-failure mode existed to return a partial merged artifact for a downstream `apply_plan`; with one tool there is no such hand-off, so the flag is dropped to keep mutation semantics simple.

### Decision: Drop `detectBaseRevisionConflicts`
A single `batch_edit` call operates against one session revision, so cross-plan base-revision reconciliation is meaningless. Only duplicate-step-id, overlapping-replace-range, and insert-slot-collision detectors are carried over.

### Decision: Relocate file-private helpers intentionally
`apply_plan.ts`/`merge_plans.ts` export only `applyPlan`/`mergePlans`; the engine and detectors are file-private. They are moved into `batch_edit.ts` (or a `batch_edit_core.ts`) as the old files are deleted — a deliberate relocation, not a cross-file import.

### Decision: Coordinated reconciliation of the unarchived apply-plan change
`add-apply-plan-and-style-source` (never archived) ADDs the `apply_plan` requirement and MODIFIEs Canonical naming to add an `apply_plan` alias scenario. Both reference tools this change removes. That change is reconciled in lockstep: its `apply_plan` ADDED requirement and its MODIFIED Canonical block are removed; its `style_source_id` requirement (ADDED Style Source Decoupling + the docx-primitives delta) is kept. This change owns the single Canonical MODIFICATION (dropping the `merge_plans` scenario), avoiding two active changes modifying the same base requirement.

## Risks / Trade-offs
- Breaking change to the MCP/CLI tool surface. Acceptable: the tools are recent and `apply_plan` was never archived → near-zero external usage.
- Removing the archived `add-multi-agent-plan-merge-phase-1` coverage test drops that feature from the default spec-coverage matrix (the script unions active changes + features with existing test mappings). A scoped `--feature add-multi-agent-plan-merge-phase-1` run would fail post-deletion, but the default gate does not run it.
