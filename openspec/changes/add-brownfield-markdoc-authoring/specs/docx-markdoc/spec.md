## ADDED Requirements

### Requirement: Hash-pinned DOCX sources have a complete compact Markdoc projection

The system SHALL import a DOCX into a compact Markdoc document that identifies
an immutable anchored source package by cryptographic hash and represents every
admitted body paragraph exactly once, in source order, with stable paragraph
identity, source-text fingerprint, readable text, and inherited style identity.

#### Scenario: [SDX-MDOC-01] Compact projection covers the pinned source
- **GIVEN** an admitted DOCX whose body paragraphs can be assigned stable Safe DOCX bookmark IDs
- **WHEN** the document is imported to canonical Markdoc
- **THEN** the source package hash and every admitted paragraph ID, fingerprint, text, order, and inherited style identity SHALL be represented
- **AND** unchanged paragraphs SHALL remain readable full-document context

#### Scenario: [SDX-MDOC-02] Import does not mutate the caller's original
- **GIVEN** a DOCX without stable Safe DOCX paragraph bookmarks
- **WHEN** import requires bookmark allocation
- **THEN** the system SHALL create and hash a separate anchored source copy
- **AND** SHALL NOT overwrite or mutate the caller's original DOCX

### Requirement: Changed language is canonical as clean before and after states

The canonical Markdoc SHALL represent each changed source paragraph as explicit
clean `before` and `after` states. Inline `ins` and `del` markup SHALL be a
generated review projection rather than editable canonical input.

#### Scenario: [SDX-MDOC-03] Inline edit resolves three projections
- **GIVEN** a changed paragraph containing one clean before state and one clean after state
- **WHEN** the system resolves the paragraph
- **THEN** the original projection SHALL equal the before state
- **AND** the revised projection SHALL equal the after state
- **AND** the tracked projection SHALL be deterministically derived by Safe DOCX comparison
- **AND** rejecting and accepting that tracked projection SHALL reproduce the two clean states

#### Scenario: [SDX-MDOC-04] Inline revision markup is rejected as canonical input
- **GIVEN** canonical changed language containing inline `ins` or `del` tags instead of clean states
- **WHEN** the Markdoc is validated
- **THEN** validation SHALL fail with a stable diagnostic before any DOCX output is written

### Requirement: Whole-source-unit operations make both legal states explicit

The system SHALL support source-anchored whole-paragraph replacement and
deletion with an explicit clean before state checked against the source and a
clean after state, plus paragraph insertion with an empty before state relative
to a stable source anchor.

#### Scenario: [SDX-MDOC-05] Whole paragraph replacement resolves original from source
- **GIVEN** a `change` operation naming one stable paragraph ID and its expected fingerprint
- **WHEN** the operation compiles
- **THEN** its before body SHALL exactly equal the hash-verified source paragraph
- **AND** its after body SHALL be the revised paragraph text

#### Scenario: [SDX-MDOC-06] Missing or ambiguous source operation fails closed
- **GIVEN** a whole-unit operation whose anchor is absent, duplicated, stale, or has a mismatched fingerprint
- **WHEN** compilation is attempted
- **THEN** compilation SHALL fail transactionally
- **AND** SHALL write neither clean nor tracked output

### Requirement: Rationale remains adjacent and separately projectable

The system SHALL associate drafting rationale with a stable edit operation while
allowing the canonical syntax to place that rationale adjacent to the affected
text. Rationale SHALL NOT enter original or revised operative text projections.

#### Scenario: [SDX-MDOC-07] Adjacent rationale binds to one operation
- **GIVEN** a rationale block adjacent to an edit and carrying or resolving to a stable operation ID
- **WHEN** the Markdoc compiles
- **THEN** the edit IR SHALL associate the rationale with exactly that operation
- **AND** clean and tracked operative text SHALL exclude rationale text

#### Scenario: [SDX-MDOC-08] Orphan or multiply bound rationale is rejected
- **GIVEN** rationale that resolves to no operation or more than one operation
- **WHEN** validation runs
- **THEN** validation SHALL fail with a stable diagnostic

### Requirement: Formatting inheritance is explicit and fail-closed

Each edit operation SHALL declare or deterministically inherit an admitted
formatting policy. The compiler SHALL refuse an operation whose source
formatting cannot be preserved under that policy without ambiguity.

#### Scenario: [SDX-MDOC-09] Simple replacement inherits source formatting
- **GIVEN** a source paragraph with one semantically uniform text style
- **AND** a clean-state paragraph replacement declaring source inheritance
- **WHEN** clean and tracked outputs are produced
- **THEN** the revised text SHALL inherit the admitted source paragraph and run properties

#### Scenario: [SDX-MDOC-09] Localized edits preserve mixed source formatting
- **GIVEN** a source paragraph containing multiple coalesced run-formatting classes
- **AND** every replacement lies wholly within one source formatting class
- **WHEN** clean and tracked outputs are produced
- **THEN** unchanged spans SHALL retain their source run properties
- **AND** inserted replacement text SHALL inherit the formatting class of its deleted source span
- **AND** deleting the whole paragraph SHALL require no run-formatting choice

#### Scenario: [SDX-MDOC-10] Mixed-format boundary requests detail instead of guessing
- **GIVEN** an edit boundary spanning incompatible run properties under the declared policy
- **WHEN** compilation cannot choose one inherited result deterministically
- **THEN** compilation SHALL fail with a diagnostic identifying the anchor and required selective detail
- **AND** SHALL NOT silently flatten or choose formatting

#### Scenario: [SDX-MDOC-10] Explicit source span resolves an ambiguous boundary
- **GIVEN** an insertion or replacement whose implicit formatting source is ambiguous
- **AND** the operation names a unique source substring occupying one coalesced formatting class
- **WHEN** compilation runs
- **THEN** inserted text SHALL inherit that source substring's run properties
- **AND** a missing, repeated, or mixed-format source substring SHALL fail validation

### Requirement: Inspection detail is generated and non-canonical

The system SHALL generate selective or full normalized formatting-detail views
without embedding raw OOXML in canonical Markdoc or treating Word run
fragmentation as authoring semantics.

#### Scenario: [SDX-MDOC-11] Selective detail coalesces equivalent runs
- **GIVEN** a source paragraph containing adjacent Word runs with identical semantic formatting
- **WHEN** selective detail is requested for that paragraph
- **THEN** the inspection view SHALL coalesce those runs for readability
- **AND** SHALL retain hashes linking the normalized view to the source paragraph and run properties

#### Scenario: [SDX-MDOC-12] Detail view cannot silently become a second source
- **GIVEN** a generated inspection view edited independently of canonical Markdoc
- **WHEN** compilation is attempted without explicit reconciliation
- **THEN** the system SHALL reject it as non-canonical

### Requirement: Compilation proves source and redline round trips

Successful compilation SHALL emit clean and native tracked-change DOCX outputs
plus a machine-readable verification certificate. Success requires source and
scaffold identity, exact-once operation application, reject-all equivalence to
source, accept-all equivalence to clean, and preservation of unchanged admitted
content under documented comparison rules.

#### Scenario: [SDX-MDOC-13] Verified replay produces both document states
- **GIVEN** valid canonical Markdoc and its matching pinned source DOCX
- **WHEN** compilation and verification complete
- **THEN** rejecting all revisions in tracked output SHALL equal the pinned source under the declared comparison
- **AND** accepting all revisions SHALL equal clean output
- **AND** every operation SHALL report exactly one application
- **AND** the certificate SHALL report every invariant and admitted/excluded capability

#### Scenario: [SDX-MDOC-14] Verification failure withholds outputs
- **GIVEN** any failed source, scaffold, operation, accept/reject, or preservation invariant
- **WHEN** compilation runs in strict mode
- **THEN** the process SHALL fail non-zero and SHALL NOT publish partial outputs

### Requirement: Edit history exports are minimally contrastive and provenance-aware

The system SHALL export language-neutral edit records from a source/revision or
caller-supplied adjacent Markdoc revisions, including bounded context,
inserted/deleted text, rationale, source identities, and verification status.
It SHALL accept explicit provenance labels but SHALL NOT infer actor, causation,
authorization, privilege, or training eligibility.

#### Scenario: [SDX-MDOC-15] Source-to-revision export yields minimal contrasts
- **GIVEN** verified Markdoc containing clean before/after and whole-unit edits
- **WHEN** edit records are exported
- **THEN** each record SHALL contain the smallest represented inserted/deleted contrast supported by the operation plus bounded surrounding context
- **AND** SHALL retain operation, source, rationale, and verification provenance

#### Scenario: [SDX-MDOC-16] Adjacent revisions preserve supplied correction labels
- **GIVEN** two caller-supplied Markdoc revisions and explicit metadata labeling an AI draft and human correction
- **WHEN** the revisions are exported as edit pairs
- **THEN** the records SHALL retain those supplied labels
- **AND** the system SHALL not invent a label for an omitted or ambiguous actor, instruction, or reason
