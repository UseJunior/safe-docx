# Design — closing `inv_rt_001`

## Context

`inv_rt_001` is the round-trip text-equality target: accept-all on the comparison output reproduces the revised document's text; reject-all reproduces the original's. It is the last `sorry` in the spike. Tier 2 already shipped a definitional `OoxmlModel` (`Doc`/`Paragraph`/`Block`/`Run`/`Atom`) and definitional `accept`/`reject` (`Tier2/AcceptReject.lean`). This change adds the text layer over that same model. The constraints inherited from Tier 2: (a) `compareDocumentXml` stays axiomatic (Tier 3 owns it), (b) the closure must be honest about its single residual assumption rather than hiding it, (c) the Lean operations are definitional mirrors of named TS functions, with extensional Lean↔TS equivalence deferred to Tier 2.5.

## Decomposition: where the proof content lives vs. what stays axiomatic

Text equality references `a` and `b`, which only `compareDocumentXml` ties to `combined`. So some assumption about the engine output is unavoidable. The design isolates it to one axiom stated over **projections of `combined` alone**, and proves the connection from those projections to the actual `accept`/`reject` outputs:

```
inv_rt_001
  = extractText_accept           -- machine-checked: extractText (accept d) ≈ revisedText d
  ∘ extractText_reject           -- machine-checked: extractText (reject d) = originalText d
  ∘ normalize_absorbs_empty_paragraphs   -- machine-checked: accept's paragraph drop is invisible post-normalize
  ∘ compareDocumentXml_output_text_roundtrip   -- residual axiom: normalize(revisedText combined)=normalize(extractText b), etc.
```

If the axiom were instead stated directly as `normalize(extractText(accept combined)) = normalize(extractText b)`, the lemmas would be vacuous and the axiom would be the theorem. Stating it over `revisedText`/`originalText` (pure projections, no `accept`/`reject`) forces the structural lemmas to do real work and matches the Tier 2 shape, where `compareDocumentXml_output_preservation_friendly` is a property of `combined` and the preservation *lemma* carries accept/reject.

### The three machine-checked obligations

1. **`extractText_accept`.** `accept` drops `del`/`moveFrom`, unwraps `ins`/`moveTo`, keeps `run`/`other` (`AcceptReject.lean:29-45`). So the surviving text atoms are exactly the revised-side runs. `revisedText` is defined as the same projection directly; the lemma is a structural induction over `Block`/`List Block` matching the `acceptBlocks` recursion. Wrinkle: empty-paragraph dropping (see #2) means the equality holds modulo blank entries, so this lemma is stated up to `normalizeText` (or paired with #2).
2. **`extractText_reject`.** `reject` drops `ins`/`moveTo`, unwraps `del`/`moveFrom`, then globally renames `delText → text` / `delInstrText → instrText` (`AcceptReject.lean:53-85`). `extractText` already counts both `text` and `delText` (`trackChangesAcceptorAst.ts:677-682`), so the rename is **text-extraction-invariant** — that sub-fact (`extractText ∘ renameBlocks = extractText`) is a clean standalone lemma. `reject` does not drop empty paragraphs (`AcceptReject.lean:83-85`), so the reject side needs no normalization wrinkle.
3. **`normalize_absorbs_empty_paragraphs`.** `accept` removes paragraphs whose body collapses to empty; `extractText` would otherwise emit them as `""` entries (spurious blank lines). `normalizeText`'s empty-entry drop (modeling `\n+ → \n` + outer `trim`) makes the two sequences equal post-normalization. This is the crux lemma and the reason the theorem is post-`normalizeText`.

## Decision: model text as a paragraph list of `List Char`, not a flat `String`

**Options.**
- **A — faithful `String` + regex `normalizeText`.** Mirror `trackChangesAcceptorAst.ts:701-711` literally: build one `String` joined with `"\n"`, then apply the six `.replace(/.../g, ...)` passes. Maximally faithful.
- **B — structured paragraph list, one entry per paragraph, each entry a `List Char` (`abbrev Line := List Char`); `normalizeText : List Line → List Line` trims each entry and drops blank entries.** (Recommended.)

**Choice: B.** Lean/mathlib reasoning over `String` regex-style global replacement is heavy and off-the-shelf-poor; a flat-string model would make the empty-paragraph-absorption lemma (#3) — the one lemma that actually matters — disproportionately hard, for no gain in what the proof establishes. Modeling per-paragraph text as `List Char` (rather than `String`) is also what the v4.29.1 toolchain forces in practice: `String` is `ByteArray`-backed there, so constructing a `String` from a char list and reducing `normLine ""`/`"".trim` by `rfl` is brittle, whereas `normLine [] = []` over `List Char` is `rfl`. The structured model keeps paragraph boundaries first-class, which is exactly the granularity at which the load-bearing behavior (blank-line collapse) lives.

The recommended model captures only **trim + blank-entry drop** (the structured analogue of `\n+ → \n` plus outer `trim`). It deliberately does NOT model the TS regex's **intra-line** multi-space/tab collapse. The cost is an **extensional gap**: the Lean `normalizeText` is not proved equal to the TS regex on the joined string, and `extractText` keeps structural document order whereas the TS helper emits all `w:t` then all `w:delText`. This is the same *class* of gap Tier 2 already carries for `accept`/`reject` (definitional mirror, no Lean↔TS equivalence) and is documented identically — owned by Tier 2.5, recorded in `Tier2/README.md` and `verification/lean/README.md`. It is **not** a new hidden axiom: the residual axiom asserts equality *post-`normalizeText`*, and the bridge test exercises the real TS `normalizeText` / `extractTextWithParagraphs` end-to-end, so drift is falsifiable.

**Rejected — A**: faithfulness we cannot currently prove anyway (the join-then-regex vs. per-entry decomposition would itself need a lemma), at a large proof-cost premium and atop the `ByteArray`-backed-`String` reducibility friction, while the residual gap to the TS code remains either way until Tier 2.5.

## Decision: keep this in `Tier2/`, do not open a new tier

`inv_rt_001` is the second of the two Tier 1.5 specification targets, proved over the *same* `OoxmlModel`/`AcceptReject` definitions Tier 2 introduced. It is not a broader model (Tier 2.5) nor an engine model (Tier 3). Placing it in `Tier2/RoundTripText.lean` keeps the residual-axiom inventory and the README in one place and matches how the roadmap framed it ("successor change," not "next tier").

## Decision: the bridge case is a falsifiability layer, not evidence for a universal claim

Mirroring the Tier 2 precedent (`lean-spec-bridge.test.ts` field-bearing fixture for `compareDocumentXml_output_recursivelyWellformed`/`preservation_friendly`), this change adds **one** field-bearing fixture case asserting `inv_rt_001`'s conclusion against the live engine: `normalize(accept(combined)) = normalize(revised input)` and `normalize(reject(combined)) = normalize(original input)`. The machine-checked lemmas equate this conclusion to the projection-form axiom (`normalize(revisedText combined) = normalize(extractText b)`, etc.), so falsifying the conclusion on real output falsifies the axiom; the test does not assert the projection equality directly. It exercises the real TS `normalizeText`/`extractTextWithParagraphs`, but the NUMPAGES fixture has no whitespace runs, so it does not specifically target the intra-line-collapse modeling gap. It is explicitly **not** empirical grounding for the universal axiom — the full field-bearing fast-check arbitrary stays a separate follow-up, consistent with how `add-field-bearing-bridge-arbitrary` was split out of Tier 2.

## Residual obligations after this change

- `compareDocumentXml_output_preservation_friendly` (existing, Tier 3).
- `compareDocumentXml_output_text_roundtrip` (new, Tier 3).
- `axiom compareDocumentXml` itself (Tier 3 discharges all three together by modeling the engine).
- Lean↔TS extensional equivalence for `extractText`/`normalizeText`/`accept`/`reject` — including the `List Char` model vs. regex `normalizeText` gap (intra-line collapse) and `extractText`'s structural- vs. `w:t`-then-`w:delText` ordering (Tier 2.5).

No `sorry` remains anywhere in the spike after this change.
