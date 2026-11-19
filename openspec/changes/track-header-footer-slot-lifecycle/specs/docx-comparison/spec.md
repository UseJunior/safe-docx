## ADDED Requirements

### Requirement: Header and footer slots attached to or dropped from a surviving section are tracked as content

The comparison engine SHALL represent as tracked content, not in
`unrepresentedChanges`, a header or footer part that section `k` of one
document names for a kind and role and section `k` of the other does not,
when both documents have the same number of sections. The side
without a reference SHALL be compared as if it named a part holding what the
section shows there: the part inherited from the previous section, or a blank
story in the first section (ECMA-376 Part 1 §17.10.5, §17.10.2). No
`w:sectPrChange` snapshot SHALL contain a header or footer reference
(§17.13.5.32). A story compared with a blank story SHALL be tracked as a whole
insertion or deletion, and its last paragraph's properties SHALL be tracked
against none (§17.13.5.29, §17.13.5.30), so the side without the story shows
one plain empty paragraph. A text box's carrier run in a story tracked as a
whole insertion or deletion SHALL carry the same revision. Slots whose display
switch (`w:titlePg`, `w:evenAndOddHeaders`) differs between the documents, and
slots that resolve to the same part in both, SHALL be left to section-aligned
story pairing.

Non-goals: documents whose section counts differ, a removed or inserted
section boundary whose carried header/footer displaces an inherited one, and a
carried lifecycle story with visible non-text content.

#### Scenario: [SDX-CMP-SLOTLIFE-01] A header or footer attached to a surviving section is tracked as inserted content

- **GIVEN** an original whose section shows no header or footer of a role, or inherits a blank one, and a revised document whose same section names a part for that role
- **WHEN** the pair is compared
- **THEN** the part's content SHALL be a tracked insertion
- **AND** every page SHALL show the revised story after Accept All and the original's after Reject All, with both appliers
- **AND** nothing SHALL be listed in `unrepresentedChanges`

#### Scenario: [SDX-CMP-SLOTLIFE-02] A header or footer dropped from a surviving section is tracked as deleted content

- **GIVEN** an original whose section names a header or footer part for a role and a revised document whose same section names none and inherits none
- **WHEN** the pair is compared
- **THEN** the section SHALL keep a live reference to a part whose content is a tracked deletion, including a text box's carrier run
- **AND** every page SHALL show a blank story after Accept All and the original story after Reject All, with both appliers
- **AND** nothing SHALL be listed in `unrepresentedChanges`

#### Scenario: [SDX-CMP-SLOTLIFE-03] A section that starts or stops inheriting a header or footer is tracked as replaced content

- **GIVEN** a section that inherits a header or footer in one document and names its own part in the other
- **WHEN** the pair is compared
- **THEN** the section's part SHALL carry the redline from the story the original shows there to the story the revised document shows there
- **AND** every page SHALL show the revised story after Accept All and the original's after Reject All, with both appliers
