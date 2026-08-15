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

### Decision 1: Deletion-side fragmentation only; no atom-pairing classifier

**What**: Only `insertDeletedRun:923` fragments collapsed-field atoms. `handleInserted:1957` and `handleMovedDestination:2300` keep their existing single-wrapper behavior. No 5-class classifier or cross-atom pairing is required — the engine just checks `atom.collapsedFieldAtoms !== undefined` at the deletion site.

**Why**: ECMA-376 Part 1 §§17.16.13 and 17.16.18 define deleted field-code containment and complex-field characters. Per the canonical FORMCHECKBOX→FORMFIELDTEXT modification example, `<w:ins>` legitimately contains `w:fldChar`. So insertion-side fragmentation is not required for this implementation constraint.

An earlier draft of this design proposed symmetric fragmentation across all three handlers (informed by Steven's #217 comment from 2026-05-22 which suggested the bridge-test insertion `assertRecursivelyWellformed` would fire after fragmentation). When implemented, that regressed the NVCA fixtures (`nvca-coi-regression.test.ts`, `nvca-structural-regression.test.ts`) with `rejectText` failures because the inserted-side fragmentation interacts with mixed-run revised-document patterns in ways that drop end-fldChars on the reject path. The narrowed scope:

- Satisfies the actual ECMA-376 conformance rule (no `w:fldChar` inside `<w:del>`).
- Keeps the NVCA fixtures passing.
- Keeps the bridge-test insertion fixture's `assertRecursivelyWellformed` passing — no Lean-side test relaxation needed.
- For a modification scenario where the same field appears as both Deleted (original side) and Inserted (revised side), the engine emits the deleted side with fragmented fldChars at sibling level + payload-wrapping `<w:del>` siblings, followed by the inserted side with its complete field inside one `<w:ins>` (with `w:fldChar` inside `<w:ins>` — permitted by ECMA-376). Each half is structurally well-formed; the combined output validates.

**Alternatives considered and rejected**:
- *Five-class classifier with atom pairing*: would produce the cleaner single-field-with-fragmented-payloads form from ECMA-376's canonical example, but requires linking Deleted and Inserted collapsed-field atoms across the merged list. Out of scope; reconsider if Phase 9 round-trips show a real-world rendering issue.
- *Symmetric fragmentation across all three handlers*: contradicts ECMA-376 (which permits `w:fldChar` inside `<w:ins>` and `<w:moveTo>`) AND empirically regresses NVCA fixtures. Rejected.

### Decision 2: Fragmentation happens via a new `fragmentModifiedField` helper, not by relaxing pre-split guards

**What**: A new helper `fragmentModifiedField(atom, wrapperKind)` builds the wrapped/unwrapped run sequence directly from `collapsedFieldAtoms`. The existing pre-split helpers (`preSplitMixedStatusRuns:1492`, `preSplitInterleavedWordRuns:1631`) keep their `FIELD_CHAR_TAG_NAMES` skip guards at `:1505/:1509/:1671/:1675` UNCHANGED.

**Why**: The pre-split helpers operate on *visible character offsets*. `w:fldChar` and `w:instrText` have zero visible length per `atomContentVisibleLength:1474` — relaxing the guards would not enable fragmentation (the splitter can't split at a zero-width boundary) and could destabilize unrelated paths. The fragmentation logic is structurally different: it walks the constituent `collapsedFieldAtoms` and decides per-atom whether to emit unwrapped (for `w:fldChar`) or wrapped (for payloads).

**Alternatives considered**:
- *Relax pre-split guards*: doesn't work for zero-visible-length atoms. Rejected.
- *Extend the pre-split splitter to split on child-element boundaries*: large surface change, risks affecting non-field paths. Rejected.

### Decision 3: Whole-field INSERTION and MOVE-DESTINATION stay unfragmented (revised from earlier draft)

**What**: `handleInserted` and `handleMovedDestination` keep their existing behavior — wrap the entire field sequence in one `<w:ins>` (or `<w:moveTo>`).

**Why**: ECMA-376 Part 1 §§17.16.13 and 17.16.18 support keeping `w:fldChar` outside the deleted field-code payload. `<w:ins>` and `<w:moveTo>` may contain `w:fldChar` markers. An earlier draft of this design (informed by Steven's #217 comment from 2026-05-22 which suggested the `lean-spec-bridge.test.ts` insertion over-check would also need to be relaxed) attempted symmetric fragmentation across all three handlers. When implemented, that broke the NVCA regression fixtures (`nvca-coi-regression.test.ts`, `nvca-structural-regression.test.ts`) — both fell back to rebuild with `rejectText` failures because the inserted-side fragmentation interacts with mixed-run revised-document patterns in ways that drop end-fldChars on the reject path.

Narrowing the scope to deletion-side fragmentation:

- Satisfies the actual ECMA-376 conformance rule (no `w:fldChar` inside `<w:del>`).
- Keeps the NVCA fixtures passing.
- Keeps the bridge-test insertion fixture's `assertRecursivelyWellformed` passing — no Lean-side test relaxation needed.
- Bridge-test DELETION fixture stays on `assertFieldInvariant` only because fragmented `<w:del><w:delInstrText>…</w:delInstrText></w:del>` is still not field-context-neutral under ∀ ctx (the `<w:del>` wrapper has an empty local stack when entered).

If future work needs `<w:ins>` fragmentation for a real-world conformance reason, the engine path is open — the deletion-side helper `insertFragmentedDeletedField` is the model and a symmetric `insertFragmentedInsertedField` would be the entry point. That work needs a different fixture suite + atomizer-side analysis to handle the mixed-run revised-tree case correctly.

### Decision 4: Whole-field DELETION representation — content-only deletion, fldChars unwrapped

**What**: For whole-field deletion, fragment the field the same way as a modification — emit `[begin]`, `[separate]`, `[end]` runs unwrapped at sibling level; wrap the `[instrText]` (renamed to `delInstrText`) and `[result]` (renamed to `delText`) runs in `<w:del>`.

**Why**: ECMA-376 Part 1 §17.16.13 (Deleted Field Code / delInstrText) specifies that `w:delInstrText` MUST appear inside `<w:del>` ("If this element is not contained within a del element, then the document is non-conformant"). The canonical example for a tracked field modification keeps the §17.16.18 `w:fldChar` markers OUTSIDE the `<w:ins>` / `<w:del>` wrappers:

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
- ECMA-376 Part 1 §17.16.13 (`delInstrText`) and §17.16.18 (`fldChar`).
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

**Why a narrow gate, not full `validateFieldStructure(combined)`**: An earlier draft of this design proposed calling `validateFieldStructure` directly on `candidateXml`. When implemented, it surfaced a pre-existing non-conformance unrelated to #217: `insertMoveFromRun` (`inPlaceModifier-deletion.ts`) calls `convertToDelText` on cloned runs even though the runs end up inside `<w:moveFrom>`, not `<w:del>`. The result is `w:delInstrText` inside `<w:moveFrom>`, which violates the rule "delInstrText must be inside w:del." This breaks NVCA structural regression. That's a separate gap — the right fix is in `insertMoveFromRun`, not in this PR.

Narrowing the combined gate to the `hasFldCharInsideDel` rule scopes it to the exact #217 conformance concern: catch any regression that puts `w:fldChar` inside `<w:del>` in the combined output. The accept and reject projections still get full `validateFieldStructure`, which catches the orphan-instrText and out-of-order-fldChar bugs the existing PR #211 check was designed for.

### Decision 6: Bridge test deletion fixture keeps `assertFieldInvariant` only

**What**: After this change lands, the deletion fixture at `lean-spec-bridge.test.ts:943–993` continues to call `assertFieldInvariant(result.combined)` and NOT `assertRecursivelyWellformed`.

**Why**: Fragmented `<w:del><w:r><w:delInstrText>…</w:delInstrText></w:r></w:del>` is not `fieldContextNeutral` under `∀ ctx` (verified by reading `isFieldContextNeutral` at `lean-spec-bridge.test.ts:753–755`: `w:delInstrText` is rejected when the local depth stack is empty). The weakened axiom from PR #220 reflects exactly this — the engine output satisfies document-level `preservationFriendly` but not per-subtree `recursivelyWellformed`.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Whole-field deletion empty-shell accept-state renders unexpectedly in Word | Phase 9 manual round-trip in Word + LibreOffice. If renderer rejects the empty shell, revisit Decision 4 by inspecting LibreOffice source for an alternative representation. |
| Combined-output gate `hasFldCharInsideDel` lets a regression through in a non-#217-related shape | The gate is intentionally narrow to the #217 conformance rule. Broader structural validation is run on accept/reject projections (which catches orphan-instrText, out-of-order fldChars). |
| Pre-existing `convertToDelText` call inside `<w:moveFrom>` (`inPlaceModifier-deletion.ts`, `insertMoveFromRun`) produces `w:delInstrText` outside `<w:del>` | Out of scope for this change. Track as a separate follow-up. The narrow combined-output gate intentionally does not catch this. |
| Bookmark markers internal to a deleted complex field follow the pre-existing first-source-run-only hoisting in `cloneUnemittedSourceBookmarkMarkers` (`inPlaceModifier-bookmarks.ts`) | Pre-existing limitation, not a regression introduced by this PR. The same hoisting happened with the old whole-field `<w:del>` wrapper. Track as a separate follow-up if real-world fixtures surface it. |

## Migration Plan

- **Phase 0**: Add red fixtures.
- **Phase 1**: Research whole-field deletion representation; record decision (Decision 4).
- **Phase 1.5**: SKIPPED — superseded by Decision 1 (no classifier needed; uniform `atom.collapsedFieldAtoms` check suffices).
- **Phase 2 + 3**: Deletion-side fragmentation (`isCollapsedFieldAtom`, `insertFragmentedDeletedField`, rewired `insertDeletedRun`); subsumes both the modification and whole-field-deletion cases via the same code path.
- **Phase 4**: Targeted combined-output gate (`hasFldCharInsideDel`), test contract updates, documentation refresh.
- **Phase 9 (follow-up, not in this PR)**: Manual Word + LibreOffice round-trip; OpenSpec archive.
- **Rollback**: Each phase is its own commit on the branch; `git revert` per phase. The new helper and gate are additive — reverting Phase 2+3 leaves `hasFldCharInsideDel` dormant.

## Open Questions

1. **Whole-field deletion empty-shell rendering in Word.** Closed on paper (Decision 4) but unvalidated empirically. Phase 9 deliverable.
2. **Nested fields**: Does `collapsedFieldAtoms` for an outer field include or exclude an inner field's atoms? The atomizer in `atomizer.ts:740` does not nest-collapse, so inner fields should appear as separate collapsed-field atoms. Verify with a fixture if a real-world failure surfaces.
3. **Move source/destination of a complex field**: `insertMoveFromRun:1100` has a pre-existing non-conformance (`w:delInstrText` inside `<w:moveFrom>`). Out of scope; file as separate follow-up.
4. **Bookmark markers internal to a deleted field**: Hoisted before the first emitted element (begin fldChar) via `cloneUnemittedSourceBookmarkMarkers` on the first source run only. Pre-existing behavior; document as known limitation.
