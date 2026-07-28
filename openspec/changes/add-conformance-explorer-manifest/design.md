## Context

`UseJunior/safe-docx` owns product-specific conformance claims.
`open-agreements/docx-platform-tests` owns neutral capabilities, scenario
identities, adapter behavior, and cross-implementation results.
`UseJunior/tests-renderer` owns the public presentation layer.

The current Safe DOCX sources are deliberately specialized:

- `spec-compliance/registry/ecma-376.md` is the authority for targeted sections,
  Non-Goals, project-authored rationale, and schema bindings;
- vendored schemas are the authority for declaration shape;
- `spec-compliance/capabilities/` and its generated projection are the authority
  for Safe DOCX capability-axis claims against the pinned neutral denominator;
- source, test, executable-evidence, and formal-verification registries retain
  their existing meanings and checks.

The exporter must join those sources without weakening their individual
validation rules or making the generated manifest authoritative over them.
Production builds in tests-renderer are offline and deterministic, so the
consumer will commit a snapshot and separately record its upstream revision and
checksum.

The completed but not yet archived
`add-safe-docx-capability-projection` change overlaps this work only as an
input. This change does not modify its denominator, status vocabulary, or
positive-evidence rules.

## Goals / Non-Goals

- Goals:
  - expose a stable external contract for the specification and capability
    views;
  - keep the export deterministic for identical repository inputs;
  - preserve precise claim boundaries and explicit negative states;
  - make every cross-repository join machine-checkable;
  - let tests-renderer validate a pinned snapshot without importing Safe DOCX
    implementation code.
- Non-goals:
  - render explorer pages in this repository;
  - run neutral adapters or copy cross-implementation results;
  - reproduce ECMA-376 normative prose;
  - broaden Safe DOCX claims, infer support from citations, or fill untested
    rows;
  - export every OOXML declaration when no Safe DOCX registry entry references
    it;
  - use QName alone as a schema-declaration identity.

## Decisions

### Decision: publish one composed, versioned document

The repository will generate
`spec-compliance/generated/conformance-explorer.json` and validate it against a
checked-in JSON Schema. The root discriminator will be a stable string such as
`safe-docx-conformance-explorer/v1`; incompatible contract changes require a
new version.

The export will contain three linked inventories:

1. **Sections** — stable registry ID, standard, edition, part, section, title,
   targeted/Non-Goal classification, project-authored bounded rationale,
   schema reference, and categorized evidence references.
2. **Schema declarations** — one record per referenced declaration identity,
   keyed by the complete schema reference and carrying the declaration kind,
   local name, schema target namespace, conformance class, declared type where
   available, and the bounded structural information required by the explorer.
3. **Capability-axis claims** — neutral capability ID, axis, Safe DOCX status,
   scope, rationale, and existing evidence/provenance fields from the validated
   projection.

The exporter may normalize existing fields for the external schema, but it
must not silently reinterpret a status or upgrade evidence.

### Decision: use source-owned stable joins

The external contract will expose these joins:

- section tuple `{standard, edition, part, section}`;
- stable Safe DOCX registry ID;
- complete `schemaRef`;
- neutral `capabilityId + axis`;
- neutral `scenarioId` only when an existing validated Safe DOCX mapping owns
  that association.

Display titles, file/line-derived test corpus IDs, and QName alone are not
cross-repository identities. A schema declaration identity must retain enough
context to distinguish reused local names and Strict/Transitional declarations.

### Decision: retain negative and bounded states

The exporter will preserve targeted versus Non-Goal classification and every
capability projection state: `supported`, `partial`, `preservation-only`,
`gap`, `non-goal`, and `untested`. Missing executable evidence must never be
rendered as positive support merely because a registry citation or source path
exists.

Formal-verification scope remains scope metadata unless an existing validated
artifact classifies it as executable evidence. XSD validity, normative
behavior, interoperability, and product invariants remain distinct evidence
classes.

### Decision: keep generation deterministic and provenance downstream

The generated manifest will not contain timestamps, the current branch, or Git
HEAD. Tests will prove repeated generation is byte-identical and the normal
drift check will reject stale committed output.

`tests-renderer` will own snapshot provenance: its refresh script records the
exact Safe DOCX commit and content checksum next to the copied manifest. This
avoids the non-deterministic self-referential commit problem while still
providing public provenance.

### Decision: validate references rather than trust copied paths

Generation/checking will fail when:

- a registry entry is missing or duplicated in the export;
- a `schemaRef` does not resolve to the named vendored declaration;
- a declaration identity is ambiguous or duplicated;
- a capability/axis pair disagrees with the validated projection denominator;
- a positive claim loses its required evidence;
- an exported repo-relative evidence path is malformed or unexpectedly absent;
- generated output disagrees with the committed artifact.

The external JSON Schema validates document shape; semantic checks validate
cross-file inventories and joins.

### Decision: do not copy neutral registries into the external manifest

The export names neutral capability, axis, and scenario identities needed to
join product claims, but it does not duplicate their definitions or current
results. Tests-renderer independently pins the neutral registry/results from
`open-agreements/docx-platform-tests` and performs the join.

This keeps neutral vocabulary ownership upstream and prevents a Safe DOCX
release from becoming a stale fork of the denominator.

## Risks / Trade-offs

- The external schema adds compatibility responsibility. Versioned root
  discriminators and fixture-based consumer documentation make breaking
  changes explicit.
- Registry prose is project-authored and useful to readers, but it is not
  normative text. The contract and renderer must label it as Safe DOCX claim
  rationale.
- Restricting declaration export to referenced schema declarations produces a
  scoped explorer rather than a complete OOXML encyclopedia. That matches the
  project's bounded conformance posture.
- A composed manifest duplicates some generated projection fields. Semantic
  checks prevent it from becoming independently editable or authoritative.

## Migration Plan

Additive only:

1. define and test the v1 JSON Schema;
2. implement the deterministic composer over existing validated inputs;
3. commit generated output and add drift checks;
4. document the tests-renderer snapshot workflow;
5. let tests-renderer consume v1 in its own subsequent PR.

Rollback removes the exporter, generated file, and its checks without changing
the underlying conformance registry or capability projection.

## Open Questions

- Whether the v1 schema should inline bounded direct child/attribute structure
  or expose only declaration identity and type, leaving richer XSD expansion
  for a compatible v1 extension. Implementation should choose the smallest
  structure that supports the first renderer PR without implying a complete
  schema browser.
- Whether evidence paths that intentionally reference optional/generated
  artifacts should be represented with an explicit availability classification
  rather than being required to exist in every checkout.
