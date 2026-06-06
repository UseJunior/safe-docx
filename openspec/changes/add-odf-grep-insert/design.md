# Design notes — ODF `grep` + `insert_paragraph`

## Positional ID shift (key decision)
ODF paragraph IDs are document-order ordinals (`p0,p1,…`); there are no durable anchors yet
(deferred). Inserting shifts every ID at/after the insertion point. Two peer reviewers (Codex,
agy) agreed this is acceptable for Phase 2a **provided** the contract is machine-actionable:
- `insertParagraph` returns the inserted blocks' freshly recomputed IDs.
- The tool response includes `invalidates_paragraph_ids_after`, `requires_reread_before_next_edit`,
  and a human `ids_note`.
- `replaceTextById` already fails closed with `TEXT_NOT_FOUND` on a stale ID (verified), so a
  mis-targeted edit errors rather than silently corrupting the wrong paragraph.
Durable injected `xml:id` anchors remain out of scope.

## grep core extraction
The DOCX grep search loop is pure over `{id,text}[]` + an optional locator map. Extracted to
`tools/grep_core.ts` (`searchParagraphsCore` / `searchRawXmlCore`) so the ODF lane reuses it
without duplicating the dedupe / truncation / context logic. Behavior-preserving — covered by
the existing `grep.test.ts` (agy ran it green). ODF passes `locatorById = null` (no list-label /
header in the ODF view).

## Style inheritance heading guard
Copying `text:style-name` blindly from a `text:h` anchor would make an inserted body paragraph
render as a heading. Guard: inherit only when `anchor.localName === 'p'`.

## `\n\n` parity
DOCX `insert_paragraph` splits `new_string` on blank lines into multiple paragraphs. ODF matches
this (blank line → separate `text:p`; single `\n` → `text:line-break`) so agents get consistent
multi-paragraph behavior across providers.

## Dispatch safety
`isGDocsRequest` keys on `google_doc_id`; `isOdfRequest` keys on the `.odt` extension and is
checked after the gdocs branch. Multi-file grep uses `file_paths` (not `file_path`), so
`isOdfRequest` is false there and it stays on the DOCX lane (which rejects `.odt` gracefully).
No session-key collision: gdocs sessions are keyed `gdocs:<id>`, docx/odf by canonical path, and
the `resolveSessionForTool` chokepoint returns `UNSUPPORTED_FOR_ODF` before any DocxSession cast.
