## ADDED Requirements

### Requirement: ODF session paragraph identity
The ODF provider SHALL assign initial `p0..pN-1` paragraph IDs in stored document order, retain existing element identities throughout a session, and allocate new IDs monotonically. Internal transaction forks SHALL preserve both identity maps and allocator state. No paragraph identity markup SHALL be added to ODF. Actual reopen SHALL deterministically renumber stored order.

ODF `insert_paragraph` SHALL retain existing response keys and report `invalidates_paragraph_ids_after: null` and `requires_reread_before_next_edit: false`. Reads, grep, comments and edits SHALL use the same session mapping.

#### Scenario: [OSID-01] Retained anchors survive transactional insertions
- **WHEN** paragraphs are inserted before and after existing anchors and subsequent MCP mutations fork the document
- **THEN** reads, grep, comments and edits still resolve every retained ID to its original paragraph and new IDs increase monotonically

#### Scenario: [OSID-02] Failed insertion leaves active identities intact
- **WHEN** a mutation fails after allocating candidate paragraph IDs
- **THEN** the active contents, identities and allocator remain unchanged and the next successful insertion uses the next active ID

#### Scenario: [OSID-03] Reopen renumbers only stored order
- **WHEN** an edited ODF document is saved and opened in a new session
- **THEN** paragraphs and comments receive IDs in stored document order without identity markup being added to the file
