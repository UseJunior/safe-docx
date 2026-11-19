## ADDED Requirements

### Requirement: Continuous list numbering in created documents

`docx-markdoc create` SHALL number every top-level ordered list with one
shared abstract numbering definition. A list whose first marker is the
previous ordered list's last number plus one SHALL continue that list's
numbering instance with no start override, so Word renumbers it when a clause
is inserted in an earlier list. A list with any other first marker SHALL
restart the count with a new numbering instance carrying a level-0
`w:startOverride` equal to its marker. The numbers Word shows, and the
cross-reference results generation caches, SHALL equal the source markers.

#### Scenario: [SDX-MDOC-LISTSEQ-01] ordered lists split by headings continue one Word list
- **GIVEN** three ordered lists separated by headings, numbered `1.`–`2.`, `3.`–`4.` and `5.`, with nested items and a bullet list between two of them
- **WHEN** the source is created
- **THEN** every ordered list paragraph SHALL use the same `w:numId`, over one ordered abstract definition, with no `w:lvlOverride`
- **AND** the read side SHALL label the items `1.` to `5.` with each nested item `(a)`
- **AND** after a clause is inserted after the first item, the read side SHALL label every later item one higher
- **AND** a first list starting at `3.` SHALL set the definition's level-0 start to 3

#### Scenario: [SDX-MDOC-LISTSEQ-02] a list whose first marker does not continue restarts with a start override
- **GIVEN** a list `1.`–`2.`, a list restarting at `1.`, a list continuing it at `3.`, and a list starting at `10.`, separated by headings
- **WHEN** the source is created
- **THEN** the document SHALL have one ordered abstract definition with three `w:num` instances: the default, one with a level-0 `w:startOverride` of 1 and one with 10
- **AND** the list continuing the restarted list SHALL use the restarted list's `w:numId`
- **AND** after a clause is inserted in the first list, the restarted list and the `10.` list SHALL keep their numbers, and after one is inserted in the restarted list, the list continuing it SHALL be one higher

#### Scenario: [SDX-MDOC-LISTSEQ-03] cross-references into continued and restarted lists show the numbers Word shows
- **GIVEN** xrefs to items in a continuing list, in a restarted list and in a list after the restarted one
- **WHEN** the source is created
- **THEN** the certificate SHALL pass, including the cross-reference check
- **AND** each REF field's cached result SHALL be the target's number as Word shows it
- **AND** in Word 16.114, after a clause is inserted in the first list and fields are updated, the later continuing clauses and the REF results to them SHALL be one higher while a restarted list keeps its numbers, as recorded in `scripts/oracle/word/evidence/issue-1252-word-16.114.json`
- **AND** the read side's labels for the recorded document, before and after each recorded insertion, SHALL equal the list strings Word showed
