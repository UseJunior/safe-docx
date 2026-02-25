## Context
Agents editing complex legal documents need a streamlined pipeline: build a plan, then apply it in one call. The current workflow requires the orchestrator to loop over individual edit tool calls, which is error-prone and chatty. The `merge_plans` tool already produces a structured steps array; `apply_plan` consumes it directly.

## Goals / Non-Goals
- Goals:
  - Reduce the common edit pipeline from 7+ tool calls to 3 (read_file, apply_plan, download).
  - Validate all steps before execution so agents get complete error diagnostics without partial mutation.
  - Decouple positional anchor from formatting source for insert operations.
  - Maintain backward compatibility with existing init_plan/merge_plans/replace_text/insert_paragraph workflows.
- Non-Goals:
  - Build a full agent orchestration runtime (remains external).
  - Auto-resolve semantic or legal conflicts.
  - Replace init_plan/merge_plans (those remain useful for multi-agent coordination).
  - Add validate-only or dry_run modes (keep the tool simple: one mode).
  - Implement undo/rollback or base_revision checking.

## Decisions

### Decision: Single mode — validate then apply
- `apply_plan` validates all steps up front (IDs exist, old_strings match uniquely, style sources exist, operations supported).
- If any step fails validation, all errors are returned without applying anything.
- If validation passes, steps are executed sequentially on the real session.
- Rationale: eliminates the complexity of separate validate/dry_run/apply modes. One call does everything. Agents that want validation-only can inspect the response and resubmit against the original document.

### Decision: Step normalization — raw and merged formats
- Steps can arrive as raw objects with top-level fields (`step_id`, `operation`, `paragraph_id`, `old_string`, `new_string`, etc.) or as `merge_plans` output where operation-specific fields are nested inside `step.arguments`.
- Normalization extracts only known fields into fresh objects. Unknown fields are silently ignored.
- Fresh objects prevent `__proto__` pollution — no property spreading from untrusted input.
- Rationale: lets agents pipe `merge_plans` output directly into `apply_plan` without reformatting, while also supporting hand-authored plans.

### Decision: Stop-on-first-error during execution
- Later steps may depend on earlier ones (e.g., insert a paragraph, then replace text in the anchor below it).
- On execution failure, the response includes `completed_step_ids`, `failed_step_id`, and `failed_step_index`.
- The agent can reapply the full plan to the original DOCX (re-download or re-open) rather than trying to resume from the failure point.
- Rationale: simpler than partial resume. Legal documents are small enough that full replay is fast.

### Decision: Each tool handles its own markEdited()
- `apply_plan` calls existing `replaceText()` / `insertParagraph()` in a loop. Each of those primitives already calls `markEdited()` internally.
- No refactoring of markEdited into apply_plan. This avoids touching existing tool internals.
- Rationale: minimal diff, keeps each primitive self-contained.

### Decision: plan_file_path security
- `plan_file_path` is validated with `enforceReadPathPolicy()` (same policy as `read_file`).
- Maximum file size: 1 MB.
- Must have `.json` extension.
- If both `steps` and `plan_file_path` are supplied, the request is rejected with an error.
- Rationale: prevents reading arbitrary files, limits memory pressure, and avoids ambiguity.

### Decision: style_source_id falls back to anchor with warning
- When `style_source_id` is provided but the referenced paragraph is not found, the operation falls back to using the positional anchor for formatting.
- A `style_source_warning` field is included in the response.
- Formatting precedence: `style_source_id` sets base pPr/rPr; role-model overlays still apply on top.
- Rationale: hard failure would be too disruptive for agents that may reference stale IDs. The warning lets the agent detect and correct the issue without losing the edit.

## Risks / Trade-offs
- Risk: Stop-on-first-error may leave partial state in the session.
  - Mitigation: Return `completed_step_ids` so the caller knows exactly what was applied. The agent can reapply the full plan to the original document.
- Risk: style_source_id fallback may mask bugs in agent-generated plans.
  - Mitigation: Warning is prominently surfaced in response. Agents can check for it.
- Risk: `__proto__` injection via step fields.
  - Mitigation: Normalization creates fresh objects with only known fields extracted by name. No object spreading from untrusted input.
