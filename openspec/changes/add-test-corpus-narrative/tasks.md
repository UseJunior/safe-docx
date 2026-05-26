# Tasks: add-test-corpus-narrative

## 1. Proposal

- [ ] 1.1 Review and approve this OpenSpec change.
- [ ] 1.2 Coordinate landing order with
      `add-ecma-376-conformance-framework`, because corpus conformance
      resolution depends on that framework's registry and Allure labels.

## 2. Conformance registry prerequisite

- [ ] 2.1 Lift the private registry parsers from
      `scripts/check_conformance_citations.mjs` and
      `scripts/generate_conformance_doc.mjs` into
      `scripts/lib/conformance-registry.mjs`.
- [ ] 2.2 Export parser/load helpers that the conformance lint, generated
      docs, and future corpus emitter can share without duplicating
      registry grammar.
- [ ] 2.3 Keep the lift as a separate follow-up PR before implementing
      `scripts/build_tests_corpus.mjs`.

## 3. Narrative schema package

- [ ] 3.1 Create `packages/test-narrative/` with a Zod schema for the
      narrative tags, word-count ranges, rendered section titles, and
      required-vs-optional visibility rules.
- [ ] 3.2 Make the schema the only source of truth imported by the drafter,
      AST extractor, CI validator, corpus emitter, and downstream
      renderers.
- [ ] 3.3 Add package tests that cover valid tags, invalid tag names,
      out-of-range prose, required public `motivatingProblem`, and
      internal structural tests with no narrative requirement.

## 4. Allure visibility metadata

- [ ] 4.1 Add `visibility?: 'public' | 'internal'` to
      `AllureLabelDefaults` in `packages/allure-test-factory/src/index.d.ts`
      and the runtime merge/emission surface.
- [ ] 4.2 Default omitted visibility to `internal`.
- [ ] 4.3 Ensure this remains the only runtime metadata added for test
      narrative; narrative prose stays in JSDoc above the
      `test.openspec(...)(...)` call.

## 5. AST extraction and validation

- [ ] 5.1 Implement an AST extractor that joins a test call to its leading
      JSDoc narrative tags and extracts verbatim BDD `given`/`when`/`then`
      step strings.
- [ ] 5.2 Extract local fixture literals and `expect()` arguments needed by
      the corpus artifact without evaluating tests.
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
      `tests-corpus.json` and `tests-corpus.schema.json`.
- [ ] 7.2 Populate the corpus from Allure JSON identity, status, labels,
      links, and step names joined with AST-extracted narrative tags, BDD
      steps, fixture literals, `expect()` arguments, and resolved
      `ConformanceClaim[]`.
- [ ] 7.3 Normalize the artifact by stripping host runner IDs, Vitest
      framework names, millisecond durations, language tags, and other
      engineer-only noise.
- [ ] 7.4 Add a tag-time GitHub Actions workflow that publishes the corpus
      files as release artifacts.

## 8. Verification

- [ ] 8.1 `openspec validate add-test-corpus-narrative --strict` passes.
- [ ] 8.2 Future implementation PRs add targeted package tests and wire the
      narrative check into CI.
