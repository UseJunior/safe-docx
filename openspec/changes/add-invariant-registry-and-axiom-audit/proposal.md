# Change: Add a machine-readable invariant registry and a `#print axioms` CI gate

## Why

The Lean 4 verification spike (`verification/lean/`) is now zero-`sorry` and carries exactly two named residual-obligation axioms — `compareDocumentXml_output_preservation_friendly` and `compareDocumentXml_output_text_roundtrip` (both in `verification/lean/LeanSpike/Spec.lean`), owned by Tier 3 — plus the uninterpreted signature axiom `LeanSpike.compareDocumentXml` (the modeled engine function itself is declared as an `axiom`, so it appears in every flagship theorem's `#print axioms` output; confirmed by running the audit against the current spike during proposal review). That is a strong, honest position. It is also invisible and under-guarded:

1. **The proof status is not machine-readable anywhere.** What is proven (LCS family, DP equivalence), what is proven-modulo-one-axiom (INV-FIELD-001, INV-RT-001), and what is only empirically validated (the differentials, the fast-check bridge, the local-only LibreOffice oracle) lives only as prose in `verification/ROADMAP.md`, `verification/lean/README.md`, and the OpenSpec archive. There is no single source of truth a doc generator, a tool response, or a trust page can read.
2. **The axiom count is guarded only by prose.** `verification/lean/README.md` suggests inspecting `#print axioms inv_field_001` / `inv_rt_001` by hand. The `lean-build` CI job audits zero-`sorry` (`.github/workflows/lean-build.yml:107-125`) but does **not** audit the axiom set. A future PR could add a *third* residual axiom — silently weakening every downstream claim — and nothing would fail. The zero-`sorry` audit cannot catch this because an `axiom` is not a `sorry`.
3. **The `lean-build` workflow is path-filtered**, so the proofs can rot on a toolchain or mathlib bump that touches nothing under the filtered paths, with no scheduled re-run to surface it.

This change is the first increment of the verified-checker + trust/demo track recorded in `verification/ROADMAP.md` ("Direction change (2026-07-07)"). It is deliberately **packaging only — no new proofs and no production-engine changes** — because everything downstream (the verified checker's certificate, the per-save verification block, the red-team demo, the site trust page, the README block) generates from the registry this change introduces and is protected by the axiom gate this change enforces. It mirrors the shape of the repo's existing conformance trust pipeline (`spec-compliance/registry/` → `scripts/generate_conformance_doc.mjs` → drift-checked `CONFORMANCE.md`), applied to verification.

## What Changes

- **New `verification/registry/invariants.json`** — the machine-readable source of truth. One entry per invariant, each carrying:
  - stable ID (e.g. `INV-LCS-001`, `INV-FIELD-001`, `INV-RT-001`, `INV-ATOMSEQ-001`, `INV-LCS-DP-001`),
  - a plain-English statement,
  - a **tier** from the four-tier taxonomy: `proven` (model-internal, no assumptions beyond Lean+mathlib), `proven-modulo-axiom`, `empirically-validated` (differential / property test), or `tested-only`,
  - the exact Lean theorem name + file (e.g. `Tier2.InvFieldOne.field_structure_preserved_doc` in `verification/lean/Tier2/InvFieldOne.lean`),
  - the production surface it mirrors (e.g. `packages/docx-core/src/baselines/atomizer/atomLcs.ts:45-104`),
  - residual axioms, if any (verbatim names),
  - scope caveats (inplace-mode only, text projection only, field-free generators, small-scope-exhaustive sweep bounds, LibreOffice-oracle-local-only, etc.),
  - the **falsifier**: the concrete CI job or test that fails if the claim breaks (e.g. `lean-build` zero-`sorry` audit + axiom audit; `packages/docx-core/src/integration/lean-differential-lcs.test.ts`; `packages/docx-core/src/integration/lean-spec-bridge.test.ts`). The falsifier field is the highest-trust column and is what distinguishes this from a marketing table.
- **New `verification/lean/AxiomAudit.lean`** — a Lean module that references the flagship theorems so their axiom dependencies can be printed deterministically in CI: at minimum `inv_field_001`, `inv_rt_001`, `computeAtomLcsDP_eq_computeAtomLcs`, `rawMatches_are_longest_relevant`, and the four Tier 1 LCS theorems. It emits `#print axioms` for each (built by `lake build` like the other modules; no new `sorry`, no new `axiom`).
- **New `verification/lean/expected-axioms.txt`** — the committed allowlist the audit diffs against, using **fully qualified names** (as `#print axioms` actually emits them): the two residual-obligation axioms (`LeanSpike.compareDocumentXml_output_preservation_friendly`, `LeanSpike.compareDocumentXml_output_text_roundtrip`), the uninterpreted signature axiom (`LeanSpike.compareDocumentXml`), and Lean's standard trusted axioms (`propext`, `Classical.choice`, `Quot.sound`). The observed set is the **union across all flagship theorems** (individual theorems legitimately use subsets — e.g. `inv_field_001` does not use `Classical.choice`). Any axiom outside this set on any flagship theorem fails CI. The registry and generated doc classify the signature axiom separately from the two residual obligations — it declares the modeled function's existence, it is not an additional unproven claim about the engine's behavior.
- **`.github/workflows/lean-build.yml`** — add an **axiom-audit step** after `lake build` that runs the `AxiomAudit.lean` output through a normalizer (strip per-theorem headers; sort the unioned, fully-qualified axiom names) and diffs the observed union against `expected-axioms.txt`, failing loudly on any addition (a new axiom) and on any removal (an allowlisted axiom no longer observed anywhere — which should force an intentional allowlist edit, not silently pass). Add a **`schedule:` trigger** so the proofs are re-audited on a cadence independent of the path filter. The existing zero-`sorry` audit stays.
- **New `scripts/generate_invariants_doc.mjs`** — cloned from `scripts/generate_conformance_doc.mjs`; reads `verification/registry/invariants.json` and emits `verification/INVARIANTS.md`, a human-readable table grouped by tier, each row carrying statement / tier / theorem / falsifier / caveats, with the two residual axioms named in full.
- **New drift check `check:invariants-doc`** — cloned from `scripts/check_conformance_doc.mjs` and wired into the root `package.json` scripts (and the same CI job that already runs `check:conformance-doc`), so `INVARIANTS.md` cannot drift from the registry.
- **`verification/INVARIANTS.md`** — the generated artifact, committed so it is diffable in PRs.
- **`verification/ROADMAP.md`** — mark Increment 1 as in progress under the "Direction change (2026-07-07)" section (status bookkeeping only).

## Scope guardrails

- **Packaging only. No new proofs.** No `.lean` proof content changes except the additive, `sorry`-free, `axiom`-free `AxiomAudit.lean`. The registry *describes* the existing proof state; it does not extend it.
- **No production-engine or MCP changes.** Nothing under `packages/*/src` (outside test/generated surfaces) is touched. The per-save certificate, verified checker, and demo are later increments with their own changes.
- **The registry records today's truth.** Every tier assignment, theorem name, residual axiom, and falsifier must match the spike as it currently stands (zero-`sorry`, exactly two residual-obligation axioms plus the `compareDocumentXml` signature axiom). No forward-looking or aspirational rows.
- **The four-tier taxonomy is carried verbatim and no row collapses tiers.** A `proven-modulo-axiom` invariant is never labeled `proven`; an `empirically-validated` correspondence (Lean↔TS extensional equivalence) is never labeled a proof.
- **The axiom allowlist is exactly the two residual-obligation axioms, the `LeanSpike.compareDocumentXml` signature axiom, and Lean's standard trusted axioms.** Widening it is an explicit, reviewable edit — never an automatic consequence of a proof change.

## Impact

- **Affected specs:** `docx-comparison` (new requirements added — see `specs/docx-comparison/spec.md`).
- **Affected code:** `verification/registry/invariants.json` (new), `verification/lean/AxiomAudit.lean` (new), `verification/lean/expected-axioms.txt` (new), `.github/workflows/lean-build.yml` (axiom-audit step + `schedule:` trigger), `scripts/generate_invariants_doc.mjs` (new), `scripts/check_invariants_doc.mjs` (new), `verification/INVARIANTS.md` (new, generated), root `package.json` (new `check:invariants-doc` script + wiring), `verification/ROADMAP.md` (status).
- **No production-engine code changes.** All work is in the verification, CI, docs-generation, and registry surfaces.
- **CI:** the axiom-audit step and `schedule:` trigger extend `lean-build`; the `check:invariants-doc` drift check joins the existing conformance-doc gate. No new external dependencies (the generator/checker reuse the conformance scripts' Node-only approach; the audit uses `lake`/`grep` already present on the runner).
