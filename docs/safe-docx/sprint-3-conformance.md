# Safe Docx Trust Improvement Sprint 3

Intent: provide reproducible, inspectable reliability evidence for `@usejunior/safe-docx` using pinned fixtures and deterministic conformance checks.

## What Is Validated

- Fixture corpus is pinned in a committed manifest:
  - `packages/safe-docx/conformance/fixtures.manifest.json`
- One-time fixture discovery exists with provenance + SHA-256:
  - `npm run conformance:discover -w @usejunior/safe-docx`
- Conformance harness emits machine-readable JSON reports:
  - `npm run conformance:run -w @usejunior/safe-docx`
- Fast smoke path exists for local/CI signal:
  - `npm run conformance:smoke -w @usejunior/safe-docx`
- Determinism is asserted at canonical content level (not byte-identical DOCX outputs).

## What Is Not Validated

- Full manual cross-editor compatibility matrix (Word/LibreOffice/Google Docs/Pages)
- Guarantees that require byte-identical archive output
- Any fixture not pinned in the checked-in manifest

## Why Fixtures Are Pinned

- Reproducibility: no runtime fixture fetch drift
- Auditability: reviewers can inspect exact fixture entries in Git
- Determinism: CI does not depend on network availability

## Harness Commands

- Full run:
  - `npm run conformance:run -w @usejunior/safe-docx`
- Smoke run:
  - `npm run conformance:smoke -w @usejunior/safe-docx`
- Explicit manifest/report path:
  - `npm run conformance:run -w @usejunior/safe-docx -- --manifest conformance/fixtures.manifest.json --report /tmp/safe-docx-conformance.json`
- Optional OpenAgreements fixture root:
  - `SAFE_DOCX_CONFORMANCE_OPEN_AGREEMENTS_ROOT=/path/to/open-agreements npm run conformance:run -w @usejunior/safe-docx`

## Report Contract

- Report schema version:
  - `safe-docx-conformance-report/v1`
- Report schema file:
  - `packages/safe-docx/conformance/report.schema.v1.json`
- Fixture manifest schema file:
  - `packages/safe-docx/conformance/fixtures.manifest.schema.v1.json`

## Safe Fixture-Add Flow

1. Discover candidates:
   - `npm run conformance:discover -w @usejunior/safe-docx`
2. Add explicit entries to:
   - `packages/safe-docx/conformance/fixtures.manifest.json`
3. Run smoke and full harness before merge.
4. Keep fixture growth deliberate and reviewable.
