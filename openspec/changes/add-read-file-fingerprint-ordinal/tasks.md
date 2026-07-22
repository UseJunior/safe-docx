# Tasks: Add opt-in fingerprint duplicate-disambiguation metadata to read_file

## 1. docx-mcp read_file tool
- [x] 1.1 `read_file.ts`: add `include_fingerprint_ordinal` param; when it and
      `include_fingerprint` are set with `format="json"`, compute document-wide,
      document-order ordinals and counts per `content_fingerprint`, and attach
      `content_fingerprint_ordinal`, `content_fingerprint_count_in_document`, and
      `portable_paragraph_ref` to each JSON node. No effect without `include_fingerprint`.
- [x] 1.2 `tool_catalog.ts`: expose `include_fingerprint_ordinal` on the `read_file` input
      schema.
- [x] 1.3 Regenerate `docs/tool-reference.generated.md`.

## 2. Tests (mapped to spec scenarios)
- [x] 2.1 `read_file_fingerprint_ordinal.test.ts` in docx-mcp with
      `TEST_FEATURE='add-read-file-fingerprint-ordinal'`: opt-in fields, unique paragraph
      ordinal/count, duplicate document-order ordinals, whitespace-variant grouping,
      ordinal requires include_fingerprint, portable_paragraph_ref composition,
      document-wide counts across windowed reads, TOON ignores the flag, default JSON omits
      the fields, and Google Docs ignores the flag.

## 3. Validation
- [x] 3.1 `openspec validate add-read-file-fingerprint-ordinal --strict`.
- [x] 3.2 Build, lint, targeted tests, spec-coverage, tool-docs check.
