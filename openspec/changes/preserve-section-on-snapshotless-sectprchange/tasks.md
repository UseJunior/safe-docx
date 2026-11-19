## 1. Implementation

- [x] 1.1 Record Word 16 Reject All / Accept All on snapshot-less `w:sectPrChange` fixtures (paragraph and body level, with and without references, `w:titlePg` and landscape page setup, with inserted and deleted paragraph marks, and the bare added-break shape)
- [x] 1.2 State the absent-snapshot contract before the fix (this change, and a code comment citing ECMA-376 § 17.13.5.32)
- [x] 1.3 docx-core `rejectChanges` drops only the record and keeps the live `w:sectPr`
- [x] 1.4 Tests on all four appliers with Word's results as expectations, plus selected versus foreign-author selective reject
