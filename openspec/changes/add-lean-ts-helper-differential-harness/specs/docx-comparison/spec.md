## ADDED Requirements

### Requirement: Executable differential harness establishes Lean↔TS accept/reject/validate extensional equivalence reproducibly in CI

The system SHALL exercise the genuine Lean Tier 2 track-change helpers — `Tier2.AcceptReject.accept`, `Tier2.AcceptReject.reject`, and `Tier2.FieldStructure.validateFieldStructure` (`verification/lean/Tier2/`) — against the production TypeScript engine `acceptAllChanges`, `rejectAllChanges`, and `validateFieldStructure` (`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`, `pipeline.ts`) over shared generated inputs, asserting agreement as a reproducible CI gate. This extends the LCS differential (the merged `add-lean-ts-lcs-differential-harness`) to the accept/reject/validate surface that the headline `inv_field_001` theorem is about.

The harness SHALL run the **actual compiled Lean definitions**, not a re-implementation: a Lean executable (`verification/lean/DifferentialHelpers.lean`, registered as the `leanHelperDifferential` `lean_exe` target) reads a batched JSON document `{ "cases": [ { "doc": Doc } ] }` from stdin, runs the three helpers per case, and emits `{ "results": [ { "validate": Bool, "accept": Doc, "reject": Doc } ] }` to stdout, where `Doc` is a tagged-union JSON encoding of `Tier2.OoxmlModel.Doc` (paragraphs → blocks → runs → atoms, with `ins`/`del`/`moveFrom`/`moveTo`/`other` wrappers; opaque `pPr`/`rPr` markers omitted). The executable SHALL contain no `sorry` and SHALL NOT alter the spike's zero-`sorry` status.

A TypeScript property test (`packages/docx-core/src/integration/lean-differential-helpers.test.ts`) SHALL:

- generate `Doc` values over a small alphabet via `fast-check`, constrained to the **faithful subset** in which the Lean model and the production engine provably agree: `fldChar`/`instrText` only in top-level runs (never inside a track-change wrapper), `delInstrText` only in its one OOXML-legal home inside a `del` wrapper in an open pre-`separate` field (where both engines agree), and every paragraph retaining surviving top-level content under accept;
- render each generated `Doc` both to the Lean JSON encoding and, via a **`Doc`→`document.xml` adapter**, to a real OOXML `document.xml` string parseable by the engine's `@xmldom/xmldom` path;
- run the TS helpers in-process per case and spawn the Lean executable **once per memory-bounded chunk** of the batch;
- compare `accept`/`reject` outputs on a **canonical token projection** that both the Lean output `Doc` and the TS output XML reduce to deterministically (paragraph/run/wrapper/atom tokens in document order), and compare `validate` as a boolean, asserting strict per-case equality;
- assert the known out-of-subset model cases explicitly as fixed cases rather than hiding them: `fldChar` inside `del` (G1) and `delInstrText` outside `del` (G2) — now **closed** to agreement by `add-lean-deleted-field-code-constraint` — and reject of an `ins`-only untracked-mark paragraph (G4) — now **closed** to agreement by the engine fidelity fix `make-reject-paragraph-collapse-mark-based` (mark-based reject) — plus the one still-characterized gap, accept of an `ins`-wrappered collapsing paragraph (G3);
- **skip** with a clear message when the Lean executable is absent (so a developer without the Lean toolchain still gets a green `npm test`), while CI builds the executable so the comparison runs there.

The harness SHALL assert **strict** agreement on the faithful subset by default; any in-subset divergence is a genuine finding, NOT a reason to weaken the assertion. The out-of-subset cases SHALL be asserted explicitly: G1/G2 as agreement (the DeletedFieldCode locality constraint is modeled), G4 as agreement (reject is now mark-based, an engine fidelity fix), and the remaining gap G3 as a documented divergence (a characterization case), forming the worklist for the next model-broadening increment. This requirement strengthens extensional-equivalence evidence between the existing Lean and TS helpers only; it introduces no production-engine change and modifies no proved Lean module.

#### Scenario: [LEAN-HELP-01] Compiled Lean accept/reject/validate match the TS engine on generated docs in the faithful subset

- **GIVEN** the `leanHelperDifferential` executable built from `verification/lean/DifferentialHelpers.lean` and a `fast-check` arbitrary generating `Doc`s within the faithful subset
- **WHEN** each `Doc` is rendered to `document.xml`, run through both the in-process TS helpers and the spawned Lean executable, and the accept/reject outputs are reduced to the canonical token projection
- **THEN** `validate` (boolean) and the accept and reject token streams are identical between the two on every generated case, asserted strictly

#### Scenario: [LEAN-HELP-02] Harness skips cleanly without the Lean toolchain and runs in CI

- **WHEN** the differential test runs where the `leanHelperDifferential` executable is absent (a developer without the Lean toolchain or an un-built `.lake`)
- **THEN** the test skips with a message explaining the executable was not found, rather than failing
- **AND** in CI the `lean-build` workflow builds the executable and triggers on the harness file and the production helper sources, so the comparison actually runs and gates merges

#### Scenario: [LEAN-HELP-03] G1 — fldChar inside w:del: Lean and TS validate agree

- **WHEN** the harness runs the fixed [G1] `Doc` with a `w:fldChar` inside a `del` wrapper
- **THEN** both the Lean `validateFieldStructure` and the TS `validateFieldStructure` return `false`, asserted as agreement (the DeletedFieldCode locality constraint is now modeled — see `add-lean-deleted-field-code-constraint`, which closed this former divergence)

#### Scenario: [LEAN-HELP-04] G2 — delInstrText outside w:del: Lean and TS validate agree

- **WHEN** the harness runs the fixed [G2] `Doc` with a `delInstrText` in an open pre-`separate` field outside any `del` wrapper
- **THEN** both the Lean `validateFieldStructure` and the TS `validateFieldStructure` return `false`, asserted as agreement

#### Scenario: [LEAN-HELP-05] G3 — accept paragraph-collapse is a characterized divergence

- **WHEN** the harness runs the fixed [G3] `Doc` with a paragraph whose only content is a `w:ins` wrapping deleted/empty content
- **THEN** the Lean `accept` drops the paragraph while the TS `acceptAllChanges` keeps an empty `<w:p>`, asserted via the token projection as a documented divergence

#### Scenario: [LEAN-HELP-06] G4 — reject paragraph-collapse now agrees (engine fidelity fix)

- **WHEN** the harness runs the fixed [G4] `Doc` with an `ins`-only paragraph whose paragraph mark is untracked (no surviving content)
- **THEN** the Lean `reject` and the TS `rejectAllChanges` both keep the collapsed paragraph as an empty `<w:p>`, asserted via the token projection as agreement — the TS engine's reject is now purely mark-based (`make-reject-paragraph-collapse-mark-based`), matching the already-faithful Lean `reject`

#### Scenario: [LEAN-HELP-07] A real divergence is caught, not masked

- **WHEN** one helper's output is perturbed (e.g. accept and reject token streams swapped, or a `validate` bool flipped)
- **THEN** the harness fails with a per-case diff identifying the diverging input `Doc` and the differing `validate` / accept / reject projection, demonstrating the equality assertions are load-bearing rather than vacuous
