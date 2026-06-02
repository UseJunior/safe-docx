# Tasks — close `inv_rt_001`

## 1. Definitional text model (`verification/lean/Tier2/RoundTripText.lean`)

- [x] 1.1 Create `Tier2/RoundTripText.lean`; `import Tier2.AcceptReject` and open `Tier2.OoxmlModel` / `Tier2.AcceptReject`.
- [x] 1.2 Define `atomText : Atom → Line` / `atomsText` / `paraTextBlocks : List Block → Line` / `extractText : Doc → List Line` (`abbrev Line := List Char`) mirroring `extractTextWithParagraphs` (`trackChangesAcceptorAst.ts:660-688`): per paragraph, concatenate `Atom.text` and `Atom.delText` payloads reached through runs and transparent `other`/wrapper containers; `instrText` / `delInstrText` / `fldChar` contribute nothing. (Structural document order; TS's `w:t`-then-`w:delText` ordering is a documented Tier-2.5 gap.)
- [x] 1.3 Define `normalizeText : List Line → List Line` modeling `normalizeText` (`trackChangesAcceptorAst.ts:701-711`): trim each entry, then drop blank entries (structured analogue of `\n+ → \n` and outer `trim`). Intra-line multi-space/tab collapse is NOT modeled (documented Tier-2.5 residual).
- [x] 1.4 Define `revisedText : Doc → List Line` (per-paragraph text of `acceptBlocks`) and `originalText : Doc → List Line` (per-paragraph text of `rejectBlocks`; `delText` counted as text).

## 2. Machine-checked lemmas (zero `sorry`)

- [x] 2.1 `rename_text_invariant`: `extractText (renameBlocks bs) = extractText bs` (the `delText → text` rename does not change extracted text, since `extractText` already counts `delText`).
- [x] 2.2 `extractText_reject`: `extractText (reject d) = originalText d`, by induction over `rejectBlocks`, consuming 2.1.
- [x] 2.3 `normalizeText_cons_empty` (with helper `normalizeText_cons`): a leading empty entry is invisible to `normalizeText`, so dropping empty-collapsing paragraphs (as `accept` does, `AcceptReject.lean:44`) leaves `normalizeText` output unchanged.
- [x] 2.4 `extractText_accept_normalized`: `normalizeText (extractText (accept d)) = normalizeText (revisedText d)`, by induction over the document + 2.3.

## 3. Wire into `Spec.lean` and close the `sorry`

- [x] 3.1 Rewire `axiom extractTextWithParagraphs` → `def extractTextWithParagraphs := Tier2.RoundTripText.extractText`; `axiom normalizeText` → `def normalizeText := Tier2.RoundTripText.normalizeText`. Confirm `inv_rt_001`'s statement still type-checks against the new types.
- [x] 3.2 Declare `axiom compareDocumentXml_output_text_roundtrip : ∀ a b combined, compareDocumentXml a b = some combined → (normalizeText (revisedText combined) = normalizeText (extractText b) ∧ normalizeText (originalText combined) = normalizeText (extractText a))`, with a docstring matching the `compareDocumentXml_output_preservation_friendly` style (engine-specific, universal in `(a,b)`, load-bearing, Tier-3-owned).
- [x] 3.3 Replace the `inv_rt_001` `sorry` with a proof composing 3.2 and the §2 lemmas.
- [x] 3.4 Add the `Tier2.RoundTripText` import to `verification/lean/LeanSpike.lean` (or root re-export).

## 4. Build, CI, and audit

- [x] 4.1 `lake build` in `verification/lean/` succeeds with **zero** `sorry`.
- [x] 4.2 Update the `sorry` audit in `.github/workflows/lean-build.yml`: remove the prior allowance for `Spec.lean`'s `inv_rt_001` `sorry`; the audit now requires zero `sorry` repo-wide.

## 5. Falsifiability bridge case

- [x] 5.1 Add one field-bearing fixture case to `packages/docx-core/src/integration/lean-spec-bridge.test.ts` asserting `inv_rt_001`'s conclusion against the live engine: `normalize(accept(combined)) = normalize(revised input)` and `normalize(reject(combined)) = normalize(original input)`, via `assertRoundTripInvariant` using the real TS `extractTextWithParagraphs` / `normalizeText`.
- [x] 5.2 Docstring states precisely that it checks the round-trip conclusion (equated to the projection-form axiom by the machine-checked lemmas, so falsifying it falsifies the axiom), does not assert the projection equality directly, and is one fixture case — not empirical grounding for a universal claim. (NUMPAGES fixture has no whitespace runs, so it does not target the intra-line-collapse gap.)

## 6. Documentation

- [x] 6.1 Extend `verification/lean/Tier2/README.md`: round-trip section, the second residual axiom, the `normalizeText`-faithfulness residual, and the now-zero-`sorry` state.
- [x] 6.2 Update `verification/lean/README.md` Specification Gap section: name both residual axioms, the Tier 2.5 equivalence gaps, and that runtime round-trip checks are not made redundant.
- [x] 6.3 Flip `verification/ROADMAP.md` Tier 1.5 / Tier 2 status lines: `inv_rt_001` closed; spike zero-`sorry` under two named residual axioms.

## 7. Validate

- [x] 7.1 `openspec validate add-inv-rt-001-proof --strict` passes.
- [x] 7.2 `npm run check:spec-coverage` (OpenSpec traceability) passes for the new `docx-comparison` requirement, with the `[LEAN-RT-*]` scenario tags mapped to the bridge test / Lean build evidence per repo convention.
