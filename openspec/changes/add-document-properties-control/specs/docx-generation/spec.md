## ADDED Requirements

### Requirement: Caller-chosen document properties

`generateDocx` SHALL accept `DocumentSpec.meta.modifiedIso`,
`meta.lastModifiedBy` and `meta.application` alongside `title`, `author` and
`createdIso`. `modifiedIso` SHALL be written as `dcterms:modified` in place
of `createdIso`; `lastModifiedBy` SHALL be written as `cp:lastModifiedBy`;
`application` SHALL be written as the `Application` element of
`docProps/app.xml`, and null SHALL leave that element out. Without
`application`, `Application` SHALL be `safe-docx`, so a spec without the new
keys compiles to the bytes it compiled to before. Each date SHALL be a
W3CDTF date and each string SHALL hold only characters XML can carry;
otherwise the spec SHALL be refused with a `GenerationSpecError` before
compilation.

#### Scenario: [SDX-GEN-136] meta writes the chosen modified date, last author and application, and null omits the application
- **GIVEN** a spec with `createdIso`, a later `modifiedIso`, `lastModifiedBy` and `application: "Acme Drafting"`, the same spec with `application: null`, and the same spec without the new keys
- **WHEN** each is compiled
- **THEN** the first package's `dcterms:created` and `dcterms:modified` SHALL carry the two dates with `xsi:type="dcterms:W3CDTF"`, its `cp:lastModifiedBy` the name, and its `Application` the chosen name
- **AND** the second package's `docProps/app.xml` SHALL have no `Application` element
- **AND** the third package SHALL have `dcterms:modified` equal to `dcterms:created` and `Application` `safe-docx`
- **AND** every package SHALL pass the structural checks and compile byte-identically across two runs
- **AND** a spec whose `modifiedIso` is not a W3CDTF date, or whose `application` is empty or holds a control character, SHALL be refused with a `GenerationSpecError`
