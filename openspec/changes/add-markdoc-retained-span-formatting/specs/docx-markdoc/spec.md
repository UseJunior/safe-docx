## ADDED Requirements

### Requirement: Retained common text supports explicit format-only changes

The system SHALL permit canonical Markdoc to declare a closed, domain-neutral
direct-format mutation over an exact non-empty span of text retained by the
source/revised alignment. The declaration SHALL preserve visible text and every
undeclared property.

#### Scenario: [SDX-MDOC-130] Retained highlight is removed declaratively
- **GIVEN** source text whose completed value carries direct yellow highlight
- **AND** the same visible value is common in the authored revised state
- **WHEN** that exact revised occurrence declares `highlight="none"`
- **THEN** the clean occurrence SHALL have no direct highlight
- **AND** its text and every undeclared direct property SHALL remain unchanged

#### Scenario: [SDX-MDOC-131] Repeated retained text is selected by authored position
- **GIVEN** one paragraph containing repeated identical visible values
- **AND** only one revised occurrence is wrapped by a retained-format declaration
- **WHEN** the document compiles
- **THEN** only the wrapped aligned occurrence SHALL change formatting
- **AND** no substring occurrence heuristic SHALL select a different value

#### Scenario: [SDX-MDOC-132] Retained formatting uses a closed set-or-remove vocabulary
- **GIVEN** a retained span declaring admitted highlight or underline set/remove values
- **WHEN** canonical validation runs
- **THEN** omission SHALL mean preserve the source property
- **AND** unknown properties or values SHALL fail before mutation

### Requirement: Retained formatting scope is alignment-proven and transactional

The system SHALL map each retained-format interval wholly to one common
source/revised alignment interval and one coalesced source formatting class.
Invalid scope SHALL fail before package mutation or output emission.

#### Scenario: [SDX-MDOC-133] Generated text cannot use retained formatting
- **GIVEN** a retained-format declaration that overlaps any generated or deleted text
- **WHEN** scope validation runs
- **THEN** compilation SHALL fail with a stable non-common-scope diagnostic
- **AND** the author SHALL use generated-text `run-format` for a generated span

#### Scenario: [SDX-MDOC-134] Mixed-format retained scope fails closed
- **GIVEN** one retained-format declaration whose mapped source interval spans multiple coalesced direct-format classes
- **WHEN** scope validation runs
- **THEN** compilation SHALL fail with a stable mixed-format diagnostic
- **AND** no source class SHALL be chosen heuristically

#### Scenario: [SDX-MDOC-135] Retained declarations are structurally unambiguous
- **GIVEN** an empty, nested, overlapping, unsupported, or deterministic no-op retained-format declaration
- **WHEN** canonical or compiler validation runs
- **THEN** validation SHALL fail with a stable diagnostic
- **AND** no output artifact SHALL be emitted

### Requirement: Format-only compilation emits native property revisions

The system SHALL express a retained-span direct-format change in tracked output
through native `w:rPrChange` markup that snapshots the prior direct run
properties. It SHALL NOT represent a property-only span as text deletion and
insertion.

#### Scenario: [SDX-MDOC-136] Property-only edit has exact clean and tracked states
- **GIVEN** one admitted retained span that removes direct yellow highlight
- **WHEN** clean and tracked artifacts compile
- **THEN** clean SHALL contain the unchanged text without highlight or revision markup
- **AND** tracked SHALL contain current unhighlighted properties plus `w:rPrChange` with the prior highlighted `w:rPr`
- **AND** every character of the declared interval SHALL appear in tracked output outside any `w:ins`, `w:del`, `w:moveFrom`, or `w:moveTo` element
- **AND** the declared interval's text in reject-all and accept-all SHALL equal the source and clean text at the mapped offsets

#### Scenario: [SDX-MDOC-137] Accept and reject restore both text and formatting
- **GIVEN** tracked output containing an admitted retained-format change
- **WHEN** accept-all and reject-all projections are independently evaluated
- **THEN** accept-all SHALL be textually and semantically formatting-equivalent to clean
- **AND** reject-all SHALL be textually and semantically formatting-equivalent to the hash-pinned source

#### Scenario: [SDX-MDOC-138] Format-only text revision overlap blocks delivery
- **GIVEN** tracked output that reproduces the right accept/reject text but emits `w:ins`, `w:del`, `w:moveFrom`, or `w:moveTo` covering any character of a declared property-only interval
- **WHEN** certification runs
- **THEN** the certificate SHALL report the format-only text-revision violation
- **AND** projection success and delivery readiness SHALL be false
