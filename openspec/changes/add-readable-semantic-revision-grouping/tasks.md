## 1. Implementation

- [x] 1.1 Add the `readable-semantic` policy and the paragraph-level semantic regrouping pass.
- [x] 1.2 Expose `CompareOptions.revisionGrouping` with a token-minimal default and value validation.
- [x] 1.3 Add `revision_grouping` to `compare_documents` with a readable-semantic default.
- [x] 1.4 Update the option matrix, generated tool reference and `docx-editing` skill.
- [x] 1.5 Add comparator tests (issue repro, mixed formatting, short common words, barriers, random rewrites) asserting exact Accept/Reject projections and schema validity.
- [x] 1.6 Add MCP tool tests for the default, the token-minimal opt-out and invalid values.
