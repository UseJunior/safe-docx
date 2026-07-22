# test-corpus-narrative Specification (delta)

## ADDED Requirements

### Requirement: Corpus entries carry cross-implementation suite join keys

The corpus schema SHALL permit each corpus entry to carry an optional
`crossImplementation` object whose `suiteScenarioIds` array lists the
cross-implementation suite scenario ids the test corresponds to. The field is
the renderer-facing join key between a
safe-docx corpus entry and the cross-impl suite repo's published results JSON,
because corpus entry ids are file/line-derived and unusable as cross-repo keys.
The field is optional and additive: entries without it remain valid against
`tests-corpus.schema.json`, and when present the array MUST contain at least one
non-empty id with no duplicates.

The ids SHALL be authored as a `@suiteScenarioIds` JSDoc tag above the
`test.openspec(...)(...)` call, holding a comma- or whitespace-separated list of
ids. The AST extractor SHALL parse the tag statically into a string array. The
join keys are not prose, so they MUST NOT be subject to the narrative word-count
tag rules and MUST NOT appear inside the entry's `narrative` object.
`scripts/build_tests_corpus.mjs` SHALL emit `crossImplementation` only when the
tag is present.

#### Scenario: suite scenario ids are extracted from the tag

- **GIVEN** a test with a `@suiteScenarioIds docx/track-changes/a, docx/track-changes/b` JSDoc tag
- **WHEN** the AST extractor processes the test
- **THEN** the scenario evidence SHALL include a `suiteScenarioIds` array equal to
  `["docx/track-changes/a", "docx/track-changes/b"]`
- **AND** the parsed `narrative` object SHALL NOT contain a `suiteScenarioIds` key

#### Scenario: corpus omits the field when the tag is absent

- **GIVEN** a test with no `@suiteScenarioIds` tag
- **WHEN** `scripts/build_tests_corpus.mjs` emits the corpus entry
- **THEN** the entry SHALL NOT include a `crossImplementation` field
- **AND** the entry SHALL remain valid against `tests-corpus.schema.json`

#### Scenario: schema accepts the optional field

- **GIVEN** a corpus entry that includes `crossImplementation` with a non-empty
  `suiteScenarioIds` array
- **WHEN** the entry is validated against the generated `tests-corpus.schema.json`
- **THEN** validation SHALL pass
- **AND** an entry that omits `crossImplementation` SHALL also pass
