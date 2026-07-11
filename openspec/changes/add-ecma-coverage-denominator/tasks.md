## 1. Source artifacts

- [x] 1.1 Vendor unchanged official Parts 1-4 ZIPs with SHA-256 verification.
- [x] 1.2 Document publication metadata and Ecma copyright treatment.

## 2. Structured ingestion

- [x] 2.1 Add artifact and initial spec-reference manifests.
- [x] 2.2 Generate and validate initial WordprocessingML vocabulary from the official Part 4 ZIP.
- [x] 2.3 Generate TypeScript vocabulary constants with source checksum provenance.

## 3. Runtime traceability and CI

- [x] 3.1 Use generated QNames in the field-fragmentation semantic group.
- [x] 3.2 Add `@ooxmlSpec` source links and a generated coverage report.
- [x] 3.3 Add a CI-suitable checksum, locator, usage, and drift check.
- [x] 3.4 Reconcile manifest references with canonical registry metadata and add deterministic generator tests.
