## Context

The current safe-docx inplace atomizer treats a complex field (`begin`/`instrText`/`separate`/`result`/`end`) as a single atom group for tracked-change purposes — when any constituent run is correlated as Inserted, Deleted, or MovedDestination, the engine wraps the *entire* sequence in one `<w:ins>` / `<w:del>` / `<w:moveTo>` wrapper. ECMA-376 Part 4 requires the opposite: `w:fldChar` markers must remain at the sibling-run level while `<w:ins>` / `<w:del>` wrap only the `w:instrText` / `w:delInstrText` / result payloads that are actually changing.

Three years of round-trip incidents in adjacent open-source projects (LibreOffice, docx4j, Pandoc — see jgm/pandoc#4609) confirm that Word treats `w:fldChar` inside `<w:del>` as fatal: the field state machine collapses and the field result renders as literal text. This is the externally observable failure that motivates the change.

## Goals / Non-Goals

**Goals**
- ECMA-376 conformance for field-modification track changes (FORMCHECKBOX→FORMTEXT canonical fixture).
- ECMA-376 conformance for whole-field deletion track changes (gated by Phase-1 research).
- Lean `inv_field_001` continues to hold without proof changes.
- Engine-side combined-output safety gate prevents regression.

**Non-Goals**
- Engine-side mirror of `isFieldContextNeutral` (separate issue #213).
- ECMA-376 schema CI gate (separate issue #214).
- Per-story field-closure check (separate issue #212).
- Changing how whole-field INSERTIONS are emitted — they stay as one `<w:ins>` because (a) ECMA-376 permits `w:fldChar` inside `<w:ins>` and (b) the current behavior passes the strong wrapper-neutrality check.

## Decisions

### Decision 1: Uniform per-handler fragmentation; no atom-pairing classifier needed

**What**: All three handlers (`handleInserted:1957`, `handleMovedDestination:2300`, `insertDeletedRun:923`) treat a collapsed-field atom the same way: walk its `collapsedFieldAtoms`, emit `w:fldChar` runs unwrapped at sibling level, wrap the `w:instrText`/`w:delInstrText`/result payloads inside the handler's target wrapper (`<w:ins>` / `<w:del>` / `<w:moveTo>`). No 5-class classifier or cross-atom pairing is required.

**Why**: An earlier draft of this design called for a `classifyFieldChange` function returning one of `{whole-field-insertion, whole-field-deletion, instr-modification, result-modification, no-change}` so that whole-field-insertion could stay unfragmented (preserving the strong `assertRecursivelyWellformed` invariant in the bridge test). Steven's #217 comment from 2026-05-22 is explicit that the bridge test's over-check will fire on fragmented insertion output too, and should be relaxed as part of this PR:

> "When the engine starts fragmenting fields per ECMA-376, the bridge test's `assertRecursivelyWellformed` over-check (`lean-spec-bridge.test.ts:766`) will start firing on fragmented inplace outputs. Remove or relax it as part of this issue's PR."

That directive implies whole-field insertion *should* fragment too. With that decision, the classifier collapses to a single yes/no predicate: "is this a collapsed-field atom?" — already trivially expressible as `atom.collapsedFieldAtoms !== undefined`. No new module is needed.

A consequence: for a modification scenario (e.g., NUMPAGES 3 → 4), the engine emits TWO complete field shells in document order — the Deleted side wraps the original payloads in `<w:del>` with unwrapped fldChars, and the Inserted side wraps the revised payloads in `<w:ins>` with its own set of unwrapped fldChars. Each shell is structurally well-formed; the combined output is two consecutive fields. `validateFieldStructure` passes on combined, accept, and reject. This is strictly less ambitious than emitting the ECMA-376 canonical single-field-with-fragmented-payloads pattern, but it (a) eliminates the `w:fldChar` inside `<w:del>` violation, (b) satisfies all engine validators, and (c) defers the cross-atom pairing complexity to a future change if needed.

**Alternatives considered and rejected**:
- *Five-class classifier with atom pairing*: would produce the cleaner ECMA-376 canonical FORMCHECKBOX example form (single field with fragmented payloads), but requires linking Deleted and Inserted collapsed-field atoms across the merged list. The atomizer assigns one `correlationStatus` per collapsed atom (from the first field atom at `atomizer.ts:780`) and doesn't link them; pairing would need a new pre-handler pass. Out of scope for this change; reconsider if Phase 9 round-trips show a real-world rendering issue.
- *Keep whole-field insertion unfragmented*: would preserve `assertRecursivelyWellformed` on the insertion fixture, but contradicts Steven's directive. Rejected.

### Decision 2: Fragmentation happens via a new `fragmentModifiedField` helper, not by relaxing pre-split guards

**What**: A new helper `fragmentModifiedField(atom, wrapperKind)` builds the wrapped/unwrapped run sequence directly from `collapsedFieldAtoms`. The existing pre-split helpers (`preSplitMixedStatusRuns:1492`, `preSplitInterleavedWordRuns:1631`) keep their `FIELD_CHAR_TAG_NAMES` skip guards at `:1505/:1509/:1671/:1675` UNCHANGED.

**Why**: The pre-split helpers operate on *visible character offsets*. `w:fldChar` and `w:instrText` have zero visible length per `atomContentVisibleLength:1474` — relaxing the guards would not enable fragmentation (the splitter can't split at a zero-width boundary) and could destabilize unrelated paths. The fragmentation logic is structurally different: it walks the constituent `collapsedFieldAtoms` and decides per-atom whether to emit unwrapped (for `w:fldChar`) or wrapped (for payloads).

**Alternatives considered**:
- *Relax pre-split guards*: doesn't work for zero-visible-length atoms. Rejected.
- *Extend the pre-split splitter to split on child-element boundaries*: large surface change, risks affecting non-field paths. Rejected.

### Decision 3: Whole-field INSERTION and MOVE-DESTINATION stay unfragmented (revised from earlier draft)

**What**: `handleInserted` and `handleMovedDestination` keep their existing behavior — wrap the entire field sequence in one `<w:ins>` (or `<w:moveTo>`).

**Why**: ECMA-376 Part 4 § 17.16.5 bars `w:fldChar` from `<w:del>` only. `<w:ins>` and `<w:moveTo>` may contain `w:fldChar` markers. An earlier draft of this design (informed by Steven's #217 comment from 2026-05-22 which suggested the `lean-spec-bridge.test.ts` insertion over-check would also need to be relaxed) attempted symmetric fragmentation across all three handlers. When implemented, that broke the NVCA regression fixtures (`nvca-coi-regression.test.ts`, `nvca-structural-regression.test.ts`) — both fell back to rebuild with `rejectText` failures because the inserted-side fragmentation interacts with mixed-run revised-document patterns in ways that drop end-fldChars on the reject path.

Narrowing the scope to deletion-side fragmentation:

- Satisfies the actual ECMA-376 conformance rule (no `w:fldChar` inside `<w:del>`).
- Keeps the NVCA fixtures passing.
- Keeps the bridge-test insertion fixture's `assertRecursivelyWellformed` passing — no Lean-side test relaxation needed.
- Bridge-test DELETION fixture stays on `assertFieldInvariant` only because fragmented `<w:del><w:delInstrText>…</w:delInstrText></w:del>` is still not field-context-neutral under ∀ ctx (the `<w:del>` wrapper has an empty local stack when entered).

If future work needs `<w:ins>` fragmentation for a real-world conformance reason, the engine path is open — the deletion-side helper `insertFragmentedDeletedField` is the model and a symmetric `insertFragmentedInsertedField` would be the entry point. That work needs a different fixture suite + atomizer-side analysis to handle the mixed-run revised-tree case correctly.

### Decision 4: Whole-field DELETION representation — content-only deletion, fldChars unwrapped

**What**: For whole-field deletion, fragment the field the same way as a modification — emit `[begin]`, `[separate]`, `[end]` runs unwrapped at sibling level; wrap the `[instrText]` (renamed to `delInstrText`) and `[result]` (renamed to `delText`) runs in `<w:del>`.

**Why**: ECMA-376 Part 4 § 17.16.5 (Deleted Field Code / delInstrText) specifies that `w:delInstrText` MUST appear inside `<w:del>` ("If this element is not contained within a del element, then the document is non-conformant"). The canonical example for a tracked field modification — quoted verbatim from ISO/IEC 29500-1 1st Edition via Microsoft Learn — keeps `w:fldChar` markers OUTSIDE the `<w:ins>` / `<w:del>` wrappers:

```xml
<w:fldChar w:fldCharType="begin"/>
<w:ins><w:r><w:instrText>FORMCHECKBOX</w:instrText></w:r></w:ins>
<w:del><w:r><w:delInstrText>FORMFIELDTEXT</w:delInstrText></w:r></w:del>
<w:fldChar w:fldCharType="separate"/>…<w:fldChar w:fldCharType="end"/>
```

ECMA-376 is silent on whole-field deletion specifically — the spec gives only the modification example. We extend the same fragmentation pattern: keep `w:fldChar` runs at sibling level, wrap only the payloads. The accept-state becomes `[begin][separate][end]` (a structurally well-formed but semantically empty field shell). The reject-state restores the field intact. Validation:

- `validateFieldStructure(accept)`: `[begin]` increments depth, `[separate]` flips the separator bit, `[end]` decrements. Final depth 0. No `w:instrText` between begin and separate. ✓
- `validateFieldStructure(reject)`: full field is restored. ✓
- `validateFieldStructure(combined)`: with `w:fldChar` at sibling level and `delInstrText` properly inside `<w:del>` between begin and separate — all three constraints in `pipeline.ts:361–430` are satisfied. ✓

**Trade-off**: On accept, the empty shell `[begin][separate][end]` is structurally valid but semantically degenerate. Microsoft Word renders an empty field as nothing (no field code, no result), which matches the user's intent of "delete this field." If empirical round-trip testing in Phase 9 surfaces a rendering problem, we will iterate — but the alternative (leaving fldChar inside `<w:del>`, the current behavior) is unambiguously non-conformant per `pipeline.ts:407`'s own runtime check.

**Research sources consulted**:
- ECMA-376 Part 4 § 17.16.5 (delInstrText) — Microsoft Learn `DeletedFieldCode` class documentation [quotes ISO/IEC 29500-1 1st Edition verbatim].
- ECMA-376 Part 4 § 17.16.18 (fldChar) — c-rex.net mirror; documents only that `fldChar`'s parent element is `<r>`, no explicit ban on `<w:del>` ancestry in schema, but no example showing `w:fldChar` inside `<w:del>` either.
- The canonical FORMCHECKBOX→FORMTEXT example is the only authoritative XML the spec provides for a tracked field-content change. We extend it.
- docx4j forum and openxml.info section 17.16 were consulted but did not contain a whole-field-deletion example.
- LibreOffice source code (`sw/source/filter/ww8/`) was not directly inspected — declaring this an open follow-up. If a later empirical comparison against LibreOffice output shows a different representation, this decision is revisable.

**Alternatives considered and rejected**:
- *Keep current behavior (fldChar inside `<w:del>`)*: directly forbidden by `pipeline.ts:407` runtime check (added in PR #211). Word reportedly treats this as fatal (issue #217 body).
- *Wrap each fldChar in its own `<w:ins>` of the post-deletion state*: paradoxical; ECMA-376 doesn't model "tracked deletion of a fldChar marker." Rejected.
- *Defer whole-field deletion entirely and route to rebuild fallback*: degrades inplace coverage; doesn't match the engine's existing capability surface.

### Decision 5: Targeted combined-output safety gate (narrowed from full structural validation)

**What**: Add a new `hasFldCharInsideDel(documentXml)` helper in `pipeline.ts` and gate the combined output on it returning `false` — alongside the existing `validateFieldStructure` checks on the accept/reject projections. Failure causes the inplace pipeline to fall back to rebuild.

**Why a narrow gate, not full `validateFieldStructure(combined)`**: An earlier draft of this design proposed calling `validateFieldStructure` directly on `candidateXml`. When implemented, it surfaced a pre-existing non-conformance unrelated to #217: `insertMoveFromRun` (`inPlaceModifier.ts:1100`) calls `convertToDelText` on cloned runs even though the runs end up inside `<w:moveFrom>`, not `<w:del>`. The result is `w:delInstrText` inside `<w:moveFrom>`, which violates the rule "delInstrText must be inside w:del." This breaks NVCA structural regression. That's a separate gap — the right fix is in `insertMoveFromRun`, not in this PR.

Narrowing the combined gate to the `hasFldCharInsideDel` rule scopes it to the exact #217 conformance concern: catch any regression that puts `w:fldChar` inside `<w:del>` in the combined output. The accept and reject projections still get full `validateFieldStructure`, which catches the orphan-instrText and out-of-order-fldChar bugs the existing PR #211 check was designed for.

### Decision 6: Bridge test deletion fixture keeps `assertFieldInvariant` only

**What**: After this change lands, the deletion fixture at `lean-spec-bridge.test.ts:943–993` continues to call `assertFieldInvariant(result.combined)` and NOT `assertRecursivelyWellformed`.

**Why**: Fragmented `<w:del><w:r><w:delInstrText>…</w:delInstrText></w:r></w:del>` is not `fieldContextNeutral` under `∀ ctx` (verified by reading `isFieldContextNeutral` at `lean-spec-bridge.test.ts:753–755`: `w:delInstrText` is rejected when the local depth stack is empty). The weakened axiom from PR #220 reflects exactly this — the engine output satisfies document-level `preservationFriendly` but not per-subtree `recursivelyWellformed`.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Field-change classifier mis-classifies a corner case (e.g., nested fields, fields without separator) and triggers wrong dispatch | Phase 1.5 unit tests with fabricated atom pairs cover each class; Phase 0 fixtures include the corner cases |
| Whole-field deletion research stalls Phase 3 indefinitely | Phase 2 (modification) ships first as a partial fix that resolves the most-observed failure mode; Phase 3 lands when research completes |
| Combined-output gate breaks pre-existing pipelines that emit `w:fldChar` inside `<w:del>` for legitimate reasons | None expected — ECMA-376 is explicit. If found, the gate provides immediate visibility |
| `lean-spec-bridge.test.ts` insertion fixture's `assertRecursivelyWellformed` starts failing because some downstream code path also fragments inserts | Insertion handler keeps its current single-wrapper behavior under `whole-field-insertion` classification; no fragmentation introduced on the insertion path |

## Migration Plan

- **Phase 0**: Add fixtures (red).
- **Phase 1**: Research whole-field deletion representation; record decision.
- **Phase 1.5**: Add classifier + unit tests (no behavior change yet).
- **Phase 2**: Field-modification fragmentation (Phase 0 fixtures go green).
- **Phase 3**: Whole-field deletion fragmentation (additional fixtures go green).
- **Phase 4**: Combined-output gate, test updates, doc updates.
- **Rollback**: Each phase is its own commit; `git revert` per phase. The new classifier and helper are additive — reverting Phase 2/3 leaves them dormant. Reverting Phase 4 only undoes the gate and doc updates.

## Open Questions

1. **Whole-field deletion**: Phase 1 deliverable.
2. **Nested fields**: Does the classifier handle a field-inside-a-field correctly, or does the inner-field's `collapsedFieldAtoms` get hidden by the outer collapse? To be verified in Phase 1.5 unit tests.
3. **Move source/destination of a complex field**: Out of scope for this change unless Phase 0 fixtures surface it as a failure mode.
