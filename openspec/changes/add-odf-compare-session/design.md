# Design — ODF `compare_documents` session mode

## Context

The two-file ODF compare (Slice 1) is stateless: it loads both `.odt`s itself because two-file
inputs carry no `file_path` and cannot route through `resolveOdfSessionForTool`. Session mode's
input *is* a `file_path`, so it can — and should — use the standard ODF session lane. The engine
(`compareOdf(originalContentXml, revisedContentXml, opts)`) is reused unchanged.

## Goals / Non-Goals

- Goals: session-mode `.odt` compare with response parity (`mode: 'session'` + session-resolution
  metadata); no session-state mutation; an unedited session yields an empty redline.
- Non-Goals: intra-paragraph granularity (#356); changing the engine; DOCX/gdocs behavior.

## Decisions

- **Route via the `dispatchOdf` handler map.** `compare_documents` is already in
  `ODF_SUPPORTED_TOOLS`, so registering `odfCompareDocumentsSession` in `loadOdfHandlers` gives
  open-or-reuse session resolution, staleness warnings, and metadata attachment for free — the same
  shape as every other ODF session tool.
- **Two-file precedence across all providers** (peer-review blocker). When both
  `original_file_path` and `revised_file_path` are present, two-file mode wins even with a stray
  `file_path` supplied — mirroring `compareDocuments_tool`'s own `twoFileMode` precedence.
  Previously a stray `.odt` `file_path` made two-`.docx` compares fail `UNSUPPORTED_FOR_ODF`; after
  the naive guard-swap it would instead have silently opened a session on the stray `.odt`.
- **Baseline = raw `content.xml` from `session.originalBuffer`, no normalization.** `compareOdf`
  diffs per-block *visible text* (`collectBlocks` + `buildSegments(...).visible`), so
  parse→serialize differences (attribute order, whitespace-in-tags) cannot surface as phantom
  changes. Verified by direct probe: `compareOdf(raw, serialize(parse(raw)))` over the sample
  fixture returns `{insertions: 0, deletions: 0, modifications: 0}`. The DOCX-style normalized
  baseline (`ensureBaselines`) is unnecessary for ODF; scenario [OPCS-02] pins this, including a
  fixture with serialization-sensitive constructs (`text:s`, `text:tab`, `text:line-break`,
  `text:h`, entity-escaped text, `office:annotation`).
- **Fresh `OdfArchive` from `originalBuffer` for both baseline extraction and redline packaging.**
  `SessionManager.saveOdfTo` stamps `session.archive` with `doc.toXml()` on every save, so the live
  archive's `content.xml` may already be the *edited* state (unusable as a baseline), and writing
  redline markup into it would poison the live session. Packaging the redline on the fresh original
  archive is valid under a **current invariant**: today's ODF session edit tools mutate
  `content.xml` only (the same premise `saveOdfTo` rests on), so the original package plus the
  redline `content.xml` *is* the revised redline package. If a future ODF tool mutates non-content
  parts (styles.xml, manifest, …), session compare must switch to a revised-session package
  baseline or copy the modified parts. Scenario [OPCS-06] pins the no-mutation property.
- **No `allow_overwrite` for the output path.** Comparison inputs are never overwritable (parity
  with the DOCX tool and two-file mode, issue #313), even though `save` offers `allow_overwrite`.

## Risks / Trade-offs

- [Invariant drift: a future ODF tool touches non-content parts] → invariant stated in the handler
  comment + here; [OPCS-06] catches session poisoning, and redline output is built from the
  original package so such a tool's parts would be *missing* from the redline — the invariant note
  tells the implementer where to fix it.
- [Pending-change coupling: `add-odf-compare` not yet archived] → its delta is amended in this PR
  (OPCD-04 re-point), following the #348 precedent for sequential slices.
