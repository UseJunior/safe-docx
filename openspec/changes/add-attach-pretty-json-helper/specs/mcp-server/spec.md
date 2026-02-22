## ADDED Requirements
### Requirement: Human-Readable JSON Evidence Attachments
The shared Safe-Docx Allure test helper SHALL provide a JSON evidence helper that renders formatted JSON inline for human review while preserving JSON-typed debug artifacts.

#### Scenario: attachPrettyJson renders formatted JSON inline
- **GIVEN** a test uses the shared Allure BDD context
- **WHEN** `attachPrettyJson(name, payload)` is called
- **THEN** the report SHALL include an inline HTML preview with formatted JSON content
- **AND** key/value structure SHALL remain readable without opening a raw file download

#### Scenario: debug JSON final-step label remains neutral
- **GIVEN** a test calls `attachJsonLastStep` with default options
- **WHEN** the evidence step is emitted
- **THEN** the step name SHALL be `Attach debug JSON (context + result)` by default
- **AND** the helper SHALL NOT prepend `AND:` or any other BDD prefix automatically

### Requirement: HTML Attachment Auto-Fit and Scroll Behavior
The branded Safe-Docx Allure report SHALL auto-size HTML evidence attachments to content height for short previews and avoid nested vertical scrollbars.

#### Scenario: short HTML attachment auto-fits without vertical scrollbar
- **GIVEN** an HTML evidence attachment whose rendered content is short
- **WHEN** the attachment is displayed inline
- **THEN** the attachment viewport SHALL expand to fit content height
- **AND** no vertical scrollbar SHALL appear for that attachment

#### Scenario: tall HTML attachment uses single vertical scrollbar
- **GIVEN** an HTML evidence attachment whose rendered content exceeds the configured max preview height
- **WHEN** the attachment is displayed inline
- **THEN** the attachment container SHALL cap at the max preview height
- **AND** only one vertical scrollbar SHALL be used for that attachment view
