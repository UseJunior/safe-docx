## ADDED Requirements

### Requirement: Markdoc uses readable revision grouping without a public selector

Every Markdoc compilation SHALL apply bounded readable-whitespace grouping
after token-minimal validation. Canonical Markdoc, the TypeScript compile API,
and the CLI SHALL NOT expose a revision-grouping selector. Former Markdoc
declarations, CLI flags, and JavaScript runtime options SHALL fail before
comparison or document mutation. The compilation certificate SHALL retain
literal `policy: 'readable-whitespace'` and `source: 'default'` fields, where
`default` means fixed rather than caller-selectable, with actual
`coalescedSpaceTokens` and `groupedChains` totals.

#### Scenario: [SDX-MDOC-139] Default compilation uses readable grouping
- **GIVEN** valid brownfield Markdoc
- **WHEN** compilation succeeds
- **THEN** the compiler SHALL use bounded readable-whitespace grouping
- **AND** the compilation certificate SHALL identify the fixed default behavior

#### Scenario: [SDX-MDOC-140] Legacy Markdoc selector is rejected
- **GIVEN** Markdoc declaring `revision-grouping="readable-whitespace"` or `revision-grouping="token-minimal"`
- **WHEN** compilation is requested
- **THEN** validation SHALL reject the declaration before document mutation

#### Scenario: [SDX-MDOC-141] Legacy runtime selectors are unavailable
- **GIVEN** a CLI invocation with `--revision-grouping`
- **WHEN** its arguments are parsed
- **THEN** the CLI SHALL reject the flag before document mutation
- **AND** the TypeScript compile-options type SHALL not include `revisionGrouping`
- **AND** a JavaScript API call with an own `revisionGrouping` option, even when its value is `undefined`, SHALL fail with `REVISION_GROUPING_REMOVED` before comparison or document mutation

### Requirement: Readable grouping may coalesce only eligible plain-space bridges

The system SHALL group a chain of at least two
replacement hunks whose source ranges and replacement text are both nonempty
when every intervening source and revised slice is the same nonempty U+0020-only
whitespace. Each bridge SHALL appear on both revision sides. Eligibility SHALL
be decided only after the token-minimal hunk set has passed the same run-format,
inline-format, and retained-format validation required by the token-minimal hunk set, so
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
- **WHEN** it compiles normally
- **THEN** the chain's deleted content and inserted content SHALL each be contiguous, with no ordinary text between the last deletion wrapper and first insertion wrapper
- **AND** accepting and rejecting revisions SHALL reproduce the exact revised and source text and semantic formatting respectively
- **AND** operation-attribution evidence SHALL remain consistent
- **AND** the compilation certificate SHALL disclose the grouped chain and coalesced-space count

#### Scenario: [SDX-MDOC-143] Internal minimal validation precedes grouping
- **GIVEN** a replacement chain that fails token-minimal run-format, inline-format, or retained-format validation
- **WHEN** compilation is requested
- **THEN** readable grouping SHALL NOT make the operation valid
- **AND** no document mutation SHALL occur

#### Scenario: [SDX-MDOC-144] Ineligible boundaries stop grouping without changing validity
- **GIVEN** fragments separated by punctuation, a common lexical token including a repeated-token ambiguity, a tab or line break, a pure insertion or deletion, a retained-format interval, protected structure, incompatible formatting, an existing revision, or an operation or paragraph boundary
- **WHEN** compilation is requested
- **THEN** the compiler SHALL NOT coalesce across that boundary
- **AND** an otherwise valid operation SHALL remain valid and use its ungrouped hunks
- **AND** common lexical, punctuation, anchored whitespace, and structural tokens SHALL retain their existing zero-loss obligations

#### Scenario: [SDX-MDOC-145] A lone replacement does not consume neighboring spaces
- **GIVEN** one replacement hunk with ordinary spaces beside it
- **WHEN** compilation is requested
- **THEN** the compiler SHALL retain the spaces as ordinary text
- **AND** SHALL NOT enlarge the revision solely to consume whitespace

#### Scenario: [SDX-MDOC-146] Preserved revisions are not attributed to this build
- **GIVEN** a source whose permitted pre-existing revisions include grouped whitespace
- **WHEN** a Markdoc build preserves those revisions without authoring a new replacement
- **THEN** the compilation certificate SHALL report zero grouped chains and zero coalesced spaces introduced by this build
