Scope: **stage A only** — additive representation, invariants, and offline
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
- [x] 2.3 Represent direct formatting differences as `both` + scoped
      `PropertyDelta`; assert no construction path emits a del/ins pair over
      equal content.

      **Partial (2026-08-14):** matched direct run-property differences are
      `both` + run-scoped `PropertyDelta`, and local replacement boundaries now
      fail fast on an adjacent equal-content original/revised pair. The global
      assertion remains open until reordered equal content is bound to explicit
      task-2.4 move relations; otherwise a non-adjacent equal del/ins pair could
      escape the local assertion.
- [x] 2.4 Model move pairs as a relation between an `original` and a `revised`
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

## 3. Serializer and story composition (offline-only)

- [x] 3.1 Implement a serializer from `TaggedTree` to OOXML tracked markup,
      exercised only by tests and controlled corpus jobs.
- [x] 3.2 Property-test that serialization preserves both projections (layer 2
      of the four correctness layers in `design.md`).
- [x] 3.2A Prove serialized accept/reject behavior over ordered multi-author
      stacks agrees with the original and revised tree projections. This is the
      serializer-dependent half of the former task 2.5 and SHALL pass before
      proceeding to offline corpus evidence.
- [x] 3.3 Design nested text-box / ancillary story composition as IR subtrees;
      verify projections compose. Do not touch the recursive pipeline path.
- [x] 3.4 Determine whether `rebuild`'s different base-archive selection
      (`pipeline.ts:1239`) needs a second serializer or one parameterized by
      which side supplies the package skeleton.

      **Determination (2026-08-14):** one serializer parameterized by
      `baseSide` is sufficient. Tests prove that original- and revised-based
      skeleton attributes differ while accept/reject tracked-content
      projections remain unchanged. Production mode selection is untouched.

## 4. Offline differential evidence

- [x] 4.1 Provide a directly callable offline harness for tests and controlled
      corpus jobs. Do not wire the tagged path into the ordinary comparison
      pipeline; the existing pipeline stays authoritative and pays no duplicate
      runtime cost.
- [x] 4.2 Emit a divergence report keyed by fixture identity and diverging
      projection, classified projection-inequivalent (blocking) vs.
      projection-equivalent (for review). Compare projections and fidelity
      scores, not bytes.
- [x] 4.3 Run over the fidelity corpus, multi-author fixtures, OpenAgreements +
      NVCA/ILPA templates, and pinned characterization cases.
- [x] 4.4 Triage every divergence: fix inline if it is an aligner or oracle
      defect; pin and file it if it is a genuine pre-existing engine bug; record
      a rationale for any accepted projection-equivalent difference. One fix per
      PR.

      **Repository corpus finding (2026-08-14):** committed OpenAgreements,
      ILPA, multi-author, and pinned cases were projection/fidelity equivalent.
      NVCA fixture `cd2f69960d5f13cc6292a138` is text-projection equivalent
      but remains blocking on direct-formatting fidelity. The report records
      paragraph/run divergence scopes. A de-identified synthetic regression now
      pins the same accept/reject-equivalent formatting failure. The defect is
      filed as https://github.com/UseJunior/safe-docx/issues/836; the legacy
      pipeline remains authoritative pending that issue's completion gate.

      **Successor-B investigation (2026-08-14):** the pinned synthetic score is
      exactly `0.4102564102564103`: accept is `1.0`; reject differs on run bold
      (added), run italic (removed), and paragraph alignment (changed). The
      opaque fixture remains `0.6287170885149017`: accept run/table/section
      dimensions are `1.0`, while paragraph formatting is `0.8528678304239401`
      (59/401 divergent paragraphs); reject also contains direct run and
      paragraph-property differences. A conforming whole-paragraph-marker
      experiment did not converge (`0.6262509972695257`) and was reverted.
      The mismatch is not merely wrapper shape: legacy reject retains revised
      direct properties on aligned content, while the tagged serializer restores
      original direct properties from `PropertyDelta`. Reproducing that legacy
      loss would contradict the IR's projection invariant. The oracle was not
      weakened, the scores were not averaged away, and #837's default flip was
      not performed. Synthetic DOCX/PDF/PNG evidence is generated under
      `.tmp/review-artifacts/tagged-formatting-divergence/`.

      **Correction after product decision (2026-08-14):** the preceding
      successor-B investigation used legacy-output fidelity as the gate. Steven
      confirmed that the tagged reject behavior is correct, so the authoritative
      gate is now source-projection fidelity: accept against revised, reject
      against original. The synthetic case is exactly `1.0`. Opaque fixture
      `cd2f69960d5f13cc6292a138` is still blocking at
      `0.6332451499118166`, with paragraph properties lost on changed
      whole-paragraph paths; consequently #837 was not implemented. An optional
      local Aspose Words check independently accepted and rejected the synthetic
      tagged DOCX. Direct run and paragraph formatting scored `1.0` in both
      directions. Aspose normalized section defaults by adding `w:cols
      w:space="720"` and header/footer-only `w:pgMar`, so the unnormalized
      all-dimension score is `0.6666666666666666`; this normalization is recorded
      separately and was not attributed to tagged serialization. The license
      remains outside the repository and Aspose is neither a runtime nor package
      dependency. Reviewable Aspose DOCX/PDF/PNG projections are stored under
      the same deterministic `.tmp/review-artifacts/` directory.
- [x] 4.5 Produce the field-case evidence that successor C's deletion of
      `suppressNoOpChangePairs` depends on: field-stable, field-modification,
      field-delete, nested-field, and paragraph-spanning-field cases showing no
      equal del/ins pairs are emitted and field structure survives both
      projections. Deletion is not justified by `both`-tagging alone — field
      fragmentation is an inherent conforming-emission constraint.
- [x] 4.6 Cross-reader verification on any corpus document whose offline output
      is proposed as equivalent (Word fidelity check, plus Pages / Google Docs
      paths).

      **External evidence gate:** this requires the serializer/offline output
      from 3.1/4.1 plus installed or connected Word, Pages, and Google Docs
      readers. On 2026-08-14, the synthetic output
      `.tmp/tagged-tree-shadow-synthetic.docx` opened in Microsoft Word, and a
      native Google Docs import preserved the synthetic visible text at
      `https://docs.google.com/document/d/1fiAzFYXb-aG5rCYrtSDkrCD3tmN2HeBbvwhffU4WCGM`.
      Apple Pages was subsequently resolved through macOS Launch Services and
      opened the same synthetic DOCX. Its visible body text contained both
      tracked alternatives, `The quick fox jumps over the lazy dog.` and
      `The slow fox jumps over the lazy dog.`, matching the Google Docs import
      behavior. The earlier statement that Pages was not installed was based on
      an incomplete filesystem/Spotlight lookup; `open -a Pages` demonstrated
      that conclusion was wrong. Word, Pages, and Google Docs paths are now all
      exercised.

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
- [x] 5.5 Record the successor changes (B default flip, C deletion, D public
      rebuild-mode decision) as issues so the staging is durable.

## Stage A evidence audit (2026-08-14)

- **Correction recorded 2026-08-14:** this audit originally said tasks 2.4,
  2.5A, 3.1-4.6, and 5.5 remained open. That was a point-in-time statement that
  became stale as later commits added the serializer, move certification,
  ordered multi-author preserve evidence, offline corpus results, and public
  issue records. It is corrected in place so the mechanism of the earlier
  conclusion remains visible without contradicting the live checklist.
- Tasks 2.4, 2.5A, 3.1-3.4, and 4.1-4.5 now have committed implementation and
  evidence. The direct-formatting divergence is pinned by a synthetic negative
  control and tracked publicly in #836; it is not silently accepted.
- Task 5.5 is complete through #837, #838, and #839. Issue #840 was filed from
  stale pre-#826 language and then closed as not planned because the formal
  verifier it referenced no longer exists.
- Task 4.6 is complete. Microsoft Word opened the synthetic output, Google Docs
  imported it with the expected visible text, and Pages opened it through
  Launch Services with both tracked alternatives present. The earlier Pages
  installation finding was a discovery false negative, corrected above.

      **Public-action record (2026-08-14):** issue creation is intentionally not
      performed by the repository test suite. After duplicate review and explicit
      human approval, the de-identified successor issues were filed as #837,
      #838, and #839. The formatting defect is #836. Issue #840 was immediately
      corrected and closed after confirming PR #826 had removed its premise.
      Exact URLs and the corrected filing method are recorded in
      `issue-drafts.md`.
