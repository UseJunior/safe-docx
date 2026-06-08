# Tasks

## odf-core
- [ ] Add `XML` namespace (`http://www.w3.org/XML/1998/namespace`) to `ODF_NS`
- [ ] Extract `collectBlocks` + an `isTrackedChangesSubtree` predicate into `shared/odf/` (block-walk helper); `document.ts` reuses it. Both the block walk and `buildSegments` skip the `text:tracked-changes` subtree (no deleted-content leak)
- [ ] New `compare/diff.ts`: pure paragraph-level LCS over `{id,text}[]` → edit script (`equal`/`insert`/`delete`); no DOM
- [ ] New `compare/emit.ts`: ODF tracked-changes emitter (insertion: `change-start`/`-end` + `text:insertion` region; deletion: coalesce consecutive deleted paragraphs into ONE `text:deletion` region + ONE inline `text:change` anchor in the nearest SURVIVING paragraph, skipping deleted ones, forward/backward merge); `ctN` id allocation scanning existing ids; `office:change-info` author/date; degenerate all-deleted case fails closed
- [ ] New `compare/index.ts`: `compareOdf(originalContentXml, revisedContentXml, opts)` — parse each string once, diff → emit, return `{ contentXml, stats }`; export `compareOdf` + result type from `index.ts`
- [ ] odf-core `compare/diff.test.ts`: insert-only, delete-only, identical, empty doc, multi-paragraph, reordering (assert edit script)
- [ ] odf-core `compare/emit.test.ts`: insertion (mid + EOF backward bracket), deletion forward (start anchor) + backward (end anchor) + consecutive-coalesce forward & backward (one region, anchor skips deleted) + modified-paragraph marker order (deletion before insertion) + table-cell + degenerate all-deleted; existing-tracked-changes-container reuse; `ctN` allocation; no-leak regression (`getParagraphs()` ignores `text:tracked-changes`)

## docx-mcp
- [ ] `tools/odf/compare_documents.ts`: stateless `odfCompareDocuments(manager, args, metadata)` — two-file load via `validateAndLoadOdfFromPath`, `archive.getContentXml()` → `compareOdf`, build redline from revised buffer (`setContentXml` + `save`), write to `save_to_local_path`; response `{ mode:'two_file', original_file_path, revised_file_path, saved_to, size_bytes, author, granularity:'paragraph', stats, message }`. Reject `save_to_local_path` resolving to either source + run `enforceWritePathPolicy` (match DOCX compare)
- [ ] Add `compare_documents` to `ODF_SUPPORTED_TOOLS`; update guard hint + both `session_resolution.ts` hints
- [ ] `server.ts`: replace the `compare_documents` case — `.odt` two-file → `odfCompareDocuments` (stateless, lazy-load odf-core); `.odt` session `file_path` → `UNSUPPORTED_FOR_ODF` (session mode deferred); else DOCX tool. Update comment
- [ ] Update `tool_catalog.ts` provider text (now includes `.odt` two-file) + regenerate `tool-reference.generated.md`

## Tests & verification
- [ ] docx-mcp `tools/odf/odf_compare.test.ts`: OPCD-01..05 scenarios + branch tests; `TEST_FEATURE='add-odf-compare'`; `import { testAllure as it }`; driven through `dispatchToolCall`
- [ ] Full CI gate locally (build, lint, cycles, release-isolation, allure-*, openspec validate --strict, spec-coverage --strict, tool-docs) + coverage ratchet not regressed
- [ ] Document-shaped `.odt` smoke: NVCA source → `.odt`, derive an edited revision, two-file `compare_documents` through `dispatchToolCall`; confirm non-trivial stats, redline parses back (regions + markers, untouched preserved, mimetype-first STORED), reopen in LibreOffice
- [ ] Regression: two-`.docx` compare unchanged; still-unsupported tool on `.odt` returns `UNSUPPORTED_FOR_ODF`; `.odt` session compare returns `UNSUPPORTED_FOR_ODF`
