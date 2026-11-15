# Change: Add layout-character and paragraph-topology publication checks

## Why

The tagged publication gate compares Accept All and Reject All text projections against the source sides, and its text normalization erased two kinds of difference. The projection ignored `w:tab`, `w:br`, `w:cr`, `w:noBreakHyphen` and `w:softHyphen`, and normalization turned tabs into spaces that then collapsed. Normalization also collapsed repeated paragraph breaks and trimmed the ends, so an empty paragraph disappeared. A comparison output that dropped a tab between a section number and its heading, a non-breaking hyphen in "non-exclusive", or a spacer paragraph would still publish. These are verifier gaps (#1026, #1027).

## What Changes

- The gate projects each run-content layout element to a stable character: tab U+0009, line break and `w:cr` U+000B, page break U+000C, column break U+000E, non-breaking hyphen U+2011, optional hyphen U+00AD. `acceptText` and `rejectText` compare that projection with a normalizer that keeps those characters. Equivalent spellings (a literal tab in `w:t`, `w:cr` versus a bare `w:br`, the Unicode hyphens in `w:t`) project alike. Drawings, pictures, embedded objects, `w:ptab` and `w:pgNum` stay outside the claim.
- New `acceptParagraphTopology` and `rejectParagraphTopology` checks in `TaggedPublicationSafetyChecks` compare paragraph count and which paragraphs are empty, reported separately from the text checks, with `ParagraphTopologyMismatchDetails` in the failure details. Text-box paragraphs are outside the check.
- The default `extractRoundTripComparisonText` projection is unchanged; the gate opts in with `{ layoutCharacters: true }`.
- The stricter text check caught one real defect, fixed here because it made the public ILPA pair unpublishable: the serializer's equal-text run refinement cut fragments from the revised runs, so a `w:tab` added or removed at a run edge, or moved between re-segmented runs, vanished from Reject All or was duplicated. Equal-text gaps with tabs now place each tab by text offset: tabs both sides share stay live, and the extra tabs of either side become a tracked deletion or insertion.
- The topology check accepts extra empty paragraphs at the very end of a projection. A story's last paragraph mark cannot be removed, so when a deleted or inserted final paragraph keeps its revision on its own mark (the #891 relocation skips content inside a hyperlink, or a mark with pre-existing revisions), Accept or Reject leaves an empty final paragraph; LibreOffice does the same. The serializer residue is pinned by a characterization test and left as a follow-up.
- Reject All in the gate's projector now treats a paragraph whose mark's `w:rPrChange` snapshot records a `w:ins` or `w:moveTo` as mark-inserted. The comparison emits that shape when a pre-tracked inserted paragraph appears plain in the revised document; rejecting it removes the paragraph in LibreOffice, while the projector left an empty paragraph, which the new topology check reported as a false failure.

## Impact

- Affected specs: `docx-comparison`
- Affected code: `packages/docx-compare/src/fieldComparisonSemantics.ts`, `packages/docx-compare/src/tagged/trackChangesAcceptorAst.ts`, `packages/docx-compare/src/tagged/pipeline.ts`, `packages/docx-compare/src/tagged/taggedTreeSerializer.ts`, `packages/docx-compare/src/compare-types.ts`
- Public API: two new check names and fields, one new exported type, an optional `normalize` argument on `compareTexts` and an optional options argument on `extractRoundTripComparisonText`.
- Ref: #1026, #1027 (split from #798)
