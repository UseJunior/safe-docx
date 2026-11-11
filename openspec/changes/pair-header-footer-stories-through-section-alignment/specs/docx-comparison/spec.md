## ADDED Requirements

### Requirement: Header and footer story identity is the effective slot paired through section alignment

The comparison engine SHALL identify a header/footer story by its effective
slot: section × kind × role after inheritance (ECMA-376 Part 1 §17.10.5,
§17.10.2), together with the first, odd and even pages that use it under
`w:titlePg` (§17.10.6) and `w:evenAndOddHeaders` (§17.10.1). It SHALL pair
slots through the section alignment the body comparison emitted: slot `i` of
the compared package after Reject All stands for the original's section `i`,
and after Accept All for the revised document's section `i`. A compared part
SHALL receive the redline of the one original story that every slot and page
showing it after Reject All shows in the original. Physical part names,
explicit versus inherited references, section count and section properties
SHALL NOT establish or prevent story identity. Story content SHALL be
compared together with what each of its relationship ids resolves to
(ECMA-376 Part 2 §6.5.2.3, §6.5.3.4): the target of an external relationship,
and the content of an internal target part together with, recursively, what
that part's own relationships resolve to, each target resolved from its source
part's directory or from the package root for a target that starts with `/`.
Relationship ids are local names and SHALL NOT distinguish two stories. A
reference that resolves to nothing, directly or through a nested relationship
or a cycle, SHALL NOT match any story.

A pair SHALL be kept only when every page it touches shows the original story
after Reject All and the revised story after Accept All. A story that cannot
meet that SHALL stay in `unrepresentedChanges`. The settings part has no
revision markup, so the compared package SHALL keep the revised
`w:evenAndOddHeaders` value.

Non-goals: text-box stories (kept on the #1204 checks), stories attached to or
removed from a surviving section (#1394), `formattingFidelity` on removed
section breaks (#1203), pairs with different admitted scaffolds, turning
different even pages off, turning even pages on with no even story, and
changes to the positional unrepresented-change detector beyond removing the
reports for slots this requirement represents.

#### Scenario: [SDX-CMP-SLOTPAIR-01] Header/footer edit across a page-layout change is tracked

- **GIVEN** original and revised documents whose header or footer text differs and whose section properties differ (page size, orientation or margins), across one or several sections with explicit and inherited references
- **WHEN** the pair is compared
- **THEN** the edited header/footer part SHALL carry tracked revisions
- **AND** Accept All SHALL show the revised story and Reject All the original story on every page of every section, with both the comparison appliers and docx-core `acceptChanges`/`rejectChanges`
- **AND** no header/footer change SHALL remain in `unrepresentedChanges`
- **AND** the output SHALL pass the emitted-document schema gate

#### Scenario: [SDX-CMP-SLOTPAIR-02] Header/footer edit across an added or removed section is tracked

- **GIVEN** a revision that adds or removes a section boundary and edits a header or footer the remaining sections show, possibly next to a removed section's own story
- **WHEN** the pair is compared
- **THEN** the edited story SHALL carry tracked revisions and every page SHALL show the revised story after Accept All and the original after Reject All
- **AND** a removed section's own story SHALL still be a tracked deletion

#### Scenario: [SDX-CMP-SLOTPAIR-03] Header/footer edit across a first-page switch is tracked, and first and even stories pair by role

- **GIVEN** a revision that switches `w:titlePg`, or edits a first-page or even-page story alongside a section-layout change
- **WHEN** the pair is compared
- **THEN** each edited story SHALL pair with the original story of the same effective slot and carry tracked revisions
- **AND** every first, odd and even page SHALL show the revised story after Accept All and the original after Reject All

#### Scenario: [SDX-CMP-SLOTPAIR-04] Turning on different even pages redlines the new even story against what the original showed there

- **GIVEN** a revision that turns `w:evenAndOddHeaders` on with a new even-page story and edits the default story
- **WHEN** the pair is compared
- **THEN** the compared package SHALL keep the revised setting
- **AND** the new even story SHALL receive the redline from the default story the original showed on even pages, so Reject All shows it there and Accept All shows the new even story
- **AND** the default story SHALL carry its own edit

#### Scenario: [SDX-CMP-SLOTPAIR-05] A story whose pages cannot come out right stays unrepresented

- **GIVEN** a revision that turns different even pages off, or turns them on with no even story, alongside a default-story edit
- **WHEN** the pair is compared
- **THEN** the default story SHALL NOT carry revisions it cannot make right on every page
- **AND** the change SHALL remain in `unrepresentedChanges`

#### Scenario: [SDX-CMP-SLOTPAIR-06] Explicit, inherited and renamed bindings of one slot pair as one story

- **GIVEN** a revision that moves a header slot to a differently named part, or from an explicit to an inherited reference, alongside a section-layout change
- **WHEN** the pair is compared
- **THEN** the revised part SHALL receive the redline of the original story and SHALL NOT be shown as a one-sided deletion or insertion

#### Scenario: [SDX-CMP-SLOTPAIR-07] Story identity includes what its relationship ids resolve to

- **GIVEN** two original header or footer stories with the same markup whose relationship ids resolve to different targets (different hyperlink URLs, or internal parts with different content)
- **WHEN** a revision shares one edited story across their slots alongside a section-layout change
- **THEN** the stories SHALL be treated as different stories and the shared story SHALL NOT be redlined against either
- **AND** two stories whose references differ only in relationship id SHALL be treated as one story
- **AND** both changes SHALL remain in `unrepresentedChanges`
