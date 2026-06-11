## Context
`@usejunior/docx-core` owns the declarative `DocumentSpec` grammar and compiles it to ECMA-376 DOCX packages. `@usejunior/odf-core` owns OpenDocument archive/session primitives, tracked-changes comparison, and native DOCX-to-ODT conversion. The two packages overlap at the document-family level, but they do not currently share a format-neutral intermediate representation that can emit both OOXML and ODF with equivalent fidelity.

## Decision
The near-term product boundary is conversion-first ODT generation:

- Users who need a generated ODT should call `generateDocx(spec)` and then `convertDocxToOdt(docx)`.
- `@usejunior/odf-core` should document this as an intentional boundary, not as a missing accidental feature.
- Native `generateOdt(spec)` remains a candidate future capability, but it is not silently promised by the current `DocumentSpec` compiler.

## Alternatives Considered

### Compile the same DocumentSpec directly to ODF
This gives the cleanest user-facing symmetry, but it is materially larger than documentation: it needs ODF style/list/table/header/footer mapping, package validation, deterministic output rules, lossiness decisions, and cross-reader evidence. It also needs an explicit stance on whether the DOCX-oriented `DocumentSpec` grammar is format-neutral enough or whether ODF requires a different abstraction.

### Conversion-first boundary
This is the chosen near-term answer. Native DOCX-to-ODT conversion already exists, so users can generate a DOCX artifact from the authoritative `DocumentSpec` compiler and convert it to ODT through the existing ODF path. The tradeoff is that ODT output inherits conversion lossiness reporting rather than native ODF-first guarantees.

## Non-Goals
- No `generateOdt(spec)` API in this change.
- No changes to the `DocumentSpec` grammar.
- No new ODF conformance claims beyond the already scoped DOCX-to-ODT conversion behavior.
