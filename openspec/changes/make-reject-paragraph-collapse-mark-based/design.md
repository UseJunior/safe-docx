# Design: mark-based Reject All

## Context

`rejectAllChanges` decided paragraph removal by two paths: (1) the paragraph mark is `PPR-INS`, or (2) a
content heuristic — every substantive run lives inside `w:ins`/`w:moveTo`. Path (2) existed solely because
`wrapParagraphAsInserted` *omitted* `PPR-INS` for non-empty inserted paragraphs (an uncited "Google Docs
compat" choice), so the mark was unavailable to drop them. The primitive `rejectChanges` carried the same
two-path logic (`paragraphHasOnlyInsertedContent`).

## Decision

Make insertions always carry `PPR-INS`, then drop the content heuristic from both reject paths so reject is
purely **mark-based**. This is the rule Word, LibreOffice, and Google Docs all implement: a run-level
insertion under an untracked paragraph mark is text added to a pre-existing paragraph and survives reject
as an empty paragraph; only a `PPR-INS`-marked paragraph (the break itself inserted) is removed.

## Why mark-based, not content-based

Oracle evidence (Stage 0/1):

| Fixture (mark untracked) | op | LibreOffice | Google Docs |
| --- | --- | --- | --- |
| `ins`-only | reject | keep empty `<w:p>` | — |
| `moveTo`-only | reject | keep empty `<w:p>` | — |
| `del`-only | accept | keep empty `<w:p>` | — |
| `ins` **+ PPR-INS** | reject | **drop** | **drop, no leftover empty paragraph** |

The content heuristic is XML-indistinguishable from "text into a pre-existing paragraph", so it cannot be
correct in general; the mark is the only faithful discriminator. Always emitting `PPR-INS` is also *more*
correct: a fully inserted paragraph's mark genuinely is inserted.

## Round-trip safety

safe-docx's own inserted paragraphs now always carry `PPR-INS`, so mark-based reject removes them exactly
as before — the insert→reject round-trip is preserved (validated: full docx-core suite + round-trip-inplace
11/11 + real-corpus regression). The only behavior change is for **foreign** documents whose inserted runs
sit under an untracked mark, which now correctly survive reject as empty paragraphs.

## Scope boundary

Reject side only. The symmetric accept-side content drop (a `del`-only untracked-mark paragraph is dropped
on accept where LibreOffice keeps it) is the same root cause but is left to a follow-up; `wrapParagraphAsDeleted`
already always emits `PPR-DEL`, so safe-docx's own deletions are already mark-based and unaffected. The Lean
accept-side gap `G3` (broaden Lean `accept` to keep empty-collapsing paragraphs) is its own successor change.
