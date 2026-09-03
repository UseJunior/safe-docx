# Verification roadmap

## Release verification model

The independent TypeScript release verifier operates on the finished DOCX
artifact and requires:

- exact accept-all and reject-all text projections;
- emitted-redline LCS minimality;
- package and native-comment integrity;
- renderer verification; and
- explicit human review for delivery.

The release verifier remains separate from the redline generator so the
implementation producing a document does not certify its own in-memory model.
