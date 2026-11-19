## 1. Spec

- [x] 1.1 Add the `Continuous list numbering in created documents`
      requirement with scenarios `SDX-MDOC-LISTSEQ-01`–`SDX-MDOC-LISTSEQ-03`
      to the `docx-markdoc` delta.

## 2. Implementation

- [x] 2.1 Decide each top-level list's numbering instance in
      `create/list-numbering.ts`: one shared ordered definition, the previous
      list's `w:numId` for a continuing marker, a new instance with a
      level-0 start override for any other marker.
- [x] 2.2 Count the lowering's REF projection per definition, applying each
      instance's start override at its first paragraph.

## 3. Verification

- [x] 3.1 Tests: continuation across headings (one definition, one instance,
      no override), a restart and a list continuing it, cross-references into
      both, and read-side labels after a clause is inserted in the first list.
- [x] 3.2 Word oracle: insert a clause in the first list of a generated
      document, update fields, and record that later clauses and REF results
      renumber while a restarted list stays restarted
      (`scripts/oracle/word/evidence/issue-1252-word-16.114.json`).
