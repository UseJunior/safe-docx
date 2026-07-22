## MODIFIED Requirements

### Requirement: Inplace Reconstruction Cross-Run Recovery
The atomizer comparison pipeline SHALL evaluate cross-run inplace reconstruction passes before using rebuild fallback when `reconstructionMode` is `inplace`, and SHALL report which inplace pass produced the output.

The pipeline evaluates inplace passes in a fixed order — `inplace_word_split`, `inplace_run_level`, `inplace_word_split_cross_run`, `inplace_run_level_cross_run` — selecting the first whose reconstruction satisfies every round-trip safety check. The cross-run passes are a safety net for run-fragmented documents that the no-cross-run passes cannot reconstruct safely.

As of this change that safety net is not reachable by any known input: `inplace_run_level` deletes and re-inserts whole runs, which preserves normalized text by construction, so it satisfies the round-trip text checks on every case that `inplace_word_split` fails — the cross-run passes are therefore never the selected rescuer. A prior "Cross-run pass rescues inplace output" scenario asserted that unreachable branch and could not be honestly mapped to a test; it is reclassified here as a documented residual rather than a routinely-exercised path. The general recovery guarantee is preserved by the "Rebuild fallback only after all inplace passes fail" scenario, which requires the cross-run passes to be evaluated before any rebuild fallback. Reachability of the cross-run passes (candidate dead code superseded by `inplace_word_split` / premerge improvements) is tracked as an engine follow-up. See #469.

#### Scenario: Inplace reconstruction reports the pass that produced the output
- **GIVEN** a run-fragmented document pair compared with `reconstructionMode: inplace` whose first inplace pass fails a round-trip safety check
- **WHEN** a later inplace pass satisfies every safety check and is selected
- **THEN** the result SHALL report `inplaceSuccessDiagnostics.passUsed` naming the selected pass
- **AND** `inplaceSuccessDiagnostics.precedingFailedAttempts` SHALL list every earlier pass that failed a safety check, in evaluation order

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
