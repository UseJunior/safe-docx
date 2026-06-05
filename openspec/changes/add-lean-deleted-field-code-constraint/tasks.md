## 1. Lean model

- [x] 1.1 Thread `delDepth : Nat` through `walkBlocks`/`stepAtoms`/`stepAtom` in
      `verification/lean/Tier2/FieldStructure.lean`; increment only in the `.del bs` recursion.
- [x] 1.2 In `stepAtom`, return `.invalid` for any `fldChar` at `delDepth > 0` (G1) and for any
      `delInstrText` at `delDepth = 0` (G2); keep the existing open-pre-`separate` field check.
- [x] 1.3 Start every entry point (`validateFieldStructure`, `preservationFriendly`, `fieldContextNeutral`,
      `RoundTripText`) at `delDepth = 0`.
- [x] 1.4 `#eval` smoke: G1 doc → `validateFieldStructure = false`; G2 doc → `false`; legal in-subset
      delInstrText-in-del doc → `true`.

## 2. Proof repair (zero-`sorry`) — keep headline, retire legacy

- [x] 2.1 Update `preservationFriendly` (`AcceptReject.lean:105`) and `validateFieldStructure` to walk at
      `walkBlocks 0`; confirm headline `field_structure_preserved_doc` (`InvFieldOne.lean:439`) stays
      plumbing-only.
- [x] 2.2 Delete the legacy `field_structure_preserved` (`InvFieldOne.lean:395`) and its four now-false
      standalone lemmas: `stepAtom_renameAtom` (`:130`), `walkBlocks_renameBlocks` (`:147`),
      `walkBlocks_acceptBlocks` (`:215`), `walkBlocks_rejectBlocks` (`:251`). Delete, do NOT `sorry`. Remove
      any now-dead supporting lemmas they alone used; keep the balance lemmas the headline still needs.
- [x] 2.3 `RoundTripText.lean` references no `walkBlocks` — confirm no change needed.
- [x] 2.4 `cd verification/lean && lake build` clean; `grep -nwH sorry` over non-`.lake` `.lean` empty.

## 3. Differential + characterization flip

- [x] 3.1 In `lean-differential-helpers.test.ts`, change the G1 and G2 fixed cases from asserting
      divergence to asserting Lean==TS agreement (both reject).
- [x] 3.2 Update the pending `add-lean-ts-helper-differential-harness` spec delta scenarios
      `[LEAN-HELP-03]`/`[LEAN-HELP-04]` (and the "four characterized gaps" prose) to reflect that G1/G2 now
      agree; leave G3/G4 as the two remaining characterizations.
- [x] 3.3 Run scoped: `npm run test:run -w @usejunior/docx-core -- src/integration/lean-differential-helpers.test.ts`
      (and the LCS differential) — all green.

## 4. Docs + ship

- [x] 4.1 `verification/ROADMAP.md`: mark G1/G2 closed; keep G3/G4 as the named 4b follow-up; update the
      `field_structure_preserved` reference (`ROADMAP.md:98`) to the doc-level headline.
- [x] 4.2 `verification/lean/README.md` (`:49`) and `verification/lean/Tier2/README.md`: name
      `field_structure_preserved_doc` as the sole headline preservation theorem; note the legacy lemma's
      retirement and why (constraint (3) vacates its precondition).
- [ ] 4.3 Peer-review (codex + agy, dynamic), then ship via `/automerge-smoke` (PR title lowercase).
