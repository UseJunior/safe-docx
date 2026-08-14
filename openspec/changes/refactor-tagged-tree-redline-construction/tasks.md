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

- [x] 2.1 Add a tag-emitting output path to `hierarchicalLcs` paragraph matching
      alongside the existing correlation-status path; matching behavior
      unchanged.
- [x] 2.2 Add a tag-emitting path to within-paragraph `atomLcs`, with
      word-vs-run granularity as an alignment parameter.
- [ ] 2.3 Represent direct formatting differences as `both` + scoped
      `PropertyDelta`; assert no construction path emits a del/ins pair over
      equal content.

      **Partial (2026-08-14):** matched direct run-property differences are
      `both` + run-scoped `PropertyDelta`, and local replacement boundaries now
      fail fast on an adjacent equal-content original/revised pair. The global
      assertion remains open until reordered equal content is bound to explicit
      task-2.4 move relations; otherwise a non-adjacent equal del/ins pair could
      escape the local assertion.
- [ ] 2.4 Model move pairs as a relation between an `original` and a `revised`
      subtree, and verify the tree satisfies the live "Tracked move ranges are
      structurally certified" requirement — one range per direction and name,
      balanced non-crossing markers, unique decimal IDs. Record whether the tree
      guarantees this at construction (input to the `coalesceMoveRangeMarkers`
      decision in successor C).
- [x] 2.5A Implement the pre-serializer PRESERVE model invariants — provenance
      splitting, nesting, revision-ID allocation, and ordered multi-author
      relationships — before proceeding to task 3. This is the
      highest-risk surface; `preSplitInsProvenanceRuns`
      (`inPlaceModifier-presplit.ts:175`) and the ID seeding at
      `inPlaceModifier.ts:96` are the behavior to match.

      **Implementation finding (2026-08-14):** this task formerly also required
      serialized accept/reject evidence, creating a circular dependency on task
      3.1. User authorization split that evidence into task 3.2A below. The
      model-level gate remains mandatory before serializer work.

## 3. Serializer and story composition (shadow-only)

- [x] 3.1 Implement a serializer from `TaggedTree` to OOXML tracked markup,
      exercised only in shadow.
- [x] 3.2 Property-test that serialization preserves both projections (layer 2
      of the four correctness layers in `design.md`).
- [x] 3.2A Prove serialized accept/reject behavior over ordered multi-author
      stacks agrees with the original and revised tree projections. This is the
      serializer-dependent half of the former task 2.5 and SHALL pass before
      proceeding to shadow corpus evidence.
- [x] 3.3 Design nested text-box / ancillary story composition as IR subtrees;
      verify projections compose. Do not touch the recursive pipeline path.
- [x] 3.4 Determine whether `rebuild`'s different base-archive selection
      (`pipeline.ts:1239`) needs a second serializer or one parameterized by
      which side supplies the package skeleton.

      **Determination (2026-08-14):** one serializer parameterized by
      `baseSide` is sufficient. Tests prove that original- and revised-based
      skeleton attributes differ while accept/reject tracked-content
      projections remain unchanged. Production mode selection is untouched.

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

      **External evidence gate:** this requires the serializer/shadow output
      from 3.1/4.1 plus installed or connected Word, Pages, and Google Docs
      readers. It cannot be satisfied by the repository-only test suite and
      remains unchecked.

## 5. Validation

- [x] 5.1 `openspec validate refactor-tagged-tree-redline-construction --strict`.
- [x] 5.2 Full gate run with explicit exit-code checks (never piped to `tail`):
      `npm run build`, `npm run test`, `npm run check:spec-coverage`.
- [x] 5.3 Coverage in the correct order — `npm run test:coverage:packages`
      **first** (it generates the summaries), then
      `npm run coverage:packages:check`. The check alone fails with "Missing
      coverage summary".
- [x] 5.4 Confirm the new scenarios are mapped before archival. Note that
      `check:spec-coverage` validates the canonical live spec, so a green
      pre-archive run does not by itself cover this change's ADDED scenarios.
- [ ] 5.5 Record the successor changes (B default flip, C deletion, D public
      rebuild-mode decision) as issues so the staging is durable, and record the
      follow-up to narrow the Lean residual axiom
      `compareDocumentXml_output_text_roundtrip` once the projection half is
      definitional.

## Stage A evidence audit (2026-08-14)

- Task 2.4 remains open. `TaggedMoveRelation` now makes a logical move a
  relation between whole original/revised subtrees, and
  `verifyMoveRelations` certifies unique integer direction IDs and one-to-one
  non-empty names. A TaggedTree serializer does not yet exist, however, so
  tree membership, non-crossing placement, and exactly one balanced start/end
  marker pair per relation remain unproved. That serializer evidence is
  required by the live move-range requirement and must not be inferred from the
  IR alone.
- Task 2.5A remains open and blocks task 3. The additive alignment records every
  enclosing revision wrapper on both representatives, tests a boundary inside
  a prior insertion, and reserves numeric revision IDs from both roots. It does
  not yet define and exercise comparison-revision nesting for every pre-existing
  `w:ins`/`w:del` stack, nor prove accept/reject equivalence for a serialized
  multi-author tree. Existing legacy-path provenance tests do not prove the new
  construction. The serialized portion now belongs to 3.2A and no longer
  circularly blocks creating the serializer.
- Tasks 3.1-4.6 consequently remain open. Wiring a shadow flag before 2.5A and
  3.2A would weaken the proposal's explicit highest-risk gate.
- Tasks 4.3, 4.4, and 4.6 additionally require proprietary/external corpus or
  reader artifacts not present in this worktree (OpenAgreements plus NVCA/ILPA
  corpus identities and Word/Pages/Google Docs readers). No result is inferred
  or fabricated for those inputs.
- Task 5.5 remains open because recording durable successor issues requires
  external issue-tracker writes, which are outside this no-push/no-PR local
  worktree run.

      **Public-action gate:** issue creation is intentionally not performed by
      this implementation worktree. Draft issue text and explicit human approval
      are required before creating public GitHub issues.
