## ADDED Requirements

### Requirement: Comparison revisions may omit w:date

`compareDocuments` SHALL accept `date: null` and SHALL then write no `w:date`
attribute on any revision it creates, in every story part. Revisions present in
an input SHALL keep their own `w:date`. An omitted `date` SHALL stamp revisions
with the current time, and a `Date` SHALL stamp them with that time.

#### Scenario: Dateless comparison omits w:date from every revision it creates

- **GIVEN** a pair with body, footnote, endnote, footer and move changes
- **WHEN** it is compared with `date: null`
- **THEN** no story part SHALL contain a generated `w:date`
- **AND** the output SHALL equal the dated output with `w:date` removed, with the same revision count

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
