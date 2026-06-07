## ADDED Requirements

### Requirement: Accept All removes paragraphs by the paragraph-mark deletion marker, not by content

The production Accept All SHALL remove a paragraph during accept **if and only if** its paragraph mark is a
tracked deletion (`<w:pPr><w:rPr><w:del/>`, "PPR-DEL"). This applies to both accept entry points —
`acceptAllChanges` (`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`) and the primitive
`acceptChanges` (`packages/docx-core/src/primitives/accept_changes.ts`) — which SHALL behave identically.
Accept SHALL NOT remove a paragraph based on a content heuristic (e.g. "all runs live inside
`w:del`/`w:moveFrom`"): a run-level deletion under an **untracked** paragraph mark denotes text deleted from a
pre-existing paragraph, which Microsoft Word and LibreOffice both keep as an empty paragraph on accept; a
content-based drop over-deletes it. The mark check SHALL be a strict direct-child traversal
(`w:p > w:pPr > w:rPr > w:del`), so a `w:del` nested inside a `w:pPrChange` snapshot is NOT mistaken for a
live paragraph mark.

`wrapParagraphAsDeleted` already always emits the `PPR-DEL` marker, so safe-docx's own genuinely-deleted
paragraphs remain removable by this mark-based rule without the content heuristic. This is the accept-side
mirror of `make-reject-paragraph-collapse-mark-based` (which made Reject All mark-based, closing G4). It
closes the characterized accept-side divergence `G5` recorded by the Lean↔TS helper differential as an
**engine fidelity fix** (the Lean `accept`, broadened by `broaden-lean-accept-keep-empty-paragraphs` to keep
empties, was already faithful): the TS and Lean `accept` SHALL now agree on a `del`-only untracked-mark
paragraph. With G5 closed, every characterized G-case (G1–G5) agrees between the genuine Lean helpers and the
production engine. This requirement changes production accept behavior only for foreign / mark-omitting input;
safe-docx's own deleted paragraphs always carry `PPR-DEL`, so their delete→accept round-trip is preserved.

#### Scenario: [ACCEPT-MARK-01] Del-only paragraph with an untracked mark survives accept as an empty paragraph

- **GIVEN** a paragraph whose only content is a `w:del`-wrapped run and whose paragraph mark is NOT `PPR-DEL` (text deleted from a pre-existing paragraph)
- **WHEN** it is run through `acceptAllChanges` (and through the primitive `acceptChanges`)
- **THEN** the deleted run is removed and the now-empty paragraph is kept, matching Word/LibreOffice and the Lean `accept` (the former `G5` divergence is now agreement)

#### Scenario: [ACCEPT-MARK-02] PPR-DEL-marked paragraph is removed by accept

- **GIVEN** a paragraph whose paragraph mark is a tracked deletion (`<w:pPr><w:rPr><w:del/>`)
- **WHEN** it is run through `acceptAllChanges` (and through the primitive `acceptChanges`)
- **THEN** the whole paragraph is removed, including its mark, matching Word/LibreOffice

#### Scenario: [ACCEPT-MARK-03] MoveFrom-only paragraph with an untracked mark survives accept as an empty paragraph

- **GIVEN** a paragraph whose only content is a `w:moveFrom`-wrapped run (the move source) and whose paragraph mark is untracked
- **WHEN** it is run through `acceptAllChanges` (and through the primitive `acceptChanges`)
- **THEN** the moved-away content is removed and the now-empty paragraph is kept (the symmetric `moveFrom` content heuristic is removed in lockstep with the `w:del` one)

#### Scenario: [ACCEPT-MARK-04] A pPrChange snapshot's nested w:del is not a live paragraph mark

- **GIVEN** a surviving paragraph whose `w:pPrChange` snapshot nests a `w:del` inside its stored `w:rPr`
- **WHEN** it is run through `acceptAllChanges` (and through the primitive `acceptChanges`)
- **THEN** the paragraph is kept (the strict direct-child mark check ignores the snapshot del), so both accept paths agree
