## 1. Core model (docx-primitives)

- [x] 1.1 Add `FootnoteParagraph` type and extend `Footnote` with `paragraphs` + `refParagraphIds` (additive)
- [x] 1.2 Build structured `paragraphs[]` with run-formatting-preserving `tagged_text` via `emitFormattingTags` (`full` mode)
- [x] 1.3 Make the anchor map plural (`refParagraphIds` array; `anchoredParagraphId` = first)
- [x] 1.4 Thread the styles model through `getFootnotes`/`getFootnote` (optional param; `DocxDocument` passes `getStylesModel()`)
- [x] 1.5 Keep all existing consumers green (serializers, `get_footnotes`, tests)

## 2. read_file JSON top-level footnotes (mcp-server)

- [x] 2.1 Map `Footnote[]` → top-level `footnotes` array ({id, display_number, ref_paragraph_ids[], paragraphs[]})
- [x] 2.2 Add to both budgeted and non-budgeted JSON return paths; keep OUT of content[]
- [x] 2.3 Retain per-node inline attachment (#158) for backward compatibility

## 3. toon #FOOTNOTES sidecar (mcp-server)

- [x] 3.1 Add `formatToonFootnotesEndnotesBlock` + `ToonFootnoteEndnote` to document_view-toon
- [x] 3.2 Append `#FOOTNOTES` block to toon output when `include_footnotes=true`

## 4. Docs + tests

- [x] 4.1 Update `include_footnotes` tool-catalog description; regenerate tool-reference.generated.md
- [x] 4.2 Core tests: multi-paragraph structure + run formatting preserved; `refParagraphIds` array
- [x] 4.3 read_file tests: top-level `footnotes` shape; toon `#FOOTNOTES`; zero/single/multi/nested; NVCA 109-footnote scale; default byte-identical

## 5. Validation

- [x] 5.1 `openspec validate add-read-file-structured-footnotes --strict`
- [x] 5.2 Full pre-submit gate chain green by exit code
