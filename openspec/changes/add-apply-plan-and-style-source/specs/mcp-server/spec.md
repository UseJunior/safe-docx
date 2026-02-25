## ADDED Requirements

### Requirement: Batch Plan Execution with Built-in Validation
The Safe-Docx MCP server SHALL provide an `apply_plan` tool that validates all steps up front, then executes them sequentially on the session document. There is one mode: validate-then-apply in a single call.

#### Scenario: successful apply executes all steps
- **GIVEN** a session with a document and a plan containing N valid edit steps
- **WHEN** `apply_plan` is called with those steps
- **THEN** the server SHALL validate all steps first
- **AND** SHALL execute all N steps sequentially on the real session
- **AND** SHALL return `success: true` with per-step results
- **AND** `completed_count` SHALL equal N

#### Scenario: validation failure returns all errors without applying
- **GIVEN** a plan with multiple invalid steps (missing target IDs, non-unique old_string matches, unsupported operations)
- **WHEN** `apply_plan` is called
- **THEN** the server SHALL report validation errors for ALL invalid steps
- **AND** SHALL NOT apply any steps to the session document
- **AND** SHALL return `success: false` with per-step validation diagnostics

#### Scenario: partial apply failure stops on first error
- **GIVEN** a plan where step 3 of 5 fails during execution (after passing validation)
- **WHEN** `apply_plan` is called
- **THEN** the server SHALL return results for steps 1-2 (succeeded)
- **AND** SHALL return the error for step 3
- **AND** SHALL NOT attempt steps 4-5
- **AND** the response SHALL include `completed_step_ids`, `failed_step_id`, and `failed_step_index`

#### Scenario: step normalization accepts raw format
- **GIVEN** steps with top-level fields (`step_id`, `operation`, `paragraph_id`, `old_string`, `new_string`)
- **WHEN** `apply_plan` is called
- **THEN** the server SHALL accept and execute those steps

#### Scenario: step normalization accepts merged format
- **GIVEN** steps produced by `merge_plans` where operation-specific fields are nested inside `step.arguments`
- **WHEN** `apply_plan` is called with those steps
- **THEN** the server SHALL normalize and execute those steps without requiring format conversion

#### Scenario: __proto__ in step fields is rejected
- **GIVEN** a step containing `__proto__` as a field name
- **WHEN** `apply_plan` normalizes that step
- **THEN** the server SHALL ignore the `__proto__` field
- **AND** normalization SHALL extract only known fields into a fresh object

#### Scenario: plan steps loaded from file path
- **WHEN** `apply_plan` is called with `plan_file_path` pointing to a JSON file
- **THEN** the server SHALL validate the path with `enforceReadPathPolicy()`
- **AND** SHALL reject files without a `.json` extension
- **AND** SHALL reject files exceeding 1 MB
- **AND** SHALL read and parse the file as a JSON array of steps
- **AND** SHALL execute those steps as if they were provided inline

#### Scenario: error when both steps and plan_file_path supplied
- **WHEN** `apply_plan` is called with both `steps` and `plan_file_path`
- **THEN** the server SHALL return an error without applying any steps

#### Scenario: unsupported operation is rejected during validation
- **GIVEN** a plan step with `operation` other than `replace_text` or `insert_paragraph`
- **WHEN** `apply_plan` validates that step
- **THEN** the step SHALL be rejected with an `UNSUPPORTED_OPERATION` error

#### Scenario: legacy aliases rejected during validation
- **GIVEN** a plan step with `operation: "smart_edit"` or `operation: "smart_insert"`
- **WHEN** `apply_plan` validates that step
- **THEN** the step SHALL be rejected with an `UNSUPPORTED_OPERATION` error
- **AND** the error hint SHALL suggest using `replace_text` or `insert_paragraph`

### Requirement: Style Source Decoupling for insert_paragraph
The `insert_paragraph` tool SHALL accept an optional `style_source_id` parameter to decouple formatting source from positional anchor.

#### Scenario: style_source_id clones formatting from specified paragraph
- **GIVEN** a document with paragraph A (heading style) and paragraph B (body style)
- **WHEN** `insert_paragraph` is called with `positional_anchor_node_id: A`, `position: AFTER`, and `style_source_id: B`
- **THEN** the inserted paragraph SHALL be positioned after A
- **AND** paragraph properties (`w:pPr`) and template run formatting SHALL be cloned from B, not A

#### Scenario: style_source_id falls back to anchor with warning
- **GIVEN** a `style_source_id` that does not match any paragraph in the document
- **WHEN** `insert_paragraph` is called with that `style_source_id`
- **THEN** the server SHALL fall back to cloning formatting from the positional anchor
- **AND** SHALL include a `style_source_warning` field in the response explaining the fallback

#### Scenario: style_source_id omitted uses anchor formatting (backward compatible)
- **WHEN** `insert_paragraph` is called without `style_source_id`
- **THEN** the server SHALL clone formatting from the positional anchor paragraph
- **AND** behavior SHALL be identical to the current implementation

## MODIFIED Requirements

### Requirement: Canonical Edit and Insert Naming Only
The Safe-Docx MCP surface SHALL expose canonical mutation tool names and SHALL NOT expose legacy smart aliases.

#### Scenario: canonical names are advertised
- **WHEN** clients request the MCP tool catalog
- **THEN** canonical names `replace_text` and `insert_paragraph` are listed

#### Scenario: legacy aliases are unavailable
- **WHEN** clients inspect the MCP tool catalog
- **THEN** `smart_edit` and `smart_insert` are not listed

#### Scenario: legacy aliases are rejected inside plan operations
- **GIVEN** a merge plan step declares `operation: smart_edit` or `operation: smart_insert`
- **WHEN** `merge_plans` validates that step
- **THEN** the step is rejected with an unsupported operation conflict

#### Scenario: legacy aliases are rejected inside apply_plan steps
- **GIVEN** an apply_plan step declares `operation: "smart_edit"` or `operation: "smart_insert"`
- **WHEN** `apply_plan` validates that step
- **THEN** the step SHALL be rejected with an `UNSUPPORTED_OPERATION` error
- **AND** the error hint SHALL suggest using `replace_text` or `insert_paragraph`
