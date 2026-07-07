## ADDED Requirements

### Requirement: Machine-readable invariant registry is the single source of truth for verification status

The system SHALL maintain a machine-readable registry at `verification/registry/invariants.json` that records, for every named verification invariant, its stable ID, a plain-English statement, its tier from the four-tier taxonomy, the exact Lean theorem name and file that establishes it, the production code surface it mirrors, any residual axioms (by verbatim name), scope caveats, and a falsifier (the concrete CI job or test that fails if the claim breaks). The four tiers are: `proven` (machine-checked in Lean with no assumptions beyond Lean + mathlib), `proven-modulo-axiom` (machine-checked except for explicitly named residual axioms), `empirically-validated` (established by a deterministic differential harness or property test, not a proof — including Lean↔TS extensional equivalence), and `tested-only` (covered by conventional tests, not formally verified). The registry SHALL record today's actual proof state — the spike as it currently stands (zero-`sorry`, exactly two residual-obligation axioms `LeanSpike.compareDocumentXml_output_preservation_friendly` and `LeanSpike.compareDocumentXml_output_text_roundtrip`, plus the uninterpreted signature axiom `LeanSpike.compareDocumentXml` recorded distinctly) — with no aspirational or forward-looking rows, and SHALL NOT collapse tiers (a `proven-modulo-axiom` invariant is never recorded as `proven`; a Lean↔TS differential is never recorded as a proof).

#### Scenario: [INV-REG-01] Registry enumerates every current invariant with its tier and theorem

- **WHEN** `verification/registry/invariants.json` is read
- **THEN** it contains an entry for each current invariant (`INV-ATOMSEQ-001`, `INV-LCS-001` through `INV-LCS-004`, `INV-LCS-002+` — the `atomsEqual`-level optimality strengthening `rawMatches_are_longest_relevant`, under the ID `verification/lean/README.md` already uses — `INV-LCS-DP-001`, `INV-FIELD-001`, `INV-RT-001`)
- **AND** each entry carries a `tier` drawn from `{proven, proven-modulo-axiom, empirically-validated, tested-only}`, a `leanTheorem` name, a `leanFile` path under `verification/lean/`, and a `falsifier`

#### Scenario: [INV-REG-02] The residual-obligation axioms and the signature axiom are recorded distinctly on the invariants that carry them

- **WHEN** the `INV-FIELD-001` and `INV-RT-001` entries are read
- **THEN** their tier is `proven-modulo-axiom`
- **AND** their `residualAxioms` list names `LeanSpike.compareDocumentXml_output_preservation_friendly` (for `INV-FIELD-001`) and `LeanSpike.compareDocumentXml_output_text_roundtrip` (for `INV-RT-001`) exactly as declared in `verification/lean/LeanSpike/Spec.lean`
- **AND** the uninterpreted signature axiom `LeanSpike.compareDocumentXml` is recorded in a distinct field (not inside `residualAxioms`), so the declaration of the modeled function's existence is never conflated with an unproven claim about the engine's behavior

#### Scenario: [INV-REG-03] Lean↔TS correspondence is recorded as empirical, not proven

- **WHEN** the entries describing the Lean↔TS differentials and the fast-check bridge are read
- **THEN** their tier is `empirically-validated`, not `proven` or `proven-modulo-axiom`
- **AND** the LibreOffice-oracle entry carries caveats recording that it is local-only and compares a structural projection

### Requirement: An enforced CI axiom-audit gate pins the residual-axiom set

The system SHALL enforce, in CI, that the flagship Lean theorems depend on no axioms outside a committed allowlist. A Lean module `verification/lean/AxiomAudit.lean` SHALL emit the axiom dependencies (`#print axioms`) of at least `inv_field_001`, `inv_rt_001`, `computeAtomLcsDP_eq_computeAtomLcs`, `rawMatches_are_longest_relevant`, and the four Tier 1 LCS theorems, adding no `sorry` and no new `axiom`. A committed allowlist `verification/lean/expected-axioms.txt` SHALL contain, in fully qualified form as `#print axioms` emits them, exactly the two residual-obligation axioms (`LeanSpike.compareDocumentXml_output_preservation_friendly`, `LeanSpike.compareDocumentXml_output_text_roundtrip`), the uninterpreted signature axiom (`LeanSpike.compareDocumentXml`), and Lean's standard trusted axioms (`propext`, `Classical.choice`, `Quot.sound`). The `.github/workflows/lean-build.yml` workflow SHALL run an axiom-audit step after `lake build` that diffs the observed axiom set — the union across all flagship theorems, since individual theorems legitimately depend on subsets — against the allowlist and fails the job on any axiom outside the allowlist (a newly introduced axiom) and on any allowlist entry never observed in the union (forcing an intentional allowlist edit rather than silent drift). This audit is distinct from and additional to the existing zero-`sorry` audit, which cannot detect an added `axiom`. The workflow SHALL additionally carry a `schedule:` trigger so the proofs are re-audited on a cadence independent of the existing path filter.

#### Scenario: [INV-AXIOM-01] The audit passes for the current spike

- **WHEN** `lake build` and the axiom-audit step run in `.github/workflows/lean-build.yml` against the current zero-`sorry` spike
- **THEN** the observed axiom set for the flagship theorems equals the `expected-axioms.txt` allowlist
- **AND** the job succeeds

#### Scenario: [INV-AXIOM-02] Introducing a third residual axiom fails the gate

- **GIVEN** a change that makes any flagship theorem depend on an axiom not in `verification/lean/expected-axioms.txt`
- **WHEN** the axiom-audit step runs
- **THEN** the step fails and names the offending axiom
- **AND** the failure is not maskable by the zero-`sorry` audit, because the offending declaration is an `axiom`, not a `sorry`

#### Scenario: [INV-AXIOM-03] The proofs are re-audited on a schedule independent of the path filter

- **WHEN** the `lean-build` workflow's `schedule:` trigger fires with no change to the path-filtered files
- **THEN** `lake build`, the zero-`sorry` audit, and the axiom-audit step all run
- **AND** a toolchain or mathlib regression that added an unexpected axiom would fail the scheduled run

### Requirement: A generated, drift-checked invariant document is derived from the registry

The system SHALL generate a human-readable `verification/INVARIANTS.md` from `verification/registry/invariants.json` via `scripts/generate_invariants_doc.mjs`, following the same generate-then-drift-check pattern the repo already uses for conformance (`scripts/generate_conformance_doc.mjs` / `scripts/check_conformance_doc.mjs`). The document SHALL group invariants by tier, state the four-tier taxonomy verbatim, name the residual axioms in full, and carry each invariant's falsifier. A drift check `check:invariants-doc` (backed by `scripts/check_invariants_doc.mjs`) SHALL fail if the committed `verification/INVARIANTS.md` differs from what the generator produces from the registry, and SHALL run in the CI job that already runs the conformance-doc drift check.

#### Scenario: [INV-DOC-01] The document regenerates deterministically from the registry

- **WHEN** `scripts/generate_invariants_doc.mjs` is run against `verification/registry/invariants.json`
- **THEN** it writes `verification/INVARIANTS.md` grouped by tier, with the four-tier taxonomy stated verbatim and each row carrying statement, Lean theorem, residual axioms (if any), and falsifier

#### Scenario: [INV-DOC-02] Drift between registry and document fails CI

- **GIVEN** an edit to `verification/registry/invariants.json` that is not reflected in the committed `verification/INVARIANTS.md`
- **WHEN** `npm run check:invariants-doc` runs
- **THEN** it exits non-zero and reports the drift
