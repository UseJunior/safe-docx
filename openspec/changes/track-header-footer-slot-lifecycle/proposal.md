# Change: Track headers and footers attached to or dropped from a surviving section

## Why

A header or footer attached to a section that had none, dropped from a
section the revision keeps, or given its own part where the section used to
inherit one, changes what that section shows without adding or removing a
section. The comparison tracked header/footer lifecycles only when a whole
section was added or removed, so these changes were listed in
`unrepresentedChanges`, and a text-box story among them refused the whole
comparison (#1394, split from #763).

`w:sectPrChange` holds a `CT_SectPrBase`, which has no
`w:headerReference`/`w:footerReference` (ECMA-376 Part 1 §17.13.5.32, #944), so
section-reference markup cannot carry the change.

## What Changes

- Before comparing, a slot (section × kind × role) that one document names a
  part for and the other does not, in two documents with the same number of
  sections, gets an explicit reference on the side without one, to a new part
  holding what that section already showed: a copy of the inherited part, or
  a blank story (§17.10.5, §17.10.2). Each document shows the same pages as
  before (`storySlotNormalization.ts`).
- The slot's two stories then pair like any edited header or footer. A story
  paired with a blank one is tracked as a whole insertion or deletion; the
  last paragraph's paragraph and mark properties are tracked against none
  (§17.13.5.29, §17.13.5.30), so the side without the story shows one plain
  empty paragraph.
- Lifecycle stories now track a text box's carrier run with `w:ins`/`w:del`,
  as Word does for an inserted or deleted shape, so Accept All or Reject All
  removes the emptied shape instead of drawing its outline.
- Slots whose display switch (`w:titlePg`, `w:evenAndOddHeaders`) differs, and
  slots that resolve to the same part on both sides, are left to the existing
  section-aligned pairing (#1390).
- Two relationships of one input with identical semantics (a copied part)
  keep separate ids, so they stay two bindings.

## Impact

- Affected specs: `docx-comparison`
- Affected code: `packages/docx-compare/src/tagged/storySlotNormalization.ts`,
  `textBoxRevisionSafety.ts`, `pipeline.ts`
- The published redline keeps a reference the revision dropped: Accept All
  selects a blank story there, which a reader shows as it shows no story.

Non-goals (child issue): a removed or inserted section boundary whose carried
header/footer displaces an inherited one, and a carried lifecycle story with
visible non-text content (a bordered table); both still refuse with
`UnsupportedTextBoxRevisionError`. Documents whose section counts differ are
not normalized.
