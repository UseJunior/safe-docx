## 1. Engine: mark-based accept (both paths, in lockstep)

- [x] 1.1 `acceptAllChanges` (`trackChangesAcceptorAst.ts`): remove the content-based all-`w:del`/`w:moveFrom`
      paragraph-drop loops; keep only the `paragraphHasParaMarker(p, 'w:del')` mark-based drop. Replace the
      stale lead comment with the full mark-based rationale (mirrors `rejectAllChanges`).
- [x] 1.2 `acceptChanges` (`primitives/accept_changes.ts`): remove `paragraphHasOnlyRemovedContent` and its
      drop branch; keep only the `paragraphHasParaMarker(p, 'del')` mark-based drop.
- [x] 1.3 Remove the now-dead helpers/constants left behind (`containsRun`, `isWElement`,
      `REMOVED_LOCALS`/`KEPT_LOCALS`/`RANGE_MARKER_LOCALS` in `accept_changes.ts`), grep-confirmed unreferenced.
      `tsc --noEmit` clean.

## 2. Tests

- [x] 2.1 `lean-differential-helpers.test.ts`: flip `[LEAN-HELP-08]` (G5) from documented divergence to strict
      agreement (both keep an empty `P[ ]`); update the file header (G5 closed, no KNOWN gap remains).
- [x] 2.2 `trackChangesAcceptorAst.test.ts`: add a targeted regression test running BOTH accept entry points
      (`acceptAllChanges` + primitive `acceptChanges`) over four shapes — PPR-DEL drop, del-only keep,
      moveFrom-only keep, pPrChange-snapshot ignore — asserting the two paths agree. Count `<w:p>` opens with
      a regex that matches self-closing empties (`<w:p/>`).
- [x] 2.3 Full `@usejunior/docx-core` suite green (1347 passed / 3 skipped); helper differential green 8/8
      with the exe.

## 3. Oracle validation (evidence)

- [x] 3.1 The accept-side keep-empty behavior is the LibreOffice/Word-faithful one, established by the same
      headless-LibreOffice oracle run that grounded the #337 reject fix (an untracked paragraph mark is a
      pre-existing paragraph; `del`-only and `moveFrom`-only collapse to an empty `<w:p>`, while the
      `PPR-DEL`-marked control drops). This change ships as a self-validated engine fix via the differential
      flip (`[LEAN-HELP-08]`) and the both-paths regression, exactly as #337 shipped its reject mirror without
      a committed oracle voter; wiring the LibreOffice voter into the harness remains the deferred PR-B.

## 4. Specs / docs

- [x] 4.1 Add the `docx-comparison` ADDED requirement (this change) + scenarios `[ACCEPT-MARK-01..04]`.
- [x] 4.2 Revise the pending `add-lean-ts-helper-differential-harness` G5 scenario (`[LEAN-HELP-08]`) and the
      pending `broaden-lean-accept-keep-empty-paragraphs` G5 scenario (`[ACCEPT-KEEP-04]`) from documented
      divergence to agreement (closed by this change).
- [x] 4.3 Docs: `verification/ROADMAP.md` records G5 closed as an engine accept-side fidelity fix (the
      accept-side mirror of G4/#337); all G1–G5 now agree. (`verification/lean/Tier2/README.md` needs no
      change: it documents the Lean proofs, whose `accept`-keeps-every-paragraph note already reflects the
      G3 broaden; G5 is a TS-engine fix, not a Lean-model change.)
- [ ] 4.4 Ship: peer-review (codex + agy), open PR, `/automerge-smoke`.
