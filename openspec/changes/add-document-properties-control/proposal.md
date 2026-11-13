# Change: Control document properties in created and existing documents

## Why

A document delivered to a reader should carry neutral or caller-chosen
document properties (#1201). Word's File > Properties panel should not show
a 2006 creation date, or the name of the authoring tool, unless the caller
asks for that. Today:

- `docx-markdoc create` always writes `<Application>safe-docx</Application>`
  in `docProps/app.xml`, and no frontmatter key, CLI flag or profile key
  changes or omits it.
- `dcterms:modified` always equals `dcterms:created`; both come from the
  frontmatter `date`.
- Without `date`, both dates are 2006-01-01T00:00:00Z, and nothing in the
  `create` output says so.
- The Safe-DOCX MCP server has no tool that reads or writes the core or
  extended properties of an existing document. A caller who needs to change
  them rewrites `docProps/*.xml` by hand, outside the session's accounting.

## What Changes

- `generateDocx`: `DocumentSpec.meta` gains `modifiedIso`, `lastModifiedBy`
  and `application` (a string, or null to leave `Application` out). Absent
  keys compile to the bytes they always did. Meta values are validated before
  compilation: W3CDTF dates, strings XML can carry.
- `docx-markdoc create`: the frontmatter gains `modified`,
  `last-modified-by` and `application` (`none` leaves the element out). The
  existing `author` key remains the `dc:creator`. A new certificate check,
  `checks.properties`, reads the properties back from the DOCX and compares
  them with the values read straight from the frontmatter, with a negative
  control. The summary line names the document dates and, when `date` is
  absent, says that they are the fixed 2006 default.
- `docx-core` gains a document-properties primitive (`readDocumentProperties`,
  `setDocumentProperties`, and `DocxDocument.getDocumentProperties` /
  `setDocumentProperties`) that locates the parts through package
  relationships, edits only the named elements, and creates a missing part
  with its relationship and content-type override.
- The MCP server gains a read-only `get_document_properties` tool and a
  `set_document_properties` tool for a closed, documented set of core
  properties (title, subject, creator, keywords, description, category,
  content_status, language, last_modified_by, revision, created, modified)
  and extended properties (application, app_version, company, manager,
  template). Both are DOCX only.

## Impact

- Affected specs: `docx-generation`, `docx-markdoc`, `mcp-server`.
- Affected code:
  - `packages/docx-core/src/primitives/document_properties.ts`, `DocxDocument`
  - `packages/docx-core/src/generation/` (types, validation, package parts)
  - `packages/docx-markdoc/src/create/` (frontmatter, lowering, certificate, CLI summary)
  - `packages/docx-mcp/src/tools/`, `server.ts`, `tool_catalog.ts`, generated tool docs
- Conformance: ECMA-376 5th edition Part 2 §8.2 and §8.3.4.3, Part 1 §22.2.

## Non-Goals

- Custom properties (`docProps/custom.xml`). They are preserved, not edited.
- Statistics in `docProps/app.xml` (pages, words, characters, total time).
  They are preserved as they are; Word recomputes them on save.
- Stamping `modified` or `lastModifiedBy` automatically on save. Writes are
  explicit, and generation never reads the clock.
- Refusing to edit a digitally signed package. Editing any part of a signed
  package invalidates its signature, as other edit tools already do.
- ODT and Google Docs document properties.
