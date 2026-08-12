Scope: **stage A only** — additive representation, invariants, and shadow
evidence. Nothing is deleted and no default changes. Successors B/C/D are named
in `proposal.md` and are separate changes.

## 1. Representation and projections (no production caller)

- [x] 1.1 Add `TaggedNode` / `TaggedTree` to
      `packages/docx-compare/src/baselines/atomizer/taggedTree.ts`, with `both`
      carrying **both** side representatives plus an optional scoped
      `PropertyDelta`.
- [x] 1.2 Define `PropertyDelta` by scope (run, paragraph mark, paragraph, row,
      cell, section), recording direct OOXML snapshots per side. Do not resolve
      through the style chain or `docDefaults` — out of scope.
- [x] 1.3 Implement `project(tree, side)` as a total fold.
- [x] 1.4 Implement the P1-P5 isomorphism checks against an
      (original, revised, tree) triple, without serialization.
- [x] 1.5 Property-test P1-P5, including the rejected-counterexample case:
      original `[A,B]`, revised `[B,A]`, tree `[both(B),both(A)]` must fail P2.
- [x] 1.6 Add the `TEST_FEATURE` constant and single-line `.openspec(...)` tags
      for the new scenarios in a dedicated test file (one feature per file), and
      regenerate the traceability matrix — never hand-edit it.

## 2. Aligner emits tags

- [ ] 2.1 Add a tag-emitting output path to `hierarchicalLcs` paragraph matching
      alongside the existing correlation-status path; matching behavior
      unchanged.
- [ ] 2.2 Add a tag-emitting path to within-paragraph `atomLcs`, with
      word-vs-run granularity as an alignment parameter.
- [ ] 2.3 Represent direct formatting differences as `both` + scoped
      `PropertyDelta`; assert no construction path emits a del/ins pair over
      equal content.
- [ ] 2.4 Model move pairs as a relation between an `original` and a `revised`
      subtree, and verify the tree satisfies the live "Tracked move ranges are
      structurally certified" requirement — one range per direction and name,
      balanced non-crossing markers, unique decimal IDs. Record whether the tree
      guarantees this at construction (input to the `coalesceMoveRangeMarkers`
      decision in successor C).
- [ ] 2.5 Implement the PRESERVE invariants — provenance splitting, nesting,
      revision-ID allocation, multi-author resolution — and evidence them on the
      multi-author corpus **before** proceeding to task 3. This is the
      highest-risk surface; `preSplitInsProvenanceRuns`
      (`inPlaceModifier-presplit.ts:175`) and the ID seeding at
      `inPlaceModifier.ts:96` are the behavior to match.

## 3. Serializer and story composition (shadow-only)

- [ ] 3.1 Implement a serializer from `TaggedTree` to OOXML tracked markup,
      exercised only in shadow.
- [ ] 3.2 Property-test that serialization preserves both projections (layer 2
      of the four correctness layers in `design.md`).
- [ ] 3.3 Design nested text-box / ancillary story composition as IR subtrees;
      verify projections compose. Do not touch the recursive pipeline path.
- [ ] 3.4 Determine whether `rebuild`'s different base-archive selection
      (`pipeline.ts:1239`) needs a second serializer or one parameterized by
      which side supplies the package skeleton.

## 4. Shadow mode and evidence

- [ ] 4.1 Run the tree construction beside the existing pipeline behind
      `SAFE_DOCX_TAGGED_TREE=shadow`; existing pipeline stays authoritative and
      every existing runtime check keeps running.
- [ ] 4.2 Emit a divergence report keyed by fixture identity and diverging
      projection, classified projection-inequivalent (blocking) vs.
      projection-equivalent (for review). Compare projections and fidelity
      scores, not bytes.
- [ ] 4.3 Run over the fidelity corpus, multi-author fixtures, OpenAgreements +
      NVCA/ILPA templates, and pinned characterization cases.
- [ ] 4.4 Triage every divergence: fix inline if it is an aligner or oracle
      defect; pin and file it if it is a genuine pre-existing engine bug; record
      a rationale for any accepted projection-equivalent difference. One fix per
      PR.
- [ ] 4.5 Produce the field-case evidence that successor C's deletion of
      `suppressNoOpChangePairs` depends on: field-stable, field-modification,
      field-delete, nested-field, and paragraph-spanning-field cases showing no
      equal del/ins pairs are emitted and field structure survives both
      projections. Deletion is not justified by `both`-tagging alone — field
      fragmentation is an inherent conforming-emission constraint.
- [ ] 4.6 Cross-reader verification on any corpus document whose shadow output
      is proposed as equivalent (Word fidelity check, plus Pages / Google Docs
      paths).

## 5. Validation

- [ ] 5.1 `openspec validate refactor-tagged-tree-redline-construction --strict`.
- [ ] 5.2 Full gate run with explicit exit-code checks (never piped to `tail`):
      `npm run build`, `npm run test`, `npm run check:spec-coverage`.
- [ ] 5.3 Coverage in the correct order — `npm run test:coverage:packages`
      **first** (it generates the summaries), then
      `npm run coverage:packages:check`. The check alone fails with "Missing
      coverage summary".
- [ ] 5.4 Confirm the new scenarios are mapped before archival. Note that
      `check:spec-coverage` validates the canonical live spec, so a green
      pre-archive run does not by itself cover this change's ADDED scenarios.
- [ ] 5.5 Record the successor changes (B default flip, C deletion, D public
      rebuild-mode decision) as issues so the staging is durable, and record the
      follow-up to narrow the Lean residual axiom
      `compareDocumentXml_output_text_roundtrip` once the projection half is
      definitional.
