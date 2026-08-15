## ADDED Requirements

### Requirement: Field comparison claims have a local Aspose differential oracle

The repository SHALL provide a local-only Aspose.Words differential oracle for pinned complex-field comparison
pairs. The oracle SHALL classify whether a comparison replaces the whole field or preserves the field scaffolding
and redlines only its cached result. Microsoft Word SHALL remain the primary behavioral oracle; Aspose verdicts
SHALL be treated as corroborating evidence, and divergences SHALL be recorded explicitly rather than hidden.

The local driver SHALL use explicit developer-provided Aspose runtime and license configuration, SHALL skip cleanly
when that configuration is absent, SHALL fail loudly when an explicitly attempted run is invalid, and SHALL NOT
copy license data into the repository, logs, snapshots, or CI artifacts. CI SHALL NOT execute or install Aspose;
it SHALL validate a checked-in deterministic JSON snapshot containing the exact oracle version, fixture hashes,
result revision text, and structural verdicts. CI SHALL reproduce the fixture hashes and SHALL reject a no-op
projection as cached-result-only evidence. The repository SHALL document one command for refreshing that snapshot
locally. Manually inspected full-document observations SHALL be dated separately so refreshing reduced fixtures
cannot silently restamp evidence that was not rerun.

#### Scenario: [ASPOSE-FIELD-01] Instruction changes replace the complete complex field

- **GIVEN** pinned FORMCHECKBOX-to-FORMTEXT, HYPERLINK-retarget, and PAGEREF-retarget fixture pairs
- **WHEN** the local oracle snapshot is refreshed with Aspose.Words 25.10
- **THEN** each verdict records whole-field replacement, including deleted and inserted field-character scaffolding, matching the measured Microsoft Word behavior

#### Scenario: [ASPOSE-FIELD-02] A cached-result-only change preserves field scaffolding

- **GIVEN** a pinned NUMPAGES fixture whose instruction is unchanged and whose cached result changes from `3` to `4`
- **WHEN** the local oracle snapshot is refreshed with Aspose.Words 25.10
- **THEN** the verdict records preserved field characters and instruction text with only the cached result redlined, matching the measured Microsoft Word behavior

#### Scenario: [ASPOSE-FIELD-03] CI validates evidence without Aspose or its license

- **GIVEN** the checked-in deterministic verdict snapshot and its source fixtures
- **WHEN** the normal test suite runs without an Aspose runtime or license
- **THEN** it validates the snapshot schema, oracle version, fixture hashes, and pinned verdicts without importing Aspose, reading a license, or attempting oracle execution

#### Scenario: [ASPOSE-FIELD-04] Local oracle configuration has a fail-closed trust boundary

- **GIVEN** no local Aspose configuration, or an explicitly configured but invalid runtime or license path
- **WHEN** a developer invokes the oracle refresh command
- **THEN** absent configuration produces a clear non-mutating skip, while invalid attempted configuration fails with sanitized diagnostics and leaves the checked-in snapshot unchanged

#### Scenario: [ASPOSE-FIELD-05] The ILPA trust boundary records agreement and divergence

- **GIVEN** the pinned ILPA original/revised pair and the measured Microsoft Word 16.112 and Aspose.Words 25.10 outputs
- **WHEN** the checked-in trust-boundary snapshot is validated
- **THEN** it records agreement on whole-field deletion, the §14.7.1 parenthetical-enumerator boundary, and the §15.5.5 bold-to-not-bold `rPrChange`; records the manual-oracle document-wide `rPrChange` counts as Word 34 and Aspose 31; keeps safe-docx behavior asserted structurally by the reproducible comparison suite rather than pinned as a self-measurement; and records that Aspose is more surgical than Word at `Giveback),` while Word remains authoritative
