## ADDED Requirements

### Requirement: Markdoc exposes an explicit revision-grouping policy

The system SHALL support exactly `token-minimal` and `readable-whitespace` as
revision-grouping policies through canonical Markdoc, the TypeScript compile
API, and the CLI. `token-minimal` SHALL remain the default. A complete runtime
override SHALL supersede the Markdoc declaration, and the compilation
certificate SHALL identify the resolved policy and its provenance. Invalid or
duplicate declarations SHALL fail before document mutation.

#### Scenario: [SDX-MDOC-91] Default compilation remains token-minimal
- **GIVEN** valid brownfield Markdoc with no revision-grouping declaration or runtime override
- **WHEN** compilation succeeds
- **THEN** the compiler SHALL use `token-minimal`
- **AND** the certificate SHALL identify the policy as a default

#### Scenario: [SDX-MDOC-92] Declarative readable grouping is auditable
- **GIVEN** valid Markdoc declaring `revision-grouping="readable-whitespace"`
- **WHEN** compilation succeeds without a runtime override
- **THEN** eligible replacement chains SHALL use readable whitespace grouping
- **AND** the certificate SHALL identify both the resolved policy and Markdoc provenance

#### Scenario: [SDX-MDOC-93] Runtime policy override is complete and visible
- **GIVEN** Markdoc declaring one valid revision-grouping policy and a CLI or API override declaring the other
- **WHEN** compilation succeeds
- **THEN** the runtime policy SHALL win as a complete value
- **AND** the certificate SHALL identify CLI or API provenance

### Requirement: Readable grouping may coalesce only eligible plain-space bridges

Under `readable-whitespace`, the system SHALL group a chain of at least two
adjacent replacement fragments across common U+0020-only whitespace by placing
each bridge on both revision sides. It SHALL preserve exact accept-all and
reject-all projections. It SHALL NOT bridge lexical tokens, punctuation, tabs,
line breaks, protected structure, incompatible formatting, or incompatible
revision provenance.

#### Scenario: [SDX-MDOC-94] Multi-word replacement becomes one readable pair
- **GIVEN** a replacement chain whose fragments are separated only by preservable ordinary spaces
- **WHEN** it compiles under `readable-whitespace`
- **THEN** the tracked output SHALL contain one grouped deletion followed by one grouped insertion for the chain
- **AND** accepting and rejecting the revisions SHALL reproduce the exact revised and source text respectively
- **AND** the certificate SHALL disclose the coalesced whitespace

#### Scenario: [SDX-MDOC-95] Minimal mode leaves common spaces ordinary
- **GIVEN** the same replacement chain
- **WHEN** it compiles under `token-minimal`
- **THEN** preservable common spaces SHALL remain ordinary text
- **AND** no readability-coalescing allowance SHALL be reported

#### Scenario: [SDX-MDOC-96] Non-space and protected boundaries stop grouping
- **GIVEN** replacement fragments separated by punctuation, a tab or line break, protected structure, incompatible formatting, or incompatible revision provenance
- **WHEN** readable grouping is requested
- **THEN** the compiler SHALL NOT coalesce across that boundary
- **AND** common lexical, punctuation, and structural tokens SHALL remain ordinary

#### Scenario: [SDX-MDOC-97] A lone replacement does not consume neighboring spaces
- **GIVEN** one replacement fragment with ordinary spaces beside it
- **WHEN** readable grouping is requested
- **THEN** the compiler SHALL retain the spaces as ordinary text
- **AND** SHALL NOT enlarge the revision solely to consume whitespace

