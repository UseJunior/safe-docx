# Change: Broaden Lean `accept` to keep empty-collapsing paragraphs (closes G3, oracle-validated)

## Why

The Lean↔TS helper differential (`add-lean-ts-helper-differential-harness`) pinned **G3**: accepting a
paragraph whose body collapses to empty (e.g. a `w:ins` wrapping only deleted content) under an **untracked**
paragraph mark — the Lean `accept` **drops** the whole paragraph (`AcceptReject.lean`), while the TS
`acceptAllChanges` **keeps** an empty `<w:p>`. G3 is the inverse of G4 (closed by
`make-reject-paragraph-collapse-mark-based`): where G4 was an engine over-deletion on reject, **G3 is a Lean
over-deletion on accept** — the TS engine was already faithful, and a reference-implementation oracle agrees:

- **LibreOffice** (driven headless, accept-all): a paragraph whose content edits collapse to empty under an
  untracked mark accepts to an **empty paragraph that survives** — the paragraph node is never in any redline
  range, only its text is. This matches the TS engine.
- **OOXML semantics:** a content-level insertion/deletion under an *untracked* paragraph mark means text was
  edited inside a **pre-existing** paragraph, so accepting those edits never removes the paragraph itself.
  Only a `PPR-INS`/`PPR-DEL` paragraph **mark** governs whether the paragraph is added/removed.

The old Lean `accept` dropped a paragraph whenever its accepted body was empty (`if (acceptBlocks p.body).isEmpty
then accept ps`). This over-drops relative to the engine + LibreOffice + Word. Broadening `accept` to **never
drop** (structurally symmetric with `reject`, which already never drops) closes G3 by fixing the Lean model.

## What Changes

- `accept` (`verification/lean/Tier2/AcceptReject.lean`) SHALL keep every paragraph: a body that collapses to
  empty leaves an empty paragraph behind (`⟨p.pPr, acceptBlocks p.body⟩ :: accept ps`), dropping the
  `isEmpty` special-case. This makes `accept` symmetric with `reject`.
- The two downstream theorems that branched on the old empty-drop SHALL be reproved (mechanically simpler,
  no new lemmas, verified by `lake build`): `extractText_accept_normalized` (`RoundTripText.lean`) collapses
  to a single cons case where `normalizeText` absorbs the empty entry; `accept_blocks` (`InvFieldOne.lean`)
  collapses to the `reject_blocks` shape. The headline `field_structure_preserved_doc` /
  `preservationFriendly` / `inv_field_001` are **insulated** — `accept_blocks`'s STATEMENT is unchanged
  (`(accept d).blocks = acceptBlocks d.blocks`) because a dropped-empty and a kept-empty paragraph both
  contribute `acceptBlocks p.body = []` to the flattened `Doc.blocks`. The spike stays zero-`sorry`; `#print
  axioms field_structure_preserved_doc` shows no new axioms.
- The G3 case in `lean-differential-helpers.test.ts` (`[LEAN-HELP-05]`) flips from *characterized divergence*
  to *agreement*; the pending `add-lean-ts-helper-differential-harness` G3 scenario is revised in place to
  match (that change is not yet archived).
- A new characterization case **G5** (`[LEAN-HELP-08]`) is pinned: broadening Lean `accept` surfaces a
  **symmetric ENGINE accept-side over-deletion** — a `del`-only untracked-mark paragraph accepts to an empty
  `<w:p>` in Lean / LibreOffice / Word, but the TS `acceptAllChanges` drops it via a content-based heuristic
  (the accept-side mirror of the reject over-deletion fixed in `make-reject-paragraph-collapse-mark-based`).
  The TS accept-side mark-based fix is the deferred successor increment; G5 pins the gap so it stays visible.

## Impact

- Affected specs: `docx-comparison` (ADDED: one requirement; the pending helper-differential change's G3
  scenario is revised in place and a G5/`[LEAN-HELP-08]` scenario is added, since that change is not yet
  archived).
- Affected code: `verification/lean/Tier2/AcceptReject.lean`, `verification/lean/Tier2/RoundTripText.lean`,
  `verification/lean/Tier2/InvFieldOne.lean`, and
  `packages/docx-core/src/integration/lean-differential-helpers.test.ts` (flip G3, add G5). No
  production-engine code changes (`trackChangesAcceptorAst.ts` is read, not edited).
- **No production behavior change.** This is a Lean-model fidelity fix; the TS engine accept path is
  unchanged. The differential's random sweep stays strict (the faithful-subset generator never emits an
  empty-collapsing paragraph), full docx-core suite green.
- The symmetric **G5** engine accept-side over-deletion (`del`-only untracked-mark dropped on accept) is
  newly pinned and is the next engine-fidelity increment.
