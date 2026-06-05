# Change: Add ODF core library and provider-aware `.odt` editing slice

## Why
Germany's IT-Planungsrat has made OpenDocument Format (ODF) mandatory for
federal/state administration, and Google Docs now surfaces `.odt` export directly
under PDF. Safe-DOCX has no ODF capability today: local file handling is
`.docx`-hardcoded (`open_document.ts` rejects every non-`.docx` extension with
`INVALID_FILE_TYPE`, and `SessionManager` only knows how to load/save `DocxDocument`).

This change adds the first viable ODF vertical: open a real `.odt`, read its
paragraphs, replace text in a targeted paragraph, and save with round-trip safety —
the minimal slice that exercises the full provider-aware architecture end to end.
It deliberately does **not** attempt tracked changes, comparison, comments, or
`.ods`/`.odp`; those are deferred to Phase 2.

## What Changes
- New `@usejunior/odf-core` package (born `private: true`, per the release-isolation
  guard added in `add-odf-release-isolation`):
  - `OdfArchive` — an ODF package handler (parallel to `DocxArchive`) enforcing
    ODF rules: the `mimetype` entry stored **first and uncompressed**; part-path
    constants for `content.xml`, `styles.xml`, `meta.xml`, `META-INF/manifest.xml`;
    untouched entries preserved byte-for-byte on save.
  - `validateOdfArchiveSafety` — ODF archive-safety guard reusing docx-core's
    format-agnostic `inspectZipEntries` (zip-bomb / entry-count / ratio limits)
    plus an ODF mimetype assertion.
  - ODF namespace constants (`text:`/`office:`/`style:`/`table:`).
  - `OdfDocument` minimal view — parse `content.xml` into a block-level paragraph
    list (`text:p` / `text:h`, including paragraphs nested in `table:table-cell`)
    with **deterministic structural paragraph IDs** and `replaceTextById`.
- Provider-aware MCP wiring in `@usejunior/docx-mcp` (no new tool surfaces):
  - Extension-aware local resolution in `open_document.ts` — `.odt` opens an
    `OdfSession` instead of being rejected; non-supported extensions still error.
  - `OdfSession` added to the `Session` union; `createOdfSession` + an ODF save
    path in `SessionManager`.
  - Per-provider branching in `read_file` / `replace_text` / `save` keyed on
    `session.provider === 'odf'` (mirrors the existing gdocs handler pattern, but
    discriminated by session provider rather than a request arg).
- `.odt` test fixtures under `odf-core` (a real Google-Docs-exported `.odt`) and a
  LibreOffice "opens cleanly" smoke as compatibility evidence.

## Impact
- Affected specs: none existing — `odf-core` is a new capability (purely additive).
- Affected code: new `packages/odf-core/`; `packages/docx-mcp/src/tools/open_document.ts`,
  `session/manager.ts`, `server.ts`, and `tools/{read_file,replace_text,save}.ts`
  (additive provider branches; DOCX and gdocs paths unchanged).
- `odf-core` stays `private: true` until a real `release-odf.yml` track exists and
  passes preflight (no name-squatting; enforced by `check:release-isolation`).
- Round-trip guarantee for Phase 1 is **semantic + structural, not byte equality**;
  tracked-changes/comparison round-trip is explicitly out of scope.
