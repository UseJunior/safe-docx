# Design: Fragmented-field fast-check arbitrary

## Context

The bridge file already has three property arbitraries (`pairArb`, `trackedPairArb`, `fieldBearingPairArb`) and a settled assertion vocabulary (`assertInplaceResult`, `assertFieldInvariant`, `assertRecursivelyWellformed`, `assertRoundTripInvariant`, `assertFieldBearingCoverage`). The predecessor established that for **whole, self-contained fields**, the inplace engine always stays inplace and the raw combined output is field-structure-valid, so `assertInplaceResult` (fallback ⇒ failure) and an operation-coverage floor were the right shape.

The fragmented-field surface breaks both of those premises. This design records why, and why that forces a **separate** arbitrary with a **mode-independent** assertion model rather than a fourth operation on `fieldBearingPairArb`.

## The empirical characterization (reproduced)

A standalone probe (clean source/revised pairs built with `buildDocxFromBodyXml`, compared with `engine: 'atomizer', reconstructionMode: 'inplace'`) established the table in `proposal.md`. The four observations that matter:

1. **Instruction-only diffs field-collapse to nothing.** Changing only `w:instrText` between two clean sides (` NUMPAGES ` → ` SECTIONPAGES `) yields `ins=0, del=0` — the atomizer field-collapses the field to a single atom and the instruction text never reaches text extraction, so there is no tracked change and nothing to fragment. An instruction-only operation would therefore be a **vacuous** test (it asserts invariants on an untracked document). It is intentionally **not** one of the operations; the operations that actually fragment are result-text edits and pre-tracked fragmented input.
2. **Result-text edits fragment and stay inplace.** Changing the field **result** run (`1` → `2`) produces `del=2, delInstrText=1, fldChar=6` (the field duplicates across the del/ins sides) and stays inplace; accept, reject, combined all field-validate; round-trip holds.
3. **Direction *and* a result change together trigger fallback.** Feeding a pre-tracked fragmented field as the *original* side and a clean field as the *revised* side stays inplace and validates everywhere. Feeding it as the *revised* side **with the field result also changed** (e.g. clean result `1` → fragmented result `3`) drives the engine to **rebuild** (`round_trip_safety_check_failed`); the raw combined output then fails `validateFieldStructure` even though accept and reject each pass and round-trip holds. Same-result clean→fragmented stays inplace. The fallback diagnostics confirm all four inplace passes fail **only** the `fieldStructure` check (`acceptText`/`rejectText` pass on every pass) — i.e. the inplace candidate is non-conformant (the #217 `fldChar`-in-`del` class), not a text/round-trip failure, so rebuild is the engine's correct defensive choice, not an over-strict check.

## Decision 1 — mode-independent invariants, not `assertInplaceResult`

The residual axioms are statements about `compareDocumentXml` *output*, quantified over inputs — they say nothing about which reconstruction strategy produced that output. On the whole-field surface the engine happens to always pick inplace, so the predecessor could fold "inplace was used" into the assertion for free. On the fragmented surface the engine **correctly** picks rebuild for some inputs (observation 3). Asserting `assertInplaceResult` there would fail a run the engine handled correctly — a false falsification.

So the new property asserts only what the axioms actually claim, on whichever output the engine produced:

- `validateFieldStructure(acceptAllChanges(combined))` and `validateFieldStructure(rejectAllChanges(combined))` (the INV-FIELD-001 obligation, on the resolved projections);
- normalized `accept` text == normalized revised, normalized `reject` text == normalized original (the INV-RT-001 obligation).

It does **not** assert `assertInplaceResult` and does **not** assert `validateFieldStructure(combined)` (observation 3 shows the raw mixed-revision combined output legitimately fails the latter under fallback).

### Why not assert on `combined`?

`validateFieldStructure(combined)` over a raw mixed `<w:ins>`+`<w:del>` field is the wrong obligation: a fragmented field mid-revision is *expected* to have both a deleted and an inserted field skeleton interleaved, which is not a single well-formed field until a side is chosen. The axioms are about the *resolved* (accepted / rejected) documents; that is exactly `acceptAllChanges` / `rejectAllChanges`. Asserting on `combined` would encode a stronger claim than the axioms make and would fail correct fallback output.

## Decision 2 — a mode-distribution coverage floor (the safety valve for dropping `assertInplaceResult`)

Dropping `assertInplaceResult` removes the signal that would otherwise catch the engine silently degrading to all-fallback (a real regression risk: if a refactor made the engine rebuild *everything*, every invariant would still pass and the inplace path would be silently untested). The replacement is a **mode-distribution floor**: the property records `(operation, reconstructionModeUsed-or-fallback)` per run and asserts that the run set contained **both** an inplace outcome **and** a fallback outcome, **and** every operation family. This converts "the engine still both stays-inplace and falls-back across this surface" into a checked invariant rather than an unstated assumption. If a future engine change makes the surface all-inplace or all-fallback, the floor fails loudly and a human re-characterizes — which is the correct response, not a silent green.

The seeded `examples` (one deterministic pair per operation, as `fieldBearingPairArb` does) guarantee the operation floor every run; the `clean-to-pretracked-fragmented` example guarantees the fallback outcome and a `result-edit` / `pretracked-fragmented-to-clean` example guarantees the inplace outcome, so the mode floor is satisfied deterministically rather than relying on the random generator.

## Decision 3 — sibling arbitrary, not a fourth operation on `fieldBearingPairArb`

`fieldBearingPairArb`'s property asserts `assertInplaceResult` and (for non-delete operations) `assertRecursivelyWellformed` on every run. The fragmented operations violate both contracts (fallback is allowed; combined is not recursively well-formed under fallback). Bolting them onto the same arbitrary would force per-operation branching that splits the assertion model down the middle of one property — exactly the kind of "the assertion strength depends on a hidden operation tag" complexity the predecessor already had to document carefully for field-delete. A separate arbitrary with a uniformly mode-independent property keeps each property's contract single and legible, and keeps the predecessor's requirement (which states its arbitrary "SHALL NOT generate fragmented field modifications") literally true.

## Decision 4 — spec shape: ADD, not MODIFY

The predecessor's requirement scopes **its** arbitrary (`fieldBearingPairArb`) and its "SHALL NOT generate fragmented…" sentence remains a true statement about that arbitrary. The new requirement governs a **new** arbitrary. They do not conflict, so this delta is **ADD-only**; the new requirement text explicitly states it extends the sibling requirement to the fragmented surface the sibling deferred, and that nested / paragraph-spanning remain deferred. This avoids a verbose full-requirement MODIFIED restatement whose only change would be one clause.

## Rejected alternatives

- **`fc.pre`-filter out the fallback runs.** Rejected for the same reason the predecessor rejected it for `ContainerResolutionError`: silently discarding inputs hides whether the surface is being exercised and can let the property pass vacuously. Recording mode in the coverage floor is the asymmetry-of-rot-correct inverse — it makes a dropped surface fail loudly.
- **Assert `assertInplaceResult` and mark `clean-to-pretracked-fragmented` as a known-fallback exception with `fc.pre`/skip.** Rejected: it re-introduces the silent-filter problem and encodes "inplace is the expectation" for a surface where rebuild is correct. Mode-independence is the honest model.
- **Assert `validateFieldStructure(combined)`.** Rejected per Decision 1 — stronger than the axioms and false under correct fallback.
- **Include nested / paragraph-spanning in this change.** Rejected on minimal-scope grounds: they need new fixture primitives and their own probing (not done here), and the fragmented surface is a complete, shippable, independently valuable unit. Deferred to a named successor, mirroring how the predecessor split this surface out of Tier 2.

## Tags

New scenarios use the `[LEAN-FRAG-NN]` tag family (Fragmented-field aRbitrary for the lean briDGe — `FRAG`), deliberately distinct from the predecessor's `[LEAN-FBA-NN]` so a matrix reader never confuses whole-field-bearing coverage with fragmented coverage. The file's existing `const TEST_FEATURE` already satisfies the `allure-labels` gate.
