# Document Traceability Capability

## ADDED Requirements

### Requirement: Metadata Embedding

The system SHALL embed traceability metadata directly in DOCX files using custom XML parts.

#### Scenario: Embed metadata in document

- **GIVEN** a document with applied edits
- **AND** an `EditCorrelationContext` for each edit
- **WHEN** metadata is embedded
- **THEN** a custom XML part SHALL be added to the DOCX
- **AND** the XML SHALL use namespace "http://junior.ai/traceability/v1"

#### Scenario: Update existing metadata

- **GIVEN** a document with existing embedded metadata
- **WHEN** new edits are applied and metadata is embedded
- **THEN** the existing metadata SHALL be replaced
- **AND** revision history SHALL be preserved

#### Scenario: Metadata includes version

- **GIVEN** metadata is embedded
- **WHEN** the XML is examined
- **THEN** a version element SHALL be present
- **AND** the version SHALL be "1.0"

---

### Requirement: Metadata Extraction

The system SHALL extract traceability metadata from DOCX files.

#### Scenario: Extract from document with metadata

- **GIVEN** a document with embedded Junior AI metadata
- **WHEN** metadata is extracted
- **THEN** a `TraceabilityMetadata` object SHALL be returned
- **AND** all revisions SHALL be deserialized

#### Scenario: Extract from document without metadata

- **GIVEN** a document without Junior AI custom XML
- **WHEN** metadata is extracted
- **THEN** None SHALL be returned

#### Scenario: Handle malformed metadata

- **GIVEN** a document with corrupted or invalid XML
- **WHEN** metadata extraction is attempted
- **THEN** an error SHALL be logged
- **AND** None SHALL be returned

---

### Requirement: Document Hash Calculation

The system SHALL calculate a hash of document content for integrity verification.

#### Scenario: Calculate hash

- **GIVEN** a document
- **WHEN** the hash is calculated
- **THEN** a SHA-256 hash SHALL be returned
- **AND** the hash SHALL be prefixed with "sha256:"

#### Scenario: Hash excludes metadata

- **GIVEN** a document with embedded metadata
- **WHEN** the hash is calculated
- **THEN** the custom XML metadata SHALL be excluded
- **AND** only document content SHALL be hashed

#### Scenario: Hash is deterministic

- **GIVEN** the same document content
- **WHEN** the hash is calculated multiple times
- **THEN** the same hash SHALL be returned each time

---

### Requirement: Hash Verification

The system SHALL verify document integrity by comparing stored and actual hashes.

#### Scenario: Verify unmodified document

- **GIVEN** a document with embedded metadata and hash
- **AND** the document has not been modified
- **WHEN** verification is performed
- **THEN** status SHALL be "valid"
- **AND** `is_valid` SHALL be true

#### Scenario: Detect external modification

- **GIVEN** a document with embedded metadata and hash
- **AND** the document was edited outside the system
- **WHEN** verification is performed
- **THEN** status SHALL be "mismatch"
- **AND** `was_modified_externally` SHALL be true

#### Scenario: Handle missing hash

- **GIVEN** a document with metadata but no stored hash
- **WHEN** verification is performed
- **THEN** status SHALL be "no_hash"

---

### Requirement: Issues List Reconstruction

The system SHALL reconstruct the Issues List from embedded document metadata.

#### Scenario: Reconstruct from metadata

- **GIVEN** a document with embedded metadata containing 5 issues list rows
- **WHEN** reconstruction is performed
- **THEN** 5 `IssueListItem` objects SHALL be returned
- **AND** each item SHALL include index, status, and description

#### Scenario: Reconstruct with revision references

- **GIVEN** an issues list row with revision_ref "rev_001"
- **AND** a revision with id "rev_001" containing instruction text
- **WHEN** reconstruction is performed
- **THEN** the instruction SHALL be included in the reconstructed item

#### Scenario: Handle missing metadata

- **GIVEN** a document without embedded metadata
- **WHEN** reconstruction is attempted
- **THEN** an empty list SHALL be returned

---

### Requirement: Shadow Database Fallback

The system SHALL maintain a shadow database for metadata recovery.

#### Scenario: Store shadow metadata

- **GIVEN** traceability metadata and document hash
- **WHEN** shadow storage is invoked
- **THEN** the metadata SHALL be stored keyed by document hash

#### Scenario: Retrieve shadow metadata

- **GIVEN** a document hash with stored shadow metadata
- **WHEN** retrieval is invoked
- **THEN** the corresponding metadata SHALL be returned

#### Scenario: Fallback when embedded missing

- **GIVEN** a document without embedded metadata
- **AND** shadow metadata exists for the document's hash
- **WHEN** metadata with fallback is requested
- **THEN** the shadow metadata SHALL be returned

#### Scenario: No fallback available

- **GIVEN** a document without embedded metadata
- **AND** no shadow metadata exists
- **WHEN** metadata with fallback is requested
- **THEN** None SHALL be returned

---

### Requirement: Revision Metadata Structure

The system SHALL store structured revision information in embedded metadata.

#### Scenario: Revision includes source information

- **GIVEN** an edit from email line 10
- **WHEN** revision metadata is created
- **THEN** source type SHALL be "email"
- **AND** source location_type SHALL be "line"
- **AND** source location_index SHALL be 10

#### Scenario: Revision includes multiple sources

- **GIVEN** an edit with instruction from email and precedent from attachment
- **WHEN** revision metadata is created
- **THEN** sources list SHALL contain 2 entries
- **AND** both sources SHALL have appropriate type and location

#### Scenario: Revision includes instruction text

- **GIVEN** an edit with instruction "Change cap to $5M"
- **WHEN** revision metadata is created
- **THEN** instruction field SHALL be "Change cap to $5M"

---

### Requirement: XML Serialization

The system SHALL serialize and deserialize metadata to/from XML.

#### Scenario: Serialize to XML

- **GIVEN** a `TraceabilityMetadata` object
- **WHEN** serialization is invoked
- **THEN** valid XML SHALL be returned
- **AND** the XML SHALL conform to the Junior AI traceability schema

#### Scenario: Deserialize from XML

- **GIVEN** valid Junior AI traceability XML
- **WHEN** deserialization is invoked
- **THEN** a `TraceabilityMetadata` object SHALL be returned
- **AND** all fields SHALL be populated correctly

#### Scenario: Round-trip preservation

- **GIVEN** a `TraceabilityMetadata` object
- **WHEN** serialized to XML and back
- **THEN** the resulting object SHALL be equivalent to the original
