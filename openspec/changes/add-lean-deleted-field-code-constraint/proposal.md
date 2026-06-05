# Change: Model the DeletedFieldCode locality constraint in the Lean field-structure walk (closes G1/G2)

## Why

The Lean↔TS helper differential (`add-lean-ts-helper-differential-harness`) pinned four
characterized model gaps where `Tier2.FieldStructure.validateFieldStructure` disagrees with the
production `validateFieldStructure` (`pipeline.ts`). Two of them — **G1** (`w:fldChar` inside
`w:del`) and **G2** (`w:delInstrText` outside `w:del`) — are the two halves of one OOXML rule the
Lean model does not yet enforce: the `DeletedFieldCode` *locality* constraint (constraint (3) at
`pipeline.ts:427-428`). The current Lean walk treats `del` as fully transparent
(`FieldStructure.lean:86`) and carries no del-ancestry, so it accepts both shapes the engine rejects.
Teaching the model this one constraint closes G1 and G2 together and tightens the model's fidelity to
the real `validateFieldStructure` surface — the headline `inv_field_001` theorem is about.

This is slice 4a of the Tier 2.5 model-broadening worklist. G3/G4 (paragraph-mark accept/reject
collapse) require an `OoxmlModel` datatype extension and are deferred to a follow-up change.

## What Changes

- Thread a structural **del-ancestry depth** through the field-context walk
  (`walkBlocks`/`stepAtoms`/`stepAtom` in `verification/lean/Tier2/FieldStructure.lean`).
- `stepAtom` enforces constraint (3): a `w:fldChar` of any kind at del-depth > 0 is `invalid` (G1, all
  `fldCharType`s, mirroring `pipeline.ts:542`); a `w:delInstrText` at del-depth 0 is `invalid` (G2,
  `pipeline.ts:555`), in addition to the existing open-pre-`separate` field-body check.
  `instrText` / `delText` / `text` gating is unchanged.
- Keep the **load-bearing** headline `field_structure_preserved_doc` (`InvFieldOne.lean:439`) — update
  `preservationFriendly` (`AcceptReject.lean:105`) and `validateFieldStructure` to walk at `walkBlocks 0`;
  the proof stays plumbing.
- **Retire** the legacy, non-load-bearing `field_structure_preserved` (`InvFieldOne.lean:395`) and its four
  now-false standalone lemmas (`stepAtom_renameAtom`, `walkBlocks_renameBlocks`, `walkBlocks_acceptBlocks`,
  `walkBlocks_rejectBlocks`). Constraint (3) makes the `reject` rename `delInstrText → instrText`
  non-walk-invariant at del-depth 0, so these become false-as-stated; their `recursivelyWellformed`
  precondition is already audit-only and now excludes legal `delInstrText`-in-`del` documents. Deleted, not
  `sorry`-stubbed, so the spike stays **zero-`sorry`**. (`RoundTripText.lean` references no `walkBlocks` — no
  repair there.)
- Flip the G1/G2 cases in `packages/docx-core/src/integration/lean-differential-helpers.test.ts` from
  *characterized divergence* to *agreement* (Lean now matches the engine), and update the pending
  `add-lean-ts-helper-differential-harness` scenarios `[LEAN-HELP-03]`/`[LEAN-HELP-04]` to match.
- Update `verification/ROADMAP.md` and `verification/lean/README.md`: G1/G2 closed; G3/G4 remain the
  named 4b follow-up.

## Impact

- Affected specs: `docx-comparison` (ADDED: one requirement; the pending helper-differential change's
  G1/G2 scenarios are revised in place since that change is not yet archived).
- Affected code: `verification/lean/Tier2/FieldStructure.lean` (walk + `walkBlocks 0`),
  `AcceptReject.lean` (`preservationFriendly` → `walkBlocks 0`),
  `verification/lean/Tier2/InvFieldOne.lean` (keep headline; retire legacy theorem + 4 lemmas),
  `packages/docx-core/src/integration/lean-differential-helpers.test.ts`, and docs
  (`verification/ROADMAP.md`, `verification/lean/README.md`, `verification/lean/Tier2/README.md`).
- No production-engine change. Zero-`sorry` preserved (CI-gated).
