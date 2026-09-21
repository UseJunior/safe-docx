## ADDED Requirements

### Requirement: Canonical Markdoc projects selected header and footer stories once

The system SHALL import every admitted relationship-selected header/footer
physical story exactly once with a deterministic opaque story ID, kind,
complete sorted semantic binding set, source-part fingerprint, paragraph count,
and stable story-scoped paragraph anchors allocated from one package-wide
bookmark name and numeric-ID reservation set. The opaque ID SHALL derive from
kind plus binding closure while content staleness remains a separate
fingerprint. The system SHALL NOT use a physical package filename as canonical
story identity.

#### Scenario: [SDX-MDOC-120] Shared header is represented once with all bindings
- **GIVEN** two sections whose default header selectors resolve to the same physical part
- **WHEN** the source is imported to canonical Markdoc
- **THEN** exactly one header story declaration SHALL represent that part
- **AND** its binding inventory SHALL disclose both section selectors in deterministic order
- **AND** each admitted paragraph SHALL appear exactly once in that story

#### Scenario: [SDX-MDOC-121] Anchoring side stories preserves the caller's original
- **GIVEN** an admitted selected header/footer containing paragraphs without stable Safe DOCX anchors
- **WHEN** import creates its anchored source and canonical Markdoc
- **THEN** stable globally unique anchors SHALL be added only to the separate anchored copy
- **AND** their bookmark names and numeric IDs SHALL NOT collide with anchors in the body or another selected story
- **AND** the caller's original DOCX SHALL remain byte-identical

### Requirement: Side-story paragraph operations are explicit and story-scoped

The system SHALL support clean before/after replacement, paragraph insertion,
and paragraph deletion in an existing declared header/footer story. Every side-
story source paragraph and operation MUST name its story; an omitted story SHALL
continue to mean the main body. Resolution SHALL require both story and anchor
identity to match the pinned source.

#### Scenario: [SDX-MDOC-122] Header date change compiles as native revisions
- **GIVEN** an imported header paragraph containing `(17 September 2026 Draft)`
- **AND** a story-scoped change whose before text matches that source and whose after text changes only `17` to `18`
- **WHEN** Markdoc compiles
- **THEN** clean output SHALL contain the revised header text
- **AND** tracked output SHALL contain native insertion/deletion evidence in the selected header part
- **AND** no operative header text SHALL be inserted into the main body

#### Scenario: [SDX-MDOC-123] Story and anchor mismatch fails transactionally
- **GIVEN** an operation naming an undeclared, stale, body, or different-side-story identity for its anchor
- **WHEN** validation or compilation runs
- **THEN** it SHALL fail with a stable story-scoped diagnostic before mutation
- **AND** no DOCX output SHALL be published

#### Scenario: [SDX-MDOC-124] Existing header table-cell paragraph follows cell safety rules
- **GIVEN** a declared selected story whose admitted anchor is in an existing physical table cell
- **WHEN** a text operation replaces, inserts beside, or deletes that paragraph
- **THEN** it SHALL preserve row, cell, grid, merge, and table topology
- **AND** insertion formatting and the final direct `w:p` block invariant, ignoring range markers, SHALL be enforced within that same physical cell

### Requirement: Side-story admission is mechanically bounded

Markdoc SHALL admit only direct story-root or physical-cell paragraphs composed
of ordinary runs, their supported text/control children, preserved hyperlinks,
range/proof markers, and non-intersected preserved field sequences. It SHALL
project paragraphs containing drawings, pictures, `mc:AlternateContent`,
content controls, text boxes, objects, comments, or note references as
read-only and MUST reject an operation targeting one.

#### Scenario: [SDX-MDOC-125] Relationship-backed paragraph stays read-only
- **GIVEN** a selected header paragraph containing a drawing, picture, `mc:AlternateContent`, content control, nested text box, object, comment, or note reference
- **WHEN** Markdoc imports and an operation attempts to target that paragraph
- **THEN** import SHALL NOT expose an operative anchor for that paragraph
- **AND** the operation SHALL fail with a typed unsupported-content diagnostic before mutation

### Requirement: Story topology and unsupported content fail closed

Markdoc side-story authoring SHALL NOT create, delete, copy, rebind, or partially
alias a selected story. It SHALL reject structural changes to sections,
relationships, tables, drawings, fields, content controls, and nested text-box
stories, plus external comment or annotation materialization whose operative
anchor is in a side story.

#### Scenario: [SDX-MDOC-126] Shared story edit discloses its alias closure
- **GIVEN** one imported physical story selected by several section bindings
- **WHEN** an admitted operation edits that story
- **THEN** every selector SHALL continue to resolve to the one edited physical story
- **AND** the certificate SHALL report the complete affected binding closure
- **AND** syntax attempting to target only a subset of those aliases SHALL fail

#### Scenario: [SDX-MDOC-127] Unsupported side-story mutation writes nothing
- **GIVEN** a request that adds/removes/rebinds a story, changes story scaffold or structural table content, targets a nested text box, or materializes an external comment there
- **WHEN** compilation is attempted
- **THEN** compilation SHALL fail with a typed actionable diagnostic before mutation
- **AND** no clean or tracked artifact SHALL be published

### Requirement: Side-story compilation is certified package-wide

For each edited selected story, the verification certificate SHALL report
source/clean identity and bindings, reject-all/source and accept-all/clean text
and formatting equality, scaffold and relationship preservation, unresolved
story revisions, and whether the change remains unrepresented. Aggregate
projection success MUST require every edited story report to pass.

#### Scenario: [SDX-MDOC-128] Accept and reject recover authentic header states
- **GIVEN** a successful story-scoped Markdoc compilation
- **WHEN** tracked output is accepted and rejected across the package
- **THEN** rejection SHALL reproduce the pinned source story and bindings
- **AND** acceptance SHALL reproduce the clean revised story and bindings
- **AND** the edited story SHALL have zero unresolved revisions and no matching `unrepresentedChanges` entry
- **AND** every selector in the story's binding closure SHALL still target the same one physical output part

#### Scenario: [SDX-MDOC-129] Body-only syntax remains compatible
- **GIVEN** canonical Markdoc containing no story declarations or story attributes
- **WHEN** it is validated and compiled
- **THEN** every operation SHALL retain its existing main-body meaning
- **AND** certificate semantics for the body-only document SHALL remain unchanged
