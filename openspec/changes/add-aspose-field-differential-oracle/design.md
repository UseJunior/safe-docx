## Context

Microsoft Word is the primary behavioral oracle for DOCX comparison. Aspose.Words is useful as a reproducible
secondary implementation, but it is proprietary, licensed locally, and inappropriate as a CI dependency. The
repository already uses local-only reference implementations such as LibreOffice, but Aspose needs a stricter
boundary: its executable output may be refreshed locally while CI validates only committed, reviewable evidence.

## Goals / Non-Goals

- Goals: reproduce pinned field comparisons; record structural verdicts deterministically; make provenance and
  refresh mechanics obvious; fail closed around missing credentials; keep CI license-free.
- Non-Goals: make Aspose authoritative over Word; install Aspose automatically; store a license or derived secret;
  compare arbitrary customer documents; change production comparison behavior from the oracle command.

## Decisions

- Decision: emit a canonical JSON snapshot rather than checking in Aspose-produced DOCX files. The generated snapshot will
  contain the oracle/version stamp, fixture IDs and hashes, non-derivable Aspose output-XML hashes, and structural verdicts sufficient to distinguish
  whole-field replacement from result-only redlining.
- Decision: require explicit environment configuration for the Python executable and license path. Absence yields
  a clear skipped result; an attempted run with invalid configuration fails loudly.
- Decision: CI validates the checked-in snapshot's schema, fixture hashes, version stamp, and expected verdicts,
  but never imports Aspose or reads a license.
- Decision: Microsoft Word measurements remain the primary ground truth. The trust-boundary test labels Aspose as
  corroborating evidence and pins disagreements rather than averaging them away. ILPA observations live in a
  separately dated manual-measurement record so the minimal-pair refresh cannot silently restamp them.
- Alternatives considered: committing generated DOCX output (opaque and noisy); installing Aspose in CI
  (license/security burden); relying on narrative notes only (not reproducible or drift-detecting).

## Risks / Trade-offs

- A stale snapshot can outlive its runtime version. Mitigation: include fixture hashes and the exact Aspose version,
  provide one documented refresh command that rewrites the snapshot deterministically, and have CI independently
  reconstruct the fixture packages and verify their hashes without importing Aspose.
- Structural projection can miss unrelated formatting changes. Mitigation: constrain claims to field-boundary
  topology and state the projection explicitly in the trust-boundary test.
- Local license discovery can accidentally expose paths or secrets. Mitigation: accept a path only, never serialize
  its value or contents, and sanitize diagnostics to configuration names and status.

## Migration Plan

Add the local driver, snapshot validator, fixtures, tests, and documentation. No existing API or workflow changes.
Removing the feature consists of deleting those development-only artifacts.

## Open Questions

- None. Implementation will use the four already measured pairs: FORMCHECKBOX→FORMTEXT, HYPERLINK retarget,
  PAGEREF retarget, and NUMPAGES cached result `3`→`4`.
