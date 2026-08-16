## 1. Contract and validation

- [ ] 1.1 Define the exact `external-facing` rationale category and reject duplicate selected rationales for one operation.
- [ ] 1.2 Extend compile options with an opt-in rationale-comment configuration requiring non-empty author, initials, and a valid caller-supplied date.
- [ ] 1.3 Add stable fail-closed diagnostics for invalid identity, missing operations, ambiguous attribution, and empty anchor ranges.

## 2. Comment materialization

- [ ] 2.1 Retain deterministic operation-to-change attribution through tracked-document compilation.
- [ ] 2.2 Materialize one native root comment per selected rationale using the exact rationale text and caller-supplied identity.
- [ ] 2.3 Implement the specified insertion, deletion, replacement, and cross-paragraph anchor rules.
- [ ] 2.4 Extend or supplement the native-comment primitive so ranges can address deleted text and cross-paragraph tracked content without mapping through visible-text offsets.
- [ ] 2.5 Keep comment-only package mutations outside tracked operative content and preserve unchanged package parts.

## 3. Verification and tests

- [ ] 3.1 Add synthetic tests for selection and non-selection, including unclassified and unknown-category rationales.
- [ ] 3.2 Add synthetic anchoring tests for insertions, deletions, replacements, and multi-paragraph operations.
- [ ] 3.3 Prove deterministic comment author, initials, date, IDs, anchors, and serialized output for identical inputs.
- [ ] 3.4 Prove accept-all, reject-all, and semantic formatting projection invariance.
- [ ] 3.5 Prove comment records, range starts, range ends, and references remain balanced through accept-all and reject-all processing, with deterministic zero-width collapse when tracked anchor text is removed.
- [ ] 3.6 Exercise `requireNativeComments: true` against positive and zero-comment outputs.
- [ ] 3.7 Confirm all fixtures contain only synthetic document and rationale content.

## 4. Delivery

- [ ] 4.1 Run package-scoped build, lint, and tests while iterating.
- [ ] 4.2 Run the full repository pre-submit gate.
- [ ] 4.3 Update public package documentation for the opt-in compile contract.
