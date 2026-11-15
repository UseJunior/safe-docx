## ADDED Requirements

### Requirement: Publication text checks project run-content layout characters

The tagged publication gate's `acceptText` and `rejectText` checks SHALL project
each run-content `w:tab`, `w:br`, `w:cr`, `w:noBreakHyphen` and `w:softHyphen`
to a stable character, distinguishing line, page and column breaks, and SHALL
compare the projections with a normalization that does not erase those
characters. Equivalent spellings of one character SHALL project alike.
`w:drawing`, `w:pict`, `w:object`, `w:ptab` and `w:pgNum` SHALL contribute no
characters, and the checks SHALL make no claim about them.

#### Scenario: Dropping or adding a layout character fails the text check

- **GIVEN** a comparison output from which one of `w:tab`, `w:br`, `w:cr`, `w:noBreakHyphen` or `w:softHyphen` is dropped, or to which one is added
- **WHEN** the publication gate evaluates the output
- **THEN** comparison SHALL throw `TaggedPublicationSafetyError`
- **AND** `failedChecks` SHALL include `acceptText` and `rejectText`

#### Scenario: Equivalent spellings of a layout character do not fail the text check

- **GIVEN** a literal tab in `w:t` and a `w:tab`, a `w:cr` and a `w:br` with no type, or a Unicode hyphen in `w:t` and its hyphen element
- **WHEN** the two spellings are projected and compared as the gate compares them
- **THEN** they SHALL compare equal

#### Scenario: A tab added or removed beside unchanged text is redlined

- **GIVEN** original and revised runs whose `w:t` text is equal but whose `w:tab` elements differ, including runs re-segmented around a tab
- **WHEN** the pair is compared
- **THEN** each added or removed `w:tab` SHALL be a tracked insertion or deletion at its own text offset
- **AND** comparison SHALL publish with `acceptText` and `rejectText` passing

#### Scenario: Drawings and objects stay outside the text check

- **GIVEN** a run containing `w:drawing`, `w:pict`, `w:object`, `w:ptab` or `w:pgNum`
- **WHEN** the run is projected for the gate
- **THEN** the element SHALL contribute no characters

### Requirement: Publication gate checks paragraph topology separately from text

`TaggedPublicationSafetyChecks` SHALL include `acceptParagraphTopology` and
`rejectParagraphTopology`. Each SHALL pass only when the projection has the same
number of paragraphs as its source projection and the same paragraphs empty,
where a paragraph is empty when it projects no character other than spaces.
Text-box paragraphs SHALL be outside the check. Extra empty paragraphs at the
very end of a projection, which a resolved final paragraph mark leaves because a
story's last paragraph mark cannot be removed, SHALL be outside the check. The
checks SHALL be reported
separately from `acceptText` and `rejectText`, with
`ParagraphTopologyMismatchDetails` in the failure details.

#### Scenario: Dropping or adding an empty paragraph fails the paragraph topology check

- **GIVEN** a comparison output from which an empty paragraph is dropped, or to which one is added
- **WHEN** the publication gate evaluates the output
- **THEN** comparison SHALL throw `TaggedPublicationSafetyError` whose `failedChecks` are `acceptParagraphTopology` and `rejectParagraphTopology`
- **AND** `acceptText` and `rejectText` SHALL still pass

#### Scenario: Legitimate empty paragraph edits and terminal paragraph cleanup pass the topology check

- **GIVEN** original and revised documents that add or remove an empty paragraph, add or remove the terminal paragraph (including one whose content sits in a hyperlink, which leaves an empty final paragraph on Accept or Reject), or move the terminal paragraph
- **WHEN** the pair is compared end to end
- **THEN** comparison SHALL publish without a topology failure
