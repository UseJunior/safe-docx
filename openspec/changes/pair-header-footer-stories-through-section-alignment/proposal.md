# Change: Pair header/footer stories through section alignment

## Why

Header and footer text edits were tracked only when both documents had the
same section topology: the same section count, the same set of
`w:headerReference`/`w:footerReference` slots, the same section properties
apart from the reference ids, and the same `w:evenAndOddHeaders` setting. Any
other difference sent every header/footer edit into `unrepresentedChanges`,
so the redline silently left it out: a section added or removed, a page-size
or orientation change, `w:titlePg` switched, even/odd headers switched, or a
slot moved to a differently named part (#1390, split from #763).

What a reader sees is not the literal references. Each section shows, per
kind and role, its own reference or the one the previous section shows
(ECMA-376 Part 1 §17.10.5 headers, §17.10.2 footers); `w:titlePg` (§17.10.6)
and `w:evenAndOddHeaders` (§17.10.1) decide which role each page uses. #1204
added a resolver for these effective bindings (`effectiveStoryBindings.ts`).

## What Changes

- A header/footer story's identity is its **effective slot**: section × kind
  × role after inheritance, together with the pages (first, odd, even) that
  use it.
- Slots are paired **through the section alignment the body comparison
  emitted**. Reject All of the compared package has the original's sections in
  order and Accept All has the revised document's, so slot `i` of the rejected
  package stands for the original's section `i` whatever was added, removed or
  re-laid-out. A compared part (the revised side's part) is paired with an
  original story when every slot and page of the rejected package that shows
  the part shows that one original story. The redline of that story is
  spliced into the part (`sectionAlignedStoryPairing.ts`,
  `sectionAlignedOrdinaryStoryInputs`).
- A pair is kept only if every page it touches comes out right in both
  projections: each page of the original that shows a paired story must be
  reproduced by Reject All, and each page Accept All shows from a paired part
  must be what the revised document shows. Otherwise the stories stay in
  `unrepresentedChanges` as before.
- Turning `w:evenAndOddHeaders` on with a new even story: the settings part
  has no revision markup, so the compared package keeps the revised value and
  Reject All still shows the even story on even pages. The new even story
  therefore receives the redline from the story the original showed on even
  pages (its default story), and Accept All / Reject All reproduce both sides.
- Positional header/footer reports in `unrepresentedChanges` are dropped for a
  section and kind whose every slot and page now comes out right in both
  projections with a paired story among them.
- The topology-matched pass (#998) and the text-box and lifecycle story checks
  (#648, #754, #1204) are unchanged; the new pass covers only parts none of them
  wrote.

## Non-goals

- **Text-box stories.** A part holding a text box on either side keeps the
  #1204 checks; a section-layout change alongside its edit still refuses where
  the projection check fails.
- **Stories attached to or removed from a surviving section, and carried
  stories displacing inherited ones** (#1394). A slot whose original page is
  blank is not paired.
- **`formattingFidelity` on removed section breaks** (#1203).
- **Different scaffolds.** The pair must share the admitted scaffold and
  relationship closure of topology-matched ordinary stories; a structural
  change (table rows, drawings, fields) stays unrepresented.
- **Turning different even pages off.** With the setting off in the compared
  package, every page of Reject All shows the default story, so no redline can
  show the original's even story on even pages and its default story on odd
  pages. The edit stays unrepresented unless both original stories have the
  same content.
- **Turning even pages on with no even story.** Reject All would leave the
  original's even pages blank; carrying the original default story there
  needs a story that exists in neither document. The edit stays unrepresented.
- **The positional detector itself** (`unrepresentedChanges.ts`). It still
  compares sections by position; only its reports for slots this change
  represents are removed.
- Pagination is not modelled (as in #1204).

## Impact

- Affected specs: `docx-comparison`
- Affected code: `packages/docx-compare/src/tagged/sectionAlignedStoryPairing.ts`
  (new), `textBoxRevisionSafety.ts`, `pipeline.ts`
- Behaviour change: a header/footer slot the revision rebinds to a
  differently named part across a section-layout change is now one story
  redline rather than an unrepresented change (the #754 test
  "does not track-delete a footer whose slot the revision rebinds" is updated).
