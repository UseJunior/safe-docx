# Design — field-bearing fast-check arbitrary for the Lean spec bridge

## Context

`lean-spec-bridge.test.ts` empirically falsifies two named residual axioms about this repo's inplace `compareDocumentXml` output:

- `compareDocumentXml_output_preservation_friendly` — INV-FIELD-001: field structure survives accept-all / reject-all on the combined output.
- `compareDocumentXml_output_text_roundtrip` — INV-RT-001: `accept(combined)` text-equals the revised input and `reject(combined)` text-equals the original, under `normalizeText`.

Property coverage (`pairArb`, `trackedPairArb`, 100 runs each) is field-free by design; field-bearing coverage is three hand-written fixtures over one `COMPLETE_NUMPAGES_FIELD`. This change adds a field-bearing fast-check arbitrary so both axioms are exercised over field type × operation × placement rather than three fixed XML strings.

The two existing field fixtures already establish the engine facts this design leans on:

- The **insert** fixture (`:893`) stays inplace and passes the *strong* `assertRecursivelyWellformed`.
- The **delete** fixture (`:924`) stays inplace but can pass only the *weak* `assertFieldInvariant`, because post-#217 the inplace atomizer fragments deleted fields (fldChars unwrapped at sibling level, `<w:del>` wrapping only the `delInstrText` / `delText` payload), so the `<w:del>` subtree has an empty *local* field stack and is not `fieldContextNeutral` under `∀ ctx`.

## Decision 1: per-operation assertion strength is load-bearing, not a workaround

`assertRecursivelyWellformed` checks the **stronger** per-subtree `fieldContextNeutral ∀ ctx` property; `assertFieldInvariant` checks the **weaker** document-level `validateFieldStructure(accept)` ∧ `validateFieldStructure(reject)`. The post-#220 residual axiom `compareDocumentXml_output_preservation_friendly` was deliberately weakened to the document-level property precisely because fragmented deletes do not satisfy the per-subtree one (`lean-spec-bridge.test.ts:937-951` documents this on the delete fixture).

Therefore the field-bearing property must dispatch by operation:

- `field-insert` / `field-stable` / `text-only` (no field deletion) → assert **both** `assertRecursivelyWellformed` (strong audit gate) **and** `assertFieldInvariant`.
- `field-delete` → assert **only** `assertFieldInvariant` (document-level), matching the axiom's actual post-#220 strength.

Applying the strong check uniformly would make the arbitrary fail on legitimate engine output (a false positive on every deletion) — it would be testing the pre-#217 engine, not the current one. Applying only the weak check uniformly would silently lose the audit-gate signal on inserts (the "engine has not regressed into emitting partial-wrapper fragments unexpectedly" guard, `:699-707`). The split preserves both: maximum strength where the engine supports it, axiom-faithful strength where it does not. The operation tag the arbitrary already carries (to realize the insert/delete/stable difference) is exactly the discriminator, so no extra XML inspection is needed.

**Alternative considered — infer strength from the output XML** (e.g. "if any `<w:del>` contains `delInstrText`, use the weak check"). Rejected: it couples the test to the engine's current fragmentation representation (the thing under test), and re-derives a fact the generator already knows. The operation tag is the honest discriminator.

## Decision 2: fallback is falsification + coverage floor, not `fc.pre` filtering

The two theorems are premised on `compareDocumentXml a b = some combined`; pairs where inplace mode fails are out of the spec's scope. The file currently treats fallback as falsification (`assertInplaceResult` throws `triage=inplace-fallback`) and justifies it by the generators being "paragraph-only, table-free, and field-free, so [`ContainerResolutionError`] is not expected to fire" (`:30-35`). A field-bearing arbitrary changes that premise.

**Options.**

- **A — `fc.pre(result.modeUsed === 'inplace')`.** Filter out any pair that falls back, formally honoring the `some combined` precondition. Risk: a generator that *always* falls back would make the property pass **vacuously** — a silent coverage hole. fast-check's `fc.pre` rejections are invisible unless the discard rate is asserted. This is exactly the "silent cap" the repo's `feedback_asymmetry_of_rot` / "no silent caps" discipline rejects.
- **B — keep fallback as falsification, constrain the generator to inplace-safe operation shapes, add an operation-coverage floor.** (Recommended.) The existing insert/delete fixtures prove the engine handles whole-field-at-run-boundary insert and delete inplace (both `assertInplaceResult` and pass). The arbitrary generates only those proven-inplace operation shapes (complete fields as atomic units at run boundaries; no fragmented modification, no nesting, no paragraph-spanning fields). Any fallback then signals a real regression and should fail loudly. The operation/field-type coverage assertion (`assertTrackedScenarioCoverage` analogue) doubles as the floor: if the generator degenerated such that an operation family never ran, the coverage assertion fails instead of the property passing on a shrunken input space.

**Choice: B.** It keeps the falsifiability strong (fallback = failure, with `triage` diagnostics) and makes coverage gaps loud, at the cost of a deliberately narrower operation set than "any field-bearing document." That narrowing is correct for this change: the broader, harder surfaces (fragmented field modification, nested fields, paragraph-spanning fields) are explicitly out of scope and are where fallback is *expected*, not a regression. Mixing them in would force option A and reintroduce the silent-hole risk.

**Residual risk acknowledged:** option B asserts the engine *stays* inplace on a wider input space than the two fixtures. If some complete-field placement the arbitrary can reach (but the fixtures did not) legitimately falls back, the property will fail with `triage=inplace-fallback` and we will either (a) discover a real inplace regression, or (b) discover the operation shape is not as inplace-safe as assumed and tighten the generator. Either outcome is informative; neither is a silent pass. This is the intended forcing function, not a flake to suppress — the triage diagnostics distinguish the two.

## Decision 3: clean inputs, no pre-tracking (field-bearing analogue of `pairArb`, not `trackedPairArb`)

`trackedPairArb` feeds **pre-tracked** documents (the input already carries `w:ins` / `w:del`), which is why it needs the `w:del`-on-`a` / `w:ins`-on-`b` guard (`:270-271`) to avoid falsifying INV-RT-001 *by construction*. This arbitrary generates **clean** original/revised documents and lets the engine produce all tracking — the same shape as `pairArb` and the three field fixtures. Consequences:

- No by-construction INV-RT-001 risk; no `w:del`/`w:ins` side guard needed.
- The field operation is realized by the **difference** between two clean sides (field present on one side, absent/identical on the other), not by emitting tracked markup into the input.
- `extractTextWithParagraphs` over a clean field-bearing input counts the field **result** text (`<w:t>` payload, e.g. NUMPAGES `"3"`) and ignores `instrText` / `fldChar`; so `field-stable` and `text-only` round-trips include the result text on both sides, and `field-insert` / `field-delete` round-trips add/remove exactly that result text — which is what the engine's accept/reject must reproduce.

## Decision 4: reuse the three existing complete-field constants; add a builder helper only if needed

The arbitrary draws fields from `COMPLETE_NUMPAGES_FIELD` / `COMPLETE_PAGE_FIELD` / `COMPLETE_PAGEREF_FIELD` (`ooxml-fixtures.ts:47-66`) rather than minting new field XML — re-deriving field shapes inline is the cross-file drift issue #221 was filed to prevent (`ooxml-fixtures.ts:1-19`, AGENTS.md "Test Fixtures"). If a `paragraphWithField(text, field)` body-XML helper is needed, it lands in `ooxml-fixtures.ts`, not inline. The arbitrary itself (operation selection, coverage tracking) is test-specific orchestration and stays in `lean-spec-bridge.test.ts`, like the existing `trackedScenario*Arb` arbitraries.

## What stays out of scope

- Fragmented field modification (`FRAGMENTED_NUMPAGES_MODIFICATION`), nested fields, paragraph-spanning fields — harder surfaces where inplace fallback is expected; a separate follow-up.
- Field bodies inside comment/footnote parts (the file already scopes comment/footnote coverage to `document.xml` anchors only, `:50-51`).
- Any Lean change or discharge of the residual axioms (Tier 3).

## Residual obligations after this change

Unchanged from `add-inv-rt-001-proof`: both residual axioms remain Tier-3-owned; this change only widens their empirical falsifiability over field-bearing inputs. No `sorry` is introduced (no Lean change). The Lean↔TS extensional-equivalence gap (Tier 2.5) is unaffected.
