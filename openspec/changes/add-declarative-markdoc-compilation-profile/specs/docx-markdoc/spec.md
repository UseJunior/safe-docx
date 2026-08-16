## ADDED Requirements

### Requirement: Canonical Markdoc can declare deterministic compilation identity

The system SHALL accept at most one compilation profile declaring tracked-
revision identity, external rationale-comment identity and policy, and an
optional pinned build date. It SHALL validate the profile before mutation. When
the build date is omitted, it SHALL capture one current UTC instant and use that
same instant for revision and comment metadata.

#### Scenario: [SDX-MDOC-49] CLI-only replay materializes attributed external comments
- **GIVEN** a canonical Markdoc revision with a complete compilation profile and an explicitly external-facing rationale
- **WHEN** it is compiled through the CLI without a JavaScript wrapper
- **THEN** the tracked revision and native rationale comment SHALL use the declared identities and dates
- **AND** repeating the compile with identical inputs SHALL preserve semantic attribution

#### Scenario: [SDX-MDOC-50] Incomplete or duplicate profiles fail before mutation
- **GIVEN** duplicate compilation profiles or enabled comments without complete deterministic comment identity
- **WHEN** compilation begins
- **THEN** validation SHALL fail with a stable actionable diagnostic
- **AND** no DOCX output SHALL be written

### Requirement: Rationale visibility is explicit and fail-closed

Each rationale SHALL declare exactly `internal` or `external-facing` visibility.
Missing, unknown, misspelled, differently cased, or legacy category-only
metadata SHALL fail validation before mutation.

#### Scenario: [SDX-MDOC-51] Only exact visibility authorizes external output
- **GIVEN** rationales with internal or external-facing visibility
- **WHEN** external rationale comments are enabled
- **THEN** only exact `visibility="external-facing"` rationales SHALL become native comments
- **AND** internal rationales SHALL remain private metadata without producing a warning

#### Scenario: [SDX-MDOC-57] Missing or legacy visibility fails cleanly
- **GIVEN** a rationale with absent, unknown, misspelled, differently cased, or legacy category-only metadata
- **WHEN** validation runs
- **THEN** validation SHALL fail before document mutation with an actionable visibility diagnostic

### Requirement: Compilation override provenance is auditable

The system SHALL let a complete CLI rendering override supersede Markdoc's
external-comment rendering policy and SHALL record the resolved configuration
source in the verification certificate.

#### Scenario: [SDX-MDOC-52] CLI suppression override is visible and wins
- **GIVEN** a Markdoc profile that includes external comments and a CLI override that suppresses them
- **WHEN** compilation succeeds
- **THEN** no external rationale comment SHALL be rendered
- **AND** the CLI SHALL warn that external rationales were present but suppressed
- **AND** the certificate SHALL identify the rendering policy as a CLI override

### Requirement: External comments are conspicuous and default to included

When external-facing rationales are present, the CLI SHALL include them by
default unless an explicit Markdoc omit policy or complete CLI suppression
override applies. Included output SHALL be conspicuous in both the filename and
CLI response.

#### Scenario: [SDX-MDOC-58] Present external rationales render by default
- **GIVEN** valid external-facing rationales and complete comment identity
- **WHEN** CLI compilation runs without a rendering override
- **THEN** those rationales SHALL become native comments
- **AND** the tracked filename SHALL contain `EXTERNAL COMMENTS INCLUDED`
- **AND** CLI output SHALL state that external comments were included

#### Scenario: [SDX-MDOC-59] Suppressed external rationales warn
- **GIVEN** one or more external-facing rationales and an effective omit policy
- **WHEN** CLI compilation succeeds
- **THEN** CLI output SHALL warn that external rationales were present but not included
- **AND** it SHALL NOT suggest including or externalizing any internal rationale

### Requirement: Internal rationale export requires an alarming runtime capability

The system SHALL exclude internal rationale from DOCX comments unless the caller
supplies the exact `--dangerously-include-internal-comments` CLI flag and a
distinct explicit internal output path. Canonical Markdoc SHALL NOT be able to
grant this capability.

#### Scenario: [SDX-MDOC-53] Markdoc cannot silently enable internal comments
- **GIVEN** valid Markdoc containing internal rationales and any document-level metadata
- **WHEN** compilation runs without the dangerous CLI flag
- **THEN** no internal rationale SHALL appear in any DOCX comment

#### Scenario: [SDX-MDOC-54] Internal artifact is conspicuously named and certified
- **GIVEN** the dangerous flag and a distinct explicit internal output path
- **WHEN** an internal-review redline is generated
- **THEN** its filename SHALL end in `INTERNAL COMMENTS INCLUDED.docx`
- **AND** any necessary truncation SHALL preserve the complete warning suffix and extension
- **AND** CLI and certificate output SHALL disclose internal-comment inclusion

#### Scenario: [SDX-MDOC-55] Internal output cannot collide with another artifact
- **GIVEN** an internal output path equal to the source, clean, or external tracked path, or an existing file without overwrite authorization
- **WHEN** compilation begins
- **THEN** it SHALL fail before writing or overwriting any artifact

### Requirement: Compile performs validation before replay

The compile command SHALL invoke the same syntactic and semantic Markdoc
validation used by the standalone validate command before document mutation.
Standalone validation SHALL remain available as a no-output fast-feedback path.

#### Scenario: [SDX-MDOC-56] Invalid Markdoc fails identically through validate and compile
- **GIVEN** canonical Markdoc with a validation defect
- **WHEN** validate and compile are invoked independently
- **THEN** both SHALL report the same stable validation code and location
- **AND** compile SHALL write no document output
