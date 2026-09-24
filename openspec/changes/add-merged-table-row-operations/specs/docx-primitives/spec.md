## ADDED Requirements

### Requirement: Merge-aware table row edits require explicit opt-in

Row insertion and deletion invoked without an explicit merge-aware opt-in SHALL reject a target table containing `w:gridSpan` or `w:vMerge` before mutation. Adding a logical occupancy inventory SHALL NOT relax this compatibility boundary implicitly.

#### Scenario: [SDX-MERGEDROW-GUARD-01] default row edits still refuse merged tables
- **GIVEN** a valid body-level table with a vertical merge or horizontal span
- **WHEN** a caller requests row insertion or deletion without a merge-aware opt-in
- **THEN** the operation SHALL fail with `UNSUPPORTED_EDIT` and a coordinate-level feature diagnostic
- **AND** serialized XML and the revision-ID state SHALL remain unchanged
