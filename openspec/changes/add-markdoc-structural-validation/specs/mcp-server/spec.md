## ADDED Requirements

### Requirement: Editing tools surface structural placement warnings

Applicable paragraph insertion and restructuring tools SHALL expose structural diagnostics derived from the same product-neutral validators used by Markdoc.

#### Scenario: Unsafe insertion returns corrective guidance

- **GIVEN** an insertion request that would slice a parent from existing descendants
- **WHEN** the tool resolves the requested anchor and intended hierarchy
- **THEN** the tool response SHALL identify the unsafe relationship
- **AND** SHALL include a deterministic suggested anchor when available
