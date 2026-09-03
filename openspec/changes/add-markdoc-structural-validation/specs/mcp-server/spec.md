## ADDED Requirements

### Requirement: Editing tools surface structural placement warnings

Applicable paragraph insertion and restructuring tools SHALL expose structural diagnostics derived from the same product-neutral validators used by Markdoc.

#### Scenario: Unsafe insertion returns corrective guidance

- **GIVEN** an insertion request that would slice a parent from existing descendants
- **WHEN** the tool resolves the requested anchor and intended hierarchy
- **THEN** the tool response SHALL identify the unsafe relationship
- **AND** SHALL include a deterministic suggested anchor when available

#### Scenario: Atomic bonded pair shares one insertion slot

- **GIVEN** exactly two batch insertion steps declare one bonded-pair identity, one anchor and position, and distinct source-proven heading/body peers
- **WHEN** the requested operation order yields heading followed by body
- **THEN** the batch SHALL permit the shared slot and apply both steps atomically
- **AND** an unrelated third insertion at that slot SHALL remain a hard conflict
