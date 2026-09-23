## ADDED Requirements

### Requirement: WML Conformance-Class Gate at Load
`DocxDocument.load` SHALL refuse a package whose main document root element is in the ISO/IEC 29500 Strict WordprocessingML namespace (`http://purl.oclc.org/ooxml/wordprocessingml/main`) by throwing `UnsupportedConformanceClassError` (code `UNSUPPORTED_CONFORMANCE_CLASS`) whose message names the conformance class. Strict consumption is out of scope; the gate exists so a Strict document is never read as empty text.

#### Scenario: [SDX-CONF-01] Loading a WML Strict package throws a typed conformance-class error
- **GIVEN** a package whose `word/document.xml` root element is in the Strict WordprocessingML namespace
- **WHEN** `DocxDocument.load` is called
- **THEN** it SHALL reject with `UnsupportedConformanceClassError`
- **AND** the error SHALL carry code `UNSUPPORTED_CONFORMANCE_CLASS`, `conformanceClass: 'strict'`, the Strict namespace URI, a message naming "WML Strict", and a hint on re-saving as Transitional

#### Scenario: [SDX-CONF-02] A Transitional control package loads and reads its body text
- **GIVEN** the same package in the Transitional namespace, including one that merely declares the Strict URI as an unused prefix
- **WHEN** it is loaded and rendered as plain text
- **THEN** loading SHALL succeed and the body text SHALL be present
