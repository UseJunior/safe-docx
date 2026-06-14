## 1. Specification (supervisor-authored)
- [ ] 1.1 mcp-server delta: ADDED `Batch Edit Tool`; REMOVED `init_plan` + `merge_plans` requirements; MODIFIED `Canonical Edit and Insert Naming Only` to drop the `merge_plans` scenario.
- [ ] 1.2 Reconcile `add-apply-plan-and-style-source`: remove its `apply_plan` ADDED requirement and its entire MODIFIED `Canonical` block from `specs/mcp-server/spec.md`; trim `proposal.md` / `design.md` / `tasks.md` to the `style_source_id` scope; keep the docx-primitives delta.
- [ ] 1.3 Retarget the `apply_plan` mention in `document-paragraph-id-stability-and-fingerprint` to `batch_edit`.
- [ ] 1.4 `openspec validate replace-plan-tools-with-batch-edit --strict` and `openspec validate add-apply-plan-and-style-source --strict` both pass.

## 2. `batch_edit` tool + relocated core (Codex)
- [ ] 2.1 Create `packages/docx-mcp/src/tools/batch_edit.ts` (+ optional `batch_edit_core.ts`). Relocate the file-private engine from `apply_plan.ts` (`normalizeSteps`, `validateSteps`, `executeSteps`/`executeStepOnDoc`, constants) and the conflict detectors from `merge_plans.ts` (`detectDuplicateStepIdConflicts`, `detectReplaceConflicts`, `rangesOverlap`, `detectInsertSlotCollisions`, `Conflict`/`StepRef`). Do NOT carry over `detectBaseRevisionConflicts`.
- [ ] 2.2 Pipeline order (critical): normalize → validate-all → capture each `replace_text` resolved `[start,end)` from `findUniqueSubstringMatch` onto the step → build conflict-view → run detectors → apply sequentially. Detectors must run on resolved ranges, never before validation.
- [ ] 2.3 Semantics: validation OR conflict failure ⇒ apply zero steps + diagnostics. Execution-time failure ⇒ stop at first failing step, return `completed_step_ids` + `failed_step_id` + `failed_step_index` (partial prefix may apply). No `fail_on_conflict` flag.
- [ ] 2.4 Input: `steps` (JSON array) XOR `plan_file_path` (`.json` array, ≤1 MB, `enforceReadPathPolicy`); error if both. Do NOT accept a `merge_plans` envelope object.
- [ ] 2.5 Delete `tools/init_plan.ts`, `tools/merge_plans.ts`, `tools/apply_plan.ts`.

## 3. Registration, CLI, manifest, docs, provider parity (Codex)
- [ ] 3.1 `server.ts`: drop the 3 imports + 3 dispatch cases; add `batch_edit`.
- [ ] 3.2 `tool_catalog.ts`: drop the 3 entries; add one `batch_edit` entry (`destructiveHint: true`, single-agent framing).
- [ ] 3.3 `cli/index.ts` + `cli/commands/edit.ts`: dispatch `batch_edit`; remove the 3 tools.
- [ ] 3.4 `packages/google-docs-core/src/types.ts`: in `PROVIDER_CAPABILITIES.docx`, replace `init_plan`/`merge_plans`/`apply_plan` with `batch_edit`.
- [ ] 3.5 `packages/safe-docx-mcpb/manifest.json`: replace the 3 tools with `batch_edit`.
- [ ] 3.6 Regenerate `packages/docx-mcp/docs/tool-reference.generated.md` via its generator (do not hand-edit).
- [ ] 3.7 Update `packages/docx-mcp/README.md` and `packages/docx-core/SUPPORT.md` tool listings.

## 4. Tests + coverage (Codex)
- [ ] 4.1 New `packages/docx-mcp/src/replace_plan_tools_with_batch_edit.test.ts` with `const TEST_FEATURE = 'replace-plan-tools-with-batch-edit';` and allure `epic(...).withLabels({ feature: TEST_FEATURE })`.
- [ ] 4.2 Add one single-line `.openspec('<exact scenario title>')(...)` tag per scenario in the delta — **including the two MODIFIED Canonical scenarios** (`canonical names are advertised`, `legacy aliases are unavailable`), not just the ADDED ones. Titles must match the spec exactly. Do NOT hand-edit the auto-generated traceability matrix.
- [ ] 4.3 Cover: all-valid batch; validation failure → zero applied; overlapping-range conflict → zero applied; duplicate-step-id conflict; insert-slot collision; run-formatting preserved on replace; execution failure → completed/failed ids; `plan_file_path` array; both-inputs error; unsupported/legacy-alias rejection.
- [ ] 4.4 Edit `add_apply_plan_and_style_source.test.ts`: drop apply_plan cases/tags (apply_plan deleted); keep style_source cases.
- [ ] 4.5 Delete `apply_plan.test.ts`, `merge_plans.test.ts`, `init_plan.test.ts`, `add_multi_agent_plan_merge_phase_1.test.ts`.
- [ ] 4.6 Update remaining live references: `cli/commands/edit.test.ts`, `cli/flag_parser.test.ts`, `add_typescript_mcp_server.test.ts`, `tools/ai_revision_validation.test.ts`, `integration/canonical-emission-mcp.test.ts`, `tools/add_safe_docx_batch_apply_and_strict_anchor_resolution.test.ts`.

## 5. Verification
- [ ] 5.1 `npm run build -w @usejunior/docx-mcp`
- [ ] 5.2 `npm run check:spec-coverage` (green; new feature mapped, no missing scenarios)
- [ ] 5.3 Vitest scoped to the docx-mcp package (not a repo-root path — avoids globbing stale worktrees)
- [ ] 5.4 Surface sweep: no live `init_plan`/`merge_plans`/`apply_plan` outside `archive/`/`dist/`; `batch_edit` present in catalog, manifest, generated docs, CLI help
- [ ] 5.5 Real-`.docx` MCP smoke: overlapping-range batch rejected with zero edits; clean batch applies + preserves formatting; execution-failure batch returns the partial contract
