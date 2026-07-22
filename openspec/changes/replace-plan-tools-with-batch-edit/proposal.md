# Change: Replace `init_plan`/`merge_plans`/`apply_plan` with a single `batch_edit` tool

## Why
The MCP server exposes three plan-vocabulary tools modeled on Terraform's plan/apply pattern for *multi-agent* document editing:

- `init_plan` issues a `plan_context_id` + `base_revision` token, but enforces nothing — `apply_plan` lists `base_revision` checking under *Non-Goals*, so the token is never validated downstream. It performs no document mutation and has no downstream enforcement. Dead ceremony.
- `merge_plans` deterministically merges N sub-agent plans and detects hard conflicts. The logic is real but only meaningful when multiple *independent* plans exist.
- `apply_plan` validates all steps, then applies them — this is the actual batch-edit capability.

Single-agent LLMs emit a full edit list in one call; the multi-agent fan-out these tools coordinate is rarely used (`apply_plan`'s own OpenSpec change was never archived). The two valuable pieces — validate-then-apply and conflict detection — collapse into one ergonomic tool named the way agents already reach for it: `batch_edit`.

## What Changes
- Add a `batch_edit` MCP tool: the single-agent front door for applying multiple edit steps in one call.
  - Validates all steps up front; on any validation failure, applies **zero** steps and returns per-step diagnostics.
  - Runs a conflict pre-flight (duplicate step ids, overlapping replace ranges in one paragraph, insert-slot collisions) **after** validation resolves each `replace_text` `old_string` to a concrete `[start,end)` range; on any conflict, applies **zero** steps.
  - Then executes steps sequentially. An execution-time failure stops at the first failing step and returns `completed_step_ids`, `failed_step_id`, and `failed_step_index` (a partial prefix may have applied — this is **not** an all-or-nothing transaction).
  - Accepts `steps` as a JSON array, or `plan_file_path` (a `.json` file holding a steps array; `enforceReadPathPolicy`, ≤1 MB). Does not accept a `merge_plans` envelope object.
- Remove `init_plan`, `merge_plans`, and `apply_plan` from the MCP surface and the CLI. Conflict detection is preserved inside `batch_edit`'s pre-flight.

## Impact
- Affected specs: `mcp-server`
  - ADDED: Batch Edit Tool.
  - REMOVED: Plan Initialization for Coordinated Multi-Agent Editing (`init_plan`); Deterministic Plan Merge and Conflict Analysis (`merge_plans`).
  - MODIFIED: Canonical Edit and Insert Naming Only — drop the `merge_plans` legacy-alias scenario so the base spec stops referencing a removed tool.
- Coordinated reconciliation of the unarchived `add-apply-plan-and-style-source` change: its `apply_plan` ADDED requirement and its MODIFIED Canonical block are removed there (both reference now-removed tools); its `style_source_id` work is retained.
- Affected code:
  - `packages/docx-mcp/src/tools/batch_edit.ts` (new; relocates the validate/apply engine + conflict detectors)
  - Delete `packages/docx-mcp/src/tools/{init_plan,merge_plans,apply_plan}.ts`
  - `packages/docx-mcp/src/server.ts`, `tool_catalog.ts`, `cli/index.ts`, `cli/commands/edit.ts`
  - `packages/google-docs-core/src/types.ts` (`PROVIDER_CAPABILITIES.docx`)
  - `packages/safe-docx-mcpb/manifest.json`, `packages/docx-mcp/docs/tool-reference.generated.md` (regenerated), `packages/docx-mcp/README.md`, `packages/docx-core/SUPPORT.md`
