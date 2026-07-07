## 1. Invariant registry (source of truth)

- [ ] 1.1 Create `verification/registry/invariants.json` with one entry per current invariant: `INV-ATOMSEQ-001`, `INV-LCS-001..004`, `INV-LCS-002+` (the `atomsEqual`-level optimality strengthening, `rawMatches_are_longest_relevant`, matching the ID `verification/lean/README.md` already uses), `INV-LCS-DP-001`, `INV-FIELD-001`, `INV-RT-001`. Each entry: `id`, `statement` (plain English), `tier` (`proven` | `proven-modulo-axiom` | `empirically-validated` | `tested-only`), `leanTheorem` (name), `leanFile`, `productionSurface` (path:lines mirrored), `residualAxioms` (array, verbatim names), `caveats` (array), `falsifier` (CI job/test that fails if the claim breaks).
- [ ] 1.2 Record the two residual-obligation axioms verbatim on the INV-FIELD-001 / INV-RT-001 entries: `LeanSpike.compareDocumentXml_output_preservation_friendly`, `LeanSpike.compareDocumentXml_output_text_roundtrip`. Record the uninterpreted signature axiom `LeanSpike.compareDocumentXml` in a distinct field (e.g. `signatureAxioms`) on those entries — it declares the modeled function's existence and must not be conflated with the residual obligations.
- [ ] 1.3 Add entries (tier `empirically-validated`) for the Lean↔TS correspondences that are differentials, not proofs: the LCS differential (`lean-differential-lcs.test.ts`), the Tier 2-helper differential (`lean-differential-helpers.test.ts`), the fast-check bridge (`lean-spec-bridge.test.ts`), and the local-only LibreOffice oracle (`libreoffice-oracle.ts`) with the local-only + structural-projection caveats.
- [ ] 1.4 Sanity-check every `leanTheorem` name and `leanFile` path against the actual sources in `verification/lean/`; every `productionSurface` path against `packages/docx-core/src`.

## 2. Axiom audit (CI gate)

- [ ] 2.1 Add `verification/lean/AxiomAudit.lean` referencing the flagship theorems and emitting `#print axioms` for each: `inv_field_001`, `inv_rt_001`, `computeAtomLcsDP_eq_computeAtomLcs`, `rawMatches_are_longest_relevant`, and the four Tier 1 LCS theorems. Must add no `sorry` and no `axiom`; builds under `lake build`.
- [ ] 2.2 Add `verification/lean/expected-axioms.txt` — the allowlist, using fully qualified names as `#print axioms` emits them: `LeanSpike.compareDocumentXml`, `LeanSpike.compareDocumentXml_output_preservation_friendly`, `LeanSpike.compareDocumentXml_output_text_roundtrip`, `propext`, `Classical.choice`, `Quot.sound`. (Verified against the current spike: `inv_field_001` depends on `[propext, LeanSpike.compareDocumentXml, LeanSpike.compareDocumentXml_output_preservation_friendly, Quot.sound]`; `inv_rt_001` adds `Classical.choice` and the text-roundtrip axiom.)
- [ ] 2.3 Add an axiom-audit step to `.github/workflows/lean-build.yml` after `Build LeanSpike`: run the `AxiomAudit.lean` `#print axioms` output through a normalizer (strip per-theorem headers; sort the **union** of fully-qualified axiom names across all flagship theorems — individual theorems legitimately use subsets) and diff against `expected-axioms.txt`; fail on any observed axiom not in the allowlist AND on any allowlist entry never observed in the union (forces intentional edits). Print the offending axiom(s) on failure.
- [ ] 2.4 Add a `schedule:` trigger to `lean-build.yml` (e.g. weekly cron) so proofs are re-audited independently of the path filter. Keep the existing `push`/`pull_request`/`workflow_dispatch` triggers and the zero-`sorry` audit.
- [ ] 2.5 Verify the audit fails as intended: locally add a throwaway `axiom foo : True` used by a flagship theorem's dependency and confirm the diff step reports it; revert.

## 3. Generated doc + drift check

- [ ] 3.1 Add `scripts/generate_invariants_doc.mjs`, cloned from `scripts/generate_conformance_doc.mjs`: read `verification/registry/invariants.json`, emit `verification/INVARIANTS.md` grouped by tier, each row carrying statement / tier / theorem / falsifier / caveats, residual axioms named in full, and a header stating the four-tier taxonomy verbatim.
- [ ] 3.2 Add `scripts/check_invariants_doc.mjs`, cloned from `scripts/check_conformance_doc.mjs`: regenerate to a temp buffer and fail if it differs from the committed `verification/INVARIANTS.md`.
- [ ] 3.3 Wire `check:invariants-doc` (and a `generate:invariants-doc` companion, matching the conformance script pair) into root `package.json`, and add `check:invariants-doc` to the CI job that already runs `check:conformance-doc`.
- [ ] 3.4 Generate and commit `verification/INVARIANTS.md`.

## 4. Roadmap bookkeeping

- [ ] 4.1 Mark Increment 1 as in progress in `verification/ROADMAP.md` under "Direction change (2026-07-07)".

## 5. Validation

- [ ] 5.1 `lake build` in `verification/lean/` succeeds (zero `sorry`, `AxiomAudit.lean` builds); the axiom-audit step passes against the committed allowlist.
- [ ] 5.2 `node scripts/generate_invariants_doc.mjs` then `npm run check:invariants-doc` is clean; deliberately editing the registry reddens the drift check.
- [ ] 5.3 `openspec validate add-invariant-registry-and-axiom-audit --strict` passes.
