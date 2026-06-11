# Tasks: Optionally inline footnote bodies in read_file

## 1. docx-mcp read_file tool
- [x] 1.1 `read_file.ts`: add `include_footnotes` param; `attachParagraphFootnotes()` over the
      windowed JSON slice with the #158 eligibility rules (skip display 0 / empty body /
      orphaned); attach before the budget renderer so the payload counts toward the budget;
      degrade load failures to `footnote_load_error` metadata.
- [x] 1.2 `tool_catalog.ts`: expose `include_footnotes` on the `read_file` input schema.
- [x] 1.3 Regenerate `docs/tool-reference.generated.md`.

## 2. Tests (mapped to spec scenarios)
- [x] 2.1 `add_read_file_inline_footnotes.test.ts` in docx-mcp: synthetic fixtures for
      attach/default-off/windowed-pagination/budget/eligibility/format scoping, plus NVCA
      SPA fixture round-trip and single-rendered-marker regression guard.

## 3. Validation
- [x] 3.1 `openspec validate add-read-file-inline-footnotes --strict`.
- [x] 3.2 Build, lint, tests, spec-coverage, tool-docs check.
