## ADDED Requirements

### Requirement: Contract Surface Classification

Every MCP tool SHALL declare a contract-surface classification of its writes:
`revisionable` (AI-attributed writes emit native OOXML tracked-change markup),
`package-mutation` (writes mutate package-level parts with no native revision
wrapper), or `internal` (read-only utilities, tracked-change consumers, and
derived-output tools). The classification SHALL be advertised in the tool's
description and in the exported tool metadata, and SHALL mirror the ratified
inventory in `packages/docx-core/SUPPORT.md`.

A tool MAY be `revisionable` and also mutate package parts; such tools SHALL set
`emitsNonRevisionChanges` and record manifest entries for the untracked portion.

#### Scenario: every tool declares a contract surface
- **GIVEN** the MCP tool catalog is loaded
- **WHEN** each tool is inspected
- **THEN** every tool SHALL declare a surface of `revisionable`, `package-mutation`, or `internal`
- **AND** the dual-surface tools that also record non-revision changes SHALL be exactly `add_comment`, `delete_comment`, and `add_footnote`

#### Scenario: revisionable edit tools emit valid AI tracked changes
- **GIVEN** an AI-authored session over a document
- **WHEN** a fresh-emission revisionable edit tool performs a write
- **THEN** the write SHALL succeed
- **AND** the resulting document SHALL contain at least one AI-authored tracked-change element
- **AND** AI revision validation SHALL report no errors

#### Scenario: revisionable edits produce no untracked AI body content
- **GIVEN** an AI-authored session over a single paragraph
- **WHEN** `replace_text` rewrites text under the AI actor
- **THEN** the inserted text SHALL appear only inside a `w:ins` tracked-change wrapper
- **AND** no AI-introduced text SHALL remain as a bare untracked run in the body

### Requirement: Non-Revision Change Manifest

The MCP server SHALL maintain a per-session manifest of package-level
(non-revision) mutations — writes whose effect is not, and cannot be, captured by
OOXML tracked-change markup. Dual-surface tools SHALL record an entry naming the
package parts they mutated, and the `save` report SHALL surface the manifest as
`non_revision_changes` so those mutations are accounted for rather than landing
silently.

#### Scenario: comment side-part writes are recorded in the save manifest
- **GIVEN** an AI-authored session in which a comment has been added
- **WHEN** the document is saved
- **THEN** the save report SHALL include a non-revision change entry for `add_comment`
- **AND** the entry SHALL name `word/comments.xml` among the mutated parts

#### Scenario: footnote part creation is recorded in the save manifest
- **GIVEN** an AI-authored session in which a footnote has been added
- **WHEN** the document is saved
- **THEN** the save report SHALL include a non-revision change entry for `add_footnote`
- **AND** the entry SHALL name `word/footnotes.xml` among the mutated parts

#### Scenario: tracked-only edits report no non-revision changes
- **GIVEN** an AI-authored session in which only a body text edit was performed
- **WHEN** the document is saved
- **THEN** the save report SHALL NOT include a non-revision change manifest
