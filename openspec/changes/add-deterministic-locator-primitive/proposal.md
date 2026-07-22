# Change: Add Deterministic Locator Primitive

## Why
Downstream consumers (starting with open-agreements "selector-contract recipes") need to locate a specific span of text in a DOCX **resiliently and deterministically** — "find the company name inside the preamble", not "replace literal `[Insert Company Name]` everywhere". Today safe-docx exposes a `DocumentView` and `computeContentFingerprint`, but no layer that resolves a *bundle* of anchors (section, regex, contextual, fingerprint) to a single text span and reports drift when the document changes. Each consumer would otherwise hand-roll matching — and the offset translation needed to mutate the result is a known footgun (see below).

Two correctness hazards block consumers from doing this safely on their own:
1. **Offset coordinate mismatch.** `replaceParagraphTextRange`/`replaceTextAtRange` operate on **raw visible-text** offsets (`getParagraphRuns().map(r => r.text).join('')`), but `DocumentViewNode.clean_text` (the natural text to author patterns against) is `getParagraphText().replace(/\r|\n/g, '').trim()` plus optional manual-list-label stripping — so its offsets diverge from raw by a (mostly leading) correction. The only existing correction, `visible_offset_correction`, is a single scalar. (Note: `clean_text` does NOT collapse internal whitespace; only `computeContentFingerprint` does.)
2. **Stubbed builder.** The free `buildDocumentView(params)` export currently returns `{ nodes: [] }` — only the `DocxDocument.buildDocumentView()` method is populated. A consumer deep-importing the free function silently gets nothing. (Both the method and the free function include only paragraphs carrying a `_bk_*` bookmark id and do not insert bookmarks — see below.)

## What Changes
- NEW: `locator.ts` in docx-core — a deterministic `resolveLocator(view, locator)` that resolves a `Locator` (`scope` + `primary` + `assertions`) to one raw-offset span and reports `unresolved` / assertion drift. `section` is a scope-only step kind (not a `primary`/assertion); `fingerprint` is a whole-node anchor computed from the node's raw visible text; zero-length regex matches are invalid.
- NEW: tested `clean_text → raw` offset-map primitive (per node), generalizing the scalar `visible_offset_correction`, covering the transforms `clean_text` actually applies: leading/trailing trim, CR/LF removal, and manual-list-label stripping. It does NOT cover internal whitespace collapse (`clean_text` does not collapse it).
- MODIFIED: `document_view.ts` — extract the populated per-paragraph view logic into a shared pure helper so **both** `DocxDocument.buildDocumentView()` and the free `buildDocumentView(params)` produce populated nodes (one node per **bookmarked** paragraph), fixing the empty-stub footgun. Neither inserts bookmarks; consumers operating on un-bookmarked source must call `DocxDocument.insertParagraphBookmarks()` first.
- MODIFIED: `index.ts` — export `resolveLocator`, the `Locator`/`LocatorStep`/`LocatorResolution` types, and the offset-map helper.
- NO MCP tool changes and NO new runtime dependencies in this change.

## Impact
- Affected specs: `docx-primitives`
- Affected code: `packages/docx-core/src/primitives/locator.ts` (new), `packages/docx-core/src/primitives/locator.test.ts` (new), `packages/docx-core/src/primitives/document_view.ts` (shared-core refactor + offset map), `packages/docx-core/src/primitives/document_view-types.ts` (offset-map field), `packages/docx-core/src/index.ts` (exports)
- Determinism: resolution is total and reproducible — no randomness, no scoring, no fuzzy matching, no tie-break heuristics. A `primary`/`section` step that does not match **exactly once** in scope yields `unresolved` (a drift signal), never a "best guess".
- Release: ships as `@usejunior/docx-core` **0.12.0**. Consumers that rely on the locator MUST pin `^0.12.0`.
