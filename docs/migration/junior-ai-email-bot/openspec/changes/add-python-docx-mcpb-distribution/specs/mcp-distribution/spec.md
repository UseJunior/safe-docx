## ADDED Requirements

### Requirement: Primitives Protocol Layer

The system SHALL define a primitives abstraction layer using typing.Protocol that enables both Aspose.Words and python-docx/lxml backends.

#### Scenario: Composed protocols provide granular interfaces

- **WHEN** the primitives layer is implemented
- **THEN** it SHALL define composed protocols: NodeProtocol, CompositeNodeProtocol, FormattableProtocol, RunProtocol, ParagraphProtocol, FontProtocol, DocumentProtocol, BookmarkProtocol
- **AND** protocols SHALL use typing.Protocol for structural subtyping

#### Scenario: Pure Python types are library-independent

- **WHEN** types.py is defined
- **THEN** it SHALL contain NodeType enum, UnderlineType enum, Color dataclass
- **AND** types SHALL NOT depend on Aspose or OOXML constants

#### Scenario: Single factory selects backend

- **WHEN** `get_backend()` is called
- **THEN** it SHALL return the implementation based on `DOCUMENT_BACKEND` environment variable
- **AND** default SHALL be "aspose" for backwards compatibility
- **AND** backend selection SHALL occur at startup only

### Requirement: lxml OOXML Manipulation Layer

The system SHALL provide generic lxml operations for OOXML manipulation, separate from the protocol layer.

#### Scenario: Central namespace constants

- **WHEN** ooxml/namespaces.py is defined
- **THEN** it SHALL contain NSMAP and all W_* constants (W_P, W_R, W_T, etc.)
- **AND** constants SHALL be the single source of truth for namespace URIs

#### Scenario: Generic bookmark XML operations

- **WHEN** bookmark operations are performed via lxml
- **THEN** insert_bookmark_xml() SHALL insert w:bookmarkStart and w:bookmarkEnd
- **AND** remove_bookmark_xml() SHALL remove both start and end elements
- **AND** find_paragraph_by_bookmark() SHALL return the paragraph element

#### Scenario: Eager bookmark ID allocation

- **WHEN** a document is loaded
- **THEN** BookmarkIdAllocator SHALL scan all existing bookmark IDs
- **AND** subsequent allocate_id() calls SHALL return unique IDs in O(1)

#### Scenario: Generic node operations

- **WHEN** node manipulation is needed
- **THEN** insert_before_xml(), insert_after_xml(), clone_node_xml(), remove_node_xml() SHALL be available
- **AND** operations SHALL work on raw lxml Elements

### Requirement: Field Handling with Full Parity

The system SHALL handle Word fields (TOC, cross-references, is_dirty) with parity for fields actually used in the codebase.

#### Scenario: XPath-based field parsing

- **WHEN** extract_visible_text() is called on a paragraph
- **THEN** it SHALL correctly handle FIELD_START, FIELD_SEPARATOR, FIELD_END
- **AND** SHALL support arbitrary nesting depth
- **AND** SHALL use XPath for efficient traversal

#### Scenario: is_dirty flag support

- **WHEN** is_field_dirty() is called
- **THEN** it SHALL return the field's dirty state
- **AND** behavior SHALL match Aspose implementation

### Requirement: python-docx/lxml Hybrid Implementation

The docx backend SHALL use python-docx for standard operations and lxml for advanced features.

#### Scenario: python-docx for document I/O

- **WHEN** DocxDocument.load() is called
- **THEN** it SHALL use python-docx to open the document
- **AND** SHALL initialize BookmarkIdAllocator from the document body

#### Scenario: lxml for run/font manipulation

- **WHEN** advanced font properties are needed
- **THEN** DocxFont SHALL fall back to lxml if python-docx doesn't support the property
- **AND** run text manipulation SHALL use lxml for direct XML access

#### Scenario: Thin wrappers delegate to XML layer

- **WHEN** DocxParagraph.insert_bookmark() is called
- **THEN** it SHALL delegate to insert_bookmark_xml() from the OOXML layer
- **AND** SHALL pass the BookmarkIdAllocator for ID allocation

### Requirement: Equivalence Testing

The system SHALL have comprehensive equivalence tests proving python-docx backend matches Aspose behavior.

#### Scenario: Parameterized tests run both backends

- **WHEN** equivalence tests are run
- **THEN** pytest.mark.parametrize SHALL run each test with both "aspose" and "docx"
- **AND** same assertions SHALL pass for both backends

#### Scenario: Text and formatting comparison

- **WHEN** comparing backend outputs
- **THEN** comparison SHALL be at text + formatting level (not XML structure)
- **AND** targeted XML structure assertions SHALL verify bookmark integrity

#### Scenario: Document validation defense in depth

- **WHEN** documents are saved
- **THEN** python-docx reload test SHALL verify no corruption
- **AND** LibreOffice headless validation SHALL be available for CI

### Requirement: Module Migration

All high-level modules SHALL be migrated to use primitives instead of direct Aspose imports.

#### Scenario: Surgeon migration with feature flag

- **WHEN** surgeon.py is migrated
- **THEN** all Aspose imports SHALL be replaced with primitives
- **AND** migration SHALL be all-at-once with DOCUMENT_BACKEND for rollback

#### Scenario: Full test pass required

- **WHEN** switching default backend to docx
- **THEN** 100% of existing tests MUST pass
- **AND** any failures SHALL block the switch

### Requirement: CI Enforcement

CI SHALL enforce that Aspose is only imported in allowed files.

#### Scenario: Import check fails on violations

- **WHEN** a PR adds `import aspose` outside aspose_impl.py
- **THEN** CI check SHALL fail
- **AND** PR SHALL be blocked until fixed

### Requirement: Shared Utils Module

Shared helper functions SHALL live in a separate utils module using composition over inheritance.

#### Scenario: Stateless helper functions

- **WHEN** both implementations need shared logic
- **THEN** utils.py SHALL provide stateless functions (parse_hex_color, normalize_font_name)
- **AND** neither implementation SHALL inherit from a base class

### Requirement: Error Handling

Operations that cannot be performed SHALL return degraded results instead of raising exceptions.

#### Scenario: Degraded result on failure

- **WHEN** an operation cannot be performed
- **THEN** it SHALL return a result with success=False and warning message
- **AND** callers SHALL handle gracefully without try/except

## MODIFIED Requirements

### Requirement: MCPB Package Structure

The Junior Document Editor SHALL be distributable as an MCPB package with full feature parity.

#### Scenario: Package uses primitives with docx backend

- **WHEN** the MCPB package is installed
- **THEN** it SHALL use the primitives layer with DOCUMENT_BACKEND=docx
- **AND** SHALL have identical capabilities to the Aspose version

#### Scenario: Build copies primitives layer

- **WHEN** `mcpb pack` is run
- **THEN** primitives layer SHALL be copied to mcpb/server/shared/
- **AND** resulting package SHALL be self-contained

#### Scenario: Dependencies are open-source

- **WHEN** pyproject.toml is parsed
- **THEN** dependencies SHALL include `python-docx`, `lxml`, `mcp`
- **AND** SHALL NOT include `aspose-words`

### Requirement: Formatting Preservation

Text replacement operations SHALL preserve formatting at the same level as the current Aspose implementation.

#### Scenario: Full formatting preservation

- **GIVEN** text with inline formatting (bold, italic, underline)
- **WHEN** find/replace is performed
- **THEN** formatting SHALL be preserved
- **AND** behavior SHALL be identical between Aspose and docx backends

## REMOVED Requirements

### Requirement: Degraded python-docx Adapter

~~The system SHALL provide a DocxAdapter with reduced capabilities compared to AsposeAdapter.~~

**Reason:** Strangler fig approach achieves full feature parity by replacing only primitives.

### Requirement: DocumentAdapter Protocol

~~The system SHALL define a DocumentAdapter Protocol that abstracts document manipulation operations.~~

**Reason:** Replaced by more granular composed protocols (NodeProtocol, ParagraphProtocol, etc.) in the primitives layer.

### Requirement: TextReplacer Utility

~~Text replacement logic SHALL be separated into a dedicated TextReplacer utility.~~

**Reason:** Text replacement stays in surgeon.py; only low-level primitives are abstracted.
