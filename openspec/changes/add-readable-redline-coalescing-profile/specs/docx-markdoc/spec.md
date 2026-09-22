## ADDED Requirements

### Requirement: Markdoc exposes an explicit revision-grouping policy

The system SHALL support exactly `token-minimal` and `readable-whitespace` as
revision-grouping policies through canonical Markdoc, the TypeScript compile
API, and the CLI. `token-minimal` SHALL remain the default. An explicit runtime
value (`revisionGrouping?: { policy, source? }`, whose omitted source defaults
to API and whose CLI source is explicit) SHALL supersede the Markdoc declaration, and the compilation certificate
SHALL report `revisionGrouping: { policy, source, coalescedSpaceTokens,
groupedChains }`, where source distinguishes API, CLI, Markdoc, and default.
Invalid or duplicate declarations SHALL fail before document mutation.

#### Scenario: [SDX-MDOC-139] Default compilation remains token-minimal
- **GIVEN** valid brownfield Markdoc with no revision-grouping declaration or runtime value
- **WHEN** compilation succeeds
- **THEN** the compiler SHALL use `token-minimal`
- **AND** the compilation certificate SHALL identify the policy as a default

#### Scenario: [SDX-MDOC-140] Declarative readable grouping is auditable
- **GIVEN** valid Markdoc declaring `revision-grouping="readable-whitespace"`
- **WHEN** compilation succeeds without a runtime value
- **THEN** eligible replacement chains SHALL use readable whitespace grouping
- **AND** the compilation certificate SHALL identify both the resolved policy and Markdoc provenance

#### Scenario: [SDX-MDOC-141] Runtime policy value is explicit and visible
- **GIVEN** Markdoc declaring one valid revision-grouping policy and a CLI or API value declaring the other
- **WHEN** compilation succeeds
- **THEN** the runtime value SHALL win
- **AND** the compilation certificate SHALL identify CLI or API provenance

### Requirement: Readable grouping may coalesce only eligible plain-space bridges

Under `readable-whitespace`, the system SHALL group a chain of at least two
replacement hunks whose source ranges and replacement text are both nonempty
when every intervening source and revised slice is the same nonempty U+0020-only
whitespace. Each bridge SHALL appear on both revision sides. Eligibility SHALL
be decided only after the token-minimal hunk set has passed the same run-format,
inline-format, and retained-format validation required by `token-minimal`, so
grouping SHALL NOT change whether an operation validates. A merged chain SHALL
resolve to the same single run-property signature as every constituent hunk, or
the same explicit `format-source`; otherwise it SHALL remain ungrouped without
introducing a new error.

The merged hunk SHALL use the chain's outer source and revised bounds and the
exact revised slice between those bounds. A bridge intersecting a resolved
retained-format interval SHALL terminate the chain.

The transform SHALL preserve exact accept-all/reject-all text and semantic
formatting projections and consistent operation-attribution evidence. It SHALL
NOT bridge any common lexical token (including repeated tokens a different
alignment could have replaced), punctuation, tabs, line breaks, pure insertions
or deletions, retained-format intervals, protected structure, incompatible
formatting, existing revisions, operation boundaries, or paragraph/story boundaries.

#### Scenario: [SDX-MDOC-142] Multi-word replacement becomes one readable pair
- **GIVEN** a replacement chain whose fragments are separated only by eligible ordinary spaces and resolve to one compatible source format
- **WHEN** it compiles under `readable-whitespace`
- **THEN** the chain's deleted content and inserted content SHALL each be contiguous, with no ordinary text between the last deletion wrapper and first insertion wrapper
- **AND** accepting and rejecting revisions SHALL reproduce the exact revised and source text and semantic formatting respectively
- **AND** operation-attribution evidence SHALL remain consistent
- **AND** the compilation certificate SHALL disclose the grouped chain and coalesced-space count

#### Scenario: [SDX-MDOC-143] Minimal mode leaves common spaces ordinary
- **GIVEN** the same replacement chain
- **WHEN** it compiles under `token-minimal`
- **THEN** preservable common spaces SHALL remain ordinary text
- **AND** grouped-chain and coalesced-space counts SHALL both equal zero

#### Scenario: [SDX-MDOC-144] Ineligible boundaries stop grouping without changing validity
- **GIVEN** fragments separated by punctuation, a common lexical token including a repeated-token ambiguity, a tab or line break, a pure insertion or deletion, a retained-format interval, protected structure, incompatible formatting, an existing revision, or an operation or paragraph boundary
- **WHEN** readable grouping is requested
- **THEN** the compiler SHALL NOT coalesce across that boundary
- **AND** an operation valid under `token-minimal` SHALL remain valid and use its ungrouped hunks
- **AND** common lexical, punctuation, anchored whitespace, and structural tokens SHALL retain their existing zero-loss obligations

#### Scenario: [SDX-MDOC-145] A lone replacement does not consume neighboring spaces
- **GIVEN** one replacement hunk with ordinary spaces beside it
- **WHEN** readable grouping is requested
- **THEN** the compiler SHALL retain the spaces as ordinary text
- **AND** SHALL NOT enlarge the revision solely to consume whitespace
