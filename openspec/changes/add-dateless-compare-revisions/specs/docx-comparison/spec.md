## ADDED Requirements

### Requirement: Comparison revisions may omit w:date

`compareDocuments` SHALL accept `date: null` and SHALL then write no `w:date`
attribute on any revision it creates where ECMA-376 makes `w:date` optional, in
every story part. The move-range start markers `w:moveFromRangeStart` and
`w:moveToRangeStart` (CT_MoveBookmark, where `w:date` is required) SHALL instead
carry the fixed neutral date `1970-01-01T00:00:00Z`. Revisions present in
an input SHALL keep their own `w:date`. An omitted `date` SHALL stamp revisions
with the current time, and a `Date` SHALL stamp them with that time.

#### Scenario: Dateless comparison omits w:date from every revision it creates

- **GIVEN** a pair with body, footnote, endnote, footer and move changes
- **WHEN** it is compared with `date: null`
- **THEN** no story part SHALL contain a generated `w:date` outside the move-range start markers
- **AND** the output SHALL equal the dated output with `w:date` removed, except that generated move-range start markers keep the neutral date, with the same revision count

#### Scenario: Dateless move-range markers keep a neutral date

- **GIVEN** a pair whose comparison detects moves
- **WHEN** it is compared with `date: null`
- **THEN** every generated `w:moveFromRangeStart` and `w:moveToRangeStart` SHALL carry `w:date="1970-01-01T00:00:00Z"`
- **AND** the output SHALL pass the emitted-document schema check

#### Scenario: Dateless comparison keeps the dates of pre-existing revisions

- **GIVEN** a revised input holding an insertion with its own `w:date`
- **WHEN** it is compared with `date: null`
- **THEN** that insertion SHALL keep its `w:date`

#### Scenario: Dateless comparison projects exactly like a dated comparison

- **GIVEN** the same pair compared dated and with `date: null`
- **WHEN** Accept All and Reject All are applied
- **THEN** the projections SHALL be identical

#### Scenario: An omitted or explicit date still stamps comparison revisions

- **GIVEN** a pair
- **WHEN** it is compared without `date` or with an explicit `Date`
- **THEN** revisions SHALL carry the current time or that `Date` respectively
