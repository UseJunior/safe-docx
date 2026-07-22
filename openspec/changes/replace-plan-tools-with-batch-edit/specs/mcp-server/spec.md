## ADDED Requirements

### Requirement: Batch Edit Tool
The Safe-Docx MCP server SHALL provide a `batch_edit` tool that applies multiple edit steps to the session document in a single call. It validates all steps up front, runs a conflict pre-flight over the validated steps, then executes them sequentially. It is the single-agent front door for multi-edit batches; the server SHALL NOT expose `init_plan`, `merge_plans`, or `apply_plan`.

#### Scenario: batch_edit applies all valid steps in order
- **GIVEN** a session with a document and a batch of N valid edit steps
- **WHEN** `batch_edit` is called with those steps
- **THEN** the server SHALL validate all steps first
- **AND** SHALL execute all N steps sequentially on the session document
- **AND** SHALL return `success: true` with per-step results and `completed_count` equal to N

#### Scenario: batch_edit validation failure applies zero steps
- **GIVEN** a batch containing one or more invalid steps (missing target id, non-unique `old_string` match, or unsupported operation)
- **WHEN** `batch_edit` is called
- **THEN** the server SHALL report validation diagnostics for all invalid steps
- **AND** SHALL NOT apply any step to the session document
- **AND** SHALL return `success: false`

#### Scenario: batch_edit conflict pre-flight rejects overlapping replace ranges
- **GIVEN** two `replace_text` steps targeting the same paragraph whose resolved `[start,end)` ranges overlap
- **WHEN** `batch_edit` is called
- **THEN** the server SHALL run the conflict pre-flight after validation resolves each `old_string` to a concrete range
- **AND** SHALL report an `OVERLAPPING_REPLACE_RANGE` conflict
- **AND** SHALL NOT apply any step

#### Scenario: batch_edit conflict pre-flight rejects duplicate step ids
- **GIVEN** a batch where two steps share the same `step_id`
- **WHEN** `batch_edit` is called
- **THEN** the server SHALL report a `DUPLICATE_STEP_ID` conflict
- **AND** SHALL NOT apply any step

#### Scenario: batch_edit conflict pre-flight rejects insert-slot collision
- **GIVEN** two `insert_paragraph` steps targeting the same anchor paragraph and the same insertion position
- **WHEN** `batch_edit` is called
- **THEN** the server SHALL report an `INSERT_SLOT_COLLISION` conflict
- **AND** SHALL NOT apply any step

#### Scenario: batch_edit preserves run formatting on replace
- **GIVEN** a paragraph whose target text is split across multiple runs
- **WHEN** `batch_edit` applies a `replace_text` step over that text
- **THEN** the replacement SHALL preserve the surrounding run formatting

#### Scenario: batch_edit execution failure stops at first failing step
- **GIVEN** a batch that passes validation and conflict pre-flight but whose step at index k fails during execution
- **WHEN** `batch_edit` is called
- **THEN** the server SHALL stop at the first failing step and SHALL NOT attempt later steps
- **AND** the response SHALL include `completed_step_ids`, `failed_step_id`, and `failed_step_index`
- **AND** the contract SHALL be partial-on-execution-failure, NOT all-or-nothing

#### Scenario: batch_edit reads steps from plan_file_path json array
- **WHEN** `batch_edit` is called with `plan_file_path` pointing to a JSON file containing an array of steps
- **THEN** the server SHALL validate the path with `enforceReadPathPolicy()`
- **AND** SHALL reject files without a `.json` extension or exceeding 1 MB
- **AND** SHALL parse the file as a JSON array of steps and apply them as if provided inline

#### Scenario: batch_edit rejects both steps and plan_file_path together
- **WHEN** `batch_edit` is called with both `steps` and `plan_file_path`
- **THEN** the server SHALL return an error without applying any step

#### Scenario: batch_edit rejects unsupported operations and legacy aliases
- **GIVEN** a step whose `operation` is not `replace_text` or `insert_paragraph` (including legacy `smart_edit` / `smart_insert`)
- **WHEN** `batch_edit` is called with that step
- **THEN** the batch SHALL be rejected without applying any step
- **AND** the diagnostic SHALL name the offending operation and suggest using `replace_text` or `insert_paragraph`

## MODIFIED Requirements

### Requirement: Canonical Edit and Insert Naming Only
The Safe-Docx MCP surface SHALL expose canonical mutation tool names and SHALL NOT expose legacy smart aliases. (The former `merge_plans` plan-operation alias-rejection scenario is removed together with the `merge_plans` tool; alias rejection for batch steps is covered by the Batch Edit Tool requirement.)

#### Scenario: canonical names are advertised
- **WHEN** clients request the MCP tool catalog
- **THEN** canonical names `replace_text` and `insert_paragraph` are listed

#### Scenario: legacy aliases are unavailable
- **WHEN** clients inspect the MCP tool catalog
- **THEN** `smart_edit` and `smart_insert` are not listed

## REMOVED Requirements

### Requirement: Plan Initialization for Coordinated Multi-Agent Editing
**Reason**: The `init_plan` tool issued a `plan_context_id` + `base_revision` token that was never enforced downstream (apply never checked `base_revision`), performed no document mutation, and is unused by single-agent callers.
**Migration**: None. Agents call `batch_edit` directly with their steps; no initialization handshake is required.

### Requirement: Deterministic Plan Merge and Conflict Analysis
**Reason**: The `merge_plans` tool combined multiple sub-agent plans, a multi-agent workflow that single-agent callers do not use. Its conflict detection (duplicate step ids, overlapping replace ranges, insert-slot collisions) is preserved inside the `batch_edit` pre-flight.
**Migration**: Submit all steps inline to `batch_edit`; conflicts are reported by its pre-flight before any step is applied.
