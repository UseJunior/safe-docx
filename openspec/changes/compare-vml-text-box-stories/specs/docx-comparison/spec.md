## ADDED Requirements

### Requirement: Supported VML text boxes are compared as nested WordprocessingML stories

The system SHALL compare the paragraph content of `w:txbxContent` as an independent nested story and preserve the surrounding drawing/VML scaffold when a paired VML text box in `word/document.xml` has an unchanged outer scaffold. It SHALL NOT represent a text-only story edit by wrapping the complete `w:pict`, `v:shape`, or `v:textbox` object in revision markup.

#### Scenario: [SDX-TXBX-01] Text-only edit emits revisions inside the text-box story

- **GIVEN** original and revised documents with one paired VML text box
- **AND** only text inside its `w:txbxContent` differs
- **WHEN** in-place comparison runs
- **THEN** the output SHALL contain ordinary tracked insertion/deletion markup inside `w:txbxContent`
- **AND** the containing `w:pict`, `v:shape`, and `v:textbox` scaffold SHALL remain present exactly once
- **AND** the complete drawing object SHALL NOT be wrapped as an insertion or deletion

#### Scenario: [SDX-TXBX-02] Mixed body and text-box edits round-trip independently

- **GIVEN** a paired document with one authored body edit and one authored text-box edit
- **WHEN** in-place comparison runs
- **THEN** both edits SHALL be represented in their respective stories
- **AND** accepting all changes SHALL recover the revised body and revised text-box story
- **AND** rejecting all changes SHALL recover the original body and original text-box story

#### Scenario: [SDX-TXBX-03] Multiple paired text boxes retain locator and order

- **GIVEN** multiple VML text boxes with unchanged scaffolds and one or more changed nested stories
- **WHEN** comparison runs
- **THEN** each story SHALL be paired by a deterministic main-part locator
- **AND** each compared story SHALL be spliced back into its original shape in document order
- **AND** content SHALL NOT move between text boxes or between a text box and the outer body

#### Scenario: [SDX-TXBX-04] Unsupported text-box topology fails closed

- **GIVEN** an inserted, deleted, reordered, nested, scaffold-mutated, header, or footer text box
- **WHEN** comparison classifies the text-box stories
- **THEN** it SHALL fail with a typed unsupported text-box story diagnostic
- **AND** the diagnostic SHALL identify the package part and stable story locator
- **AND** it SHALL NOT emit a flattened, stale, duplicated, or drawing-level revision

#### Scenario: [SDX-TXBX-05] Verifier coverage is explicit for nested stories

- **GIVEN** a successful comparison containing a supported changed text-box story
- **WHEN** the compiled verifier evaluates the comparison triple
- **THEN** it SHALL either verify that nested story or report it as an uncovered story
- **AND** a certificate SHALL NOT claim complete story coverage while any text-box story remains uncovered
