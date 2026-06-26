## 1. Implementation

- [x] 1.1 Add `@suiteScenarioIds` tag name + Zod validator to `tagSchema.ts`
- [x] 1.2 Parse `@suiteScenarioIds` into `ScenarioEvidence.suiteScenarioIds` in `astExtractor.ts`
- [x] 1.3 Add optional `crossImplementation.suiteScenarioIds` to the generated schema
- [x] 1.4 Populate `crossImplementation` in `build_tests_corpus.mjs` when present
- [x] 1.5 Regenerate and commit `tests-corpus.schema.json`

## 2. Tests

- [x] 2.1 AST extractor test: `@suiteScenarioIds` parses to a string array
- [x] 2.2 tagSchema test: suite-scenario-ids validator accepts/rejects ids
- [x] 2.3 Generator test: emitted schema carries optional `crossImplementation`
