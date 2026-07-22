## ADDED Requirements

### Requirement: ODT generation boundary
`@usejunior/odf-core` SHALL document that it does not currently expose a native
`generateOdt(spec)` compiler. For generation workflows that need ODT output, the documented
near-term path SHALL be `@usejunior/docx-core` `generateDocx(spec)` followed by
`@usejunior/odf-core` `convertDocxToOdt(docx)`, with any conversion downgrade surfaced through
the existing lossiness report.

Native ODT generation from `DocumentSpec` SHALL NOT be implied by package positioning or README
copy. If native `generateOdt(spec)` is added later, it SHALL be introduced through a separate
OpenSpec proposal that defines its ODF mapping, validation, determinism, fidelity, and
cross-reader compatibility expectations.

#### Scenario: [ODT-GEN-BND-01] Package README describes the supported ODT generation path
- **WHEN** a user reads the `@usejunior/odf-core` package README
- **THEN** the README SHALL describe DOCX generation followed by DOCX-to-ODT conversion as the supported near-term path for generated ODT files
- **AND** it SHALL identify native `generateOdt(spec)` as not currently shipped

#### Scenario: [ODT-GEN-BND-02] Native ODT generation is not implied
- **WHEN** package positioning describes `@usejunior/odf-core` capabilities
- **THEN** it SHALL avoid presenting `DocumentSpec` as a directly supported ODT compiler input
- **AND** it SHALL direct native ODT compiler work to a future OpenSpec proposal
