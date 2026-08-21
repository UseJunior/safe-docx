## ADDED Requirements

### Requirement: Brownfield annotations are first-class canonical Markdoc

The system SHALL import admitted Word comments and footnotes as readable,
editable canonical annotations. Each annotation SHALL retain a stable identity,
structured body, source presentation, explicit audience, admitted source
metadata, semantic role, and an explicit range-or-point anchor. Import SHALL NOT leave the
annotation body available only as opaque content in the pinned DOCX.

The admitted annotation body vocabulary SHALL initially consist of paragraphs
and text runs with bold, italic, underline, six-digit RGB color, and Word
highlight properties. Tables, drawings, fields, tracked changes, embedded
objects, and other unlisted body constructs are unsupported and SHALL follow
the strict-import diagnostic behavior below.

#### Scenario: [SDX-MDOC-70] Ranged comment imports with editable content
- **GIVEN** a Word comment with an admitted body and balanced range markers
- **WHEN** the DOCX is imported to canonical Markdoc
- **THEN** the comment body SHALL be readable and editable in the Markdoc
- **AND** its exact start and end positions SHALL be represented as a range
- **AND** its source presentation SHALL be `comment`

#### Scenario: [SDX-MDOC-71] Footnote imports without invented selection
- **GIVEN** a Word footnote with an admitted body and one body reference
- **WHEN** the DOCX is imported to canonical Markdoc
- **THEN** the footnote body SHALL be readable and editable in the Markdoc
- **AND** its reference position SHALL be represented as a point anchor
- **AND** its source presentation SHALL be `footnote`
- **AND** no range start SHALL be inferred from nearby text

#### Scenario: [SDX-MDOC-79] Imported footnote remains substantive by default
- **GIVEN** a brownfield Word footnote with no explicit drafting-note mapping
- **WHEN** the DOCX is imported to canonical Markdoc
- **THEN** its semantic role SHALL default to `substantive-footnote`
- **AND** an audience-wide presentation rule SHALL NOT convert or omit it
- **AND** conversion or omission SHALL require an explicit per-annotation choice

#### Scenario: [SDX-MDOC-72] Unsupported annotation content fails visibly
- **GIVEN** a comment or footnote whose body or topology cannot be represented by
  the admitted canonical annotation vocabulary without loss
- **WHEN** strict import is requested
- **THEN** import SHALL fail with a structured diagnostic identifying the annotation
- **AND** SHALL NOT silently omit, flatten, or hide its negotiation content

#### Scenario: [SDX-MDOC-81] Strict annotation import is atomic
- **GIVEN** a document containing admitted annotations and one unsupported annotation
- **WHEN** strict import is requested
- **THEN** the canonical import SHALL fail as a whole with structured diagnostics
- **AND** SHALL NOT publish a partial canonical document

### Requirement: Source annotation provenance is immutable

Each canonical annotation SHALL retain immutable `sourcePresentation` of
`comment`, `footnote`, or `authored` and an immutable `sourceAnchor` containing
the imported or authored range-or-point geometry. Its current editable `anchor`
and presentation preference SHALL be stored separately. Editing either SHALL
NOT rewrite source provenance.

#### Scenario: [SDX-MDOC-82] Explicit range preserves imported point provenance
- **GIVEN** an annotation imported from a footnote with a point `sourceAnchor`
- **WHEN** an editor replaces its current anchor with an explicit range
- **THEN** later comment output SHALL use the current range
- **AND** `sourcePresentation` SHALL remain `footnote`
- **AND** `sourceAnchor` SHALL remain the imported point

### Requirement: Annotation audience is explicit and never inferred from origin

Canonical annotations SHALL declare `internal`, `external-facing`, or
`unspecified` audience. Brownfield import SHALL default to `unspecified` unless
the caller supplies an explicit mapping and SHALL NOT infer audience from
author, comment presence, file origin, or prose.

#### Scenario: [SDX-MDOC-73] Incoming Word comment has unspecified audience
- **GIVEN** an imported Word comment with author and date metadata
- **WHEN** no audience mapping is supplied
- **THEN** its canonical audience SHALL be `unspecified`
- **AND** its author and date SHALL NOT cause internal or external-facing classification

### Requirement: Presentation is a reversible projection of canonical annotation

The system SHALL project each canonical annotation as `preserve`, `comment`,
`footnote`, or `omit` according to an explicit per-annotation choice or audience
profile. Projection SHALL NOT destructively rewrite the canonical body, source
presentation, anchor geometry, or admitted reply topology.

#### Scenario: [SDX-MDOC-74] Comment range exports as styled footnote and later comment
- **GIVEN** a canonical ranged annotation imported from a comment
- **WHEN** one output projects it as a footnote with configured label and body styling
- **THEN** the footnote reference SHALL be placed at the range end
- **AND** the configured styling SHALL affect only the output presentation
- **WHEN** a later output projects the unchanged annotation as a comment
- **THEN** the original start and end range SHALL be restored

#### Scenario: [SDX-MDOC-75] Imported footnote exports transparently as point comment
- **GIVEN** a canonical point annotation imported from a footnote
- **WHEN** an output profile projects it as a comment
- **THEN** the system SHALL emit a point comment at the preserved point
- **AND** SHALL report that no selected range was available
- **AND** SHALL NOT guess or expand the anchor to a word, sentence, or paragraph

#### Scenario: [SDX-MDOC-76] Explicit later range replaces point-comment fallback
- **GIVEN** a canonical point annotation whose editor explicitly supplies a valid range
- **WHEN** a later output projects it as a comment
- **THEN** the comment SHALL use the supplied start and end positions
- **AND** later footnote projection SHALL still use the range end deterministically

#### Scenario: [SDX-MDOC-77] Unspecified audience fails closed without routing policy
- **GIVEN** a canonical annotation whose audience is `unspecified`
- **WHEN** export uses a profile with no `unspecified` rule and no per-annotation choice
- **THEN** export SHALL fail before publishing output
- **AND** SHALL identify the unrouted annotation

#### Scenario: [SDX-MDOC-83] Authored annotation preserve fallback is a comment
- **GIVEN** an authored canonical annotation with no explicit presentation preference
- **WHEN** an output profile selects `preserve`
- **THEN** the annotation SHALL be emitted as a comment
- **AND** its current point or range anchor SHALL be preserved without guessed expansion

### Requirement: Annotation bodies remain editable independently of presentation

Editing a canonical annotation body or its admitted structured formatting SHALL
change subsequent comment and footnote projections while leaving operative
document text and anchor geometry unchanged unless the editor explicitly edits
the anchor.

#### Scenario: [SDX-MDOC-78] One body edit feeds both presentations
- **GIVEN** a canonical annotation whose body is edited in Markdoc
- **WHEN** comment and styled-footnote outputs are compiled from that revision
- **THEN** both outputs SHALL contain the edited semantic body
- **AND** neither output SHALL require an intermediate destructive conversion
- **AND** operative document text SHALL remain unchanged

#### Scenario: [SDX-MDOC-80] Text edit cannot silently relocate an anchor
- **GIVEN** a canonical annotation anchored to document text
- **WHEN** an operative-text edit makes that anchor ambiguous or unresolvable
- **THEN** compilation SHALL fail with a diagnostic identifying the annotation
- **AND** SHALL NOT silently move, expand, collapse, or discard the anchor
