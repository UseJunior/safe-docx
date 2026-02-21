# Safe Docx Golden Prompts

These prompts are designed to produce reliable first-run behavior with local Safe Docx.

## 1) Apply Edits To One Document

```text
Use safe-docx to edit /absolute/path/to/Agreement.docx.
1) Read the file and identify the paragraph IDs that contain "Term" and "Termination".
2) Replace the clause text in those paragraphs with clearer language while preserving formatting.
3) Save both outputs:
   - clean: /absolute/path/to/Agreement.clean.docx
   - tracked changes: /absolute/path/to/Agreement.tracked.docx
Return a short summary of what changed and list the paragraph IDs edited.
```

## 2) Compare Two Documents

```text
Use safe-docx to compare these two files and generate a tracked-changes output document:
- original: /absolute/path/to/Agreement.v1.docx
- revised: /absolute/path/to/Agreement.v2.docx
- output: /absolute/path/to/Agreement.compare.tracked.docx
After generating the tracked-changes file, extract revisions and return:
1) total revision count
2) top 10 changed paragraphs with before/after text.
```

## 3) Comment + Footnote Workflow

```text
Use safe-docx on /absolute/path/to/Memo.docx.
1) Find the paragraph that starts with "Risk Factors".
2) Add a comment requesting tighter language.
3) Add a footnote to the same paragraph with citation text:
   "Source: Internal policy memo, rev 2026-02-01."
4) Save tracked-changes output to /absolute/path/to/Memo.review.tracked.docx
Return the comment ID and footnote ID created.
```
