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
  run-format or run-format spans), a zero-width insertion hunk that lands on an
  ambiguous formatting boundary is slid across equal characters (left first,
  then right). The first equivalent offset with an unambiguous template is
  used.
- A slide never crosses a neighbouring hunk and never splits a surrogate pair.
  When no equivalent in-run offset exists, the hunk is unchanged and
  compilation still fails closed.
- Rationale ranges use the same placement.
- Story (header/footer) edits are unchanged.
- **Policy note for review:** this resolves cases that previously failed
  closed. For example, `Alpha beta.` (with `beta.` bold) becoming
  `Alpha inserted beta.` now inherits the plain run without `format-source`.
  The text is identical either way, but the chosen formatting is the one that
  admits an equivalent offset. Insertions sharing no edge character with
  either neighbour (for example `Alpha -beta.`) still fail closed.

## Impact

- Affected specs: `docx-markdoc` (one ADDED requirement).
- Affected code: `packages/docx-markdoc/src/compile.ts`; tests in
  `insertion-placement.test.ts`. The existing SDX-MDOC-10 drift test now uses
  a genuinely ambiguous insertion for its fail-closed case.
