## ADDED Requirements

### Requirement: DOCX Document Properties Read Tool
The Safe-DOCX MCP server SHALL provide a read-only DOCX `get_document_properties`
tool that returns the core properties of the Core Properties part and the
extended properties of the Extended File Properties part, each part located
through the package relationships.

#### Scenario: Document properties are read from the related parts
- **WHEN** `get_document_properties` is called for a DOCX whose parts are related from `_rels/.rels`
- **THEN** the response SHALL list every core property (title, subject, creator, keywords, description, category, content_status, language, identifier, version, last_modified_by, revision, created, modified, last_printed) and extended property (application, app_version, company, manager, template) with its text, or null when absent
- **AND** it SHALL name the parts in `core_part` and `app_part`, null for a part the package does not have
- **AND** reading SHALL NOT change the package or the session's edit count

### Requirement: DOCX Document Properties Write Tool
The Safe-DOCX MCP server SHALL provide a DOCX `set_document_properties` tool
that sets or removes properties from a closed set: core title, subject,
creator, keywords, description, category, content_status, language,
last_modified_by, revision, created and modified, and extended application,
app_version, company, manager and template. A string SHALL set a property,
null SHALL remove its element, and an omitted key SHALL leave it unchanged.

#### Scenario: Properties are set and removed in place
- **GIVEN** a DOCX with core and extended property parts
- **WHEN** `set_document_properties` sets core and extended values and removes `application`
- **THEN** the parts SHALL hold the new values, `created` and `modified` with `xsi:type="dcterms:W3CDTF"`, and no `Application` element
- **AND** a value with XML markup characters SHALL be stored escaped and read back unchanged
- **AND** the response SHALL report `changed: true` with the previous and resulting properties

#### Scenario: Unknown content in the parts is preserved
- **GIVEN** property parts with elements and namespace declarations outside the closed set, and an extended-properties root written with a prefix
- **WHEN** `set_document_properties` changes one property
- **THEN** every other element, attribute and namespace declaration SHALL remain, and new elements SHALL use the part's existing prefixes
- **AND** no package part other than the changed property parts SHALL change

#### Scenario: Missing property parts are created with relationship and content type
- **GIVEN** a DOCX with no core or extended property part
- **WHEN** `set_document_properties` sets a core and an extended value
- **THEN** the package SHALL gain `docProps/core.xml` and `docProps/app.xml`, each with one package relationship of its type and one content-type override of its media type
- **AND** the saved package SHALL pass the package and schema checks and open again with the values set

#### Scenario: Matching values are a no-op
- **WHEN** `set_document_properties` is called with values the document already has, or removes properties it does not have
- **THEN** the response SHALL report `changed: false`
- **AND** no part SHALL be written and the session's edit count SHALL NOT change

#### Scenario: Invalid property values are refused before writing
- **WHEN** a date is not a W3CDTF date, revision is not a non-negative integer, app_version does not have the form XX.YYYY, a string is empty or holds a control character, a property is read-only or unknown, or no property is given
- **THEN** the server SHALL return a structured validation error
- **AND** the package SHALL remain unchanged

#### Scenario: Effective property writes appear in the save report
- **WHEN** `set_document_properties` changes a property and the session is saved
- **THEN** the save report's non-revision change manifest SHALL list the change and the parts it touched
- **AND** the saved clean and tracked outputs SHALL both carry the new properties

#### Scenario: Unsupported providers are rejected for document properties
- **WHEN** `get_document_properties` or `set_document_properties` targets ODT or Google Docs
- **THEN** the server SHALL return a structured unsupported-provider error
- **AND** SHALL NOT mutate the source
