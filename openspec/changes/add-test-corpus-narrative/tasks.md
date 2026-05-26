# Tasks: add-test-corpus-narrative

## 1. Proposal

- [ ] 1.1 Review and approve this OpenSpec change.
- [ ] 1.2 Coordinate landing order with
      `add-ecma-376-conformance-framework`. Implementation of
      `scripts/build_tests_corpus.mjs` (task 7.1) is **blocked** until
      the registry-parser lift (task 2) lands, which itself MUST follow
      `add-ecma-376-conformance-framework` reaching a stable registry
      grammar (either fully archived or at a commit a maintainer
      explicitly pins as stable for downstream consumers). OpenSpec has
      no native cross-change dependency mechanism; this dependency is
      tracked here.

## 2. Conformance registry prerequisite

- [ ] 2.1 Lift the private registry parsers from
      `scripts/check_conformance_citations.mjs` and
      `scripts/generate_conformance_doc.mjs` into
      `scripts/lib/conformance-registry.mjs`. Do NOT begin this task
      until `add-ecma-376-conformance-framework` has reached a stable
      registry grammar (see task 1.2).
- [ ] 2.2 Export parser/load helpers that the conformance lint, generated
      docs, and future corpus emitter can share without duplicating
      registry grammar.
- [ ] 2.3 Keep the lift as a separate follow-up PR before implementing
      `scripts/build_tests_corpus.mjs`.

## 3. Narrative schema package

- [ ] 3.1 Create `packages/test-narrative/` with a Zod schema for the
      narrative tags, word-count ranges, rendered section titles, and
      required-vs-optional visibility rules.
- [ ] 3.2 Make the schema the only source of truth imported by in-repo
      consumers (drafter, AST extractor, CI validator, corpus emitter).
      Cross-repo renderers MUST consume the emitted JSON Schema artifact
      instead — they MUST NOT import the TypeScript package directly.
- [ ] 3.3 Generate `tests-corpus.schema.json` from the Zod schema, check
      it into the repository, and add a CI step that regenerates it and
      fails on drift (mirroring the existing
      `scripts/generate_conformance_doc.mjs` idiom).
- [ ] 3.4 Add package tests that cover valid tags, invalid tag names,
      out-of-range prose, required public `motivatingProblem`, and
      internal structural tests with no narrative requirement.

## 4. Allure visibility metadata

- [ ] 4.1 Add `visibility?: 'public' | 'internal'` to
      `AllureLabelDefaults` in `packages/allure-test-factory/src/index.d.ts`
      and the runtime merge/emission surface.
- [ ] 4.2 Default omitted visibility to `internal`.
- [ ] 4.3 Emit `visibility: 'public'` as an Allure label with name
      `corpusVisibility` and value `public` on the test result.
      `visibility: 'internal'` (or omitted) MUST NOT emit a
      `corpusVisibility` label; the corpus builder reads the absence as
      internal. Do NOT reuse the bare `visibility` label name — it
      collides with the conventional Allure label namespace.
- [ ] 4.4 Ensure this remains the only runtime metadata added for test
      narrative; narrative prose stays in JSDoc above the
      `test.openspec(...)(...)` call.

## 5. AST extraction and validation

- [ ] 5.1 Implement a purely-static AST extractor that joins a test call
      to its leading JSDoc narrative tags and extracts verbatim BDD
      `given`/`when`/`then` step strings. The extractor MUST NOT
      evaluate test code, follow imports, or resolve function calls.
- [ ] 5.2 Extract syntactically-local fixture literals and `expect()`
      arguments. For any value that is not statically resolvable
      (imported binding, factory call, computed expression, destructured
      fixture), emit an unresolved-evidence marker carrying the source
      text of the expression plus a `path:line` reference. The extractor
      MUST NOT fail the build and MUST NOT silently drop the field.
- [ ] 5.3 Implement `scripts/check_test_narratives.mjs` so CI hard-fails
      when public tests lack `@motivatingProblem` or any present tag fails
      schema parsing.
- [ ] 5.4 Do not add hash-based staleness gates.

## 6. Authoring loop

- [ ] 6.1 Implement `scripts/draft-narrative-jsdoc.mjs` as a local-only
      helper that shells to `codex exec` to draft narrative tags.
- [ ] 6.2 Document that developers must review, edit, and commit the
      drafted tags manually.
- [ ] 6.3 Ensure CI never runs an LLM and never opens automatic narrative
      PRs.

## 7. Corpus artifact

- [ ] 7.1 Implement `scripts/build_tests_corpus.mjs` to emit
      `tests-corpus.json` (using the schema generated in task 3.3).
- [ ] 7.2 Populate the corpus from Allure JSON identity, status, labels
      (including the `corpusVisibility` label from task 4.3), links, and
      step names joined with AST-extracted narrative tags, BDD steps,
      fixture literals (or unresolved-evidence markers per task 5.2),
      `expect()` arguments, and resolved `ConformanceClaim[]`.
- [ ] 7.3 Normalize the artifact by stripping host runner IDs, Vitest
      framework names, millisecond durations, language tags, and other
      engineer-only noise.
- [ ] 7.4 For each entry, emit a `sections` array of stable section
      identifiers in canonical order: `breadcrumb`, `statusStrip`,
      `citationsStrip`, `motivatingProblem`, `scenario`, `results`,
      `implementationLimitation`, `testScopeExclusion`,
      `observedPerformance`, `potentialMisconception`,
      `implementationAlternativeRejected`, `ecma376Difficulty`,
      `specCitations`, `sourceLink`. Omit any section whose backing
      content is absent.
- [ ] 7.5 Add a tag-time GitHub Actions workflow that publishes
      `tests-corpus.json` and the checked-in `tests-corpus.schema.json`
      as release artifacts.

## 8. Verification

- [ ] 8.1 `openspec validate add-test-corpus-narrative --strict` passes.
- [ ] 8.2 Future implementation PRs add targeted package tests and wire the
      narrative check into CI.
