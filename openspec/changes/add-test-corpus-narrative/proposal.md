# Change: Add test corpus narrative

## Why

BDD tests carry context that is currently trapped in commit messages,
review discussion, and local maintainer memory. Public corpus consumers
need a machine-readable, test-local source of truth that explains why a
scenario exists, what it proves, what it deliberately excludes, and how it
relates to ECMA-376 conformance evidence.

## What Changes

- Add a new OpenSpec capability, `test-corpus-narrative`, for per-test
  narrative metadata and the publishable tests-corpus artifact.
- Define a JSDoc narrative tag schema owned by a future
  `packages/test-narrative/` package. The schema is the only source for
  tag names, word ranges, and rendered section titles.
- Add `visibility?: 'public' | 'internal'` to `AllureLabelDefaults`, with
  a default of `internal`, as the only new runtime metadata needed to
  decide whether narrative tags are required.
- Define `tests-corpus.json` and `tests-corpus.schema.json`, emitted from
  Allure result JSON joined with AST-extracted JSDoc narrative tags, BDD
  strings, local fixture literals, `expect()` arguments, and resolved
  ECMA-376 conformance claims.
- Define the authoring and maintenance loop: a local Codex drafter may
  propose JSDoc tags, CI validates required-tag presence and schema
  conformance, and CI does not run an LLM or hash-based staleness gate.
- Coordinate the corpus emitter with the active
  `add-ecma-376-conformance-framework` change by listing the
  conformance-registry parser lift as a prerequisite follow-up task.

## Impact

- Affected specs: `test-corpus-narrative` (new capability)
- Affected code in follow-up PRs only:
  - `packages/test-narrative/**`
  - `packages/allure-test-factory/src/index.{js,d.ts}`
  - `scripts/draft-narrative-jsdoc.mjs`
  - `scripts/check_test_narratives.mjs`
  - `scripts/build_tests_corpus.mjs`
  - `scripts/lib/conformance-registry.mjs`
  - tag-time GitHub Actions release workflow

Ref: #235.
