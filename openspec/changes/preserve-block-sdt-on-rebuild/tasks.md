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

## 6. Relationship-closure review fix

- [x] 6.1 Add memoized package relationship-closure identity for opaque body blocks.
- [x] 6.2 Fail closed on changed, missing, unsafe, cyclic, or unsupported relationship targets and dependent parts.
- [x] 6.3 Add adversarial direct-image, external-target, recursive XML, alias, and fast-path tests.
- [x] 6.4 Compare original, revised, and output ILPA relationship closures and media bytes.
- [x] 6.5 Re-run all required gates and commit the review fix.

## 7. Cycle and internal-target review fix

- [x] 7.1 Serialize independent closure roots and cache only completed recursive identities.
- [x] 7.2 Reject decoded authority, malformed, backslash, scheme, and other unsafe internal target forms before package normalization.
- [x] 7.3 Add timeout-free multi-root cycle, shared dependency, and positive/negative target controls.
- [x] 7.4 Re-run focused/full tests, preflight/gates, DPT, schema, and LibreOffice checks.
- [x] 7.5 Commit the final review fix conventionally without pushing.

## 8. Table-scoped reconstruction bug fix

- [x] 8.1 Add row-block and cell-block placement identities with container-relative anchoring.
- [x] 8.2 Permit controlled paragraph edits while failing closed on wrapper or scaffold mutation.
- [x] 8.3 Add forced-rebuild accept/reject evidence for both legal table-scoped placements.
- [x] 8.4 Run the focused and mandatory repository gates and commit with `Fixes: #660`.
