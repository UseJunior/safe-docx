# Change: Place boundary insertions at an equivalent in-run offset

## Why

Inserting words next to a highlighted fill-in or an emphasised word fails
closed with `MIXED_FORMATTING_REQUIRES_DETAIL`, even when an equivalent
placement of the same text sits inside one run (#1167). Example:
`reserves [Number]` → `reserves up to [Number]`. The token diff inserts
`up to ` at the boundary before `[Number]`. Inserting ` up to` one character
earlier, inside the plain run, gives identical text. Created instruments
(#1162) are full of fill-ins, so this blocks most first edits in the
brownfield flow unless the author adds `format-source`.

## What Changes

- For body paragraphs whose edit declares no formatting (`format-source`,
  run-format, run-format spans or retained-format spans), a zero-width
  insertion hunk that lands on an ambiguous formatting boundary may move
  across an adjacent U+0020 space when the inserted text starts or ends with
  one. That is the only kind of slide; letters are never rotated.
- The first in-run offset in each direction is a candidate. The insertion
  moves only when every candidate inherits the same formatting, so the rule
  never chooses between two formats.
- A move never crosses a neighbouring hunk or any range marker (bookmark,
  comment range, permission, move range), so marker membership cannot change.
  Otherwise the hunk is unchanged and compilation still fails closed.
- Preflight, application and rationale ranges all use the same placement.
- Rationale ranges use the same placement.
- Story (header/footer) edits are unchanged.
- **Policy note for review:** this resolves cases that previously failed
  closed. For example, `Alpha beta.` (with `beta.` bold) becoming
  `Alpha inserted beta.` now inherits the plain run without `format-source`.
  The text is identical either way, but the chosen formatting is the one that
  admits an equivalent offset. Insertions with no space to move across (for
  example `Alpha -beta.`, `Alpha:bravo beta`), moves that would cross a
  bookmark, and moves whose candidates disagree all still fail closed.

## Impact

- Affected specs: `docx-markdoc` (one ADDED requirement).
- Affected code: `packages/docx-markdoc/src/compile.ts`; tests in
  `insertion-placement.test.ts`. The existing SDX-MDOC-10 drift test now uses
  a genuinely ambiguous insertion for its fail-closed case.
