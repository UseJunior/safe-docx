# Changelog

## Unreleased

- Behavior change: comparison now defaults to `reconstructionMode: 'inplace'`
  everywhere. Previously the `@usejunior/docx-compare` library and its
  `docx-comparison` / `safe-docx-compare` binaries defaulted to `'rebuild'`
  while the MCP `compare_documents` tool and the `safe-docx` CLI defaulted to
  `'inplace'`, so the same pair of documents produced different output
  depending on which entry point you used. Callers that omit
  `reconstructionMode` now get in-place reconstruction, which preserves the
  revised document's existing structure; it falls back to `'rebuild'`
  automatically when round-trip safety checks fail. Pass
  `reconstructionMode: 'rebuild'` explicitly to keep the old behavior.
- The `docx-comparison` / `safe-docx-compare` CLI JSON output now reports
  `mode` as the mode actually used, alongside `mode_requested` and
  `fallback_reason`. It previously reported the requested mode as the mode
  used, hiding silent in-place to rebuild fallbacks.
- Migration note: DOCX comparison and redline generation moved from
  `@usejunior/docx-core` to `@usejunior/docx-compare`. Update comparison
  imports such as `compareDocuments` to use the new package name.

This project uses [GitHub Releases](https://github.com/UseJunior/safe-docx/releases)
as the canonical changelog. Each release is auto-categorized from PR labels.

Browse the full history:

- **GitHub Releases:** <https://github.com/UseJunior/safe-docx/releases>
- **Trust site changelog:** <https://safedocx.com/trust/changelog/>
