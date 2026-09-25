## 1. Implementation

- [x] 1.1 Detect unsaved in-memory edits after a one-shot CLI tool call.
- [x] 1.2 Add `-o/--output` to mutating tool subcommands and save through the `save` tool.
- [x] 1.3 Refuse with `UNSAVED_EDITS_DISCARDED`, `success: false` and a non-zero exit when an edit would be discarded; apply the same rule to `safe-docx edit`.
- [x] 1.4 Document the requirement in top-level and per-tool help.
- [x] 1.5 Add process-level and in-process tests: unchanged file hash, exit code, `success: false`, saved output with `-o`, read-only commands unaffected, help text.
