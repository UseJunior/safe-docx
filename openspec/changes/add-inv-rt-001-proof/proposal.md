# Change: Close `inv_rt_001` — definitional round-trip text model, preservation lemma, single named residual axiom

## Why

The Lean 4 verification spike has exactly **one remaining `sorry`**: `inv_rt_001` in `verification/lean/LeanSpike/Spec.lean` (the round-trip text-equality target). Tier 2 closed `inv_field_001` via the merged change `add-ooxml-doc-subset-and-inv-field-001-proof` (PRs #208/#219/#220) using the pattern "definitional model + machine-checked preservation lemma + a single named residual axiom." `inv_rt_001` was explicitly deferred to a successor change by name — both `Spec.lean:51-59` and `verification/ROADMAP.md:110-112` cite the owner as `add-inv-rt-001-proof`:

> "This theorem **remains unproved** — it is explicitly deferred to the `add-inv-rt-001-proof` successor change, which owns `extractTextWithParagraphs` and `normalizeText`." — `Spec.lean`

This change is that successor. It closes the last `sorry`, taking the spike to **zero `sorry`** carried by exactly **two** named, location-stable residual axioms (the existing `compareDocumentXml_output_preservation_friendly` plus one new text-round-trip axiom this change introduces), both owned by Tier 3.

`inv_rt_001` states (current `Spec.lean`):

```
∀ (a b combined : OoxmlDoc), compareDocumentXml a b = some combined →
  normalizeText (extractTextWithParagraphs (acceptAllChanges combined))
    = normalizeText (extractTextWithParagraphs b) ∧
  normalizeText (extractTextWithParagraphs (rejectAllChanges combined))
    = normalizeText (extractTextWithParagraphs a)
```

i.e. accepting all changes in the comparison output reproduces the revised document's text, and rejecting reproduces the original's text. It currently sits over the uninterpreted `axiom extractTextWithParagraphs` and `axiom normalizeText` (`Spec.lean:54,59`).

### Why a residual axiom is unavoidable (and where the real proof content is)

Text equality to `a` and `b` inherently references `a` and `b`, which **only `compareDocumentXml` connects to `combined`**. `compareDocumentXml` stays axiomatic until Tier 3 (modeling the comparison engine definitionally is out of scope here, same as in Tier 2). So part of `inv_rt_001` must remain a named assumption about the engine's output. The honest decomposition isolates that assumption to the smallest possible surface and proves everything else:

1. **Machine-checked text-projection lemmas (the real content).** Prove, against the Tier 2 `OoxmlModel`/`AcceptReject` definitions, that `extractText (accept d)` equals the *revised-side* text projection of `d` (runs outside `del`/`moveFrom`, with `ins`/`moveTo` unwrapped) and `extractText (reject d)` equals the *original-side* projection (runs outside `ins`/`moveTo`, counting `delText` as text after the `delText → text` rename). These are structural facts about the model, provable with no axiom.
2. **`normalizeText` absorbs `accept`'s paragraph dropping (the subtle content).** `accept` drops paragraphs whose body collapses to empty (`AcceptReject.lean:44`), but `extractTextWithParagraphs` joins paragraphs with `\n` and emits empty paragraphs as empty entries. The two differ by spurious blank lines — which is **exactly** what `normalizeText`'s `\n+ → \n` + `trim` behavior (`trackChangesAcceptorAst.ts:701-711`) collapses. Proving this absorption is the load-bearing reason the theorem is stated post-`normalizeText`, and the main reason this is a real proof rather than a rewrite.
3. **Single named residual axiom.** `compareDocumentXml_output_text_roundtrip`: for any `(a, b)` with `compareDocumentXml a b = some combined`, the *revised-side projection of `combined`* normalizes to `b`'s extracted text and the *original-side projection of `combined`* normalizes to `a`'s. This is the genuine, isolated assumption about the engine; Tier 3 discharges it. Crucially it is stated over **projections of `combined` alone** (no `accept`/`reject`), so the machine-checked lemmas of step 1 carry the connection from projections to `accept`/`reject` outputs — the axiom is not a restatement of the theorem.

`inv_rt_001` then closes by composing 1 + 2 + 3, mirroring exactly how `inv_field_001` composed its preservation lemma with `compareDocumentXml_output_preservation_friendly`.

Tracking: no dedicated GitHub issue; the work is named in `Spec.lean` and `verification/ROADMAP.md`. Related: closed Tier 2 change `add-ooxml-doc-subset-and-inv-field-001-proof`, issue #201.

## What Changes

- **New `verification/lean/Tier2/RoundTripText.lean`** (Tier 2 stays the home — this is the second invariant over the same `OoxmlModel`, not a new tier):
  - `extractText : Doc → List Line` (`abbrev Line := List Char`) — definitional mirror of `extractTextWithParagraphs` (`trackChangesAcceptorAst.ts:660-688`): one entry per paragraph, the concatenation of `Atom.text` and `Atom.delText` payloads reached through runs and transparent `other`/wrapper containers; `instrText`/`delInstrText`/`fldChar` contribute nothing. Modeled as a paragraph list of `List Char` (not a flat `String`) so the `\n`-join and per-paragraph reasoning stay tractable and `normLine [] = []` is `rfl` on the `ByteArray`-backed-`String` toolchain — see `design.md`. (`extractText` keeps structural document order; the TS helper emits all `w:t` then all `w:delText` — a Tier-2.5 ordering gap, vacuous on the `w:t`-only surfaces the round-trip compares.)
  - `normalizeText : List Line → List Line` — definitional model of `normalizeText` (`trackChangesAcceptorAst.ts:701-711`) capturing the load-bearing behavior: trim each entry, then drop blank entries (the structured analogue of `\n+ → \n` and outer `trim`). The TS regex's intra-line multi-space/tab collapse is NOT modeled; that faithfulness gap is documented as a Tier-2.5-class residual, not hidden.
  - `revisedText : Doc → List Line` / `originalText : Doc → List Line` — the two side projections the residual axiom is stated over.
  - **Machine-checked lemmas** (zero `sorry`): `extractText_accept` (`extractText (accept d) = revisedText d` modulo empty-paragraph drops), `extractText_reject` (`extractText (reject d) = originalText d`, consuming `delText → text` rename text-invariance), and `normalize_absorbs_empty_paragraphs` (the `accept` paragraph-drop is invisible after `normalizeText`).
  - `Tier2/README.md` — extend with the round-trip section, the second residual axiom, and the `normalizeText`-faithfulness residual.
- **`verification/lean/LeanSpike/Spec.lean` rewires:**
  - `axiom extractTextWithParagraphs` → `def extractTextWithParagraphs := Tier2.RoundTripText.extractText`.
  - `axiom normalizeText` → `def normalizeText := Tier2.RoundTripText.normalizeText`.
  - `axiom compareDocumentXml` **remains axiomatic** (Tier 3).
  - **NEW** `axiom compareDocumentXml_output_text_roundtrip : ∀ a b combined, compareDocumentXml a b = some combined → (normalizeText (revisedText combined) = normalizeText (extractText b) ∧ normalizeText (originalText combined) = normalizeText (extractText a))`. The single new named residual obligation, scoped to this repo's inplace atomizer output, universal in `(a, b)`, load-bearing, owned by Tier 3.
  - The `inv_rt_001` `sorry` (sole remaining `sorry` in the spike) is replaced by a proof composing the new axiom with the `RoundTripText` lemmas.
  - The closed `inv_field_001` proof and the existing `compareDocumentXml_output_preservation_friendly` axiom are untouched.
- **`verification/lean/LeanSpike.lean` / root re-export** — add the `Tier2.RoundTripText` import so `lake build` covers it.
- **`verification/lean/README.md`** — record what `inv_rt_001` closes vs. what remains; name both residual axioms; document the `normalizeText`-faithfulness residual.
- **`verification/ROADMAP.md`** — flip Tier 1.5 / Tier 2 status lines: `inv_rt_001` closed, spike now zero-`sorry` under two named residual axioms.
- **Field-bearing-irrelevant bridge case** in `packages/docx-core/src/integration/lean-spec-bridge.test.ts` — add a single fixture case as a **falsifiability layer for `compareDocumentXml_output_text_roundtrip`**: assert that on a real comparison output, the revised-side text normalizes to the revised input's text and the original-side text to the original's, using TS analogues of `revisedText`/`originalText`/`normalizeText`. One fixture case, NOT a full fast-check arbitrary (that follow-up stays separate, like the Tier 2 `add-field-bearing-bridge-arbitrary`).

## Scope guardrails

- **Inplace-mode comparison output only.** Matches the `Spec.lean` precondition and the Tier 1.5 framing.
- **Theorem domain matches `Spec.lean` exactly.** Same `(a b combined : OoxmlDoc)` quantification and `compareDocumentXml a b = some combined` premise — no narrower precondition.
- **No definitional `compareDocumentXml`, no discharge of either residual axiom.** That is Tier 3.
- **`normalizeText` is modeled structurally, not as a faithful `String` regex engine.** The extensional gap between the `List Char` model (trim + blank-drop) and the literal regex rewrite (which also collapses intra-line whitespace) is a documented residual (Tier-2.5 class), not a hidden assumption. See `design.md`.
- **No Tier 2.5 work** (Lean↔TS extensional equivalence, broader `Atom`/`Block` projection) and **no full field-bearing fast-check arbitrary** — both stay separate follow-ups.
- **No production-engine code changes.** All work is inside `verification/lean/` and the test layer.

## Impact

- **Affected specs:** `docx-comparison` (one new requirement — see `specs/docx-comparison/spec.md`).
- **Affected code:** `verification/lean/Tier2/RoundTripText.lean` (new), `verification/lean/Tier2/README.md` (docs), `verification/lean/LeanSpike/Spec.lean` (axiom rewires + `sorry` closure + new named axiom), `verification/lean/LeanSpike.lean` (import), `verification/lean/README.md` (docs), `verification/ROADMAP.md` (status), `packages/docx-core/src/integration/lean-spec-bridge.test.ts` (one new test case).
- **No production-engine code changes.**
- **CI:** `.github/workflows/lean-build.yml` already runs `lake build` plus a `sorry` audit. After this change the audit reports **zero `sorry`** across the entire spike; the audit's allowance for `Spec.lean`'s `inv_rt_001` `sorry` is removed. The new bridge case runs in the standard workspace-test job.
