## 1. Implementation

- [x] 1.1 Red tests on the base for the issue reproduction, multi-section, added and removed sections, page-size change, `w:titlePg` switch, first and even roles, even pages turned on, and a renamed/inherited slot.
- [x] 1.2 Pair compared parts with original stories through the Reject All / Accept All section alignment of the compared package, keyed by effective slot and page.
- [x] 1.3 Keep a pair only when every page it touches comes out right in both projections.
- [x] 1.4 Compare paired plain stories through the ordinary story path and splice them into the compared part.
- [x] 1.5 Drop positional header/footer reports for sections and kinds the pairing makes right.
- [x] 1.6 Check accept/reject per displayed page with docx-compare's appliers and docx-core `acceptChanges`/`rejectChanges`, body text, and the emitted-document schema gate.
- [x] 1.7 Record Word 16 for Mac Accept All / Reject All of the compared outputs with the local accept/reject oracle.
- [x] 1.8 Run OpenSpec validation and repository pre-submit checks.
