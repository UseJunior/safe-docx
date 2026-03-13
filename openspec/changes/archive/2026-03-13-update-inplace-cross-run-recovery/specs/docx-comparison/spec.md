## ADDED Requirements
### Requirement: Inplace Reconstruction Cross-Run Recovery
The atomizer comparison pipeline SHALL evaluate cross-run inplace reconstruction passes before using rebuild fallback when `reconstructionMode` is `inplace`.

#### Scenario: Cross-run pass rescues inplace output
- **GIVEN** a run-fragmented document pair where no-cross-run inplace passes fail round-trip safety
- **WHEN** cross-run inplace passes are evaluated
- **THEN** the pipeline SHALL keep `reconstructionModeUsed` as `inplace` if any cross-run pass satisfies all safety checks
- **AND** tracked output SHALL avoid rebuild fallback-driven structure loss

#### Scenario: Rebuild fallback only after all inplace passes fail
- **GIVEN** all inplace passes (no-cross-run and cross-run) fail at least one safety check
- **WHEN** comparison completes
- **THEN** the pipeline SHALL use `reconstructionModeUsed: rebuild`
- **AND** `fallbackReason` SHALL be `round_trip_safety_check_failed`

#### Scenario: Table-heavy run-fragmented templates preserve tracked table structure
- **GIVEN** table-heavy OpenAgreements templates with differing run segmentation across original and revised documents
- **WHEN** a small text edit is applied and tracked output is downloaded with `fail_on_rebuild_fallback: true`
- **THEN** download SHALL succeed without rebuild fallback
- **AND** tracked output SHALL preserve table structure (`w:tbl` remains present)
