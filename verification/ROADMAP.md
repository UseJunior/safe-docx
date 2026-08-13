# Verification roadmap

## Lean retirement (2026-08-13)

Safe DOCX previously maintained a Lean verification program in this location.
That program was removed because its local toolchain and multi-minute build made
the release certificate non-portable and routinely `not_run` in the environment
where documents are actually reviewed.

This changes the mechanism, not the release standard. The independent
TypeScript release verifier operates on the finished DOCX artifact and requires:

- exact accept-all and reject-all text projections;
- emitted-redline LCS minimality;
- package and native-comment integrity;
- renderer verification; and
- explicit human review for delivery.

The release verifier remains separate from the redline generator so the
implementation producing a document does not certify its own in-memory model.
Historical Lean design work remains available in Git history; it is not a
current product claim, runtime dependency, or release gate.
