## 1. Specification and conformance

- [x] 1.1 Validate the OpenSpec proposal and delta requirements.
- [x] 1.2 Register exact ECMA-376 block SDT, block content, and property sections.
- [x] 1.3 Keep opaque preservation labeled as a bounded metamorphic invariant.

## 2. Placement-aware opaque substrate

- [x] 2.1 Add placement kind and block paragraph-slot ownership to the reusable descriptor.
- [x] 2.2 Reuse fingerprint and effective namespace/MCE validation for direct body block SDTs.
- [x] 2.3 Pair unchanged block controls deterministically without global ordinal laundering.
- [x] 2.4 Fail closed on mutation, internal edits, movement, ownership loss, nesting, unsupported placement, or correlation loss.
- [x] 2.5 Precompute/memoize group identity and expose deterministic complexity counts.

## 3. Rebuild scaffold

- [x] 3.1 Advance over every owned paragraph slot without reconstructing or replacing it.
- [x] 3.2 Preserve unrelated outside edits and correct accept/reject projections.

## 4. Evidence and neutral suite

- [x] 4.1 Add focused positive, multiple/identical, and fail-closed block tests.
- [x] 4.2 Upgrade both ILPA corpus scenarios to real outside edits and complete subtree/relationship/package-part validation.
- [x] 4.3 Pin DPT merge `ba9936af06cc18249e892dc594ed9bcefaf98463`, refresh registry hashes/projection, and validate oracle-specific statuses.

## 5. Verification and delivery

- [x] 5.1 Run focused/full tests, build/lint, mandatory pre-submit, emitted-schema MCE/XSD, DPT, and archive checks.
- [x] 5.2 Run LibreOffice open-save and PDF smoke checks for both ILPA outputs.
- [x] 5.3 Review scope and commit conventionally with WHY and `Ref: #582`.
