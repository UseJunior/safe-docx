## Implementation
- [x] Add a shared portable core projection guard and structured error.
- [x] Integrate edit preflight and final comparison publication.
- [x] Verify focused valid/broken edits, references and opt-out.
- [x] Measure overhead on a 351-paragraph real NVCA document.
- [ ] Complete local gates and cross-model review.

## Release blocker
The default-on implementation is not release-ready. The required corpus run passes
36 of 37 tests and fails the checked-in ILPA strategy characterization on rejected
header/footer binding and story-content differences. Compare unit tests also expose
incompatibilities with warning-only unrepresented changes and additional projection
normalization gaps. Do not disable the guard in the characterization harness or
regenerate the strategy manifest to conceal this failure. Complete the compatibility
work and rerun every required gate before pushing.

Cross-model review also requests changes before release:
- [ ] Bound asset identity size/work; nested XML relationship closures currently grow exponentially.
- [ ] Validate the actual forked candidate; reloading loses session-created header state.
- [ ] Protect field, hyperlink, inline control, equation and other structural atoms.
- [ ] Include batch-end numbered-paragraph removal in the guarded transaction.
- [ ] Complete broad compatibility tests without hiding failures behind opt-outs.

This is a local checkpoint only; it must not be pushed or merged in this state.
