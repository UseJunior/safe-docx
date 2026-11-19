## ADDED Requirements

### Requirement: Empty Numbered Paragraph Check After Edits
The server SHALL apply the `on_empty_numbered_paragraph` policy, which
defaults to `warn`, when a DOCX `replace_text` edit leaves the paragraph it
targeted displaying a list label (its own `w:numPr` or numbering inherited
through its paragraph style) with no visible content after the label, and
that paragraph had visible content before the edit. Visible
content SHALL be judged as the paragraph reads once its tracked changes are
accepted: non-whitespace text, a symbol glyph, a drawing, picture, object or
equation, or a footnote or endnote reference counts; whitespace, tabs,
breaks, range markers, field instructions and text inside `w:del` do not. A
paragraph whose tracked mark deletion removes it on accept SHALL NOT be
reported. Under `warn`, the response SHALL carry a warning naming the
paragraph id, its list label and its text before the edit.

#### Scenario: An edit that leaves only whitespace in a list item is reported
- **GIVEN** a numbered list item whose text ends with a space
- **WHEN** `replace_text` replaces the item text without that trailing space with an empty string, in tracked or untracked mode
- **THEN** the edit SHALL succeed
- **AND** `warnings` SHALL contain one entry naming the paragraph id, its list label and its text before the edit

#### Scenario: A pre-existing empty numbered paragraph is not reported
- **GIVEN** a document that already has an empty numbered paragraph
- **WHEN** `replace_text` edits that paragraph or another paragraph without emptying it
- **THEN** the response SHALL NOT carry an empty numbered paragraph warning

#### Scenario: A whole-paragraph tracked deletion is not reported
- **GIVEN** the default tracked mode
- **WHEN** `replace_text` blanks the complete text of a numbered list item, so its text moves into `w:delText` and its paragraph mark is deleted
- **THEN** the response SHALL NOT carry an empty numbered paragraph warning

#### Scenario: An image-only list item is not reported
- **GIVEN** a numbered list item holding text and a drawing
- **WHEN** `replace_text` blanks the text
- **THEN** the response SHALL NOT carry an empty numbered paragraph warning

#### Scenario: A list item kept for an anchor is reported with the reason
- **GIVEN** a numbered list item whose text is wrapped in a comment range
- **WHEN** `replace_text` blanks its complete text
- **THEN** the warning SHALL say the paragraph is kept because it holds a comment anchor

#### Scenario: A style-numbered heading is checked
- **GIVEN** a heading numbered only through its paragraph style that holds a bookmark
- **WHEN** `replace_text` blanks its complete text
- **THEN** the warning SHALL name the heading list label

### Requirement: Empty Numbered Paragraph Policy Values
`replace_text` and `batch_edit` SHALL accept an optional
`on_empty_numbered_paragraph` parameter with the values `warn` (default),
`error`, `remove_paragraph` and `ignore`. `error` SHALL refuse the edit with
error code `EMPTY_NUMBERED_PARAGRAPH` and leave the document unchanged.
`ignore` SHALL report nothing. `remove_paragraph` SHALL delete the
paragraph's remaining whitespace through the same rules as blanking its
complete text: untracked, the paragraph SHALL be removed; tracked, its
remaining text and its paragraph mark SHALL be deleted as tracked changes.
A paragraph those rules keep SHALL NOT be removed, and the response SHALL
say what keeps it. Any other value SHALL be rejected with `INVALID_PARAMS`
before the document is changed.

#### Scenario: error refuses the edit and leaves the document unchanged
- **WHEN** `replace_text` with `on_empty_numbered_paragraph` `error` would leave an empty numbered paragraph
- **THEN** the call SHALL fail with `EMPTY_NUMBERED_PARAGRAPH`
- **AND** the session document and its edit count SHALL be unchanged

#### Scenario: ignore reports nothing
- **WHEN** `replace_text` with `on_empty_numbered_paragraph` `ignore` leaves an empty numbered paragraph
- **THEN** the edit SHALL succeed without a warning and the paragraph SHALL remain

#### Scenario: remove_paragraph removes the list item untracked
- **GIVEN** untracked mode and a three-item numbered list
- **WHEN** `replace_text` with `on_empty_numbered_paragraph` `remove_paragraph` leaves the middle item holding only whitespace
- **THEN** the middle paragraph SHALL be removed and the list SHALL number the remaining items consecutively
- **AND** the response SHALL say the paragraph was removed

#### Scenario: remove_paragraph deletes the list item as a tracked change
- **GIVEN** tracked mode and a three-item numbered list
- **WHEN** `replace_text` with `on_empty_numbered_paragraph` `remove_paragraph` leaves the middle item holding only whitespace
- **THEN** the remaining whitespace and the paragraph mark SHALL be tracked deletions
- **AND** accepting all changes SHALL leave two numbered items, and rejecting all changes SHALL restore the original item text

#### Scenario: remove_paragraph keeps a paragraph the blanking rules keep
- **GIVEN** a numbered list item holding a bookmark that is not a paragraph id
- **WHEN** `replace_text` with `on_empty_numbered_paragraph` `remove_paragraph` blanks its complete text
- **THEN** the paragraph SHALL remain and the warning SHALL name the bookmark that keeps it

#### Scenario: An unknown policy value is rejected
- **WHEN** `replace_text` or `batch_edit` is called with an `on_empty_numbered_paragraph` value outside the four
- **THEN** the call SHALL fail with `INVALID_PARAMS` and the document SHALL be unchanged

### Requirement: Batch Edit Empty Numbered Paragraph Policy
`batch_edit` SHALL apply `on_empty_numbered_paragraph` to the end state of
the batch, to the paragraphs its `replace_text` steps emptied. Each warning
or removal notice SHALL be a `{ step_id, warning }` entry whose `step_id` is
the step that emptied the paragraph. A paragraph a later step fills again
SHALL NOT be reported. `remove_paragraph` SHALL run once after the last
step, so every step's paragraph-id anchors resolve against the paragraphs
validation checked. `error` SHALL refuse the whole batch with
`EMPTY_NUMBERED_PARAGRAPH` before any step is applied.

#### Scenario: A batch warning carries the step_id of the step that emptied the paragraph
- **GIVEN** a batch of three `replace_text` steps of which only the second leaves a numbered list item holding only whitespace
- **WHEN** `batch_edit` is called
- **THEN** `warnings` SHALL contain exactly one empty numbered paragraph entry, with the second step's `step_id`

#### Scenario: A paragraph a later step fills again is not reported
- **GIVEN** a batch whose first step leaves a list item holding only whitespace and whose second step replaces that whitespace with new text
- **WHEN** `batch_edit` is called
- **THEN** the response SHALL NOT carry an empty numbered paragraph warning

#### Scenario: remove_paragraph in a batch runs after the last step
- **GIVEN** a batch whose first step leaves a list item holding only whitespace and whose second step inserts a paragraph after that item
- **WHEN** `batch_edit` is called with `on_empty_numbered_paragraph` `remove_paragraph`
- **THEN** both steps SHALL succeed
- **AND** the emptied list item SHALL be removed after the second step, with a notice carrying the first step's `step_id`

#### Scenario: error refuses the whole batch before any step is applied
- **GIVEN** a batch whose second step leaves a list item holding only whitespace
- **WHEN** `batch_edit` is called with `on_empty_numbered_paragraph` `error`
- **THEN** the call SHALL fail with `EMPTY_NUMBERED_PARAGRAPH`, naming the second step's `step_id`
- **AND** no step SHALL be applied to the session document
