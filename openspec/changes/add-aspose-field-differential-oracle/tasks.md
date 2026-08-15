## 1. Local oracle driver

- [x] 1.1 Add shared minimal field-pair fixtures for the three instruction changes and one cached-result change.
- [x] 1.2 Add a local-only Aspose.Words driver with explicit Python/license configuration, sanitized diagnostics,
      clean absent-configuration skip behavior, and loud failures for invalid attempted runs.
- [x] 1.3 Project Aspose output into deterministic structural verdicts and write the canonical JSON snapshot.

## 2. Checked-in evidence

- [x] 2.1 Check in a snapshot stamped `Aspose.Words 25.10` with fixture hashes and deterministic verdicts.
- [x] 2.2 Add CI-safe tests that validate the snapshot schema, provenance, fixture hashes, and pinned verdicts without
      importing Aspose or accessing a license.
- [x] 2.3 Add a separately dated manual trust-boundary record and test recording Word as primary oracle, the measured Word/Aspose agreements, and any
      characterized divergences, including the pinned ILPA enumerator, formatting, and `Giveback),` observations.

## 3. Documentation and verification

- [x] 3.1 Document the single refresh command and local configuration contract.
- [x] 3.2 Run targeted tests, package suites, repository pre-submit gates, emitted-schema validation, and coverage.
- [ ] 3.3 Obtain peer review, publish a focused PR, and run post-merge real-document smoke verification.
