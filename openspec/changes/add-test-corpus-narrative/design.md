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

The schema is the only place these strings and ranges live. In-repo
consumers (the drafter, AST extractor, CI validator, and corpus emitter)
import from it directly. Cross-repo consumers (notably the downstream
renderer that lives in another repository) consume the emitted
`tests-corpus.schema.json` artifact instead — they do not import the
TypeScript package. See D6c and the spec's "Corpus artifact is the
renderer-facing contract" requirement.

The rejected names `limitation`, `aiContext`, `compare`, `specQuirk`,
`notCovered`, `prose`, `description`, and `discussion` are intentionally
not aliases because they are ambiguous or encourage undifferentiated prose.

### D4. Public tests require `motivatingProblem`; structural tests stay internal

`motivatingProblem` frames the problem in the world that motivates the
scenario. The framing is "the problem we are solving" even when the
sentence necessarily describes a capability deficiency the test catches —
the writer leans on the problem rather than the capability so the text
stays true if the solution improves.

The normative mechanical contract is narrow: `visibility: 'public'`
requires a valid `@motivatingProblem`; `visibility: 'internal'` (or
omitted) does not. The authoring policy that tests with no honest problem
statement should stay internal lives here, in design, because no automated
check can decide whether a candidate `@motivatingProblem` is honest — only
a human reviewer can. There is no escape-hatch tag that satisfies the
public-narrative requirement in place of `@motivatingProblem`.

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

### D6a. AST extractor is purely static; unresolved values become evidence markers

The AST extractor will encounter many tests whose given/when/then
arguments are not raw literals — they're imported constants, factory
calls, destructured fixtures, or template literals with runtime
expressions (the existing `merge_runs.test.ts`, `accept_changes.test.ts`,
and most integration tests are in this shape). A spec that required the
extractor to resolve these would force it to evaluate code, which we
explicitly reject (slow, unsafe, defeats the purpose of static
extraction).

The contract is: extract what is syntactically a literal directly; for
everything else, emit an unresolved-evidence marker with the source-text
of the expression plus a `path:line` source reference. The downstream
renderer can show "this fixture is `SHARED_PARAGRAPH_FIXTURE` — see
[source link]" instead of pretending to show the value. The marker
shape is normative — see spec.md Requirement: "AST extractor falls back
on non-literal evidence".

### D6b. Visibility emitted as `corpusVisibility` Allure label

`AllureLabelDefaults.visibility` is the authoring surface; the runtime
emission is a label with name `corpusVisibility` and value `public`
when (and only when) `visibility: 'public'`. The label name avoids the
bare `visibility` namespace because that conflicts with other Allure
conventions and is too generic for downstream filters. Internal/omitted
visibility emits no label; the corpus builder reads the absence as
`internal`. This makes the Allure JSON the canonical signal — the
corpus builder does not need to read the test source to classify
visibility.

### D6c. JSON Schema is generated and checked in; CI fails on drift

`tests-corpus.schema.json` is generated from the Zod schema in
`packages/test-narrative/` and checked into the repository. A CI step
regenerates and compares; drift fails the build. The release workflow
attaches the same file as a release artifact so external consumers
(particularly the cross-repo renderer) can pin to a stable URL without
importing this repo's TypeScript package.

This pattern mirrors `scripts/generate_conformance_doc.mjs` (commit
`9aac629` and the broader spec-compliance directory) — generated file
checked in, `git diff --exit-code` drift gate. The trade-off vs.
release-time-only generation: checking in costs almost nothing because
the schema is small and changes rarely, and it gives PR reviewers a
visible diff when the schema evolves, which catches accidents the
generate-at-release flow would only surface after the change ships.

### D7. Rendering order is a corpus-artifact contract, not a renderer-side rule

Each corpus entry carries a `sections` array of stable section identifiers
in the canonical order. Sections whose source content is absent are
omitted from the array — the renderer iterates the array and emits one
slab per identifier. The full identifier set, in canonical order:
`breadcrumb`, `statusStrip`, `citationsStrip`, `motivatingProblem`,
`scenario`, `results`, `implementationLimitation`, `testScopeExclusion`,
`observedPerformance`, `potentialMisconception`,
`implementationAlternativeRejected`, `ecma376Difficulty`,
`specCitations`, `sourceLink`.

This shape makes the renderer obligation enforceable from this repo: the
corpus emitter's tests assert section ordering and omission rules, which
is mechanical. A spec that put SHALLs on the cross-repo renderer would
be a contract we cannot test from here.

There is no "Discussion" umbrella and no "Related scenarios" identifier
in the set; both were rejected during plan iteration (the former as too
vague to be useful, the latter as a publish-gate that rotted 10× faster
than other content because editing one scenario forced edits on N
sibling pages).

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

- Should the corpus emitter include source ranges for every extracted
  literal or only a source link for the owning test? The current contract
  requires enough identity for a source link, not full range provenance.
- Should `corpusVisibility` Allure-label emission live inside the
  `allure-test-factory` runtime, or in a setup-allure-labels helper that
  callers already wire in? Either works; the implementation PR for Allure
  visibility metadata will choose.

## Closed Questions

- **Where does `tests-corpus.schema.json` live?** Decided in D6c:
  generated from the Zod schema, checked into the repo, CI fails on
  drift, release attaches the same file.
- **How does a cross-repo renderer consume the schema?** Decided in
  spec.md Requirement: "Corpus artifact is the renderer-facing
  contract": through the emitted JSON Schema artifact, not by importing
  the TypeScript workspace package.
- **How is `visibility` emitted as Allure metadata?** Decided in D6b:
  label name `corpusVisibility`, value `public` when public, no label
  when internal or omitted.
- **What does the AST extractor do with non-literal fixture values?**
  Decided in D6a and spec.md Requirement: "AST extractor falls back on
  non-literal evidence": emit an unresolved-evidence marker with source
  text and a `path:line` reference; never evaluate code.
