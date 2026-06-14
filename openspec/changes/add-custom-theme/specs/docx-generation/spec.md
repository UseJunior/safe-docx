## ADDED Requirements

### Requirement: Custom theme and theme-relative colors

`generateDocx` SHALL accept an optional partial document theme that overrides
canonical theme color slots and latin major/minor fonts, and SHALL allow runs
and table-cell shading to reference the supported theme color slots without
requiring literal hex colors at each authoring site.

#### Scenario: [SDX-GEN-107] custom theme slots drive theme-relative authoring
- **GIVEN** a document spec with `theme.colors.accent1` set to a custom six-digit hex value
- **WHEN** the document spec is compiled
- **THEN** `word/theme/theme1.xml` SHALL contain that value in the `accent1` color slot
- **AND** a run authored with `themeColor: "accent1"` SHALL emit `w:color` with `w:themeColor="accent1"`
- **AND** a table cell authored with a theme fill SHALL emit `w:shd` with the matching theme-fill attribute
- **AND** compiling without `spec.theme` SHALL preserve the canonical default theme output
- **AND** invalid theme color slots or specs that set both literal and theme-relative colors for the same run or cell SHALL be rejected before emission
