## 1. Shared field semantics

- [x] 1.1 Add switch-aware field instruction tokenization and classification.
- [x] 1.2 Cover quoted targets, supported presentation switches, unsupported
  projection switches, and layout-dependent classifications.
- [x] 1.3 Reuse the classifier in PAGEREF comparison identity.

## 2. Deterministic refresh

- [x] 2.1 Add main-story complex-field enumeration with stable locators.
- [x] 2.2 Add strict bookmark pairing and visible range extraction.
- [x] 2.3 Refresh admitted REF cached results while preserving result runs.
- [x] 2.4 Mark admitted layout-dependent fields dirty on request.
- [x] 2.5 Return structured outcomes and typed fail-closed errors.
- [x] 2.6 Export the additive public API.

## 3. Review remediation

- [x] 3.1 Refuse tabbed and cross-paragraph bookmark projections instead of
  flattening them to literal control characters.
- [x] 3.2 Make `w:fldSimple` subtrees opaque to complex-field collection.
- [x] 3.3 Read instructions from the surviving revision state, by ancestry.
- [x] 3.4 Restore the comparison keyword floor so cache suppression cannot
  narrow, and pin it with a differential suite.
- [x] 3.5 Name unread field-bearing stories; drop the `-1` locator sentinel.
- [x] 3.6 Replace per-field linear scans with a precomputed element index.

## 4. Evidence

- [x] 4.1 Add conformance-tagged unit and integration tests.
- [x] 4.2 Add ECMA-376 registry entries and verified-by references.
- [x] 4.3 Add OpenSpec traceability mappings.
- [x] 4.4 Run focused tests, build, conformance checks, and strict OpenSpec
  validation.
