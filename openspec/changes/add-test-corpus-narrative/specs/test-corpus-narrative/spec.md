# test-corpus-narrative Specification (delta)

## ADDED Requirements

### Requirement: Narrative schema owns public test prose tags

The repository SHALL define a Zod-backed narrative schema in
`packages/test-narrative/` that is the only source of truth for narrative
JSDoc tag names, required-vs-optional rules, word-count ranges, and
rendered section titles. The in-repo drafter prompt, AST extractor, CI
validator, and corpus emitter MUST import those definitions instead of
duplicating constants. Downstream renderers in other repositories MUST
consume the emitted `tests-corpus.schema.json` artifact (see Requirement:
Corpus artifact is the renderer-facing contract) rather than importing
the TypeScript package directly.

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

Each narrative tag SHALL carry its own distinct section identifier and
title from the schema, so the corpus emitter emits a separate entry in
the `sections` array per present tag. The corpus emitter MUST NOT emit
a generic `discussion` (or equivalent umbrella) section identifier that
groups multiple tag bodies; the schema also MUST NOT define one. (Cross-
repo renderers consume the resulting sections array — see the "Corpus
artifact is the renderer-facing contract" requirement.)

The schema's tag definitions SHALL constrain content as follows:
`motivatingProblem` describes the problem in the world that motivates
the scenario, framed as a problem statement rather than a capability
claim. `implementationLimitation` describes constraints of the code
under test and biases toward underselling on rot. `testScopeExclusion`
describes input shapes the test itself does not exercise, independent
of whether the implementation handles them. `observedPerformance`
describes applicable Big-O, memory complexity, observed runtime range,
or scaling caveats without requiring every category.
`potentialMisconception` includes both the misconception and corrective
claim in one block. `implementationAlternativeRejected` describes
implementation designs considered and rejected, not test-design
alternatives. `ecma376Difficulty` describes ECMA-376 idiosyncrasies that
motivated the test.

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

When `visibility` is `'public'`, the Allure runtime SHALL emit it as a
label with name `corpusVisibility` and value `public` on each test
result. When `visibility` is `'internal'` or omitted, the Allure runtime
SHALL NOT emit a `corpusVisibility` label; the corpus builder normalizes
the absent value to `internal`. The label name `corpusVisibility` is the
hard contract — corpus builders, downstream tooling, and future renderers
key off it; the alternate name `visibility` MUST NOT be used because it
collides with the conventional Allure label namespace.

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
- **THEN** the runtime Allure metadata SHALL include the
  `corpusVisibility` label but SHALL NOT include the narrative tag bodies

#### Scenario: public visibility emits stable Allure label

- **GIVEN** a test with `visibility: 'public'`
- **WHEN** the Allure runtime emits the test result JSON
- **THEN** the result's `labels` array SHALL include an entry with
  `name: 'corpusVisibility'` and `value: 'public'`

#### Scenario: internal visibility omits the label

- **GIVEN** a test with `visibility: 'internal'` or with `visibility`
  omitted
- **WHEN** the Allure runtime emits the test result JSON
- **THEN** the result's `labels` array SHALL NOT include any entry whose
  `name` is `corpusVisibility`
- **AND** the corpus builder SHALL classify the test as `internal` when
  it consumes the result

### Requirement: No public escape hatch for missing narrative

The system MUST NOT provide an escape hatch that allows a `visibility:
'public'` test to omit `@motivatingProblem`. No alternate tag, label, or
flag (for example, a hypothetical `@structuralGuarantee` tag) SHALL
satisfy the public-narrative requirement in place of `@motivatingProblem`.

Authoring policy (non-normative; see `design.md` D4): tests whose value
is purely structural and for which no useful `@motivatingProblem` can
honestly be written should stay `visibility: 'internal'`. The mechanical
contract above is the only normative gate.

#### Scenario: no public escape hatch exists

- **GIVEN** a test marked `visibility: 'public'`
- **WHEN** it tries to bypass `@motivatingProblem` with any alternate flag
  or tag
- **THEN** `scripts/check_test_narratives.mjs` SHALL fail the test

#### Scenario: internal structural test passes the gate

- **GIVEN** a structural parser test marked `visibility: 'internal'`
- **WHEN** it has no `@motivatingProblem` tag
- **THEN** `scripts/check_test_narratives.mjs` SHALL accept the test
  without checking for narrative content

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

The AST extractor SHALL be purely static. It MUST NOT evaluate test
code, resolve runtime imports, follow factory function calls, or attempt
to compute non-literal values. The contract is "extract what is
syntactically present in the test source; for everything else, point at
it." See the fallback requirement below.

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

- **GIVEN** a test whose given/when/then bodies contain only
  syntactically-local string literals, number literals, and object/array
  literals (no imports, no factory calls, no computed expressions)
- **WHEN** the AST extractor processes the test
- **THEN** the corpus entry SHALL include those literals verbatim and the
  exact `expect()` argument expressions without executing the test body

### Requirement: AST extractor falls back on non-literal evidence

The corpus emitter SHALL record an unresolved-evidence marker in place
of any value the AST extractor cannot statically resolve. The unresolved
case includes imported bindings, factory function calls, template
literals with runtime expressions, destructured fixtures, and any
non-literal expression. The marker SHALL include the source-text of the
unresolved expression and a stable source reference (file path plus
line number) so a downstream reader can follow the link. The emitter
MUST NOT fail the build, MUST NOT execute the test, and MUST NOT
silently drop the field.

#### Scenario: imported fixture is recorded as unresolved with source link

- **GIVEN** a test whose `given(...)` argument is an imported constant
  (for example, `given(SHARED_PARAGRAPH_FIXTURE, ...)` where
  `SHARED_PARAGRAPH_FIXTURE` is imported from another module)
- **WHEN** `scripts/build_tests_corpus.mjs` runs the AST extractor
- **THEN** the corpus entry for that step SHALL contain a value object
  whose `kind` is `unresolved`, whose `sourceText` is the literal
  expression (`SHARED_PARAGRAPH_FIXTURE`), and whose `sourceRef` is the
  `path:line` of the call site

#### Scenario: factory call is recorded as unresolved

- **GIVEN** an `expect()` whose argument is a function call (for example,
  `expect(buildFixture('case-A')).toBe(...)`)
- **WHEN** the AST extractor processes it
- **THEN** the corpus entry SHALL record the call as an unresolved
  evidence marker rather than evaluating the function

#### Scenario: static literal is fully resolved

- **GIVEN** a `given(...)` with a string-literal argument
- **WHEN** the AST extractor processes it
- **THEN** the corpus entry SHALL include the literal value directly,
  without any unresolved-evidence marker

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

### Requirement: Corpus artifact is the renderer-facing contract

`scripts/build_tests_corpus.mjs` SHALL generate `tests-corpus.schema.json`
from the in-repo Zod schema and check it into the repository alongside
the source schema, so the renderer contract lives in the emitted
artifact rather than in source-code imports across repositories. A CI
step SHALL regenerate the JSON Schema and fail the build if it drifts
from the checked-in copy. The release workflow SHALL publish the same
generated file as a release artifact so external consumers can pin to
a stable URL.

Each corpus entry SHALL carry a `sections` array of stable section
identifiers in their canonical rendering order: `breadcrumb`,
`statusStrip`, `citationsStrip`, `motivatingProblem`, `scenario`,
`results`, `implementationLimitation`, `testScopeExclusion`,
`observedPerformance`, `potentialMisconception`,
`implementationAlternativeRejected`, `ecma376Difficulty`,
`specCitations`, `sourceLink`. Sections whose backing content is absent
(e.g., the entry has no `@implementationLimitation` tag) SHALL be
omitted from the array, not emitted with empty content. The schema
SHALL document each section identifier's human-readable title. The
emitted `sections` array MUST NOT contain a `relatedScenarios`,
`discussion`, or other umbrella identifier — the canonical list above is
exhaustive. (Cross-repo renderers iterate the array in order and emit
one slab per identifier; this proposal places no further normative
requirement on those renderers because they live outside this repo.)

#### Scenario: schema is checked in and CI fails on drift

- **GIVEN** a developer modifies the Zod schema in
  `packages/test-narrative/` without regenerating
  `tests-corpus.schema.json`
- **WHEN** CI runs the schema-drift check
- **THEN** the check SHALL fail with a message identifying the drift

#### Scenario: omitted optional section is not present in sections array

- **GIVEN** a corpus entry derived from a test with `@motivatingProblem`
  but no `@implementationAlternativeRejected`
- **WHEN** the entry is emitted
- **THEN** the entry's `sections` array SHALL contain
  `motivatingProblem`
- **AND** SHALL NOT contain `implementationAlternativeRejected`

#### Scenario: spec citations and source link are last

- **GIVEN** any corpus entry with ECMA-376 citations and a source link
- **WHEN** the entry is emitted
- **THEN** the last two elements of its `sections` array SHALL be
  `specCitations` followed by `sourceLink`, in that order
