## 0. Approval

- [ ] 0.1 Steven decides the four questions under "Decisions Needed" in `proposal.md`; amend this change to match before implementation.

## 1. Compiler

- [ ] 1.1 Add the dense-rewrite coalescing transform after token-minimal validation and whitespace grouping, scoped to one operation and one paragraph.
- [ ] 1.2 Apply the changed-share gate and the island bound; never absorb leading/trailing text or protected boundaries.
- [ ] 1.3 Record coalescing evidence in the compilation certificate.
- [ ] 1.4 Expose the threshold as decided in 0.1 (README and CLI help if public).

## 2. Verifier

- [ ] 2.1 Implement the verifier policy decided in 0.1, with independent disclosure of absorbed common tokens.

## 3. Tests

- [ ] 3.1 #1293 synthetic paragraph compiles to one deletion and one insertion after the common prefix.
- [ ] 3.2 Accept-all equals `after` and reject-all equals `before` for every fixture.
- [ ] 3.3 Light and moderate edits stay granular; the N and changed-share boundaries are pinned on both sides.
- [ ] 3.4 Update or re-justify the #846 dense-rewrite fixtures.
