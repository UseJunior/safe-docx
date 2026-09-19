## 1. Specification

- [x] 1.1 Specify anchored table-cell text replacement, paragraph insertion and
      paragraph deletion with unchanged topology.
- [x] 1.2 Specify transactional rejection of structural table operations.

## 2. Compiler

- [x] 2.1 Admit replacement, insertion, and safe deletion operations targeting
      table-cell paragraphs.
- [x] 2.2 Reject cross-cell formatting sources, deletion sets that leave no
      trailing cell paragraph, and edits in vertical-merge continuation cells.
- [x] 2.3 Narrow the certificate exclusion to structural table operations.

## 3. Evidence

- [x] 3.1 Prove clean, accept-all, and reject-all text projections.
- [x] 3.2 Prove table topology and unrelated cells remain unchanged.
- [x] 3.3 Prove table paragraph deletion remains rejected.

## 4. Documentation and validation

- [x] 4.1 Document the admitted table-cell editing boundary.
- [x] 4.2 Run focused tests, package build, strict OpenSpec validation, and repository checks.
