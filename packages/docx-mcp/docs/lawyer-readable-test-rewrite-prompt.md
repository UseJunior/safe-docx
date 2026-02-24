# Prompt: Rewrite One Test Into Lawyer-Readable Format (DRY + Declarative)

You are updating exactly one existing Vitest test scenario in this repo to make it maximally readable for non-technical reviewers while staying DRY and maintainable.

## Inputs You Will Receive
- `TEST_FILE`: path to the test file to modify
- `SPEC_FILE`: path to the canonical spec file (`openspec/specs/.../spec.md`)
- `SCENARIO_TITLE`: exact scenario title text from spec (without leading `#### Scenario:`)
- `SCENARIO_ID`: unique serial like `SDX-ER-001`

## Primary Goal
Rewrite one scenario so the Allure output reads like a clear story for a lawyer (or intelligent middle-schooler), while keeping the test implementation declarative, non-repetitive, and easy to extend.

## Non-Goals
- Do not modify shared Allure helper wrappers unless explicitly requested.
- Do not redesign test architecture for the whole package in this task.
- Do not add redundant “evidence tables” that duplicate assertions.

## Hard Requirements
1. Preserve behavioral coverage.
- Do not remove assertions.
- Keep all existing guarantees the scenario checks.

2. Keep OpenSpec traceability exact.
- Ensure the spec has: `#### Scenario: [SCENARIO_ID] SCENARIO_TITLE`.
- In test, use `.openspec('[SCENARIO_ID] SCENARIO_TITLE')` with exact text.

3. Use explicit plain-English Allure steps.
- Use `Given`, `When`, `Then`, `And` wording.
- Each step should communicate one coherent check.
- Avoid generic/mechanical phrasing like “coverage is defined” or repeating the title as the outcome.

4. Add user-facing metadata.
- Prefer fluent metadata on the test builder via `.allure({ ... })`.
- Add plain-English `description`.
- Ensure tag `human-readable` is present (auto-applied for `.openspec(...)` and `Scenario:`-style tests; explicit is fine).
- Add `scenario_id` test parameter (auto-applied from `[SCENARIO_ID]` when present; explicit is fine).

5. Keep it DRY and declarative.
- Introduce small local helpers for repeated patterns (e.g., step+parameters+expect).
- Prefer data-driven assertions over repeated boilerplate blocks.
- Do not add a separate “evidence table” attachment that duplicates assertions.

6. SOLID-oriented structure.
- Single responsibility: separate fixture setup, action execution, and assertion helpers.
- Open/closed: make assertion helpers reusable for nearby scenarios without editing helper internals.
- Keep dependencies explicit and narrow.

7. TypeScript correctness for Allure paths.
- Do not use `any` for Allure runtime or step context in migrated code.
- Prefer typed wrappers/interfaces for runtime calls and step parameter contexts.
- Keep fallbacks for adapter capability differences (`tags`/`tag`/`label`) without unsafe typing.

## Preferred Test Pattern
Use this shape (adapt to existing code):
- `fixture` object for scenario data
- helper: `allureStepWithParameters(name, params, fn)`
- helper: `assertStepEqual(name, expected, actual)`
- helper(s) for repeated domain assertions (e.g., revision/assertion blocks)
- explicit `Given` step for input setup summary
- explicit `When` step for tool execution
- explicit `Then/And` steps for assertions

## Allure and Vitest Constraints
- Keep existing repo helper imports (`testAllure`, `allureStep`, `allureJsonAttachment`) where appropriate.
- Prefer `testAllure...allure({...}).openspec(...)` over direct raw runtime metadata calls for readability and DRY.
- Use runtime API with `await` for all `allure.*` calls.
- Do not introduce direct `allure-vitest` imports in tests.
- Keep narrative steps contiguous; append technical attachments at the end.
- Attachment budget: default max 2 technical attachments per migrated scenario unless explicitly justified.
- Prefer step parameters over large per-step JSON attachments.

## Output Requirements
After editing, provide:
1. Files changed
2. Short explanation of DRY/SOLID improvements
3. Confirmation that traceability string matches spec exactly
4. Test command run and pass/fail result

## Done Definition
- The scenario appears in Allure with:
  - `story = [SCENARIO_ID] ...`
  - `openspecScenarioId = SCENARIO_ID` label
  - `tag = human-readable`
- Technical JSON attachments appear as final items, after narrative steps.

## Acceptance Checklist (must all be true)
- [ ] Spec scenario header includes `[SCENARIO_ID]`
- [ ] Test uses `.openspec('[SCENARIO_ID] SCENARIO_TITLE')`
- [ ] `human-readable` tag present
- [ ] Description + scenario_id parameter present
- [ ] Given/When/Then/And steps are plain-English and specific
- [ ] No duplicated evidence table attachment
- [ ] Repeated assertion logic extracted into helper(s)
- [ ] Targeted test run passes
