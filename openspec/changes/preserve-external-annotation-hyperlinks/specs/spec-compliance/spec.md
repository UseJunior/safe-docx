## ADDED Requirements

### Requirement: Annotation hyperlink relationship evidence

The conformance registry SHALL bind annotation hyperlink import and emission to
ECMA-376 5th edition Part 1 § 17.16.22 for the `w:hyperlink` relationship
reference, Part 2 § 6.5.2.3 for the owning part Relationships part, and Part 2
§ 6.5.3.4 for relationship identifiers, types, targets, and target modes.
Implementation JSDoc and focused tests SHALL use the structured citation forms
enforced by the repository conformance checks.

#### Scenario: [SDX-CONF-16] annotation hyperlink citations resolve

- **WHEN** annotation hyperlink import, relationship allocation, and projection claims are checked
- **THEN** every cited edition, part, and section SHALL resolve to a targeted registry entry backed by vendored normative schemas
- **AND** issue #956 SHALL appear only as non-normative `@see` context
