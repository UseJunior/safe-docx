## 1. Spec

- [x] 1.1 Rewrite `SDX-MDOC-XREF-05` and `SDX-MDOC-XREFTEXT-05` for restored references.
- [x] 1.2 Add the `Cross-references in imported documents` requirement
      (`SDX-MDOC-XREFIMPORT-01`–`SDX-MDOC-XREFIMPORT-06`).

## 2. Word oracle

- [x] 2.1 Record Word 16.114's field results for a created agreement before
      and after inserting a clause before a referenced one and updating fields,
      and keep the saved copy.

## 3. docx-core

- [x] 3.1 `field` on footnote and comment body runs, written as one complex field.

## 4. docx-markdoc

- [x] 4.1 Import REF fields as xref tags, and report the fields kept as text.
- [x] 4.2 Parse xref tags in the anchored dialect, with coded errors.
- [x] 4.3 Compile: check tags against the source's fields, edit around fields,
      write note fields again, and verify the output's fields.
- [x] 4.4 README: the xref tag in anchored Markdoc and its error codes.
