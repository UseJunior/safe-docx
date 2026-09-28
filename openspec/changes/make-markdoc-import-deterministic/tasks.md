## 1. Serialization

- [x] 1.1 Let `DocxZip.toBuffer()` and `DocxDocument.toBuffer()` write every entry with a caller-supplied `fileDate`, restoring in-memory dates afterwards.
- [x] 1.2 Export `ZIP_EPOCH` from docx-core and reuse it in document generation.

## 2. Import

- [x] 2.1 Serialize the body-anchored package and the story-anchored copy with `fileDate: ZIP_EPOCH`.

## 3. Evidence

- [x] 3.1 Test that two imports of the same DOCX across a faked ZIP timestamp tick yield byte-identical Markdoc and anchored source, stamp every entry with `ZIP_EPOCH`, and compile against each other without `SOURCE_HASH_DRIFT`.
