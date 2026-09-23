## 0. Default-only contract correction (user direction after PR #1016)

- [x] 0.1 Remove the public grouping selector from canonical Markdoc, TypeScript compile options, and CLI; reject legacy Markdoc/CLI declarations and JavaScript own-property API options before comparison or mutation.
- [x] 0.2 Always apply bounded readable grouping after token-minimal validation in Markdoc; keep docx-compare's internal token-minimal default and explicit minimal option as the test oracle and unsupported-boundary fallback.
- [x] 0.3 Narrow compilation-certificate types to literal `policy: 'readable-whitespace'` and `source: 'default'`, retaining actual grouping counts without suggesting a caller-selected mode.
- [x] 0.4 Update README and retag/rewrite all SDX-MDOC-139/140/141/143/146 tests for default grouping, legacy-selector rejection (including an own API option set to `undefined`), unchanged accept/reject projections, pre-existing revision evidence, and zero-loss bounds; remove assertions of the old opt-in contract.
- [ ] 0.5 Run pre-submit checks, real-template smoke, Fable peer review, and a separate implementation PR/automerge smoke.

## 1. Original PR #1016 implementation history

The completed tasks below describe PR #1016's original opt-in implementation;
section 0 supersedes its public-default and selector wording.

- [x] 1.1 Add the closed `token-minimal | readable-whitespace` policy to the Markdoc `compilation` tag, edit IR, TypeScript compile options, CLI parsing, and validation.
- [x] 1.2 Implement `revisionGrouping?: { policy, source?: 'api' | 'cli' }`, default omitted source to API, have the CLI pass explicit provenance, and record `{ policy, source, coalescedSpaceTokens, groupedChains }` in compilation certificates.
- [x] 1.3 Document syntax, defaults, override behavior, and the deliberate difference between token-minimal and readability-grouped emitted shapes.

## 2. Bounded readable grouping

- [x] 2.1 Add a post-validation transform that groups chains of replacement hunks (both source and replacement nonempty) across identical U+0020-only common bridges; use the chain's outer source/revised bounds and exact revised slice while preserving the current minimal hunk path unchanged by default.
- [x] 2.2 Keep run-format, inline-format, and retained-format validation on the token-minimal hunk set; group only when the merged range and all fragments resolve to one compatible template signature or explicit `format-source`, otherwise emit them ungrouped.
- [x] 2.3 Emit each admitted bridge on both deletion and insertion sides and assert the emitter's existing `xml:space` behavior on grouped output.
- [x] 2.4 Stop grouping without throwing at lexical, punctuation, tab/line-break, pure insertion/deletion, retained-format, field, bookmark, comment, hyperlink, property, paragraph/table, formatting, and existing-revision boundaries.
- [x] 2.5 Apply grouped hunks consistently to emission, attribution ranges, and formatting-projection expectations, or prove and test that the latter are invariant.
- [x] 2.6 Tag new OOXML tests with the existing `w:del`/`w:ins` ECMA-376 citations, update the conformance registry if required, and retain schema validation.

## 3. Independent disclosure evidence

- [x] 3.1 Keep `authored-zero-loss` as the only gate and add deterministic U+0020-only coalesced-whitespace disclosure from maximal content-bearing deletion-to-insertion groups in finished markup, using exact interior-token multiset intersection without compiler IR.
- [x] 3.2 Bind grouped-chain and coalesced-space totals into the release certificate and diagnostics without changing `lostTokensByClass` or the verdict.
- [x] 3.3 Add verifier regressions proving alternating and correctly grouped shapes both pass zero-loss but differ in disclosure, while over-broad edge-space/lexical/punctuation grouping still fails.
- [x] 3.4 Update the release-verifier README to define anchored obligations and disclosure semantics.

## 4. Regression and acceptance evidence

- [x] 4.1 Add synthetic positive fixtures in a dedicated `TEST_FEATURE` file proving multi-word replacements group into one readable deletion/insertion pair only when opted in.
- [x] 4.2 Add negative controls for punctuation, tabs/newlines, pure insertion/deletion, a single replacement fragment, a retained-format bridge interval, incompatible formatting, repeated-token ambiguity, existing revisions, and protected structure.
- [x] 4.3 Prove exact accept/reject text and semantic-formatting projections, attribution evidence, `xml:space` handling, schema validity, and zero required lexical/punctuation/structural loss for every readable fixture.
- [x] 4.4 Keep the #846 dense-rewrite, paragraph-topology, numbering, mixed-format, selected-story, retained-format, and existing verifier regressions green under the default policy.
- [x] 4.5 Run the full repository pre-submit suite and a real-template Markdoc smoke with both policies, then capture the readability difference without confidential fixture content.
