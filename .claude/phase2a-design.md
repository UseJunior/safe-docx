# Phase 2a design — ODF `grep` + `insert_paragraph`

Extends the proven Phase-1 optional-provider ODF lane (PR #335, merged `d1e087d`). Adds two of
the four Phase-2 tools — the light tier. `compare_documents` + comments (heavy ODF atomizer) are
deferred to a separate Phase-2b PR.

## Foundation already in place (Phase 1)
- Lazy `loadOdfCore()` optional provider; odf-core is NOT a package.json dep of docx-mcp.
- `dispatchOdf` (server.ts) → `checkOdfSupport` → `resolveOdfSessionForTool` → `loadOdfHandlers` → handler.
- `isOdfRequest(args)` = sync, extension-only (`path.extname === '.odt'`).
- Chokepoint in `resolveSessionForTool` returns `UNSUPPORTED_FOR_ODF` for any `.odt`/non-docx session
  before the `DocxSession` cast — so `grep`/`insert_paragraph` on `.odt` ALREADY fail-safe today.
- `OdfDocument`: `getParagraphs()→{id,text}[]`, `getParagraphTextById`, `replaceTextById`, `toXml()`.
  IDs are positional ordinals `p0,p1,…` (rebuilt from document-order `text:p`/`text:h` traversal).

## Change set (~12 files)

### 1. odf-core: `OdfDocument.insertParagraph` (NEW method, document.ts)
```ts
export type InsertResult =
  | { ok: true; newId: string }
  | { ok: false; code: 'ANCHOR_NOT_FOUND'; message: string };

insertParagraph(anchorId, text, position: 'BEFORE'|'AFTER'): InsertResult
```
- Resolve anchor via `blockForId`; ANCHOR_NOT_FOUND if missing or no parentNode.
- Create `text:p` via `createElementNS(ODF_NS.TEXT,'text:p')`.
- **Style inheritance:** copy anchor's `text:style-name` onto the new block so it matches visually.
- Map `text` to `#text` nodes; `\n` → `text:line-break` element between lines.
- Insert: AFTER → `parent.insertBefore(newEl, anchor.nextSibling)`; BEFORE → `insertBefore(newEl, anchor)`.
- Rebuild `this.blocks` via `collectBlocks`; return new positional ID (`p<newIndex>`).

### 2. docx-mcp: extract shared grep core (`tools/grep_core.ts`, NEW)
Pure functions, no behavior change to docx grep:
- `searchParagraphsCore(paras: {id,text}[], re, opts, locatorById?)` → match rows.
- `searchRawXmlCore(xml, re, opts)`.
docx `grep.ts` refactored to call them (locatorById from buildDocumentView, unchanged output).

### 3. docx-mcp: `tools/odf/grep.ts` (NEW) — `odfGrep(manager, session, params, metadata)`
- `session.doc.getParagraphs()` → paras; run `searchParagraphsCore` with `locatorById=null`
  (ODF has no list_label/header → empty strings).
- `search_xml:true` → `searchRawXmlCore(session.doc.toXml(), …)`.
- Same response shape as docx grep (patterns, total_matches, matches[…], matches_truncated).

### 4. docx-mcp: `tools/odf/insert_paragraph.ts` (NEW) — `odfInsertParagraph(...)`
- params `{ positional_anchor_node_id, new_string, instruction, position? }`.
- `stripAllInlineTags(new_string)` (ODF Phase 2a = plain text only; docx run-formatting tags ignored).
- position default AFTER; non BEFORE/AFTER → INVALID_POSITION.
- call `session.doc.insertParagraph(...)`; map ANCHOR_NOT_FOUND; `manager.markEdited`.
- response `{ file_path, provider:'odf', edit_count, anchor_paragraph_id, new_paragraph_id, position,
  inserted_text(preview), ids_note }`.

### 5. server.ts — add `if (isOdfRequest(args)) return dispatchOdf(...)` to `case 'grep'` and
`case 'insert_paragraph'`; register both in `loadOdfHandlers`.

### 6. provider_guard.ts — add `'grep','insert_paragraph'` to `ODF_SUPPORTED_TOOLS`.

### 7. OpenSpec — new change `add-odf-grep-insert`: proposal.md, tasks.md, design.md,
`specs/mcp-server/spec.md` (OPLR-06 grep, OPLR-07 insert), `specs/odf-core/spec.md`
(insertParagraph requirement). Tests set `TEST_FEATURE='add-odf-grep-insert'`.

### 8. tool_catalog.ts + regenerate tool-reference.generated.md (provider text for grep/insert).

### 9. Tests (Allure-wrapped: `import { testAllure as it }`):
odf-core document.test.ts (insert BEFORE/AFTER, style inherit, ID shift, line-break, ANCHOR_NOT_FOUND);
docx-mcp odf grep/insert scenarios + branch tests (MISSING_PATTERN, INVALID_POSITION, dedupe,
search_xml, whole_word). Keep coverage ratchet from regressing.

## KEY DESIGN RISK — positional-ID shift on insert
ODF IDs are document-order ordinals. Inserting a paragraph shifts every subsequent ID by one.
`insert_paragraph` returns the freshly-computed `new_paragraph_id`, but an agent holding pre-insert
IDs (from an earlier read_file/grep) will now be off-by-one for paragraphs after the insertion point.
Mitigation: (a) response includes `ids_note` telling the agent IDs are positional and to re-read
before further edits; (b) spec documents this as a known Phase-2 limitation. Durable injected
`xml:id` anchors are explicitly out of scope (deferred). **Is (a)+(b) acceptable, or does insert
need stable IDs before shipping?**

## Open questions for review
1. Positional-ID-shift mitigation (above) — acceptable for Phase 2a, or blocker?
2. grep-core extraction — DRY win worth touching the hot docx grep path, or duplicate in odf grep
   to keep zero regression surface on docx?
3. Style inheritance default (copy anchor `text:style-name`) — right default vs. bare default style?
4. `text:line-break` mapping for `\n` — correct, or should `\n\n` split into multiple `text:p`
   like docx insert_paragraph does? (Phase 2a proposes single-paragraph insert only.)
5. Any session-key / dispatch-ordering hazard from adding these two to the lane (gdocs keyed
   `gdocs:<id>`, docx/odf keyed by canonical path; isOdfRequest is extension-only & checked after
   isGDocsRequest)?
