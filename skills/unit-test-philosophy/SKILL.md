---
name: unit-test-philosophy
description: Risk-based unit testing and Allure-readable behavioral spec style for the Safe DOCX monorepo. Use when adding/updating tests, expanding coverage, or reviewing test quality across safe-docx, docx-primitives, and docx-comparison.
metadata:
  short-description: Safe DOCX testing philosophy
---

# Unit Test Philosophy (Safe DOCX)

## Use this skill when
- A request asks to add tests, improve coverage, or harden regressions.
- A change touches `packages/safe-docx`, `packages/docx-primitives`, or `packages/docx-comparison`.
- You need readable Allure behavior specs and OpenSpec traceability.

## Core philosophy
1. Test highest-risk behavior first.
   Focus first on mutating paths, parser/serializer boundaries, and safety/policy checks.
2. Optimize for regression prevention, not just line coverage.
   Prioritize branches and invariants where bugs cause wrong edits or corrupted DOCX output.
3. Treat Allure as test style, not test type.
   Use normal unit/integration tests with Allure labels/steps/attachments in the same file.
4. Keep spec and test effectively coextensive.
   If behavior is important enough to test, it should map to canonical spec or active change spec.
5. Keep assertions behavior-oriented.
   Verify user-observable outputs, error codes, and mutation summaries before internals.
6. Make failures easy to debug.
   Attach structured context for inputs, normalized outputs, and diagnostics.

## Repo standards

### Test structure
- Use Given/When/Then/And step wording in Allure steps.
- Prefer one assertion per step, but this is a guideline (not a hard rule).
- Multiple assertions in one step are acceptable when they validate one cohesive invariant.
- Keep tests deterministic (fixed fixtures, explicit env flags, no timing assumptions).

### Allure API
- Prefer repo helpers over direct raw Allure calls:
  - `packages/safe-docx/src/testing/allure-test.ts` (`testAllure`, `itAllure`, `allureStep`, `allureJsonAttachment`)
  - `packages/docx-primitives/test/helpers/allure-test.ts` (`itAllure`, helpers)
  - `packages/docx-comparison/src/testing/allure-test.ts` (`itAllure`, helpers)
- Prefer fluent metadata composition with `.allure({ description, tags, parameters })` on `testAllure` / `itAllure` chains.
- Do not import from `allure-vitest` in tests.
- If direct Allure calls are needed, use `allure-js-commons` and `await` every call.
- Avoid `any` in Allure paths; prefer typed runtime/context wrappers.
- Keep adapter-compatibility shims typed (`tags`/`tag`/`label`) instead of untyped direct access.

### Allure Vitest compatibility
- `allure.tags(...)` is not consistently available across adapter versions.
- Use safe fallback order for tags:
  1. `allure.tags('x')`
  2. `allure.tag('x')`
  3. `allure.label('tag', 'x')`
- Prefer compatibility helpers to avoid adapter-version breakages in single scenarios.

### Lawyer-readable profile
- Write narrative steps as concrete `Given/When/Then/And` statements.
- Avoid mechanical phrasing (e.g., “coverage is defined”, “expected outcome is scenario title”).
- Keep technical JSON attachments at the end of the step list.
- Use concise step parameters (`expected`, `actual`, key inputs) for readability.
- Tag migrated scenarios with `human-readable` for progress tracking.
- `.openspec(...)` and `Scenario:`-style tests inherit human-readable defaults from wrappers (`human-readable` tag, `audience=non-technical`, and `scenario_id` when a serial is present).
- Always prefer an explicit `.allure({ description })` sentence in plain English over generic template text.
  Good pattern: “Running X on Y returns Z with correct A/B/C fields.”
- Do not expose ephemeral IDs (e.g., session IDs) as reader-facing step parameters unless they are asserted behavior.
- Prefer input parameters that drive assertions (`inserted_text`, `deleted_text`, authors) and avoid computed/debug-only values in `Given`.
- Keep debug JSON as root-level attachments via `attachJsonLastStep()` default behavior; only use `attachAsStep: true` when a step-scoped attachment is intentional.

### BDD wording style (parameterized)
- Prefer reusable wording that remains true when fixture values change.
  - `WHEN extract_revisions is run in the session`
  - `THEN the tool reports the correct number of changed paragraphs`
  - `AND the insertion record shows correct type/text/author`
- Avoid first-person phrasing (`I run ...`) in generated Allure step titles.

### Branded report defaults
- Default report expansion mode is `moderate`:
  - Steps auto-expand.
  - JSON/XML attachments remain collapsed by default.
  - Word-like HTML previews auto-expand.
- Query/config overrides:
  - `sdxExpandMode=compact|moderate|verbose`
  - `sdxAutoExpandSteps=true|false`
  - `sdxAutoExpandAttachments=true|false`

### Reference test pattern (gold standard)

For high-risk OpenSpec-traced scenarios, follow this pattern (demonstrated by SDX-ER-001 in `extract_revisions.test.ts` and SDX-DE-001 in `prevent_double_elevation.test.ts`):

1. **Fluent metadata chain**: `.allure({ title, description }).openspec('SDX-XX-NNN')` with explicit English description.
2. **BDD context destructuring**: Accept `AllureBddContext` and destructure `{ given, when, then, and, attachPrettyXml, attachJsonLastStep }`.
3. **Named fixture const**: Typed `fixture` object (`as const`) at the top of the test body.
4. **Visual XML preview**: `attachPrettyXml('01 Input ...', xml)` for before state, `attachPrettyXml('02 Output ...', xml)` for after state.
5. **Step parameters**: `{ expected_X: val, actual_X: val }` as third arg to `then`/`and`. Renders as key-value pairs in report.
6. **Debug JSON in finally**: `try/finally` + `attachJsonLastStep({ context, result })` — root-level pretty-printed HTML, attached even on failure.
7. **Readable assertion grouping**: Group related assertions in one step when they validate a single cohesive invariant (e.g., fix count + property removed + property preserved). Don't over-split.

Reference files:
- `packages/safe-docx/src/tools/extract_revisions.test.ts` (SDX-ER-001)
- `packages/docx-primitives/src/prevent_double_elevation.test.ts` (SDX-DE-001)

For high-risk OpenSpec-traced scenarios, use the **Reference test pattern** above instead of the minimal template below.

### Traceability IDs
- Use compact serial IDs in `.openspec('SDX-XX-NNN')` — the coverage validators resolve serial IDs to full scenario names.
- Keep serial IDs as `const scenarioId = 'SDX-DE-001'` for debug payloads and step parameters.
- Scenario headers in specs use the `[SDX-XX-NNN] scenario name` format.
- IDs sourced from active change-package specs are valid before canonical spec promotion.
- Keep IDs stable when promoting change-package scenarios into canonical specs.
- Emit Allure traceability labels where available (`openspecScenarioId`).

### Report performance hygiene
- Avoid auto-generating large generic behavior attachments for every test.
- Keep attachment count and payload size small by default.
- Prefer targeted, scenario-specific evidence over repeated boilerplate attachments.
- Keep `cleanResultsDir: true` in Vitest reporter config to reduce stale-result confusion.

### One-test migration playbook
1. Add/confirm spec scenario serial ID.
2. Migrate one scenario to readable format in-place.
3. Run targeted test file only.
4. Regenerate report and verify labels/tags/step order.
5. Move to the next scenario.

### File naming and placement
- Use normal collocated test files: `src/<module>.test.ts`.
- Do not split into separate “allure test type” files by default.
- Add Allure style (labels/steps/attachments) inside these tests.
- Keep one test file focused on one module/capability.
- Migration policy: gradually rename legacy `*.allure.test.ts` files to `*.test.ts`; do not introduce new `*.allure.test.ts` files.

### OpenSpec traceability
- Require `.openspec('exact scenario text')` whenever a matching scenario exists.
- Scenario text must match spec headers exactly (including case/backticks).
- Matching scenarios may live in canonical specs or active change-package specs.
- For ID-based scenarios, prefer stable serial IDs in active change specs and keep them unchanged when canonicalized.
- For new important behavior, add/extend spec first, then map tests to that scenario text.

## Coverage expansion workflow
1. Read coverage summaries:
   - `packages/safe-docx/coverage/coverage-summary.json`
   - `packages/docx-primitives/coverage/coverage-summary.json`
   - `packages/docx-comparison/coverage/coverage-summary.json`
2. Rank by uncovered branches in high-blast-radius modules.
3. Add tests in this order:
   - Validation and error branches
   - Strict vs permissive mode behavior
   - No-partial-mutation / transactional guarantees
   - Invariants (paragraph count, selector behavior, deterministic outputs)
4. Run targeted package tests, then package coverage.

## Severity recommendation rubric
- `critical`: mutation correctness, document integrity, data-loss risk, path-policy/security guardrails.
- `normal`: standard behavior and compatibility scenarios.
- `minor`: narrow edge cases with low production impact.
- Apply severity based on failure impact, not module ownership.

## Command checklist
```bash
npm run test:run -w @usejunior/safe-docx
npm run test:run -w @usejunior/docx-primitives
npm run test:run -w @usejunior/docx-comparison
npm run test:coverage:packages
node scripts/report_package_coverage.mjs
```

## Minimal test template (TypeScript)
```ts
import { describe, expect } from 'vitest';
import { itAllure as it, allureStep, allureJsonAttachment } from '../testing/allure-test.js';

describe('replace_text behavior', () => {
  it('applies unique replacement deterministically', async () => {
    let result: { success: boolean; code?: string };

    await allureStep('Given a paragraph with a unique target span', async () => {
      await allureJsonAttachment('input', { old: 'Alpha', next: 'Beta' });
    });

    await allureStep('When replace_text executes', async () => {
      result = { success: true };
    });

    await allureStep('Then the replacement succeeds', async () => {
      expect(result!.success).toBe(true);
    });
  });
});
```

> For high-risk OpenSpec-traced scenarios, use the **Reference test pattern** above instead of this minimal template.

## Extended reference
- See `references/allure-test-spec-writing-guide.md` for complete guidance adapted from the shared cross-repo Allure spec guide.
