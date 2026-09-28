## 1. Comment definition date

- [x] 1.1 Accept `date: null` on `addComment` / `addCommentReply` and write no `w:date` for it; keep the clock default when `date` is omitted.
- [x] 1.2 Pass `null` from the Markdoc re-emit path for a source comment that carried no date.

## 2. Evidence

- [x] 2.1 Test an undated source thread re-emitted after an author change (no `w:date`), a dated source thread through the same path (date kept), a newly authored undated comment (still dated) and the docx-core `null` / omitted contrast under a frozen clock.
