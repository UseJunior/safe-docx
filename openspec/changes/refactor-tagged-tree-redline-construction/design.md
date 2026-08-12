## Context

The comparison engine's core loop is a generate-and-test search: `pipeline.ts`
runs the full comparison under up to four atomization configurations, checks
each serialized candidate by accept/reject round-trip, and keeps the first
survivor — falling back to `rebuild` if none survive.

That shape follows from the intermediate representation. `atomizeTree` flattens
OOXML into a flat `ComparisonUnitAtom[]`; LCS runs over the flat list;
`documentReconstructor` rebuilds a tree from atoms. Tree well-formedness — what
makes a redline valid, and what `accept`/`reject` depend on — is not preserved
by that pipeline, so it can only be checked at the end, and recovery from a
failed check means retrying with different knobs.

Two prior findings frame this change:

- `reclassify-cross-run-rescue-as-residual` measured passes 3-4 as never
  selected and documented them as a residual (#469, follow-up #542).
- The Lean spike carries `compareDocumentXml_output_text_roundtrip` as a named
  residual axiom precisely because `compareDocumentXml` is not modeled
  definitionally — the engine's behavior has to be assumed.

Both are symptoms of the same thing: correctness is asserted about the output
instead of guaranteed by the construction.

## Goals / Non-Goals

**Goals (this change, stage A)**
- A representation in which `accept`/`reject` correctness is a property of the
  construction rather than a test on serialized output.
- A projection contract precise enough to be falsifiable.
- Shadow-mode divergence evidence over the differential corpus.

**Non-Goals (this change)**
- Any behavior change. Nothing is deleted, nothing is flipped, no runtime check
  is retired.
- **Effective formatting.** The existing detector (`format-detection.ts:299`)
  and fidelity oracle (`formattingFidelity.ts:290`) inspect *direct* `w:rPr` /
  `w:pPr` only, not formatting resolved through the style chain or
  `docDefaults`. The shadow gate therefore cannot establish correctness for
  inherited toggles, and `PropertyDelta` is scoped to direct properties.
  Resolved formatting stays a separately-tracked known-divergence class.
- Removing the explicit `rebuild` output mode (successor D).
- Discharging the Lean residual axiom (Tier 3).

## Decisions

### Decision: a side-tagged tree carrying both side representatives

```
type Side = 'both' | 'original' | 'revised'

type TaggedNode =
  | { tag: 'both'
      original: Element            // the original-side node
      revised:  Element            // the revised-side node (may differ)
      propertyDelta?: PropertyDelta
      children: TaggedNode[] }
  | { tag: 'original'; node: Element; children: TaggedNode[] }   // deleted
  | { tag: 'revised';  node: Element; children: TaggedNode[] }   // inserted
```

A `both` node holds **two** element references, not one. Two nodes can be
*matched* without being *identical* — same text with different run properties,
same paragraph with a different `pPr`, same run carrying different pre-existing
revision provenance. A single-element `both` node cannot say which side's
attributes each projection should emit, which is the flaw that forces
formatting differences into delete+insert pairs today.

`PropertyDelta` is **scoped**, because OOXML property changes are not one kind
of thing:

| Scope | Source | Serializes to |
|---|---|---|
| run | `w:rPr` | `w:rPrChange` |
| paragraph mark | `w:pPr/w:rPr` | `w:rPrChange` on the mark |
| paragraph | `w:pPr` | `w:pPrChange` |
| table row / cell | `w:trPr` / `w:tcPr` | `w:trPrChange` / `w:tcPrChange` |
| section | `w:sectPr` | `w:sectPrChange` |

Each records a **direct OOXML property snapshot** of each side, not resolved
effective formatting (see Non-Goals).

**Alternatives considered**
- *Keep flat atoms, type the reconstructor's output.* Rejected: the information
  destroyed by flattening (containment, table topology, field boundaries) cannot
  be typed back into existence — which is why `ContainerResolutionError` exists
  as a pass-failure signal today.
- *Single-element `both` with a side discriminator on each attribute.* Rejected:
  pushes the same two-sidedness down to every attribute with no simplification.

### Decision: the obligation is projection isomorphism, not coverage

The first draft of this design stated two coverage obligations — "every input
node appears exactly once, tagged `both` or its own side" — and claimed
round-trip correctness followed. **That is false.** Peer review supplied the
counterexample:

> original children `[A, B]`, revised children `[B, A]`. An IR ordered
> `[both(B), both(A)]` satisfies "each input node appears exactly once," yet
> `project(_, 'original')` yields `[B, A]`, not `[A, B]`. Coverage holds;
> round-trip fails.

Membership and multiplicity say nothing about **order**, and OOXML text
extraction is order-sensitive. The obligation is therefore stated as an
isomorphism. For each side `s`, `project(tree, s)` must be isomorphic to input
side `s`:

- **P1 — bijection.** Every node of input side `s` corresponds to exactly one IR
  occurrence tagged `both` or `s`, and vice versa.
- **P2 — order.** Sibling order in the projection equals sibling order in the
  input side.
- **P3 — containment.** Parent/child relationships are preserved; a node's
  projected parent is the projection of its IR parent.
- **P4 — content.** Side-specific text, attributes, and properties are those of
  side `s`'s representative — for a `both` node, its `original` or `revised`
  element as appropriate.
- **P5 — opaque payload.** Content the engine does not model (passthrough
  subtrees) is reproduced byte-identically on the side it came from.

P1-P5 are checkable on the IR in linear time without serializing.

### Decision: separate the four correctness layers, and keep every runtime check

P1-P5 establish **IR projection fidelity** only. Three further layers stand
between that and a correct `.docx`, and conflating them was the first draft's
second error:

1. **IR projection fidelity** — P1-P5, established by construction.
2. **Serializer correctness** — that emitting a `TaggedTree` as OOXML tracked
   markup preserves the projections.
3. **Accept/reject semantics** — that Word's and our own accept/reject agree
   with `project`.
4. **Package/story assembly** — headers, footers, notes, comments, text-box and
   ancillary stories, relationship tables.

Therefore the existing runtime checks for text, bookmarks, field structure, and
ancillary stories **all stay**, unchanged, until each has its own construction
invariant *and* executable evidence. This change retires none of them.

### Decision: PRESERVE semantics need a construction invariant, not "payload"

The first draft claimed pre-existing tracked changes could "ride as node
payload, orthogonal to the tag." Peer review showed that is not what the engine
does: `preSplitInsProvenanceRuns` (`inPlaceModifier-presplit.ts:175`) splits
runs along provenance boundaries and reconstructs original insertion wrappers,
and revision IDs are seeded across preserved roots (`inPlaceModifier.ts:96`).

So PRESERVE needs explicit invariants, not transport:

- **provenance splitting** — where a comparison-side boundary falls inside a
  pre-existing `w:ins`/`w:del`, the IR must represent the split without losing
  the original wrapper's author/date;
- **nesting** — the legal nesting of a comparison revision inside a pre-existing
  one, and which projection unwraps which;
- **revision-ID allocation** — collision avoidance against IDs already present
  in either input;
- **accept/reject over multi-author stacks** — the reject-projection oracle
  already covers this class and is the gate.

These are proved on the multi-author corpus **first**, not last (task 2.5).

### Decision: move ranges keep their existing certification

The live requirement "Tracked move ranges are structurally certified"
(`openspec/specs/docx-comparison/spec.md:324`) demands exactly one range per
direction and name, balanced non-crossing markers, unique decimal IDs, and
matching names. A subtree relation alone does not deliver marker balance,
uniqueness, non-crossing, or name pairing.

That requirement is **not modified**. The IR must satisfy it, and whether
`coalesceMoveRangeMarkers` (`inPlaceModifier-postprocess.ts:397`) can be deleted
is decided by evidence in stage B: if the IR guarantees one logical range per
direction at construction, the pass goes with its cause in successor C;
otherwise it is retained and reclassified alongside the readability passes.

### Decision: nested stories compose over the IR

Text-box and ancillary-part stories currently recurse into the whole pipeline
(`pipeline.ts:609-680`) and re-validate the assembled result with another
accept/reject round-trip. Under the IR a nested story is a subtree with its own
tagged tree, and assembly is IR composition. This is designed for in stage A but
only exercised in shadow; the recursive path is untouched until successor C.

## Risks / Trade-offs

- **This is the engine's core.** A wrong step ships bad redlines into legal
  documents. → Stage A changes no behavior at all; the IR has no production
  caller. Every subsequent stage is gated on corpus evidence.
- **PRESERVE is the hardest case**, and the first draft underestimated it. →
  Explicit invariants above; multi-author fixtures are proved before anything
  else advances.
- **Shadow equivalence may be equivalent-but-not-identical.** Coalescing
  boundaries can legitimately differ. → The gate compares projections and
  fidelity scores, not bytes; projection-inequivalent diffs block, and
  projection-equivalent textual differences are reviewed individually and either
  accepted with a recorded rationale or pinned.
- **The shadow gate cannot see inherited formatting**, because neither the
  detector nor the oracle resolves the style chain. → Declared a non-goal rather
  than assumed away; effective-formatting divergence remains separately tracked.
- **Two representations coexist during migration.** → Bounded: stage A is
  additive, and the legacy path is deleted only in successor C.

## Migration Plan

**This change (A):** build `TaggedTree`, `project`, and the P1-P5 checks;
property-test them in isolation; run the IR in shadow and produce a divergence
report over the differential corpus. Nothing user-visible changes. Fully
revertible.

**Successor B:** flip the default, retaining the legacy path behind a flag and
retaining all existing diagnostics and both explicit output modes.

**Successor C:** after release evidence from B, delete the four-pass ladder, the
automatic fallback, `suppressNoOpChangePairs`,
`suppressDuplicatedFormatChangesInTextReplacements`, and — if stage B evidence
supports it — `coalesceMoveRangeMarkers`. Closes #542.

**Successor D (separate decision):** whether to deprecate the explicit `rebuild`
output mode and the reconstruction-mode metadata at all. This is a public
breaking change: the docx-compare CLI defaults to `rebuild`
(`cli/compare-two.ts:49`) and `compare_documents` returns
`reconstruction_mode_used` (`compare_documents.ts:149`). It may well be that
`rebuild` simply survives as an explicit output shape and nothing is removed.

Rollback: A is additive. B is a flag flip. Only C is irreversible, and it is
gated on a green B release.

## Open Questions

- Does the IR guarantee one logical move range per direction at construction, or
  is `coalesceMoveRangeMarkers` load-bearing? Decided by stage B evidence.
- Should P1-P5 checks run in production builds or only under test? Linear-time
  argues for always-on; profiling on the largest corpus documents decides.
- Can `opaquePassthrough`'s counterpart binding be expressed as P5 payload, or
  does it need to stay a separate pre-pass?
- Does `rebuild`'s different base-archive selection (`pipeline.ts:1239`) mean
  the IR needs two serializers, or one serializer parameterized by which side
  supplies the package skeleton?
