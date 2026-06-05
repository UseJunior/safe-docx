# Design: ODF core + provider-aware `.odt` slice

## Context

Safe-DOCX's editing model is: open a file → session holds a parsed document with
stable paragraph anchors → tools address paragraphs by ID → save reconstructs the
package preserving everything untouched. ODF (`.odt`) is also a ZIP-of-XML, so the
*shape* of this model transfers, but four integration seams are DOCX-hardcoded and
must gain provider awareness. The seams (verified against the current tree):

- `tools/open_document.ts:58-64` — rejects any extension `!== '.docx'` with
  `INVALID_FILE_TYPE`, then runs `validateDocxArchiveSafety` and
  `manager.createSession` (which calls `DocxDocument.load`).
- `session/manager.ts:51-95` — `Session = DocxSession | GDocsSession`;
  `createSession` (`:319`) hardcodes `DocxDocument.load`; `saveTo` (`:546`) hardcodes
  `session.doc.toBuffer()`.
- `server.ts:86-158` — `dispatchToolCall` branches to gdocs via `isGDocsRequest(args)`
  (an *arg* discriminant: `google_doc_id`). ODF has no such arg; the discriminant is
  the opened file's extension, known only after session creation.
- `tools/docx_archive_guard.ts` — `validateDocxArchiveSafety` wraps docx-core's
  **format-agnostic** `inspectZipEntries`; the zip-bomb logic is directly reusable.

## Goals / Non-Goals

**Goals (Phase 1):** open real `.odt`, `read_file`, `replace_text`, `save`, with
semantic+structural round-trip safety and a LibreOffice open smoke. Exercise the
full provider-aware path so Phase 2 breadth is additive.

**Non-Goals:** tracked changes, `compare_documents`, comments/annotations,
`insert_paragraph`, `grep`, `.ods`/`.odp`, durable cross-edit anchors (injected
`xml:id`), and any byte-identical round-trip claim.

## Decision 1 — `OdfArchive`: clone `DocxArchive`, don't generalize it

`DocxArchive` is a thin JSZip wrapper (~200 LOC) with DOCX path constants and a
`load()` that asserts `word/document.xml`. Rather than refactor it into a
format-parameterized base (which would churn the stable DOCX package for no DOCX
benefit), `OdfArchive` is a sibling clone in `odf-core` with ODF specifics:

- `load()` asserts `content.xml` + `META-INF/manifest.xml` (ODF's required parts).
- **`mimetype` discipline (empirically verified, with a critical round-trip trap):**
  ODF/ZIP requires the `mimetype` entry to be the first entry and **stored
  uncompressed** (`STORE`, no DEFLATE). A *fresh* JSZip honors `mimetype` first +
  `{ compression: 'STORE' }` correctly. BUT on the real path — **load an existing
  `.odt` → modify `content.xml` → re-save the loaded zip** — JSZip re-emits the
  loaded `mimetype` entry with method `8` (DEFLATE), producing an invalid `.odt`.
  Verified directly: naive re-save yields `mimetype:method=8`; the original was
  `method=0`. Therefore `save()` MUST **rebuild a fresh `JSZip`**: write `mimetype`
  first with `{ compression: 'STORE' }`, then copy every other entry's decompressed
  content. Rebuilding (not re-saving the loaded handle) is the only approach that
  guarantees mimetype-first + STORE across a round trip. The LibreOffice open smoke
  is the backstop. (A minimal JSZip-built `.odt` was confirmed to open and round-trip
  text via `soffice --headless --convert-to`.)
- **"Preserved untouched entries" means decompressed-content-identical, not
  container-byte-identical.** Because `save()` rebuilds the zip, untouched parts are
  re-compressed; their *decompressed* bytes are identical to the input, but the raw
  zip/compressed bytes may differ (different deflate output). This matches the DOCX
  side, which also does not promise a byte-identical container. Round-trip assertions
  compare decompressed entry content, never raw archive bytes.

`validateOdfArchiveSafety` reuses `inspectZipEntries` from `@usejunior/docx-core`
(already an exported, format-agnostic helper) with ODF error codes and an added
assertion that a `mimetype` entry exists and reads `application/vnd.oasis.opendocument.text`.

## Decision 2 — Stable paragraph IDs: in-session structural ordinals (Phase 1)

DOCX gets durable anchors by **injecting** `_bk_*` bookmarks and round-tripping them.
ODF Phase 1 deliberately avoids mutating the file to add anchors (injecting and
safely round-tripping `xml:id` is a Phase 2 concern). Instead, `OdfDocument`
computes a **deterministic structural ID** for each block-level text element
(`text:p` / `text:h`) in document order, including those nested in
`table:table-cell`. The ID is a stable function of the element's position in the
parse tree (e.g. `p{ordinal}`), so:

- It is **byte-stable**: identical stored `.odt` bytes → identical IDs across
  reopens/machines (matches the project's determinism convention).
- It is **session-scoped**: IDs are recomputed from the live in-session document on
  every read, and `replace_text` resolves its target against that same live view —
  exactly how the DOCX/gdocs tools already behave within a session. A structural ID
  is therefore a valid `replace_text` target within a session even though ordinals
  would shift if paragraphs were inserted/deleted (not a Phase 1 operation).

This keeps Phase 1 read-only at the packaging layer for everything except the one
paragraph `replace_text` touches, which is the smallest possible blast radius.

If an ODF element already carries `text:id` / `xml:id`, the view records it but does
**not** depend on it for addressing in Phase 1 (real-world `.odt` files rarely set
it on every paragraph). Promoting durable IDs to injected `xml:id` is the documented
Phase 2 upgrade path.

## Decision 3 — A parallel ODF resolver + a session/extension discriminant

gdocs branches in `dispatchToolCall` *before* session resolution because
`google_doc_id` is on the request, and it has its **own** `resolveGDocsSessionForTool`
that returns a `GDocsSession` — the shared `resolveSessionForTool` stays
`DocxSession`-typed and untouched. ODF must follow the **same parallel-resolver
pattern**, because (verified in `session_resolution.ts`):

- `resolveSessionForTool` returns `ResolvedSession.session: DocxSession`, auto-opens
  **`.docx`-only** (`validateAndLoadDocxFromPath` rejects non-`.docx` at line 67), and
  reuses existing sessions cast to `DocxSession` (line 168). Widening its return type
  to the `Session` union would force narrowing changes in every DOCX tool and in
  DOCX-only consumers like `get_file_status.ts` (which reads `saveCache` /
  normalization fields). That blast radius is unnecessary.

So ODF gets, mirroring gdocs exactly:

- **`validateAndLoadOdfFromPath` + `resolveOdfSessionForTool`** returning an
  `OdfSession` (with the same concurrent-auto-open dedup structure). File-first
  `.odt` calls therefore auto-open just like `.docx` (UX parity), without touching
  the DOCX resolver.
- **`isOdfRequest(manager, args)`** discriminant in `dispatchToolCall`: true if the
  canonical path already has an `OdfSession`, **or** the `file_path` extension is
  `.odt`. Evaluated after `isGDocsRequest` (gdocs uses a different arg, so no
  overlap). DOCX is the fall-through, unchanged.
- **`checkOdfSupport(toolName)`** provider guard (parallel to `checkGDocsSupport`):
  the Phase-1 ODF tool set is `read_file`, `replace_text`, `save`, `get_file_status`,
  `close_file` (plus `open_document` for explicit opens). Every other tool
  (`compare_documents`, `accept_changes`, `add_comment`, `insert_paragraph`, `grep`,
  footnotes, `export`, `format_layout`, …) returns a clear `UNSUPPORTED_FOR_ODF`
  error rather than mis-running DOCX logic on an ODF session.
- A lazily-imported ODF handler set (`loadOdfHandlers`, mirroring `loadGDocsHandlers`)
  servicing the Phase-1 tools.
- `open_document.ts` also gains the `.odt` branch for explicit opens; `.odt` is
  removed from the "unsupported extension" set, all other extensions keep
  `INVALID_FILE_TYPE`.

Net: DOCX and gdocs code paths are byte-for-byte unchanged; ODF is a third parallel
provider lane (resolver + guard + handler set + session type), not a widening of the
DOCX lane. This is more files than "3 tool branches" but it is the only change that
doesn't destabilize the DOCX typing — which is the point of the slice.

## Decision 5 — `replace_text` scope: single-text-node matches in Phase 1

ODF visible paragraph text is not a single string: it spans `#text` nodes,
`text:span` (formatting runs), `text:s` (run of N spaces, `text:c="N"`), `text:tab`,
`text:line-break`, hyperlinks, fields, and annotations. `replaceTextById` must define
exactly what it edits. Phase 1 scope:

- The view builds a paragraph's **visible text** by concatenating descendant text,
  expanding `text:s` → N spaces and `text:tab` → a tab, in document order.
- `replace_text` finds `findText` in that visible string. If the matched region maps
  to a **contiguous span within a single `#text` node** (no intervening `text:s` /
  `text:tab` / element boundary), it is replaced in place — the smallest, safest edit.
- If the match **crosses node/element boundaries** or includes an expanded
  `text:s` / `text:tab`, Phase 1 returns a transactional `MATCH_SPANS_MULTIPLE_NODES`
  error and makes **no** change. Cross-span replacement (the DOCX "fragmented run"
  problem) is deferred to Phase 2.

This is honest about the slice: it edits real `.odt` paragraphs where the match lies
in one text node (the common case for Google-Docs-exported `.odt`, which wraps each
paragraph's text in one span), and refuses — visibly, without corrupting the file —
the cases it can't yet do safely. Tests cover a plain match, a `text:s`-adjacent
match, a `text:tab` case, and a span-crossing match (expected rejection).

## Decision 4 — Round-trip safety = semantic + structural, not byte equality

A byte-identical round trip is impossible (and not the product guarantee even for
DOCX). Phase 1 asserts, after `open → replace_text → save → reopen`:

1. The `mimetype` entry is still first and stored uncompressed.
2. Every ZIP entry **not** semantically modified is present and its **decompressed
   content** is byte-identical to the input (only `content.xml` changes for a
   `replace_text`). The compressed container bytes may differ — see Decision 1.
3. `content.xml` parses as well-formed XML after save.
4. Re-read visible text of the edited paragraph equals the expected post-replace
   string; every **unchanged** paragraph's text is preserved.
5. A real LibreOffice headless conversion (`soffice --headless --convert-to`) opens
   the saved `.odt` without error (CI-gated; skipped with a logged warning when
   `soffice` is unavailable locally so the unit suite stays hermetic).

## Risks / Trade-offs

- **JSZip mimetype ordering.** If JSZip can't guarantee first-entry-uncompressed in
  practice, `save()` falls back to assembling the zip with the `mimetype` written
  before any `.file()` call and `STORE` compression; the LibreOffice smoke is the
  backstop that catches a regression here. (Primary residual risk — explicitly tested.)
- **Structural ordinals vs. durable anchors.** Acceptable for a read/replace/save
  slice; called out as the Phase 2 upgrade. A reviewer should confirm no Phase 1 path
  inserts/deletes paragraphs (none does).
- **Residual monorepo CI coupling.** odf-core adds to `npm run build`/`test` fan-out;
  it does not touch DOCX release lists (guarded by `check:release-isolation`).
- **`@xmldom/xmldom` namespace handling.** ODF is namespace-heavy; the view must use
  `getElementsByTagNameNS` / `localName` consistently (the docx-core `getWAttr`
  prefix-fallback pattern is the model). Mis-handling namespaces is the likeliest
  parse bug; covered by fixture tests on a real `.odt`.

## Migration Plan
Additive only. No existing DOCX or gdocs behavior changes; no spec deltas to existing
capabilities. odf-core ships `private: true`; the unscoped/scoped ODF publish and
`release-odf.yml` are deferred to a later change at a genuine publish-readiness gate.

## Open Questions
- Should `validateOdfArchiveSafety` and `validateDocxArchiveSafety` be unified into a
  shared `validateZipArchiveSafety(buffer, { expectedMimetype? })` in docx-core?
  Deferred — clone now, unify later only if a third format appears.
- Phase 2 anchor durability: inject `xml:id` on first open (like DOCX bookmarks) vs.
  a content-hash anchor scheme. Decide when `insert_paragraph` lands.
