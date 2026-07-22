# Change: Corpus cross-implementation suite join keys

## Why

The tests-renderer matrix page consumes the cross-impl suite repo's published
results JSON keyed by suite scenario id. Corpus entry ids are file/line-derived
(`scripts/build_tests_corpus.mjs`) and are unusable as cross-repo join keys, so
a renderer cannot place per-test-page "Other implementations" rows next to a
safe-docx scenario. The corpus contract needs an explicit, optional place to
carry the suite scenario ids a given test corresponds to. (Ref: #391, #283.)

## What Changes

- Add an optional `crossImplementation: { suiteScenarioIds: string[] }` field to
  each corpus entry in `tests-corpus.schema.json`. Additive and optional — entries
  without the field stay valid.
- Add a `@suiteScenarioIds` narrative JSDoc tag (a comma/space-separated list of
  suite scenario ids), parsed statically by the AST extractor. It is a list of
  join keys, not prose, so it lives outside the word-count `tagDefinitions` and
  outside the entry `narrative` object.
- Populate the entry's `crossImplementation` from the parsed tag in
  `scripts/build_tests_corpus.mjs`, emitting the field only when the tag is present.

## Impact

- Affected specs: test-corpus-narrative
- Affected code: `packages/test-narrative/src/tagSchema.ts`,
  `packages/test-narrative/src/astExtractor.ts`,
  `scripts/generate_tests_corpus_schema.mjs`,
  `scripts/build_tests_corpus.mjs`, `tests-corpus.schema.json`
