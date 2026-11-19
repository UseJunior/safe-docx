## ADDED Requirements

### Requirement: Session selective revision preservation policy
The server SHALL model ordinary mode and selective-preservation mode explicitly,
separating policy from last-action diagnostics. Only a successful selective
resolution that changes document contents SHALL publish preservation mode and its
action together with the changed document. Ordinary edits, non-revision edits,
global acceptance and exports SHALL retain preservation mode for the session.
A genuinely new or reopened session SHALL start in ordinary mode; the policy
SHALL NOT add persisted DOCX metadata.

#### Scenario: Selective preservation remains sticky across later edits and saves
- **WHEN** a selective resolution changes the document and later ordinary edits or saves occur
- **THEN** clean or both export SHALL require allow_discard_preserved_revisions when remaining AI revisions exist in the captured document
- **AND** tracked export SHALL preserve the remaining human and AI revision set
- **AND** acknowledgement SHALL affect only that export, leaving live policy and XML unchanged

#### Scenario: Complete resolution and subsequent AI edits
- **WHEN** all AI revisions have been resolved but third-party revisions remain
- **THEN** clean export SHALL succeed while preserving third-party history
- **AND** subsequent AI revisions SHALL again require acknowledgement for clean export

#### Scenario: Failed and no-op selections do not publish policy
- **WHEN** selective resolution fails, resolves no IDs, or selects only unresolved markup without changing XML
- **THEN** document, counters, policy, extraction cache and save cache SHALL remain unchanged

#### Scenario: Save captures policy and document generation together
- **WHEN** a mutation overlaps a cached or fresh save export
- **THEN** the response and artifacts SHALL use the captured generation and policy
- **AND** stale exports SHALL NOT repopulate the live save cache
- **AND** selective_revision_action SHALL retain only tool, selector, selectedRevisionIds and editRevision
