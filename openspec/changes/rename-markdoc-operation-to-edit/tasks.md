## 1. Syntax

- [x] 1.1 Accept `edit=` (and `edits=` on change-set) alongside the deprecated `operation=`/`operations=` spelling.
- [x] 1.2 Reject a tag that sets both spellings; warn on the old spelling without failing validation.
- [x] 1.3 Emit only `edit=` from import.

## 2. Diagnostics

- [x] 2.1 Surface non-fatal validation warnings through `parseMarkdoc`, `requireMarkdoc`, the verification certificate and CLI stderr.
- [x] 2.2 Rename validation codes and messages that named operations to name edits.

## 3. Evidence and docs

- [x] 3.1 Test the new spelling, the deprecated spelling with its warning, the both-set error, and import output free of `operation=`.
- [x] 3.2 Update README examples to edit names such as `add-cure-period`, and note the deprecation window.
