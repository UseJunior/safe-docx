## 1. Approval and characterization

- [x] 1.1 Obtain owner approval for the shared paragraph-merge scope. Approved in chat September 14, 2026: "I approve - proceed".
- [x] 1.1a Obtain approval to extend to field-aware tracked-paragraph structure. Approved September 15, 2026: "yes, extend it".
- [x] 1.1b Characterize and repair the complete/multiple/nested versus partial field deletion emission causing the corpus formatting conflict, without changing expected corpus outcomes. Safety outcomes unchanged; representation snapshot changes adjudicated in evidence.md.
- [x] 1.2 Preserve the local public-document causal controls and add minimized synthetic reader cases using shared fixture builders.
- [x] 1.3 Audit normative paragraph-mark and paragraph-property semantics; record Word evidence or its absence explicitly.
- [x] 1.4 Establish the formatting decision table, including empty/partial/full content, direct/inherited/suppressed numbering, Accept/Reject, consecutive breaks and safety boundaries. Conflict paused September 14; approved field extension resolves it September 15. See evidence.md; Word remains unverified.

## 2. Repair

- [x] 2.1 Add failing regressions for the justified native merge behavior in comparison and core primitives.
- [x] 2.2 Correct the shared behavior without content-based paragraph deletion; audit independent release-verifier impact without coupling it to the emitter. Its text-only structural projector remains independent and unchanged.
- [x] 2.3 Remove unnecessary synthetic paragraph-format compensation and superseded local numbering experiments; retain only separately verified successor-format repairs.
- [x] 2.4 Strengthen actual-reader assertions for numbering suppression/list-header state and effective neighboring paragraph formatting.

## 3. Verification and shipping

- [x] 3.1 Pass focused tests and the required actual-reader matrix; render the public NVCA Accept/Reject outputs and verify numbering against the corresponding source states. September 15 fresh actual-reader renders inspected and opened locally; native/reader controls pass. Repeat as part of shipping smoke.
- [x] 3.2 September 16: final reviewed head `25ff4870` passed all six root pre-submit gates and required corpus 21/21. The September 15 field representation changes were causally adjudicated below; the later history/order follow-up left the reviewed 23-row manifest unchanged. This completion records final-head evidence, not success at the earlier failing implementation commit.
- [x] 3.3 Validate emitted document and notes through the repository schema gate and check text, bindings, topology and package relationships. Built-code public smoke and selective-mark/field schema controls pass September 15; rerun on reviewed/shipped head.
- [x] 3.4 September 16: fresh dynamic Claude Opus 5 APPROVE of exact head `25ff4870309706813a348559690cbbd095f09117`, including 160 required-reader focused tests and 27 independently executed parity probes. Earlier REQUEST CHANGES reports are historical, not the final verdict.
- [x] 3.5 September 16: normal reviewed-history push, green required CI, actual advisory 9 pass/0 warn/0 error, PR #980 squash merge `615fd5f7abf0d4f9b20a54b4f811e0374754b483` at 05:59:59 UTC. Fresh detached exact-merge clean build/full suite (3,412 passed/47 documented skips), public DOCX/schema/projection and required-reader smoke passed; production docs READY at that exact merge SHA. Public proof: https://github.com/UseJunior/safe-docx/pull/980#issuecomment-5701007298 . No Word verification or hosted API build/deploy claimed.

## Archive follow-up

- [x] September 17, before canonical promotion: added the active docx-comparison delta to coverage enforcement and mapped all five scenarios. Strict coverage passed 70/70. Numbered Accept/Reject use actual unresolved reader dispatches versus independent source identities, linked document-outline rules, ordinal/restart/list-header checks and direct native formatting measurement. The release-gate negative control measures reader/schema/text agreement, then explicitly fault-injects the native formatting vote and asserts the production publisher rejects it; it does not falsely claim today's native projector disagrees on that fixture. The four unfiltered Accept/Reject native/AST parity cases (two per projection) are also mapped. Required actual-reader/mapping suite passed 56/56; strengthened outline/capture-isolation control subsequently passed. Archive validation and this follow-up's own review/shipping remain separate gates.

The three reader-mapped scenarios execute only under local `SAFE_DOCX_NOTE_READER_REQUIRED=1`; CI has no LibreOffice job, so CI enforces their mapping, not their execution. Actual-reader execution remains a local release gate.
