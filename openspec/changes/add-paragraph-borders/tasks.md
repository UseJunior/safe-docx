## 1. Implementation

- [x] 1.1 Add a paragraph-border type and `ParagraphSpec.borders`.
- [x] 1.2 Validate paragraph borders with the shared border validation rules.
- [x] 1.3 Emit schema-ordered `w:pBdr` children in the existing `w:pPr` slot.

## 2. Evidence

- [x] 2.1 Add a bottom-bordered paragraph generation fixture and assertions.
- [x] 2.2 Prove package load/save and compare round-trip preservation.
- [x] 2.3 Run focused package, schema, OpenSpec, and conformance checks.
