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

### Decision 1: Add a field-change classifier, do NOT extend `ComparisonUnitAtom`

**What**: Introduce `classifyFieldChange(originalAtom, revisedAtom) → FieldChangeClass` as a side-table function that reads the two collapsed-field atoms and returns one of five classes.

**Why**: `ComparisonUnitAtom.collapsedFieldAtoms` carries only ONE `correlationStatus`, derived from the first field atom at `atomizer.ts:780`. Per-constituent comparison status is not preserved. To distinguish (a) new-field-insertion vs (b) modification of an existing field vs (c) whole-field deletion at the handler call sites (`handleInserted:1957`, `handleMovedDestination:2300`, `insertDeletedRun:923`), we must inspect both sides' field atom sequences.

**Alternatives considered**:
- *Per-constituent status on `ComparisonUnitAtom`*: would require atomizer rewrite, breaking other invariants. Rejected.
- *Heuristic at handler call sites* (e.g., "if the atom is a collapsed field and the wrapper is `<w:del>`, assume modification"): fragile, wrong for whole-field deletion, doesn't separate result-only from instr-only modifications. Rejected.
- *Defer classification to Phase 2*: would block Phase 0 fixtures from being precisely typed. Rejected.

### Decision 2: Fragmentation happens via a new `fragmentModifiedField` helper, not by relaxing pre-split guards

**What**: A new helper `fragmentModifiedField(atom, wrapperKind)` builds the wrapped/unwrapped run sequence directly from `collapsedFieldAtoms`. The existing pre-split helpers (`preSplitMixedStatusRuns:1492`, `preSplitInterleavedWordRuns:1631`) keep their `FIELD_CHAR_TAG_NAMES` skip guards at `:1505/:1509/:1671/:1675` UNCHANGED.

**Why**: The pre-split helpers operate on *visible character offsets*. `w:fldChar` and `w:instrText` have zero visible length per `atomContentVisibleLength:1474` — relaxing the guards would not enable fragmentation (the splitter can't split at a zero-width boundary) and could destabilize unrelated paths. The fragmentation logic is structurally different: it walks the constituent `collapsedFieldAtoms` and decides per-atom whether to emit unwrapped (for `w:fldChar`) or wrapped (for payloads).

**Alternatives considered**:
- *Relax pre-split guards*: doesn't work for zero-visible-length atoms. Rejected.
- *Extend the pre-split splitter to split on child-element boundaries*: large surface change, risks affecting non-field paths. Rejected.

### Decision 3: Whole-field INSERTION stays unfragmented

**What**: When `classifyFieldChange` returns `whole-field-insertion`, `handleInserted` keeps its existing behavior — wrap the entire field sequence in one `<w:ins>`.

**Why**: ECMA-376 Part 4 bars `w:fldChar` from `<w:del>` only. A complete `[begin..end]` field inside one `<w:ins>` is well-formed and is `fieldContextNeutral` under `∀ ctx` (verified empirically by `assertRecursivelyWellformed` passing at `lean-spec-bridge.test.ts:935`). Fragmenting it would lose the stronger wrapper-neutrality property without conformance benefit.

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

### Decision 5: Combined-output safety gate

**What**: Add a third call site to `validateFieldStructure` in `pipeline.ts` — alongside the existing accept/reject validation at `:468`, also validate the combined output. Failure causes the inplace pipeline to fall back to rebuild.

**Why**: Without this gate, a regression that re-emits `w:fldChar` inside `<w:del>` in the combined output (but not in the accept/reject projections) would silently slip through. The runtime check from PR #211 at `pipeline.ts:407` enforces the rule per-XML but is only called on the accept/reject projections.

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
