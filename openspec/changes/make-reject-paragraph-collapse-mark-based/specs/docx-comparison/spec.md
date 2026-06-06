## ADDED Requirements

### Requirement: Reject All removes paragraphs by the paragraph-mark insertion marker, not by content

The production Reject All SHALL remove a paragraph during reject **if and only if** its paragraph mark is a
tracked insertion (`<w:pPr><w:rPr><w:ins/>`, "PPR-INS"). This applies to both reject entry points —
`rejectAllChanges` (`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`) and the
primitive `rejectChanges` (`packages/docx-core/src/primitives/reject_changes.ts`) — which SHALL behave
identically. Reject SHALL NOT remove a paragraph based on a content heuristic (e.g. "all runs live inside
`w:ins`/`w:moveTo`"): a run-level insertion under an **untracked** paragraph mark denotes text inserted
into a pre-existing paragraph, which Microsoft Word and LibreOffice both keep as an empty paragraph on
reject; a content-based drop over-deletes it.

To make every genuinely inserted paragraph removable by this mark-based rule, `wrapParagraphAsInserted`
(`packages/docx-core/src/baselines/atomizer/inPlaceModifier-wrappers.ts`) SHALL always emit the `PPR-INS`
marker, including for non-empty paragraphs, mirroring `wrapParagraphAsDeleted` (which already always emits
`PPR-DEL`). The prior omission of `PPR-INS` for non-empty paragraphs (justified by an uncited claim that
Google Docs hides `w:ins` runs coexisting with `PPR-INS`) SHALL be removed: Google Docs renders the
inserted runs identically with `PPR-INS` present and rejects such a paragraph cleanly with no leftover
empty paragraph.

This closes the characterized reject-side divergence `G4` recorded by the Lean↔TS helper differential as an
**engine fidelity fix** (the Lean `reject`, which keeps the empty paragraph, was already faithful): the TS
and Lean `reject` SHALL now agree on an `ins`-only untracked-mark paragraph. The accept-side gap `G3`
(Lean `accept` dropping empty-collapsing paragraphs) is out of scope and remains the successor increment.
This requirement changes production reject behavior only; safe-docx's own inserted paragraphs always carry
`PPR-INS`, so their insert→reject round-trip is preserved.

#### Scenario: [REJECT-MARK-01] Ins-only paragraph with an untracked mark survives reject as an empty paragraph

- **GIVEN** a paragraph whose only content is a `w:ins`-wrapped run and whose paragraph mark is NOT `PPR-INS` (text inserted into a pre-existing paragraph)
- **WHEN** it is run through `rejectAllChanges` (and through the primitive `rejectChanges`)
- **THEN** the inserted run is removed and the now-empty paragraph is kept, matching Word/LibreOffice and the Lean `reject` (the former `G4` divergence is now agreement)

#### Scenario: [REJECT-MARK-02] PPR-INS-marked inserted paragraph is removed by reject

- **GIVEN** a paragraph whose paragraph mark is a tracked insertion (`<w:pPr><w:rPr><w:ins/>`)
- **WHEN** it is run through `rejectAllChanges` (and through the primitive `rejectChanges`)
- **THEN** the whole paragraph is removed, including its mark, matching Word/LibreOffice/Google-Docs

#### Scenario: [REJECT-MARK-03] wrapParagraphAsInserted always emits the PPR-INS marker

- **GIVEN** a paragraph with substantive run content that is being marked as a tracked insertion
- **WHEN** `wrapParagraphAsInserted` is applied
- **THEN** a `PPR-INS` paragraph-mark marker is present in `w:pPr/w:rPr`, so mark-based reject removes the paragraph (the prior no-op-for-substantive-runs behavior is reversed)

#### Scenario: [REJECT-MARK-04] safe-docx insert→reject round-trip is preserved

- **GIVEN** the in-place modifier inserting paragraphs into a real document (each inserted paragraph now carrying `PPR-INS`)
- **WHEN** the result is run through reject
- **THEN** every inserted paragraph is removed and the document round-trips to its pre-edit paragraph structure, with the existing round-trip-inplace and real-corpus regression suites passing
