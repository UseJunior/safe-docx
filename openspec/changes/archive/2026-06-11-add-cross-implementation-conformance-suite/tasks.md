## 1. Suite repository (open-agreements/docx-platform-tests — M1)

- [x] 1.1 Create public repo with BSD-3-Clause LICENSE, README (WordprocessingML conformance scope), CONTRIBUTING — created BSD-3-Clause; relicensed to Apache-2.0 before accepting external contributions (docx-platform-tests#13)
- [x] 1.2 Write `docs/scenario-dsl.md` (DSL v1.0: operations enum, assertion kinds incl. deferred `schemaValidAgainstWml`, text-projection and match-scope rules, weakest-assertion authoring rule) and `docs/adapter-protocol.md` (protocol v1, exit codes)
- [x] 1.3 Author the 3 M1 scenarios (`acceptInsertionsUnwrapsInsWrappers`, `acceptDeletionsRemovesDelContent`, `replaceFirstOccurrencePreservesOffsets`) with `scenario.json`, `input/document.xml`, packed `input.docx`, expected outputs
- [x] 1.4 Build the runner (`@xmldom/xmldom` + `xpath` + zip; canonicalizer with rsid-stripping and `mergeAdjacentIdenticalRuns`; results JSON writer) and the fixture-sync check
- [x] 1.5 CI workflow `run-suite.yml` (push + weekly cron) publishing `results/latest.json` to gh-pages
- [x] 1.6 File the suite repo's M1/M3 issues; `registry/adapters.json` scaffold

## 2. safe-docx adapter + self-check (M2, issue #389)

- [x] 2.1 `packages/docx-core/src/cli/conformance-adapter.ts` (shebang entrypoint; protocol v1; wires `acceptChanges`, `rejectChanges`, `getParagraphText`/`replaceParagraphTextRange`, `DocxDocument.load`/`toBuffer`; exit 2 for unknown operations)
- [x] 2.2 `"safe-docx-conformance-adapter"` bin entry in `packages/docx-core/package.json`
- [x] 2.3 Self-check test `packages/docx-core/src/integration/cross-implementation-suite.test.ts` with `DOCX_PLATFORM_TESTS_DIR` skip-gate, `docx-platform-tests.pin.json` (landed at `src/integration/docx-platform-tests.pin.json`), `TEST_FEATURE`, single-line `.openspec()` tags, `.conformance()` citations
- [x] 2.4 Pre-submit gates green: build, lint:workspaces, test:run, check:spec-coverage, check:conformance-citations, check:conformance-doc

## 3. Suite adapters (M2/M3)

- [x] 3.1 `adapters/safe-docx/` wrapper installing the pinned-SHA `npm pack` tarball; all 3 scenarios `pass` (self-check: safe-docx vs suite expected)
- [x] 3.2 `adapters/python-docx/` (pip-installable; intra-run find-replace; accept/reject exit 2 `unsupported`)
- [x] 3.3 Flip the safe-docx adapter to the published npm bin after the next release train — moved to external tracking as docx-platform-tests#3; interim state changed by the suite's #6 (builds from tip-of-main rather than a pinned SHA)

## 4. Renderer (M4, UseJunior/tests-renderer#62)

- [x] 4.1 Standalone Starlight matrix page consuming the suite's gh-pages `results/latest.json`, keyed by suite scenario id (UseJunior/tests-renderer#62, closed)

## 5. Archive (issue #390)

- [x] 5.1 `openspec archive add-cross-implementation-conformance-suite --yes` in its own PR after deployment; coverage-validator extension for the new capability split out to a follow-up issue
