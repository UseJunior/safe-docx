# Change: Field-bearing fast-check arbitrary for the Lean spec bridge

## Why

The Lean spike is now zero-`sorry` (closed by `add-inv-rt-001-proof`, PR #293) and carries exactly two named residual axioms about this repo's inplace `compareDocumentXml` output:

- `compareDocumentXml_output_preservation_friendly` (Tier 2, `add-ooxml-doc-subset-and-inv-field-001-proof`) — the INV-FIELD-001 obligation.
- `compareDocumentXml_output_text_roundtrip` (Tier 2, `add-inv-rt-001-proof`) — the INV-RT-001 obligation.

`packages/docx-core/src/integration/lean-spec-bridge.test.ts` is the falsifiability layer for both axioms: it fails if either invariant breaks on real engine output. But its **property-based** coverage (the `pairArb` and `trackedPairArb` fast-check arbitraries, 100 runs each) is entirely **field-free** — the file header records this as an intentional spike limitation ("Field-bearing input families still live in `collapsed-field-inplace.test.ts`"). The only field-bearing coverage in the bridge file is **three hand-written single fixtures**, all over one `COMPLETE_NUMPAGES_FIELD` shape:

- INV-FIELD-001 field-insert (`lean-spec-bridge.test.ts:893`) — asserts the strong `assertRecursivelyWellformed`.
- INV-FIELD-001 field-delete (`lean-spec-bridge.test.ts:924`) — asserts only the document-level `assertFieldInvariant` (the `<w:del>` subtrees are not context-neutral post-#217).
- INV-RT-001 field-insert round-trip (`lean-spec-bridge.test.ts:971`).

A single fixture per operation falsifies an axiom only on that exact XML. The residual axioms are stated **universally** over `(a, b)`; the field-bearing surface — where `w:fldChar` / `w:instrText` / `w:delInstrText` atoms exercise the field-walk in `pipeline.ts` and the `delInstrText → instrText` rename in `trackChangesAcceptorAst.ts` — is the **riskiest** part of that surface and the one with the weakest empirical grounding. Both the Tier 2 and the INV-RT-001 changes explicitly deferred a full field-bearing fast-check arbitrary to this successor change, by name:

> "The full arbitrary is a separate follow-up." — `add-ooxml-doc-subset-and-inv-field-001-proof/tasks.md`, naming `add-field-bearing-bridge-arbitrary`.
> "the full field-bearing fast-check arbitrary stays a separate follow-up, consistent with how `add-field-bearing-bridge-arbitrary` was split out of Tier 2." — `add-inv-rt-001-proof/design.md`
> "the arbitrary opens as `add-field-bearing-bridge-arbitrary`." — `verification/ROADMAP.md:128-129`

This change is that successor. It adds a field-bearing fast-check arbitrary that drives randomly-generated complete-field documents through the live inplace engine and asserts INV-FIELD-001 and INV-RT-001 across many runs — lifting field-bearing coverage from three fixed XML strings to a property over field type × field operation × placement.

Tracking: no dedicated GitHub issue; the follow-up is named in `verification/ROADMAP.md`, `add-ooxml-doc-subset-and-inv-field-001-proof/tasks.md`, and `add-inv-rt-001-proof/{proposal,design}.md`. This change carries **no Lean changes and no production-engine changes** — it is test-layer only.

## What Changes

All changes are inside `packages/docx-core/src/integration/lean-spec-bridge.test.ts` and (if new primitives are needed) `packages/docx-core/src/testing/ooxml-fixtures.ts`. No Lean files, no production engine code.

- **New `fieldBearingPairArb` arbitrary.** Generates a clean (non-pre-tracked) `(original, revised)` body-XML pair built with `buildDocxFromBodyXml`, mirroring the existing field fixtures' construction. Each side is a small paragraph array; selected paragraphs carry a **complete, self-contained field** drawn from the three existing constants `COMPLETE_NUMPAGES_FIELD` / `COMPLETE_PAGE_FIELD` / `COMPLETE_PAGEREF_FIELD` (`ooxml-fixtures.ts:47-66`), surrounded by ordinary `<w:t>` runs. The difference between the two sides realizes one of a fixed set of **field operations**:
  - `field-insert` — field absent on the original side, present on the revised side.
  - `field-delete` — field present on the original side, absent on the revised side.
  - `field-stable` — identical complete field present on both sides (pure field context; the surrounding text may still change).
  - `text-only` — a field present-and-unchanged on both sides, with a tracked text edit in a *different* paragraph (guards that a nearby field does not perturb a plain-text round-trip).

  Inputs are clean documents (the engine generates all tracking), so — unlike `trackedPairArb` — there is **no by-construction INV-RT-001 falsification risk** and no need for the `w:del`-on-`a` / `w:ins`-on-`b` guard. This arbitrary is the field-bearing analogue of `pairArb`, not of `trackedPairArb`.

- **Two (or three) new property tests** over `fieldBearingPairArb`, mirroring the existing INV-FIELD-001 / INV-RT-001 property tests:
  - `INV-FIELD-001: field structure preserved on field-bearing inplace comparison output` — asserts `assertInplaceResult` + `assertFieldInvariant` on every run; additionally asserts the **stronger** `assertRecursivelyWellformed` **only on runs whose operation is `field-insert` / `field-stable` / `text-only`** (no field deletion), matching the existing fixtures' split. `field-delete` runs assert the document-level `assertFieldInvariant` only — see `design.md` for why the per-operation assertion strength is load-bearing, not a workaround.
  - `INV-RT-001: paired round-trip text equality on field-bearing inplace comparison output` — asserts `assertInplaceResult` + `assertRoundTripInvariant` on every run, exercising the live `extractTextWithParagraphs` / `normalizeText` over field result text (`<w:t>` payloads) while `instrText` / `delInstrText` / `fldChar` atoms contribute none.

- **Operation/field-type coverage assertion.** Mirroring `assertTrackedScenarioCoverage` (`lean-spec-bridge.test.ts:382`), each property records a coverage map over `{field-insert, field-delete, field-stable, text-only}` (and field type) and asserts every family was exercised, so a generator that silently stopped producing one operation fails loudly rather than passing vacuously.

- **Fallback is treated as falsification, with a coverage floor (no silent `fc.pre` filtering).** The file header currently states the generators are "paragraph-only, table-free, and field-free, so [`ContainerResolutionError`] is not expected to fire," and treats any inplace fallback as falsification via `assertInplaceResult`. This change's arbitrary is **field-bearing**, so that premise no longer holds verbatim. The arbitrary is therefore **constrained to the whole-field-at-run-boundary operation shapes the existing fixtures already prove the engine handles inplace** (the insert/delete fixtures both `assertInplaceResult` and pass). Fallback remains falsification (`assertInplaceResult` throws with `triage=inplace-fallback`); the operation-coverage assertion doubles as the floor that detects a degenerate all-fallback run. The header comment is updated to scope the "field-free" claim to the two original generators and document the field-bearing arbitrary's narrower inplace-safe operation set. See `design.md` for the rejected `fc.pre`-filter alternative.

- **Header / coverage-surface comment update.** The "Coverage surfaces" and "Fallback semantics" comment blocks (`lean-spec-bridge.test.ts:8-52`) are extended to list the field-bearing arbitrary and its operation families, so the file's self-description stays accurate (asymmetry-of-rot: the comment must not oversell field-free-ness once a field-bearing generator exists).

- **`ooxml-fixtures.ts` additions only if needed.** If the arbitrary needs a field-bearing paragraph builder beyond the existing `COMPLETE_*` constants (e.g. a `paragraphWithField(text, field)` helper), it is added to `ooxml-fixtures.ts` per the AGENTS.md fixture-home rule, not inlined in the test.

## Scope guardrails

- **Inplace-mode comparison output only.** Matches the `Spec.lean` precondition and the existing bridge tests.
- **Whole, self-contained fields at run boundaries only.** The arbitrary generates only complete `begin … (instrText) … separate … result … end` sequences as atomic units inserted/deleted/kept — the operation shapes the existing fixtures prove are inplace-safe. It does **not** generate fragmented field modifications (changing instruction text under track changes — `FRAGMENTED_NUMPAGES_MODIFICATION`), nested fields, or fields spanning paragraph boundaries. Those are separate, harder surfaces.
- **No new residual-axiom claims and no Lean changes.** This change only strengthens empirical falsifiability of the two existing axioms; it does not discharge them (Tier 3) and adds no Lean code.
- **No production-engine code changes.** Test layer only.
- **No change to the existing field-free property tests or the three field fixtures.** They stay as-is; this change is additive.

## Impact

- **Affected specs:** `docx-comparison` (one new requirement — see `specs/docx-comparison/spec.md`).
- **Affected code:** `packages/docx-core/src/integration/lean-spec-bridge.test.ts` (new arbitrary + property tests + header comment), `packages/docx-core/src/testing/ooxml-fixtures.ts` (new field-bearing paragraph helper only if required).
- **No Lean changes. No production-engine code changes.**
- **CI:** the new property tests run in the standard `@usejunior/docx-core` workspace test job alongside the existing bridge properties; no new CI wiring. `npm run check:spec-coverage` must continue to pass for the new `docx-comparison` requirement once its scenarios are mapped per repo convention.
- **Runtime:** adds two (or three) `fc.assert` properties at `numRuns: 100` each, each building and comparing real DOCX buffers — comparable to the existing field-free properties; the `{ timeout: 60_000 }` describe budget already in the file covers them.
