# Conformance explorer export

`spec-compliance/generated/conformance-explorer.json` is the versioned,
machine-readable Safe DOCX input for the public conformance explorer maintained
in [`UseJunior/tests-renderer#37`](https://github.com/UseJunior/tests-renderer/issues/37).
Its JSON Schema is `spec-compliance/conformance-explorer.schema.json`.

The export is a presentation contract, not a new source of truth. It composes:

- targeted sections and Non-Goals from `registry/*.md`;
- the vendored schema declarations named by those registry entries;
- product claims from `capabilities/safe-docx-projection.json`;
- neutral capability/axis/scenario join IDs from the pinned
  `open-agreements/docx-platform-tests` inputs.

It does not copy neutral capability definitions or cross-implementation
results. Those remain owned by `open-agreements/docx-platform-tests`, and the
renderer pins them independently.

## Generate and check

```bash
npm run generate:conformance-explorer
npm run check:conformance-explorer
```

Generation is deterministic and deliberately omits the current date, branch,
and Git commit. The committed file must be byte-identical for identical inputs.

## Contract boundaries

- Registry prose is labeled `claimRationale`: it explains Safe DOCX's bounded
  claim or Non-Goal and is not reproduced ECMA-376 normative text.
- `schemaDeclarations` includes only declarations referenced by the Safe DOCX
  registry. It is not a complete OOXML schema browser.
- A declaration is identified by its complete `schemaRef`. Every matching
  physical occurrence retains a context path, so a reused local name is not
  silently flattened into one QName-only declaration.
- Capability statuses retain the existing meanings of `supported`, `partial`,
  `preservation-only`, `gap`, `non-goal`, and `untested`.
- XSD validity, normative behavioral evidence, cross-implementation evidence,
  formal-verification scope, and project invariants remain distinct concepts.

## Downstream snapshot workflow

The renderer must refresh explicitly rather than fetching during its production
build:

1. choose an exact Safe DOCX commit;
2. copy `spec-compliance/generated/conformance-explorer.json` and its JSON
   Schema from that commit;
3. record the full commit and SHA-256 checksum beside the renderer snapshot;
4. validate the snapshot against the producer-owned schema;
5. pin the neutral registry and results from
   `open-agreements/docx-platform-tests` separately;
6. fail renderer CI on checksum, schema, duplicate-identity, or unresolved-join
   drift.

Stable joins are the ECMA citation tuple, complete `schemaRef`,
`capabilityId + axis`, and validated `scenarioId`. Display titles, file/line
test IDs, repository paths alone, and QName alone are not global identities.

Tracking: [`UseJunior/safe-docx#689`](https://github.com/UseJunior/safe-docx/issues/689).
