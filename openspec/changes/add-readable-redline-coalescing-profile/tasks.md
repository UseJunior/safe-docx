## 1. Contracts and policy resolution

- [ ] 1.1 Add the closed `token-minimal | readable-whitespace` policy to the Markdoc `compilation` tag, edit IR, TypeScript compile options, CLI parsing, and validation.
- [ ] 1.2 Implement deterministic precedence, have the CLI pass explicit provenance, and record `revisionGrouping: { policy, source, coalescedSpaceTokens, groupedChains }` in compilation certificates.
- [ ] 1.3 Document syntax, defaults, override behavior, and the deliberate difference between token-minimal and readability-grouped emitted shapes.

## 2. Bounded readable grouping

- [ ] 2.1 Add a post-validation transform that groups chains of replacement hunks (both source and replacement nonempty) across identical U+0020-only common bridges while preserving the current minimal hunk path unchanged by default.
- [ ] 2.2 Keep run-format, inline-format, and retained-format validation on the token-minimal hunk set; group only when the merged range and all fragments resolve to one compatible template signature or explicit `format-source`, otherwise emit them ungrouped.
- [ ] 2.3 Emit each admitted bridge on both deletion and insertion sides and assert the emitter's existing `xml:space` behavior on grouped output.
- [ ] 2.4 Fail closed across lexical, punctuation, tab/line-break, pure insertion/deletion, field, bookmark, comment, hyperlink, property, paragraph/table, formatting, and existing-revision boundaries.
- [ ] 2.5 Apply grouped hunks consistently to emission, attribution ranges, and formatting-projection expectations, or prove and test that the latter are invariant.
- [ ] 2.6 Tag new OOXML tests with the existing `w:del`/`w:ins` ECMA-376 citations, update the conformance registry if required, and retain schema validation.

## 3. Independent disclosure evidence

- [ ] 3.1 Keep `authored-zero-loss` as the only gate and add U+0020-only coalesced-whitespace disclosure evidence derived from adjacent content-bearing deletion/insertion groups in finished markup, without compiler IR.
- [ ] 3.2 Bind grouped-chain and coalesced-space totals into the release certificate and diagnostics without changing `lostTokensByClass` or the verdict.
- [ ] 3.3 Add verifier regressions proving alternating and correctly grouped shapes both pass zero-loss but differ in disclosure, while over-broad edge-space/lexical/punctuation grouping still fails.
- [ ] 3.4 Update the release-verifier README to define anchored obligations and disclosure semantics.

## 4. Regression and acceptance evidence

- [ ] 4.1 Add synthetic positive fixtures in a dedicated `TEST_FEATURE` file proving multi-word replacements group into one readable deletion/insertion pair only when opted in.
- [ ] 4.2 Add negative controls for punctuation, tabs/newlines, pure insertion/deletion, a single replacement fragment, incompatible formatting, repeated-token ambiguity, existing revisions, and protected structure.
- [ ] 4.3 Prove exact accept/reject text and semantic-formatting projections, attribution evidence, `xml:space` handling, schema validity, and zero required lexical/punctuation/structural loss for every readable fixture.
- [ ] 4.4 Keep the #846 dense-rewrite, paragraph-topology, numbering, mixed-format, selected-story, retained-format, and existing verifier regressions green under the default policy.
- [ ] 4.5 Run the full repository pre-submit suite and a real-template Markdoc smoke with both policies, then capture the readability difference without confidential fixture content.

