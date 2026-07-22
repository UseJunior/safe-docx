# Tasks

## Phase 0 — oracle confirmation (gate: emitter shapes settled before emitter code)
- [x] LibreOffice authoring oracle (throwaway, `.tmp/odf-inline-oracle/`): author O1–O10 intra-paragraph tracked changes (`RecordChanges` + cursor edits, store `writer8`), inspect each `content.xml`, record the confirmed shapes as a decision log in `design.md`

## odf-core
- [x] `compare/inline_diff.ts`: token-level LCS (`diffInline`) with prefix/suffix trim, char-offset `SpanOp`s, delete-before-insert at ties, coalescing; `inline_diff.test.ts` incl. reconstruction property invariant
- [x] `compare/inline_diff.ts`: group adjacent replacements bridged by whitespace-only equal spans into one delete+insert pair (issue #378, OCMPI-14); diff-level + emit-level tests
- [x] `compare/diff.ts`: `modify` EditOp variant + `pairModifications` (order-constrained DP: max pair count then total Jaccard; threshold 0.25 default; deterministic tie-breaks; deletes-then-inserts segment order); extend `diff.test.ts` (threshold pass/fail, 2-deletes+1-insert, empties)
- [x] `shared/odf/text_segments.ts`: virtual `Segment` gains `node: Element` + `virtual: 'space' | 'tab' | 'line-break'` (additive; `rg buildSegments` confirms no caller breaks)
- [x] `compare/inline_map.ts`: `resolveOffset` (manual `#text` split, `text:s` rebalance, block-edge points, re-segment per call) + `extractVisibleRange` (clone inline content preserving spans/links, edge trims, whole tab/line-break); `inline_map.test.ts` with serialized-XML assertions
- [x] `compare/emit.ts`: explicit `equal | insert | delete | modify` planning lanes; `ModifyPlan` built purely before mutation; degrade valve (incl. `text:h` pending oracle); inline-deletion region stores one styled `text:p`, no merge artifact; descending-offset marker placement; whole-paragraph markers placed after intra markers; `emitTrackedChanges` returns `EmitResult` counts
- [x] `compare/emit_inline.test.ts`: OCMPI-03..11 shapes per oracle log; no-leak; structural round-trip (revised minus insert spans plus spliced deletions = original)
- [x] `compare/index.ts`: `similarityThreshold` option; pipeline `diffParagraphs → pairModifications → emit`; changed-region stats rule; fix the "modifications is always 0" doc comment

## docx-core
- [x] `integration/libreoffice-oracle.ts`: `.odt` format dimension (FilterName `writer8`, `content.xml` extraction, pre-packed buffer input); keep `.docx` default path identical
- [x] Gated round-trip vitest (skips when `resolveSoffice()` is null): accept-all on a generated inline redline reproduces the revised visible text; reject-all reproduces the original

## docx-mcp
- [x] `tools/odf/compare_documents.ts`: `granularity: 'inline'`, rewritten message (stats unit), stats passthrough
- [x] Update `odf_compare.test.ts` granularity assertions/describe text; new test file `TEST_FEATURE='add-odf-intra-paragraph-compare'` covering OPDI-01..02
- [x] `tool_catalog.ts` ODF compare description; regenerate `tool-reference.generated.md`

## Verification
- [x] `openspec validate add-odf-intra-paragraph-compare --strict`; spec-coverage maps every OCMPI/OPDI scenario
- [x] Full local CI gate (build, lint:workspaces, test:run, check:spec-coverage, conformance checks)
- [x] Document-shaped `.odt` smoke: real document with sub-paragraph edits through `compare_documents`; redline opens in LibreOffice with inline changes visible and acceptable
