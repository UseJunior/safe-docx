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

- **GIVEN** an inserted, deleted, reordered, nested, scaffold-mutated, or ambiguously paired text box
- **WHEN** comparison classifies the text-box stories
- **THEN** it SHALL fail with a typed unsupported text-box story diagnostic
- **AND** the diagnostic SHALL identify the package part and stable story locator
- **AND** it SHALL NOT emit a flattened, stale, duplicated, or drawing-level revision

#### Scenario: [SDX-TXBX-05] Verifier coverage is explicit for nested stories

- **GIVEN** a successful comparison containing a supported changed text-box story
- **WHEN** the compiled verifier evaluates the comparison triple
- **THEN** it SHALL either verify that nested story or report it as an uncovered story
- **AND** a certificate SHALL NOT claim complete story coverage while any text-box story remains uncovered

#### Scenario: [SDX-TXBX-06] Relationship-selected story survives physical-part renumbering

- **GIVEN** corresponding section slots select semantically paired header/footer stories at different physical package paths
- **AND** their VML scaffolds match while supported nested paragraph content differs
- **WHEN** in-place comparison runs
- **THEN** the stories SHALL be paired through typed section bindings and semantic scaffold identity rather than raw filenames
- **AND** tracked revisions SHALL be spliced into the revised selected part
- **AND** the final section selectors and owning-part relationships SHALL remain closed

#### Scenario: [SDX-TXBX-07] New section owns a side-only story lifecycle

- **GIVEN** an inserted or deleted section whose direct selector is the only binding to a side-only header/footer text-box story
- **WHEN** comparison classifies relationship-selected stories
- **THEN** the complete story SHALL be treated as lifecycle content of that inserted/deleted section
- **AND** it SHALL NOT be paired with an unrelated physical story
- **AND** accepting and rejecting the final package SHALL select the intended revised and original story inventories

#### Scenario: [SDX-TXBX-08] Ambiguous ancillary topology fails closed

- **GIVEN** a changed header/footer text-box story has multiple possible semantic counterparts
- **OR** a side-only story is selected by a section that corresponds across both inputs
- **WHEN** comparison classifies relationship-selected stories
- **THEN** it SHALL fail with a typed non-content-bearing diagnostic
- **AND** it SHALL NOT publish stale, duplicated, or silently copied ancillary text

#### Scenario: [SDX-TXBX-09] Ancillary text-box projections recover both sources

- **GIVEN** a supported same-path or renumbered-path header/footer text-box edit
- **WHEN** the compared package is assembled
- **THEN** accepting all changes in every selected story SHALL recover the revised selector/story inventory
- **AND** rejecting all changes in every selected story SHALL recover the original selector/story inventory
