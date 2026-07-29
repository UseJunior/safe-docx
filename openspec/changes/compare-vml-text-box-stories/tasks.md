## 1. Specification

- [x] 1.1 Validate this OpenSpec proposal and delta requirements.
- [x] 1.2 Register the exact ECMA-376 sections governing VML text-box hosted WordprocessingML content and tracked revisions.

## 2. Story classification and orchestration

- [x] 2.1 Discover main-document `w:txbxContent` stories with deterministic locators.
- [x] 2.2 Separate and compare scaffold identity from nested story content identity.
- [x] 2.3 Reject inserted/deleted/reordered/nested/ancillary/scaffold-mutated text boxes with typed diagnostics.

## 3. In-place comparison

- [x] 3.1 Neutralize supported nested stories during outer-body comparison.
- [x] 3.2 Compare each supported paragraph sequence with the shared atomizer/LCS/revision pipeline.
- [x] 3.3 Splice each compared story into the preserved revised scaffold without drawing-level revisions.
- [x] 3.4 Validate accept/reject parity for the assembled document and every nested story.

## 4. Evidence

- [x] 4.1 Convert the published #647 VML reproduction into positive tracked-revision coverage.
- [x] 4.2 Add mixed body/story, multiple-box, formatting, and field-bearing positive fixtures.
- [x] 4.3 Add negative fixtures for topology, scaffold, nesting, and ancillary-story boundaries.
- [x] 4.4 Run Microsoft Word/LibreOffice openability smoke checks where available.
- [x] 4.5 Re-run the confidentiality-safe third-pair oracle and record aggregate-only results.

## 5. Verification coverage

- [x] 5.1 Add text-box story coverage to verifier input/output reporting.
- [x] 5.2 Keep certificates incomplete until the compiled verifier checks every supported nested story.

## 6. Delivery

- [x] 6.1 Run focused tests and the mandatory repository pre-submit command.
- [x] 6.2 Review the public diff for confidential identifiers and bounded scope.
- [ ] 6.3 Commit, push, merge through a focused PR, and perform a real-document post-merge smoke.
