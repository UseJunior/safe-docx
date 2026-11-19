## 1. Core primitive

- [x] 1.1 Read core and extended properties through package relationships,
      tolerating prefixed roots, strict namespaces and missing parts.
- [x] 1.2 Set and remove properties element by element, validating every
      value before writing; create missing parts with relationship and
      content-type override.
- [x] 1.3 Expose `DocxDocument.getDocumentProperties` /
      `setDocumentProperties` and package exports.

## 2. Generation and creation

- [x] 2.1 Add `meta.modifiedIso`, `meta.lastModifiedBy` and
      `meta.application` with validation (`SDX-GEN-136`).
- [x] 2.2 Add `modified`, `last-modified-by` and `application` frontmatter
      keys (`SDX-MDOC-DOCPROPS-01`, `-03`).
- [x] 2.3 Add `checks.properties` with a negative control and the summary
      entry for the document dates (`SDX-MDOC-DOCPROPS-02`).

## 3. MCP tools

- [x] 3.1 Add `get_document_properties` and `set_document_properties` to the
      catalog, server dispatch and unsupported-provider routing.
- [x] 3.2 Record effective writes in the non-revision change manifest.
- [x] 3.3 Regenerate the tool reference and update support documentation.

## 4. Validation

- [x] 4.1 Unit, generation, creation and MCP tests, and a smoke on a real
      NVCA agreement (with and without docProps parts).
- [x] 4.2 `openspec validate add-document-properties-control --strict`.
- [x] 4.3 The pre-submit gate.
