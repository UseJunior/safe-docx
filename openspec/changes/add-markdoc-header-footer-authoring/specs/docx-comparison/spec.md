## ADDED Requirements

### Requirement: Ordinary selected header and footer stories compare independently

The comparison engine SHALL independently compare ordinary paragraph content in
each paired header/footer story when original and revised packages retain the
same section count, selector set, exact physical-story binding closures, and
admitted scaffold, with unchanged `w:sectPrChange`, `w:titlePg`, and even/odd
header settings. It SHALL pair stories by complete sorted binding closure,
not canonical content or a content-sensitive scaffold fingerprint. It SHALL use
the shared tagged-tree semantics and splice tracked paragraph/run revisions into
the preserved revised story root. Physical package filenames SHALL NOT
establish story identity.

#### Scenario: [SDX-CMP-STORY-01] Ordinary selected header text receives native revisions
- **GIVEN** original and revised packages with the same selected default header scaffold and one changed ordinary paragraph
- **WHEN** the packages are compared
- **THEN** tracked insertion/deletion markup SHALL be emitted inside the selected header part
- **AND** accept-all SHALL recover the revised header text
- **AND** reject-all SHALL recover the original header text
- **AND** the represented header SHALL NOT remain in `unrepresentedChanges`

#### Scenario: [SDX-CMP-STORY-02] Semantic identity survives physical part renumbering
- **GIVEN** corresponding selected stories whose physical package filenames differ but whose semantic bindings and admitted scaffolds pair uniquely
- **WHEN** their ordinary paragraph content is compared
- **THEN** the engine SHALL treat them as one corresponding story
- **AND** SHALL NOT model the change as whole-story deletion and insertion

#### Scenario: [SDX-CMP-STORY-03] Shared selected story compares once
- **GIVEN** several section selectors that resolve to one physical header/footer part on each side
- **WHEN** that story's admitted paragraph text changes
- **THEN** the engine SHALL compare and splice the physical story exactly once
- **AND** accept/reject validation SHALL preserve the complete selector binding closure
- **AND** the output package SHALL retain one physical part targeted by every alias relationship rather than copying it per selector

### Requirement: Selected-story scaffold changes remain explicit and fail closed

Ordinary selected-story comparison SHALL preserve the story root, relationship
closure, fields, tables, drawings, content controls, and nested story scaffold.
Its structural fingerprint SHALL blank admitted ordinary paragraph text and
nested text-box content before equality checks. For the comparison's
eligibility checks it SHALL also leave out the run properties, paragraph-mark
run properties and paragraph properties of the paragraphs it keeps (those
holding a field, content control or drawing), because `w:rPrChange` and
`w:pPrChange` record a change to them; content-control properties and field
instructions stay in it, and so does all formatting of a paragraph whose
mark is already inserted, deleted or moved. A paragraph that already carries
a `w:rPrChange` or `w:pPrChange` record is compared like any other; the new
formatting revision is layered without nesting or duplicating a record.
The eligibility checks SHALL
also leave out each row of a table placed directly in the story whose
paragraphs are all admitted ordinary paragraphs and which carries no revision
record, because the story comparison tracks such a row as inserted or deleted
under the same table-topology guard as the main body; a row holding a field,
content control (including a cell-level one), drawing, nested table, range
markup or table-property exceptions stays in it, and so does every row of a
story that also holds a text box. A table topology that guard refuses in a
header or footer part with no text box SHALL leave that part listed rather
than abort the comparison; a text-box story the guard refuses keeps the
unguarded comparison it used before. Field-state validation
SHALL relationship-walk every selected header/footer part.
Creation, deletion, rebinding, ambiguous pairing, or unsupported scaffold
mutation SHALL produce a typed diagnostic or `unrepresentedChanges` entry and
MUST NOT be silently represented as an ordinary text edit.

#### Scenario: [SDX-CMP-STORY-04] Field-bearing running text preserves field structure
- **GIVEN** a paired selected story containing an unchanged PAGE-family field and an admitted neighboring text edit
- **WHEN** comparison completes
- **THEN** the complete field structure and cached-result policy SHALL remain valid
- **AND** only the neighboring text change SHALL receive revision markup

#### Scenario: [SDX-CMP-STORY-06] Formatting beside a field, content control or drawing is tracked
- **GIVEN** a paired default, first or even header or footer paragraph holding a field, a content control or a drawing, whose only change is run formatting (including on the field's own runs or inside the content control), paragraph-mark formatting or paragraph properties
- **WHEN** the packages are compared
- **THEN** the change SHALL be tracked with `w:rPrChange` or `w:pPrChange` inside the story part
- **AND** accept-all SHALL recover the revised formatting and reject-all the original formatting, with both the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`
- **AND** the story SHALL NOT remain in `unrepresentedChanges`
- **AND** a change to a field instruction, a content control's own properties, or the presence of a field or content control SHALL still be listed
- **AND** a formatting change in such a paragraph that already carries a `w:rPrChange` or `w:pPrChange` SHALL also be tracked, with at most one formatting revision per property element and never a nested or duplicate one, while reject-all SHALL recover the original document's rejected formatting

#### Scenario: [SDX-CMP-STORY-07] Header and footer table rows are tracked as whole-row revisions
- **GIVEN** a paired default, first or even header or footer, or a text box inside one, whose table gains or loses a row of ordinary paragraphs (at the start, in the middle or at the end, beside an edit to another row, or beside a row holding a `PAGE` field), or whose row skeleton changes within an unchanged grid
- **WHEN** the packages are compared
- **THEN** an inserted row SHALL carry `w:trPr/w:ins` and a deleted row `w:trPr/w:del`, and a matched row whose skeleton changed SHALL be replaced by a deleted and an inserted row (a vertical-merge band as a whole), as in the main body
- **AND** accept-all SHALL recover the revised story and reject-all the original story, with both the comparison acceptor and docx-core `acceptChanges`/`rejectChanges`
- **AND** the story SHALL NOT remain in `unrepresentedChanges`, an unchanged field SHALL keep its structure without revision markup, and the emitted document SHALL validate against the vendored Transitional schema
- **AND** inserting or deleting a row that holds a field, content control, drawing, nested table or table-property exceptions, a change to a row's table-property exceptions or cell-level content control, a row change in a table beside a text box in the same story, or a whole table, SHALL still be listed

#### Scenario: [SDX-CMP-STORY-05] Unsupported topology remains unrepresented
- **GIVEN** selected stories with creation, deletion, rebinding, ambiguous pairing, structural table mutation outside the tracked table-row subset, drawing/content-control mutation, or nested-story change outside the admitted subset
- **WHEN** comparison is attempted
- **THEN** the engine SHALL return a typed unsupported-story diagnostic or retain a precise `unrepresentedChanges` entry
- **AND** SHALL NOT publish a tracked artifact that claims to represent the unsupported change
