## 1. Implementation

- [x] 1.1 Record Word 16 Accept All / Reject All on S1e/S3b fixtures with survivor variants (no references, some references, every reference, `w:titlePg` only; body-level and paragraph-level survivors)
- [x] 1.2 Add the shared docx-core helper and call it wherever an applier removes a paragraph-owned section boundary
- [x] 1.3 Use the same helper in docx-compare's acceptor
- [x] 1.4 Tests on all four appliers with Word's results as expectations, including the unchanged control
