# Design: Test corpus narrative

## Context

Issue #235 asks for an OpenSpec proposal only. The desired system makes the
test itself the source of truth for public corpus narrative while retaining
Allure as the source for test identity, status, labels, links, and step
execution data.

No deployed OpenSpec capability currently owns a test-corpus narrative
concept. `website-trust-surface` consumes Allure artifacts for the public
site trust surface, and the active `add-ecma-376-conformance-framework`
change adds `testAllure.conformance(...)` under a proposed
`spec-compliance` capability, but neither owns `AllureLabelDefaults` or a
publishable test corpus. This proposal therefore introduces
`test-corpus-narrative` and documents the `AllureLabelDefaults.visibility`
addition there as an added requirement.

## Goals / Non-Goals

**Goals**
- Put public test rationale in JSDoc directly above the
  `test.openspec(...)(...)` call.
- Keep tag names, word-count ranges, and rendered section titles in one
  Zod schema under a future `packages/test-narrative/` package.
- Add one runtime metadata field, `visibility`, to classify tests as
  `public` or `internal`.
- Emit a stable `tests-corpus.json` plus `tests-corpus.schema.json`
  artifact suitable for downstream rendering.
- Let developers use a local Codex drafter while keeping CI deterministic
  and LLM-free.
- Coordinate ECMA-376 citation resolution with the active conformance
  framework and a prerequisite registry-parser lift.

**Non-Goals**
- Implementing `packages/test-narrative/`, AST extraction, drafter, CI
  check, corpus emitter, or workflow in this PR.
- Creating an external renderer or website page.
- Adding cross-linking between scenarios. Rendered test pages are
  self-contained.
- Adding a staleness hash gate for narrative prose.

## Decisions

### D1. New capability: `test-corpus-narrative`

The existing capabilities cover DOCX behavior, MCP behavior, website trust
summary generation, and open-agreements functionality. The test-corpus
narrative system is cross-cutting but has a distinct contract: schema,
authoring loop, validation, artifact shape, and release behavior. A new
capability avoids overloading unrelated specs.

### D2. JSDoc carries prose; Allure carries visibility

Narrative prose lives in JSDoc above the `test.openspec(...)(...)` call so
it can be reviewed with the test body and extracted through AST context.
Runtime metadata is limited to `visibility?: 'public' | 'internal'` on
`AllureLabelDefaults`, defaulting to `internal`. This avoids adding a
runtime narrative API and keeps prose out of Allure labels.

### D3. Schema-owned names, ranges, and section titles

The future `packages/test-narrative/` package owns a Zod schema that
defines exactly these tags:

| Tag | Required | Words | Section title |
| --- | --- | --- | --- |
| `motivatingProblem` | when `visibility` is `public` | 60-150 | Motivating problem |
| `implementationLimitation` | optional | 40-300 | Implementation limitations |
| `testScopeExclusion` | optional | 40-300 | Test-scope exclusions |
| `observedPerformance` | optional | 40-200 | Observed performance characteristics |
| `potentialMisconception` | optional | 40-250 | Potential misconceptions |
| `implementationAlternativeRejected` | optional | 40-250 | Implementation alternatives considered and rejected |
| `ecma376Difficulty` | optional | 40-250 | What makes this hard in ECMA-376 |

The schema is the only place these strings and ranges live. The drafter,
AST extractor, CI validator, corpus emitter, and any renderer import from
it instead of copying constants.

The rejected names `limitation`, `aiContext`, `compare`, `specQuirk`,
`notCovered`, `prose`, `description`, and `discussion` are intentionally
not aliases because they are ambiguous or encourage undifferentiated prose.

### D4. Public tests require `motivatingProblem`; structural tests stay internal

`motivatingProblem` frames the problem in the world that motivates the
scenario and may be capability-shaped only where the issue allows it. Tests
whose value is purely structural, such as checking that a parser does not
crash on empty input, remain `visibility: internal`; there is no escape
hatch that allows a public test to omit `motivatingProblem`.

### D5. Asymmetry-of-rot replaces hash staleness gates

The validator fails on missing required tags and present tags that do not
parse against the schema. It does not compare hashes of test bodies to
narrative prose. Hash gates are noisy for cosmetic edits and can miss
semantic changes that preserve token order. The accepted trade-off is that
capability rot oversells and breaks trust, while limitation rot usually
undersells what the implementation can do.

### D6. Corpus artifact joins Allure and AST evidence

`tests-corpus.json` is produced from Allure result JSON joined with
AST-extracted evidence. Allure contributes identity, status, labels, links,
and step names. AST extraction contributes JSDoc narrative tags, verbatim
BDD `given`/`when`/`then` strings, local fixture literals, `expect()`
arguments, and test source coordinates. ECMA-376 citations come from
`ConformanceClaim[]` labels resolved through the conformance registry.

The artifact strips engineer-only noise such as host runner IDs, Vitest
framework name, millisecond durations, language tags, and other fields that
do not help downstream corpus readers.

### D7. Rendering order is deterministic and self-contained

The rendered page order is:

1. Breadcrumb, status strip, and citations strip.
2. Motivating problem.
3. Scenario from AST-extracted BDD strings.
4. Results, including conclusion, expected, actual, evaluation,
   performance, and cross-library subsections when present.
5. Implementation limitations.
6. Test-scope exclusions.
7. Observed performance characteristics.
8. Potential misconceptions.
9. Implementation alternatives considered and rejected.
10. What makes this hard in ECMA-376.
11. Spec citations and source link.

Optional sections render only when their source tag is present. There is no
"Discussion" umbrella and no "Related scenarios" requirement.

### D8. Conformance-registry parser lift is a prerequisite

The active `add-ecma-376-conformance-framework` change currently keeps
registry parsing private to `scripts/check_conformance_citations.mjs` and
`scripts/generate_conformance_doc.mjs`. The corpus emitter must not
duplicate that grammar. A separate follow-up PR must lift
`parseRegistryFile` and `loadRegistry` into
`scripts/lib/conformance-registry.mjs` before `scripts/build_tests_corpus.mjs`
consumes resolved `ConformanceClaim[]`.

## Risks / Trade-offs

- **Authoring friction for public tests.** Mitigation: provide a local
  drafter, keep the required set to `motivatingProblem`, and validate only
  schema shape in CI.
- **Schema constants copied into prompts or renderers.** Mitigation: make
  `packages/test-narrative/` the import source for every consumer.
- **Corpus emitter depends on test AST shape.** Mitigation: scope the
  extractor to the existing Allure/OpenSpec BDD pattern and add targeted
  fixture tests before broad rollout.
- **Conformance framework landing order.** Mitigation: list the registry
  parser lift as a prerequisite follow-up and keep this proposal
  implementation-free.

## Migration Plan

This proposal does not change runtime code. Follow-up implementation PRs
should land in this order: registry-parser lift, narrative schema package,
Allure visibility metadata, AST extractor and CI validator, local drafter,
corpus emitter, then tag-time release workflow.

Existing tests default to `visibility: internal` until explicitly marked
public and given valid JSDoc narrative tags.

## Open Questions

- Should `tests-corpus.schema.json` be checked in, generated during release,
  or both? The requirement only needs a stable emitted schema artifact.
- Should the corpus emitter include source ranges for every extracted
  literal or only a source link for the owning test? The current contract
  requires enough identity for a source link, not full range provenance.
