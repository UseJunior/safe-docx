## ADDED Requirements

### Requirement: Readable semantic revision grouping

`compareDocuments` SHALL accept `revisionGrouping: 'token-minimal' | 'readable-semantic'`
and SHALL default to `'token-minimal'`. Any other value SHALL throw a `TypeError`
before comparison.

With `'readable-semantic'`, the system SHALL regroup each paragraph's
comparison-generated run revisions into change clusters. An unchanged stretch
between two changes SHALL be absorbed when its character length is no greater
than the larger side (deleted or inserted characters) of the change on each
side of it, or when it consists only of whitespace and punctuation; absorption
SHALL repeat until no stretch qualifies. Each cluster SHALL be emitted as one
`w:del` holding the original-side runs (absorbed unchanged runs re-emitted with
`w:delText`) followed by one `w:ins` holding the revised-side runs, and each run
SHALL keep its own run properties. Moves, fields, bookmarks, comment ranges,
note references, pre-existing input revisions and every other non-text atom
SHALL be barriers that a cluster never crosses. Accept All and Reject All
projections SHALL be identical to those of the token-minimal output.

#### Scenario: A rewritten paragraph with a highlighted placeholder groups into one deletion and one insertion

- **GIVEN** a one-run original paragraph and a heavily rewritten revision containing a separately highlighted placeholder run
- **WHEN** the documents are compared with `revisionGrouping: 'readable-semantic'`
- **THEN** the rewrite SHALL be one `w:del` followed by one `w:ins` between the unchanged leading and trailing text
- **AND** the placeholder SHALL keep its highlight inside the insertion
- **AND** Accept All SHALL yield the revised text and Reject All the original text exactly

#### Scenario: Mixed run formatting does not disable grouping

- **GIVEN** a rewritten paragraph whose cluster spans differently formatted runs, such as a bold defined term or a word whose formatting changed
- **WHEN** the documents are compared with readable semantic grouping
- **THEN** the cluster SHALL still be one deletion followed by one insertion
- **AND** each side SHALL keep its own run formatting in its projection

#### Scenario: Short common words between replacements are absorbed while real anchors stay plain

- **GIVEN** replacements separated by short common words such as "a", "an", "the" and "as", followed by a long unchanged clause
- **WHEN** the documents are compared with readable semantic grouping
- **THEN** the short words SHALL be absorbed into one cluster
- **AND** the long unchanged clause SHALL remain plain text outside any revision

#### Scenario: Non-text atoms are barriers that grouping never crosses

- **GIVEN** rewritten phrases on both sides of a bookmark, a complex field, a note reference or a pre-existing tracked insertion
- **WHEN** the documents are compared with readable semantic grouping
- **THEN** the atom SHALL stay outside the generated clusters, with a separate cluster on each side of it
- **AND** both projections SHALL remain exact and schema-valid

#### Scenario: Token-minimal grouping remains the library default

- **GIVEN** a comparison request without `revisionGrouping`
- **WHEN** `compareDocuments` runs
- **THEN** the output SHALL equal the explicit `'token-minimal'` output
- **AND** an unsupported grouping value SHALL be rejected with a `TypeError`
