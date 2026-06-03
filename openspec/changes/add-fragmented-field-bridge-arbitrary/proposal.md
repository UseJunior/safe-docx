# Change: Fragmented-field fast-check arbitrary for the Lean spec bridge

## Why

The Lean spike is zero-`sorry`, carrying exactly two named residual axioms about this repo's inplace `compareDocumentXml` output — `compareDocumentXml_output_preservation_friendly` (INV-FIELD-001) and `compareDocumentXml_output_text_roundtrip` (INV-RT-001). `packages/docx-core/src/integration/lean-spec-bridge.test.ts` is the falsifiability layer for both axioms.

The predecessor change `add-field-bearing-bridge-arbitrary` (PR #294) lifted field-bearing coverage from three hand-written fixtures to the `fieldBearingPairArb` arbitrary — but only over **whole, self-contained fields at run boundaries** (field-insert / field-delete / field-stable / text-only). It explicitly deferred three "separate, harder surfaces" by name:

> "It does **not** generate fragmented field modifications (changing instruction text under track changes — `FRAGMENTED_NUMPAGES_MODIFICATION`), nested fields, or fields spanning paragraph boundaries. Those are separate, harder surfaces." — `add-field-bearing-bridge-arbitrary/proposal.md`, Scope guardrails.

This change takes up the **first and highest-leverage** of those three: the **fragmented-field surface**, where the field's instruction or result text is edited under track changes so the field's internal atoms (`w:instrText` / `w:delInstrText`) fragment into `<w:ins>`/`<w:del>` wrappers while the `w:fldChar` markers stay sibling-level-unwrapped. This is the surface that exercises the `delInstrText → instrText` rename in `trackChangesAcceptorAst.ts` and the field-walk in `pipeline.ts` under tracking — the riskiest part of the field surface and the one with the weakest empirical grounding (one pre-tracked fixture, `FRAGMENTED_NUMPAGES_MODIFICATION`).

Nested fields and fields spanning paragraph boundaries remain deferred to a named successor (`add-nested-and-spanning-field-bridge-arbitrary`); they need new fixture primitives and their own empirical characterization, and behave differently enough to warrant separate scoping.

### What the empirical probe established (load-bearing for the design)

Driving fragmented-field pairs through the live inplace engine (`engine: 'atomizer', reconstructionMode: 'inplace'`) shows the surface does **not** behave like the whole-field surface — and in particular **inplace fallback is a correct, expected outcome here, not a falsification**:

| Generated pair | mode used | `validate(combined)` | `validate(accept)` / `validate(reject)` | round-trip |
| --- | --- | --- | --- | --- |
| instruction-only change (clean → clean) | inplace | ✅ | ✅ / ✅ | ✅ (the engine **field-collapses** instruction-only diffs, emitting **zero** tracked changes; instruction text is invisible to text extraction) |
| field **result**-text change (clean → clean, `1`→`2`) | inplace | ✅ | ✅ / ✅ | ✅ |
| pre-tracked fragmented field → clean field | inplace | ✅ | ✅ / ✅ | ✅ |
| clean field → pre-tracked fragmented field, **result unchanged** | inplace | ✅ | ✅ / ✅ | ✅ |
| clean field → pre-tracked fragmented field, **result changed** (`1`→`3`) | **rebuild (fallback)**, `round_trip_safety_check_failed` | **❌** | ✅ / ✅ | ✅ |

The fallback is precisely triggered by the **combination** of the clean→pre-tracked-fragmented *direction* and a *result-text change*; same-result or the reverse direction stays inplace. All four inplace passes fail **only** the `fieldStructure` safety check (`acceptText`/`rejectText` pass on every pass), so the engine rebuilds and produces conformant accept/reject output. The arbitrary's `clean-to-pretracked-fragmented` operation always changes the result (its result pools are disjoint), so it deterministically realizes the fallback row.

Two findings drive the design:

1. **Inplace fallback is the engine's correct defensive behavior on part of this surface** (last row). The predecessor's rule — "treat any inplace fallback as falsification via `assertInplaceResult`" — is **wrong here**: forcing inplace would fail a run the engine correctly handled by rebuilding. The widened arbitrary therefore asserts **mode-independent** invariants and records the **mode distribution** as a coverage floor (both inplace and rebuild must be exercised), instead of asserting inplace mode.
2. **The raw `combined` (mixed `<w:ins>`+`<w:del>`) output does not always pass `validateFieldStructure`** (last row, `validate(combined)` ❌), but the **accepted** and **rejected** projections each do, and round-trip holds across both modes. So the invariants asserted are on `accept` / `reject` and on round-trip text — never on the raw combined field structure for this surface.

This is the genuine departure from the predecessor and the reason the surface deserves its own arbitrary and requirement rather than an extra operation on `fieldBearingPairArb`.

Tracking: no dedicated GitHub issue; the follow-up is named in the predecessor's scope guardrails and in `verification/ROADMAP.md`. This change carries **no Lean changes and no production-engine changes** — it is test-layer only.

## What Changes

All changes are inside `packages/docx-core/src/integration/lean-spec-bridge.test.ts` and (if new primitives are needed) `packages/docx-core/src/testing/ooxml-fixtures.ts`. No Lean files, no production engine code.

- **New `fragmentedFieldPairArb` arbitrary.** A *sibling* of `fieldBearingPairArb`, not an extra operation on it (its assertion model differs — see below). It generates `(original, revised)` body-XML pairs built with `buildDocxFromBodyXml` whose difference fragments a field's internal atoms under track changes, over a fixed set of **fragmented-field operations**:
  - `result-edit` — clean → clean; identical complete field on both sides except the field **result** run text differs (e.g. `1` → `2`). The engine tracks the result-text change inside the field (probe: inplace, all invariants hold).
  - `pretracked-fragmented-to-clean` — side `a` carries a pre-tracked fragmented field (`FRAGMENTED_NUMPAGES_MODIFICATION`-shaped: `instrText` already wrapped in `<w:ins>`/`<w:del>`, `fldChar` markers sibling-level), side `b` carries the clean complete field (probe: inplace, all invariants hold).
  - `clean-to-pretracked-fragmented` — the reverse; side `a` clean, side `b` pre-tracked fragmented, with the field **result changed** between the sides (probe: **rebuild fallback**, `combined` field-validate false, accept/reject validate, round-trip holds — the mode-independence-critical case). The result change is guaranteed by construction (disjoint result pools), so this operation deterministically realizes the fallback outcome that floors the mode distribution.
- **One new property test** over `fragmentedFieldPairArb` asserting, on **every** run regardless of reconstruction mode:
  - `validateFieldStructure(acceptAllChanges(combined)) === true` and `validateFieldStructure(rejectAllChanges(combined)) === true` (INV-FIELD-001, on the projections — *not* on the raw combined output);
  - normalized accepted text equals the revised input's normalized text, and normalized rejected text equals the original's, via the live `extractTextWithParagraphs` / `normalizeText` (INV-RT-001);
  - it does **not** assert inplace mode and does **not** assert `validateFieldStructure(combined)`, because the engine correctly rebuilds part of this surface.
- **Mode-distribution coverage floor.** The property records the reconstruction mode (`inplace` vs `rebuild`/fallback) and the operation per run, and asserts that **both** modes and **every** operation family were exercised — so the test fails loudly if the engine silently stops falling back (or stops staying inplace), or if a generator drops an operation, rather than passing vacuously. This mirrors `assertFieldBearingCoverage`, adapted to record mode instead of forcing it.
- **Header / coverage-surface comment update.** The "Coverage surfaces" and "Fallback semantics" comment blocks are extended to (a) list the fragmented-field arbitrary and its operation families, and (b) record that for this arbitrary, **fallback is a legitimate, coverage-floored outcome, not falsification** — distinguishing it from the two whole-field/field-free arbitraries where fallback remains falsification. Asymmetry-of-rot: the comment must not let the reader assume "all bridge properties treat fallback as falsification" once one provably does not.
- **`ooxml-fixtures.ts` additions only if needed.** If a parameterized fragmented-field builder beyond the existing `FRAGMENTED_NUMPAGES_MODIFICATION` constant is required (e.g. `fragmentedFieldModification(instr, result)`), it is added to `ooxml-fixtures.ts` per the AGENTS.md fixture-home rule, not inlined in the test.

## Scope guardrails

- **Fragmented-field surface only.** Whole-field operations stay owned by `fieldBearingPairArb`; this change does not touch it or the three single field fixtures.
- **Nested fields and paragraph-spanning fields remain out of scope** and are deferred to a named successor (`add-nested-and-spanning-field-bridge-arbitrary`). They require new fixture primitives and separate empirical characterization.
- **Inplace-mode comparison input only** (the comparison is invoked with `reconstructionMode: 'inplace'`); the engine's own fallback to `rebuild` is permitted and recorded, not suppressed.
- **No new residual-axiom claims and no Lean changes.** This change strengthens empirical falsifiability of the two existing axioms over a harder surface; it does not discharge them (Tier 3 owns that) and adds no Lean code.
- **No production-engine code changes.** Test layer only. In particular, the `round_trip_safety_check_failed` fallback observed on the `clean-to-pretracked-fragmented` operation is treated as correct engine behavior to be characterized, not a bug to fix in this change.

## Impact

- **Affected specs:** `docx-comparison` (one new ADDED requirement — see `specs/docx-comparison/spec.md`).
- **Affected code:** `packages/docx-core/src/integration/lean-spec-bridge.test.ts` (new arbitrary + property test + coverage floor + header comment), `packages/docx-core/src/testing/ooxml-fixtures.ts` (parameterized fragmented-field builder only if required).
- **No Lean changes. No production-engine code changes.**
- **CI:** the new property runs in the standard `@usejunior/docx-core` workspace test job alongside the existing bridge properties; no new CI wiring. `npm run check:spec-coverage` must continue to pass once the new requirement's scenarios are mapped via `.openspec()` tags. The file already declares `const TEST_FEATURE`, so the `allure-labels` gate is satisfied.
- **Runtime:** adds one `fc.assert` property at `numRuns: 100`, building and comparing real DOCX buffers — comparable to the existing field-bearing properties; the existing `{ timeout: 60_000 }` describe budget covers it.
