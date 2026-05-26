# test-corpus-narrative Specification (delta)

## ADDED Requirements

### Requirement: Narrative schema owns public test prose tags

The repository SHALL define a Zod-backed narrative schema in
`packages/test-narrative/` that is the only source of truth for narrative
JSDoc tag names, required-vs-optional rules, word-count ranges, and
rendered section titles. The drafter prompt, AST extractor, CI validator,
corpus emitter, and downstream renderers MUST import those definitions
instead of duplicating constants.

The schema SHALL define these tags and no aliases:

| Tag | Required | Words | Rendered section title |
| --- | --- | --- | --- |
| `motivatingProblem` | required when `visibility` is `public` | 60-150 | Motivating problem |
| `implementationLimitation` | optional | 40-300 | Implementation limitations |
| `testScopeExclusion` | optional | 40-300 | Test-scope exclusions |
| `observedPerformance` | optional | 40-200 | Observed performance characteristics |
| `potentialMisconception` | optional | 40-250 | Potential misconceptions |
| `implementationAlternativeRejected` | optional | 40-250 | Implementation alternatives considered and rejected |
| `ecma376Difficulty` | optional | 40-250 | What makes this hard in ECMA-376 |

The names `limitation`, `aiContext`, `compare`, `specQuirk`,
`notCovered`, `prose`, `description`, and `discussion` MUST NOT be
accepted as aliases.

#### Scenario: public test requires motivating problem

- **GIVEN** a test with `visibility: 'public'`
- **WHEN** the test has no `@motivatingProblem` JSDoc tag above its
  `test.openspec(...)(...)` call
- **THEN** `scripts/check_test_narratives.mjs` SHALL fail the test file
  with a missing-required-tag error

#### Scenario: internal test does not require narrative

- **GIVEN** a structural test with omitted visibility or
  `visibility: 'internal'`
- **WHEN** it has no narrative JSDoc tags
- **THEN** `scripts/check_test_narratives.mjs` SHALL accept the test

#### Scenario: rejected tag alias fails

- **GIVEN** a test JSDoc block containing `@limitation`
- **WHEN** `scripts/check_test_narratives.mjs` parses the block
- **THEN** the check SHALL fail because `limitation` is not a schema tag

#### Scenario: tag word count is enforced

- **GIVEN** a public test with `@motivatingProblem`
- **WHEN** the tag body has fewer than 60 words or more than 150 words
- **THEN** the check SHALL fail with a schema validation error

### Requirement: Narrative tags describe distinct rendering sections

Each present optional narrative tag SHALL render as its own self-titled
section using the title provided by the schema. The renderer MUST NOT
group optional tag bodies under a generic "Discussion" section.

`motivatingProblem` SHALL describe the problem in the world that motivates
the scenario, framed as a problem statement rather than a capability claim.
`implementationLimitation` SHALL describe constraints of the code under
test and bias toward underselling on rot. `testScopeExclusion` SHALL
describe input shapes the test itself does not exercise, independent of
whether the implementation handles them. `observedPerformance` SHALL
describe applicable Big-O, memory complexity, observed runtime range, or
scaling caveats without requiring every category. `potentialMisconception`
SHALL include both the misconception and corrective claim in one block.
`implementationAlternativeRejected` SHALL describe implementation designs
considered and rejected, not test-design alternatives. `ecma376Difficulty`
SHALL describe ECMA-376 idiosyncrasies that motivated the test.

#### Scenario: optional tags render independently

- **GIVEN** a public test with `@implementationLimitation` and
  `@potentialMisconception`
- **WHEN** the corpus is rendered
- **THEN** the page SHALL include separate sections titled
  "Implementation limitations" and "Potential misconceptions"
- **AND** it SHALL NOT include a generic "Discussion" wrapper section

#### Scenario: test-scope exclusions do not describe implementation support

- **GIVEN** a JSDoc block with `@testScopeExclusion`
- **WHEN** the schema validates the tag
- **THEN** the tag SHALL be treated as prose about shapes unexercised by
  that test, not as a claim that the implementation cannot handle them

### Requirement: Allure label defaults include corpus visibility

`packages/allure-test-factory` SHALL add
`visibility?: 'public' | 'internal'` to `AllureLabelDefaults`. Omitted
visibility SHALL be treated as `internal`. This field SHALL be the only
new runtime metadata for test narrative; narrative content MUST remain in
JSDoc above the `test.openspec(...)(...)` call and MUST NOT be passed
through a runtime narrative API.

#### Scenario: omitted visibility defaults internal

- **GIVEN** a test whose Allure defaults omit `visibility`
- **WHEN** the narrative validator classifies the test
- **THEN** it SHALL treat the test as `internal`
- **AND** it SHALL NOT require `@motivatingProblem`

#### Scenario: public visibility activates required narrative

- **GIVEN** a test whose Allure defaults include `visibility: 'public'`
- **WHEN** the narrative validator classifies the test
- **THEN** it SHALL require a valid `@motivatingProblem` tag

#### Scenario: runtime API does not carry narrative prose

- **GIVEN** a public test with narrative JSDoc
- **WHEN** the test calls `test.openspec(...)(...)`
- **THEN** the runtime Allure metadata SHALL include visibility but SHALL
  NOT include the narrative tag bodies

### Requirement: Structural tests remain internal

The system SHALL keep tests whose value is purely structural and has no
natural problem-in-the-world narrative at `visibility: 'internal'`.
The system MUST NOT provide an escape hatch that allows a public test to
omit `@motivatingProblem`.

#### Scenario: parser empty-input guard stays internal

- **GIVEN** a parser test that only verifies empty input does not crash
- **WHEN** no meaningful public `@motivatingProblem` can be written
- **THEN** the test SHALL remain `visibility: 'internal'`

#### Scenario: no public escape hatch exists

- **GIVEN** a test marked `visibility: 'public'`
- **WHEN** it tries to bypass `@motivatingProblem` with any alternate flag
  or tag
- **THEN** `scripts/check_test_narratives.mjs` SHALL fail the test

### Requirement: Narrative authoring is local and review-driven

The repository SHALL provide `scripts/draft-narrative-jsdoc.mjs` as a
local authoring helper that can invoke `codex exec` to draft narrative
JSDoc tags for a developer to review, edit, and commit. CI MUST NOT run
an LLM and MUST NOT create automatic narrative PRs.

#### Scenario: developer drafts narrative locally

- **GIVEN** a developer has added or updated a public test
- **WHEN** the developer runs `scripts/draft-narrative-jsdoc.mjs`
- **THEN** the script MAY invoke `codex exec` locally to draft candidate
  narrative JSDoc tags
- **AND** the developer SHALL review and edit the tags before committing

#### Scenario: CI does not invoke LLM

- **GIVEN** a pull request with public tests
- **WHEN** CI runs narrative checks
- **THEN** CI SHALL validate committed tags only
- **AND** CI SHALL NOT invoke Codex, another LLM, or an automatic PR author

### Requirement: Narrative CI gate validates presence and schema only

`scripts/check_test_narratives.mjs` SHALL hard-fail when a public test is
missing required `@motivatingProblem` or any present narrative tag fails
the schema. The gate MUST NOT use hash-based staleness checks over test
body text or narrative text.

#### Scenario: invalid optional tag fails

- **GIVEN** an internal or public test with `@observedPerformance`
- **WHEN** the tag body fails the schema word-count range
- **THEN** `scripts/check_test_narratives.mjs` SHALL fail even though the
  tag is optional

#### Scenario: cosmetic test edit does not trigger staleness failure

- **GIVEN** a public test with valid narrative tags
- **WHEN** a contributor changes indentation, renames a local variable, or
  fixes a typo in the test body
- **THEN** `scripts/check_test_narratives.mjs` SHALL NOT fail because of
  a stale body hash

### Requirement: Tests corpus artifact combines Allure and AST evidence

`scripts/build_tests_corpus.mjs` SHALL emit `tests-corpus.json` and
`tests-corpus.schema.json`. The corpus JSON SHALL combine Allure result
JSON identity, status, labels, links, and step names with AST-extracted
JSDoc narrative tags, verbatim BDD `given`/`when`/`then` strings, local
fixture literals, `expect()` arguments, source links, and ECMA-376
`ConformanceClaim[]` values resolved through the conformance registry.

#### Scenario: corpus includes public narrative and BDD steps

- **GIVEN** a public OpenSpec-mapped test with valid narrative JSDoc and
  BDD `given`/`when`/`then` calls
- **WHEN** `scripts/build_tests_corpus.mjs` runs after tests have emitted
  Allure JSON
- **THEN** `tests-corpus.json` SHALL include the test identity, status,
  labels, links, narrative tag values, and verbatim BDD strings

#### Scenario: corpus resolves ECMA-376 conformance claims

- **GIVEN** a test with `ConformanceClaim[]` labels for ECMA-376 sections
- **WHEN** `scripts/build_tests_corpus.mjs` loads the conformance registry
- **THEN** the corpus entry SHALL include the scenario's resolved
  conformance claims rather than only raw label strings

#### Scenario: corpus includes local test evidence

- **GIVEN** a test with local fixture literals and `expect()` calls
- **WHEN** the AST extractor processes the test
- **THEN** the corpus entry SHALL include the relevant fixture literals
  and `expect()` arguments without executing the test body

### Requirement: Tests corpus artifact strips engineer-only noise

The corpus emitter SHALL normalize output for downstream corpus readers by
excluding engineer-only or unstable runner details, including host runner
IDs, Vitest framework names, millisecond durations, language tags, and
other fields that do not describe the scenario, evidence, result, links,
labels, citations, or source.

#### Scenario: unstable runner fields are omitted

- **GIVEN** an Allure result JSON file containing host runner IDs, Vitest
  framework metadata, millisecond durations, and language tags
- **WHEN** `scripts/build_tests_corpus.mjs` emits `tests-corpus.json`
- **THEN** those fields SHALL be absent from the corpus entry

#### Scenario: stable scenario fields remain

- **GIVEN** the same Allure result JSON file contains test identity,
  status, labels, links, and step names
- **WHEN** `scripts/build_tests_corpus.mjs` emits `tests-corpus.json`
- **THEN** those stable fields SHALL remain available in normalized form

### Requirement: Tests corpus artifact is released at tag time

The repository SHALL publish `tests-corpus.json` and
`tests-corpus.schema.json` as tag-time release artifacts from a GitHub
Actions workflow.

#### Scenario: tag release publishes corpus artifacts

- **GIVEN** a release tag is pushed
- **WHEN** the tag-time release workflow runs
- **THEN** the workflow SHALL build `tests-corpus.json` and
  `tests-corpus.schema.json`
- **AND** it SHALL attach both files to the release artifacts

### Requirement: Rendered corpus pages follow fixed section ordering

Downstream renderers of `tests-corpus.json` SHALL render each public test
as a self-contained page in this order: breadcrumb/status/citations strip,
Motivating problem, Scenario, Results, Implementation limitations,
Test-scope exclusions, Observed performance characteristics, Potential
misconceptions, Implementation alternatives considered and rejected, What
makes this hard in ECMA-376, then Spec citations and Source link. Optional
sections SHALL render only when their source tags are present. Renderers
MUST NOT require a "Related scenarios" section.

#### Scenario: optional section is omitted when tag is absent

- **GIVEN** a corpus entry with `@motivatingProblem` but no
  `@implementationAlternativeRejected`
- **WHEN** the entry is rendered
- **THEN** the page SHALL include "Motivating problem"
- **AND** it SHALL NOT include "Implementation alternatives considered
  and rejected"

#### Scenario: source and citations remain final

- **GIVEN** a corpus entry with ECMA-376 citations and a source link
- **WHEN** the entry is rendered
- **THEN** the final page section SHALL expose spec citations and the
  source link after all present narrative sections
