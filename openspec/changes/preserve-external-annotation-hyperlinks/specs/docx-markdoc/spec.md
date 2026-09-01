## ADDED Requirements

### Requirement: External annotation hyperlink fidelity

The annotation importer SHALL resolve each relationship-backed external
`w:hyperlink` against the owning comment or footnote relationship part and
retain its destination explicitly on every canonical run inside the wrapper.
Canonical Markdoc SHALL serialize and parse that destination without inferring
link identity from formatting. Comment and footnote projection SHALL emit a
valid hyperlink wrapper plus a collision-free external hyperlink relationship
in the destination part while retaining visible text and all admitted run
formatting.

Internal anchor hyperlinks, bookmark markers, unsupported wrapper contents,
and missing, dangling, mistyped, non-external, or malformed relationships SHALL
fail closed with stable actionable diagnostics.

#### Scenario: [SDX-MDOC-104] comment and footnote links survive every projection

- **GIVEN** a comment or footnote body containing a relationship-backed external hyperlink with mixed run formatting
- **WHEN** the annotation is imported, serialized to Markdoc, parsed, and projected as either a comment or a footnote
- **THEN** the canonical runs and output package SHALL retain the exact destination, visible text, named character style, and direct half-point size
- **AND** the output hyperlink relationship SHALL belong to the destination annotation part with `TargetMode="External"`

#### Scenario: [SDX-MDOC-105] relationship allocation is deterministic and collision-free

- **GIVEN** multiple annotation hyperlinks with repeated destinations and destination relationship parts containing pre-existing IDs of any relationship type
- **WHEN** annotations are projected
- **THEN** repeated destinations SHALL resolve deterministically without duplicating semantic link targets
- **AND** each new relationship ID SHALL be unique within its destination relationship part
- **AND** source relationship IDs SHALL NOT be assumed reusable

#### Scenario: [SDX-MDOC-106] invalid external hyperlink structures fail closed

- **GIVEN** an annotation hyperlink with a missing or dangling ID, wrong relationship type, missing or non-external target mode, empty target, or unsupported wrapper child
- **WHEN** annotations are imported
- **THEN** import SHALL fail with `ANNOTATION_IMPORT_UNSUPPORTED`
- **AND** the diagnostic SHALL identify the annotation and stable reason plus relevant relationship details

#### Scenario: [SDX-MDOC-107] internal navigation stays unsupported

- **GIVEN** an annotation body containing `w:hyperlink w:anchor`, `w:bookmarkStart`, or `w:bookmarkEnd`
- **WHEN** annotations are imported
- **THEN** import SHALL fail explicitly at that internal navigation structure
- **AND** no navigation markup SHALL be silently discarded
