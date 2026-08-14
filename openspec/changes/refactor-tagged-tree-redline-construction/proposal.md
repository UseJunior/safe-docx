# Change: Add a side-tagged tree IR for redline construction, proved in shadow

Tracking issue: #814. Related: #542 (cross-run passes as candidate dead code), #469.

## Why

`compareDocumentsAtomizerCore` does not construct a redline — it searches for
one. `packages/docx-compare/src/baselines/atomizer/pipeline.ts:1128-1231`
defines four atomization configurations, runs the **entire comparison** under
each, and after each candidate calls `evaluateRoundTripSafety`, which
accept-alls and reject-alls the serialized output and compares it against the
two inputs. The first candidate that passes wins; if all four fail, the result
is discarded and a structurally different reconstruction (`rebuild`) runs as a
hard fallback.

Two consequences are not defensible on their own terms:

1. **The correctness oracle is load-bearing control flow.**
   `accept(output) ≡ revised ∧ reject(output) ≡ original` is the *definition* of
   a correct redline. It is currently a runtime filter used to select among
   guesses, so the engine is correct only to the extent that the checker is
   complete. Every gap in the checker is a silently-shipped wrong redline, and
   every failure is a silent downgrade to lower-fidelity output.

2. **The emitter needs a cleanup crew behind it.**
   `inPlaceModifier.ts:126-145` runs `suppressNoOpChangePairs` over the tree it
   just built, to find and delete `<w:del>x</w:del><w:ins>x</w:ins>` pairs —
   content marked as deleted and re-inserted, identically. Its own docstring
   (`inPlaceModifier-postprocess.ts:163-166`) calls these "false-positive
   changes". Nothing should emit them.
   `suppressDuplicatedFormatChangesInTextReplacements` (#724) then compensates
   for a defect introduced by the coalescing passes themselves.

The root cause is representational. `atomizeTree` flattens OOXML into a flat
`ComparisonUnitAtom[]`, LCS runs over the flat list, and
`documentReconstructor.ts` (2330 lines) reconstitutes a tree from it. The tree
invariants that make output valid are destroyed by the flattening and have to be
recovered afterwards — which is precisely why they can only be *checked*
afterwards.

## What Changes

This change is **stage A only**: it adds the representation and proves it in
shadow. It deletes nothing and changes no user-visible behavior. Deletion of the
pass ladder and any public-surface decisions are successor changes, named below.

- **Add a side-tagged tree IR (`TaggedTree`).** Every node carries a tag of
  `both`, `original`, or `revised`. A `both` node holds **both side
  representatives** (original and revised), not a single element, plus an
  optional scoped `PropertyDelta` for formatting-only differences. Move pairs
  are a relation between an `original` and a `revised` subtree.

- **Specify projections as a projection-isomorphism contract, not a coverage
  count.** `project(tree, side)` is a total fold, and the aligner's obligation
  is that each projection is *isomorphic* to its input side — preserving
  document and sibling order, parent/child containment, side-specific text,
  attributes and properties, with a bijection from every input-side node to
  exactly one IR occurrence. Membership-and-multiplicity alone is provably
  insufficient (see `design.md` for the rejected counterexample).

- **Run the IR in shadow.** The existing pipeline stays authoritative. The IR
  path runs beside it behind `SAFE_DOCX_TAGGED_TREE=shadow` and records
  divergence over the differential corpus. No production caller switches.

- **Sequence PRESERVE evidence in two layers.** Model-level provenance
  splitting, nesting, identifier allocation, and multi-author relationships
  gate the serializer. Accept/reject evidence over those relationships follows
  immediately after the shadow-only serializer exists; it cannot coherently
  precede the serializer whose output it evaluates. This ordering correction
  was authorized on 2026-08-14 and does not weaken the PRESERVE requirement.

- **Keep every runtime check.** Text, bookmark, field-structure, and ancillary
  story checks all remain exactly as they are. This change adds a construction
  invariant; it does not yet cash it in against any existing safety net.

**Explicitly deferred to successor changes** (so this one stays reviewable):

- **B — default flip.** Make the IR path default while retaining the legacy path
  and all existing diagnostics.
- **C — remove the retry ladder and automatic fallback**, and delete
  `suppressNoOpChangePairs` /
  `suppressDuplicatedFormatChangesInTextReplacements` with their cause. Gated on
  release evidence from B. Closes #542.
- **D — public-surface decisions.** Whether explicit `rebuild` output mode and
  the reconstruction-mode metadata are deprecated at all. See the correction
  below; this is a public breaking change and needs its own justification.

## Corrections carried from peer review

Three claims in the first draft of this proposal were wrong and are recorded
here rather than quietly dropped:

- **`rebuild` is a first-class requested output mode, not only a fallback.**
  `CompareOptions.reconstructionMode` exposes it, both CLIs accept
  `--mode rebuild`, and rebuild vs. inplace select different base archives
  (`pipeline.ts:1239`). "Collapse to a single path" is therefore wrong; the
  correct target is *one construction algorithm per requested output shape*.
  Removing the mode is a separate public breaking change (successor D), not a
  side effect of this refactor.

  *Amended after merge:* this bullet originally said the docx-compare CLI
  **defaults** to `rebuild`. That was true of the branch it was verified
  against, but #811 (issue #808) had already unified every front door on
  `inplace`, and #816 recorded that as a behavior change. The default clause is
  withdrawn; the substantive point — `rebuild` is a requested output shape, not
  merely a fallback — is unaffected, and successor D still owns any removal.
  Note that `CompareOptions.reconstructionMode`'s own doc comment
  (`compare-types.ts:25`) still advertises `Default: 'rebuild'` and is now
  wrong on a published API surface; tracked separately, not fixed here.

- **`fail_on_rebuild_fallback` needs no migration.** It exists only on `save`,
  where it is already deprecated and ignored (#126,
  `tool_catalog.ts:257-262`). The first draft invented migration work for it.
  The real consumers of reconstruction metadata are
  `CompareOptions.reconstructionMode`, the two CLIs' `--mode`, and
  `compare_documents`' `reconstruction_mode_used` response field
  (`compare_documents.ts:149`).

- **Cross-run pass unreachability is empirical, not proven.** The prior change
  established that no cross-run selection was observed across ~3,900 synthetic
  fragmentation cases and 508 tests. That is not a proof: the safety oracle
  checks accept/reject **bookmarks** and **field structure** as well as text
  (`pipeline.ts:1104`), and the "text-safe by construction" argument covers only
  the text dimension. Stated as a measured result, not a theorem.

## Impact

- Affected specs: `docx-comparison` — ADDED only (tagged-tree IR, projection
  isomorphism, shadow-differential gate). **No REMOVED delta in this change**:
  the ladder requirement stays until successor C actually deletes the code, so
  the spec never describes a state the engine is not in.

- Affected code (additive; all in `packages/docx-compare/src/`):
  new `baselines/atomizer/taggedTree.ts`, plus shadow-mode wiring in
  `baselines/atomizer/pipeline.ts`. `hierarchicalLcs.ts` / `atomLcs.ts` gain a
  tag-emitting output path alongside their existing one.

- Post-processing inventory (fates decided here, executed in successor C):

  | Pass | Compensates for | Fate |
  |---|---|---|
  | `suppressNoOpChangePairs` | our emitter producing del+ins of equal content | delete with cause — **gated on field cases** |
  | `suppressDuplicatedFormatChangesInTextReplacements` (#724) | a defect from the coalescing passes | delete with cause |
  | `coalesceMoveRangeMarkers` | fragmented source atoms emitting duplicate range markers | delete with cause **only if** the IR guarantees one logical range per direction; otherwise retain |
  | `mergeAdjacentTrackChangeSiblings` | redline readability | retain, reclassified |
  | `coalesceDelInsPairChains` | redline readability | retain, reclassified |
  | `mergeWhitespaceBridgedTrackChanges` | redline readability | retain, reclassified |

  The test applied is: *does this layer exist because Word/OOXML is messy, or
  because our own earlier stage emits garbage?* Only the second kind is
  removable. `auxiliaryIdCollision`, `opaquePassthrough`,
  `consumerCompatibility`, `formattingFidelity`, and `leanXmlVerifier` are the
  first kind and are untouched.

- Non-goal: **effective** (style-chain / `docDefaults`-resolved) formatting.
  The current detector (`format-detection.ts:299`) and fidelity oracle
  (`formattingFidelity.ts:290`) both compare *direct* `w:rPr` / `w:pPr` only, so
  the shadow gate cannot establish correctness for inherited toggles. This
  change scopes `PropertyDelta` to direct properties and records resolved
  formatting as out of scope; it is already tracked separately as a
  known-divergence class.

- Spec drift observed, not fixed here: several `docx-comparison` requirements
  cite `packages/docx-core/src/baselines/atomizer/…` paths that moved to
  `packages/docx-compare/` in #549/#550, and the tests mapped to those scenarios
  still live in `packages/docx-core/`. Left for a docs-only pass.

- Safety net: the LibreOffice/Word differential oracles, pinned engine-bug
  characterization cases, and the fidelity corpus are what make this attemptable
  at all. The shadow gate runs against them, not unit tests alone.
