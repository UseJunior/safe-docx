## 1. Contracts and policy resolution

- [ ] 1.1 Add the closed `token-minimal | readable-whitespace` policy to the Markdoc compilation profile, edit IR, TypeScript compile options, CLI parsing, and validation.
- [ ] 1.2 Implement deterministic precedence and record the resolved policy plus API/CLI/Markdoc/default provenance in compilation certificates.
- [ ] 1.3 Document syntax, defaults, override behavior, and the deliberate difference between token minimality and readable coalescing.

## 2. Bounded readable grouping

- [ ] 2.1 Add a post-LCS transform that groups chains of replacement hunks across U+0020-only common bridges while preserving the current minimal hunk path unchanged by default.
- [ ] 2.2 Emit each admitted bridge on both deletion and insertion sides with exact `xml:space` preservation and compatible revision metadata/formatting.
- [ ] 2.3 Fail closed across lexical, punctuation, tab/line-break, field, bookmark, comment, hyperlink, property, paragraph/table, formatting, and revision-provenance boundaries.
- [ ] 2.4 Add the required ECMA-376 citations, Allure conformance tags, registry entries, and schema validation for changed OOXML behavior.

## 3. Independent policy-aware verification

- [ ] 3.1 Extend verifier inputs and evidence with `authored-zero-loss` and `authored-readable-whitespace-v1` policies without importing compiler IR.
- [ ] 3.2 Under the readable policy, independently recognize only paired plain-space bridges proven by finished tracked markup and exact semantic projections.
- [ ] 3.3 Report mandatory token loss separately from allowed coalesced whitespace; fail closed for a policy mismatch or unexplained loss.
- [ ] 3.4 Bind the resolved verifier policy and evidence totals into the release certificate and human-readable diagnostics.

## 4. Regression and acceptance evidence

- [ ] 4.1 Add synthetic positive fixtures proving multi-word replacements group into one readable deletion/insertion pair only when opted in.
- [ ] 4.2 Add negative controls for punctuation, tabs/newlines, a single replacement fragment, incompatible formatting/provenance, repeated tokens, and protected structure.
- [ ] 4.3 Prove exact accept/reject projections, `xml:space` preservation, schema validity, and zero lexical/punctuation/structural loss for every readable fixture.
- [ ] 4.4 Keep the #846 dense-rewrite, paragraph-topology, numbering, mixed-format, and existing verifier regressions green under the default policy.
- [ ] 4.5 Run the full repository pre-submit suite and a real-template Markdoc smoke with both policies, then capture the readability difference without confidential fixture content.

