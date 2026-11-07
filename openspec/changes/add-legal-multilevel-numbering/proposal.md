# Change: Add legal multilevel numbering

## Why

Most US M&A and finance forms number their outline as ARTICLE I → Section 1.01
→ (a) → (i) → (A), with "(a)" restarting in each Section. Word builds this from
one multilevel list: the Section level prints the article number in Arabic
(`w:isLgl`) and zero-pads its own number (`decimalZero`), and the Article and
Section levels are linked to Heading 1 / Heading 2 (`w:pStyle`), so applying the
heading style numbers the paragraph. `NumberingSpec` cannot express any of this:
`decimalZero` fails validation, there is no `isLgl`, `lvlRestart`, or `pStyle`,
level indents take only `left`/`hanging` (legal clauses put the label at 0.5"
with `firstLine` and the text at a tab stop), and each definition emits exactly
one `w:num`, so a list cannot restart. Issue #1235 tracks the gap.

## What Changes

- Add `decimalZero` to the authorable `numFmt` subset, through a closed
  `NUMBERING_LEVEL_FORMATS` array that the union and the validator share.
- Add level properties `isLgl` (`w:isLgl`), `lvlRestart` (`w:lvlRestart`),
  `pStyle` (`w:pStyle`), `indentTwips.firstLine`, and `tabs` (`w:pPr/w:tabs`).
  Level children are emitted through a new `LVL_ORDER` table in CT_Lvl order.
- A level's `pStyle` must name a declared paragraph style that no other level
  links; the compiler writes the reverse link (`w:numPr` naming the
  definition's default instance and the level) into that style's `w:pPr`, so a
  paragraph that only sets `styleId` is numbered.
- Add `NumberingSpec.instances`: additional `w:num` instances of the same
  abstract definition, each with `levelOverrides` (`w:lvlOverride` /
  `w:startOverride`). Paragraphs reference an instance by its handle, like the
  definition's own. Additional instances take numeric ids after every default
  instance, so existing ids never shift.
- `lvlRestart` accepts only `0` or values below the level's `ilvl`: Word for Mac
  drops a level's numbering when `lvlRestart` equals `ilvl` (the default
  restated), observed with the Word oracle.
- Read side (`primitives/numbering.ts`): label computation honors `isLgl`,
  `decimalZero`, and `lvlRestart`, so generated legal outlines read back as
  "Section 2.01".
- Correct the conformance registry: `w:pStyle` on `w:lvl` is § 17.9.23 (the
  registry and two citations said § 17.9.22, which is the level `w:pPr`); add
  entries for § 17.9.4, 17.9.8, 17.9.10, 17.9.22, and 17.9.26.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement, scenarios
  `SDX-GEN-112`–`SDX-GEN-117`).
- Affected code: `packages/docx-core/src/generation/{types,validate-spec,ordering,compile}.ts`,
  `emit/numbering-part.ts`, `emit/styles-part.ts`,
  `packages/docx-core/src/primitives/numbering.ts`, the ECMA-376 registry and
  the generated conformance outputs.
- Backward compatible: every new field is optional, and a spec that uses none of
  them emits byte-identical output.
- Reader notes, from the Word for Mac and LibreOffice 26.2 oracles: both readers
  keep one running sequence per abstract definition, so an instance's
  `startOverride` restarts that shared sequence rather than starting a list that
  counts separately; LibreOffice ignores `w:lvlRestart`.
- Out of scope: full `w:lvl` overrides inside an instance, numbering style
  links (`w:numStyleLink`/`w:styleLink`), resolving style-linked numbering in
  the read-side document view, and per-abstract-definition read-side counters.
