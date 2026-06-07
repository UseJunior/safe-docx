# Tasks: Broaden Lean `accept` to keep empty-collapsing paragraphs (closes G3)

## 1. Lean model

- [x] 1.1 Broaden `accept` (`verification/lean/Tier2/AcceptReject.lean`) to never drop a paragraph
  (`⟨p.pPr, acceptBlocks p.body⟩ :: accept ps`); update the module header and `accept` doc comment to record
  the keep-empty semantics and its symmetry with `reject`.
- [x] 1.2 Reprove `extractText_accept_normalized` (`RoundTripText.lean`) — single cons case, no new lemmas.
- [x] 1.3 Simplify `accept_blocks` (`InvFieldOne.lean`) — collapse to the `reject_blocks` shape; confirm
  `field_structure_preserved_doc` / `inv_field_001` recompile untouched (statement unchanged).
- [x] 1.4 `lake build Tier2` clean; zero `sorry` in `Tier2/*.lean`; `#print axioms
  field_structure_preserved_doc` shows no new axioms; rebuild `leanHelperDifferential`.

## 2. Differential harness

- [x] 2.1 Flip `[LEAN-HELP-05]` G3 in `lean-differential-helpers.test.ts` from divergence to agreement
  (Lean keeps empty `<w:p>`, equals TS).
- [x] 2.2 Add the pinned `[LEAN-HELP-08]` G5 characterization (`del`-only untracked-mark paragraph: Lean
  keeps empty, TS drops) with a comment that the engine accept-side fix is the deferred successor.
- [x] 2.3 Update the module header to record G3 closed (Lean fidelity fix) and G5 as the remaining gap; fix
  the pre-existing "G3/G4 remain" header inconsistency.
- [x] 2.4 Scoped `npm test -w @usejunior/docx-core -- lean-differential-helpers` green (random sweep strict;
  G3 agrees; G5 pinned divergence; perturbation guard intact). Full docx-core suite green (no regression).

## 3. Specs & docs

- [x] 3.1 Revise the pending `add-lean-ts-helper-differential-harness` `docx-comparison` spec in place: G3
  scenario to agreement, add the G5/`[LEAN-HELP-08]` scenario, update the prose (the precedent set by
  `make-reject-paragraph-collapse-mark-based` for G4).
- [x] 3.2 `openspec validate broaden-lean-accept-keep-empty-paragraphs --strict` passes.
- [x] 3.3 Update `verification/ROADMAP.md` / `Tier2/README.md`: record G3 was a Lean over-drop (broadened,
  the inverse of G4's engine over-delete); G3/G4 now both AGREE with the engine + oracle; G5 is the
  newly-pinned symmetric engine accept-side gap. (`lean/README.md` is LCS-only — no G3/G4 content.)
