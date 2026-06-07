## ADDED Requirements

### Requirement: The Lean `accept` model keeps paragraphs whose body collapses to empty, matching the engine

The Tier 2 Lean `accept` (`verification/lean/Tier2/AcceptReject.lean`) SHALL preserve every paragraph mark:
accepting a paragraph whose body collapses to empty (e.g. a `w:ins` wrapping only deleted content) under an
**untracked** paragraph mark SHALL leave an empty paragraph behind, NOT drop the paragraph. This makes
`accept` structurally symmetric with `reject` (which already never drops a paragraph). It matches the
production TS `acceptAllChanges`, LibreOffice, and Microsoft Word: a content-level edit under an untracked
paragraph mark denotes text edited inside a **pre-existing** paragraph, so accepting those edits never
removes the paragraph itself — only a tracked paragraph **mark** (`PPR-INS`/`PPR-DEL`) governs whether the
paragraph is added or removed.

Broadening `accept` SHALL preserve the headline preservation theorem `field_structure_preserved_doc` (and
thus `inv_field_001`) without a statement change: because the document field structure is validated over the
flattened `Doc.blocks` stream (`d.flatMap Paragraph.body`), a dropped-empty paragraph and a kept-empty
paragraph both contribute the empty block list, so `accept_blocks` (`(accept d).blocks = acceptBlocks
d.blocks`) holds unchanged. The reproved `extractText_accept_normalized` and `accept_blocks` SHALL introduce
no new lemmas and no new axioms (`#print axioms field_structure_preserved_doc` unchanged), and the spike
SHALL remain zero-`sorry`.

This closes the characterized accept-side divergence `G3` recorded by the Lean↔TS helper differential as a
**Lean fidelity fix** (the inverse of the G4 engine fix `make-reject-paragraph-collapse-mark-based`): the TS
and Lean `accept` SHALL now agree on a `w:ins`-wrappered collapsing paragraph. Broadening `accept` SHALL
surface and the harness SHALL pin a new characterized divergence `G5`: a `del`-only untracked-mark paragraph
accepts to an empty `<w:p>` in Lean (faithful), but the TS `acceptAllChanges` over-deletes it via a
content-based heuristic — the symmetric accept-side analog of the reject over-deletion fixed in
`make-reject-paragraph-collapse-mark-based`, whose TS accept-side mark-based fix is the deferred successor
increment. This requirement modifies the proved Lean model only; it introduces no production-engine change.

#### Scenario: [ACCEPT-KEEP-01] Ins-wrappered collapsing paragraph is kept as an empty paragraph on accept

- **GIVEN** a paragraph whose only content is a `w:ins` wrapping deleted content and whose paragraph mark is NOT `PPR-INS` (text edited inside a pre-existing paragraph)
- **WHEN** it is run through the Lean `accept`
- **THEN** the collapsed body is emptied and the now-empty paragraph is kept, matching the TS `acceptAllChanges`, LibreOffice, and Word (the former `G3` divergence is now agreement)

#### Scenario: [ACCEPT-KEEP-02] Lean `accept` is symmetric with `reject` (never drops a paragraph)

- **GIVEN** any modeled `Doc`
- **WHEN** it is run through the Lean `accept`
- **THEN** the output has exactly one paragraph per input paragraph (none dropped), the same paragraph-preservation property the Lean `reject` already has

#### Scenario: [ACCEPT-KEEP-03] The field-structure preservation theorem is unchanged by broadening

- **GIVEN** the broadened `accept` and the reproved `accept_blocks` / `extractText_accept_normalized`
- **WHEN** the Tier 2 modules are built
- **THEN** `field_structure_preserved_doc` and `inv_field_001` compile with no statement change, the spike is zero-`sorry`, and `#print axioms field_structure_preserved_doc` reports no new axioms

#### Scenario: [ACCEPT-KEEP-04] Broadening surfaces and pins the symmetric engine accept-side gap (G5)

- **GIVEN** a `del`-only paragraph whose paragraph mark is untracked, followed by a surviving paragraph
- **WHEN** both engines accept it
- **THEN** the Lean `accept` keeps an empty `<w:p>` (faithful to LibreOffice/Word) while the TS `acceptAllChanges` drops it, asserted via the harness token projection as the characterized divergence `[LEAN-HELP-08]` (G5), the deferred engine accept-side fidelity fix
