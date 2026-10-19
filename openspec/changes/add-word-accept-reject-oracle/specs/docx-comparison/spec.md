## ADDED Requirements

### Requirement: A local Microsoft Word oracle checks Accept All and Reject All against Word

The repository SHALL provide an opt-in developer command, `npm run oracle:word:accept-reject`, that resolves
tracked documents with Microsoft Word for Mac (Accept All and Reject All, then Save As) and compares Word's
saved output with safe-docx's own appliers: docx-core `acceptChanges`/`rejectChanges` and docx-compare
`acceptAllChanges`/`rejectAllChanges`.

The comparison SHALL be a projection of what a reader sees, not a byte diff: the number of live sections
(excluding `w:sectPrChange` snapshots); each section's page size, margins and `w:titlePg`; each section's
header and footer bindings for the default, first and even types, resolved to the bound part's text with
linked-to-previous inheritance; the text of every body paragraph in order; and the number of tracked
revisions left. Page setup that is absent on one side SHALL be reported as a note, not a mismatch, because
Word writes defaults on save.

The command SHALL ship committed generators for the #1188 section-boundary matrix and the #1144 part A
round-trip pairs, and SHALL accept external documents. For a round-trip pair it SHALL produce the redline
with `compareDocuments` and SHALL also require Word's Accept All to reproduce the revised document and its
Reject All the original.

The command SHALL stage every file it gives Word inside Word's sandbox container, SHALL bound every Word call
with a timeout and report a stalled call instead of hanging, SHALL close only the documents it opened, SHALL
never quit Word, and SHALL serialize concurrent runs on a lockfile. It SHALL skip with a clear message and a
zero exit status in CI, on platforms other than macOS, and when Word or the Automation permission is missing.
It SHALL NOT run as part of `npm test` or CI. Word output is behavioral reference evidence, not the normative
definition of ECMA-376 conformance.

#### Scenario: [WORD-AR-ORACLE-01] Our appliers match Word on every matrix fixture in both modes

- **GIVEN** the 30 generated #1188 section-boundary fixtures and a Word host that may be automated
- **WHEN** the developer runs `npm run oracle:word:accept-reject -- --suite matrix`
- **THEN** each fixture is resolved by Word with Accept All and with Reject All, and for each of the 60 units the docx-core and docx-compare projections equal Word's

#### Scenario: [WORD-AR-ORACLE-02] A round-trip pair resolves back to its sides in Word and in our appliers

- **GIVEN** an original and a revised document that differ by a paragraph-level section break
- **WHEN** the oracle compares them with `compareDocuments` and resolves the redline in Word and in both appliers
- **THEN** Word's Accept All projects equal to the revised document, its Reject All projects equal to the original, and both appliers project equal to Word's output in each mode

#### Scenario: [WORD-AR-ORACLE-03] A divergence is reported with its path and fails the run

- **GIVEN** an applier whose output differs from Word's, for example a missing header binding on a surviving section
- **WHEN** the oracle compares the projections
- **THEN** the report names the unit, the applier and the differing path with Word's value and ours, and the command exits non-zero unless that unit is listed as a known divergence

#### Scenario: [WORD-AR-ORACLE-04] The command skips cleanly where Word cannot be driven

- **GIVEN** CI is set, or the platform is not macOS, or Word is not installed, or the terminal lacks the Automation permission for Word
- **WHEN** the developer runs the command
- **THEN** it prints why it skipped and exits 0 without driving Word (or exits 3 with `--strict`)

#### Scenario: [WORD-AR-ORACLE-05] A Word call that does not answer is reported as a stall

- **GIVEN** Word does not answer an Accept/Reject call within the timeout, for example because a dialog is open
- **WHEN** the call times out and its single retry also times out
- **THEN** the oracle kills only the osascript process it started, closes only this run's documents, reports the unit as a STALL error, and exits 2
