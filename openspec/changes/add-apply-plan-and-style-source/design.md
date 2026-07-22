## Context
`insert_paragraph` clones formatting from the positional anchor. Inserting body text after a heading therefore produces a wrongly-styled paragraph. Callers need to choose the formatting source independently of where the paragraph lands.

> Note: the batch-apply design that originally lived here is superseded by `batch_edit`
> (change `replace-plan-tools-with-batch-edit`) and has been removed. Only the
> `style_source_id` design remains.

## Goals / Non-Goals
- Goals:
  - Decouple positional anchor from formatting source for insert operations.
- Non-Goals:
  - Auto-resolve semantic or legal conflicts.

## Decisions

### Decision: style_source_id falls back to anchor with warning
- When `style_source_id` is provided but the referenced paragraph is not found, the operation falls back to using the positional anchor for formatting.
- A `style_source_warning` field is included in the response.
- Formatting precedence: `style_source_id` sets base pPr/rPr; role-model overlays still apply on top.
- Rationale: hard failure would be too disruptive for agents that may reference stale IDs. The warning lets the agent detect and correct the issue without losing the edit.

## Risks / Trade-offs
- Risk: style_source_id fallback may mask bugs in agent-generated plans.
  - Mitigation: Warning is prominently surfaced in the response. Agents can check for it.
