## ADDED Requirements

### Requirement: Plan Initialization for Coordinated Multi-Agent Editing
The Safe-Docx MCP server SHALL provide an `init_plan` tool that emits plan-context metadata for orchestrating multiple sub-agent plan submissions against a shared document revision.

#### Scenario: init_plan returns revision-bound context
- **WHEN** `init_plan` is called with `session_id` or `file_path`
- **THEN** the server returns a plan context containing resolved session/file metadata
- **AND** includes `base_revision` derived from the active editing session
- **AND** includes a generated `plan_context_id` for caller-side audit correlation

#### Scenario: init_plan uses file-first session resolution
- **WHEN** `init_plan` is called with `file_path` and no `session_id`
- **THEN** the server resolves a session using standard file-first behavior
- **AND** returns `resolved_session_id` and `resolved_file_path`

### Requirement: Deterministic Plan Merge and Conflict Analysis
The Safe-Docx MCP server SHALL provide `merge_plans` to deterministically combine multiple sub-agent plans and detect structural conflicts before apply.

#### Scenario: merge_plans returns merged artifact when no conflicts
- **GIVEN** multiple valid plans sharing one `base_revision`
- **AND** no hard conflicts are detected
- **WHEN** `merge_plans` is called
- **THEN** the server returns `has_conflicts=false`
- **AND** returns a deterministic `merged_plan` artifact preserving stable step order

#### Scenario: merge_plans reports base-revision conflict
- **GIVEN** plans with mismatched `base_revision` values
- **WHEN** `merge_plans` is called
- **THEN** the server reports a `BASE_REVISION_CONFLICT`

#### Scenario: merge_plans reports overlapping replace ranges
- **GIVEN** two replace steps targeting the same paragraph with overlapping `[start,end)` ranges
- **WHEN** `merge_plans` is called
- **THEN** the server reports `OVERLAPPING_REPLACE_RANGE`

#### Scenario: merge_plans reports unknown-range conflict for same paragraph
- **GIVEN** two replace steps targeting the same paragraph
- **AND** one or both steps omit explicit range metadata
- **WHEN** `merge_plans` is called
- **THEN** the server reports `UNKNOWN_REPLACE_RANGE`

#### Scenario: merge_plans reports insert-slot collision
- **GIVEN** two insert steps targeting the same anchor paragraph and same insertion position
- **WHEN** `merge_plans` is called
- **THEN** the server reports `INSERT_SLOT_COLLISION`

#### Scenario: merge_plans reports duplicate step IDs
- **GIVEN** two submitted steps share the same `step_id`
- **WHEN** `merge_plans` is called
- **THEN** the server reports `DUPLICATE_STEP_ID`

#### Scenario: merge_plans fails by default when conflicts exist
- **GIVEN** one or more hard conflicts are detected
- **WHEN** `merge_plans` is called without overriding conflict behavior
- **THEN** the server returns an error result with conflict diagnostics

#### Scenario: merge_plans can return diagnostics without hard failure
- **GIVEN** one or more hard conflicts are detected
- **WHEN** `merge_plans` is called with `fail_on_conflict=false`
- **THEN** the server returns success with `has_conflicts=true`
- **AND** includes conflict diagnostics and a partial merged artifact for caller review
