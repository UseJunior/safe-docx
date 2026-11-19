## 1. Statistics

- [x] 1.1 Add `moves`, `movedParagraphs`, `moveFromRanges`, and `moveToRanges` to `CompareStats` and populate them from the tagged move relations and serialized move wrappers.
- [x] 1.2 Aggregate the new fields across selected stories.
- [x] 1.3 Allocate generated move range IDs around every input `w:id`, so a generated range can neither duplicate an input ID nor be confused with a preserved move when counting.

## 2. Tests

- [x] 2.1 Serialized-markup tests: pure move, move plus unrelated edit, move plus paragraph split, and move detection disabled.
- [x] 2.2 Public `compareDocuments` and MCP `compare_documents` tests for a pure move and a move plus edit.
- [x] 2.3 Self-comparison of the three NVCA forms still reports zero for every stats field.
