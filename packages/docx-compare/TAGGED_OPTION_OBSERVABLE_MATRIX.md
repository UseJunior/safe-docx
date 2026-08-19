# Tagged option-to-observable matrix

This matrix is the Phase 5 decision record for every setting accepted by the
public `compareDocuments` facade or the exported low-level
`compareDocumentsAtomizer` entry point. “Retained” means the setting reaches
tagged construction/publication and has tagged-specific evidence. “Scheduled
removal” means the setting remains temporarily for the legacy rollback window
but intentionally has no new tagged meaning; the breaking-removal requirement
is recorded in `openspec/changes/refactor-tagged-tree-spine/specs/docx-comparison/spec.md`.

| Setting | Surface | Decision | Tagged observable and evidence |
| --- | --- | --- | --- |
| `author` | Public | Retained | Supplies `w:author` on generated tagged revision and property markup; covered by `taggedTreeSerializer.test.ts`. |
| `date` | Public | Retained | Supplies normalized `w:date` on generated tagged markup; covered by `taggedTreeSerializer.test.ts`. |
| `ignoreFormatting` / `formatDetection.detectFormatChanges` | Public / low-level | Retained | Inverts/routes to `constructTaggedTree.detectFormatChanges`; enabled property deltas and disabled detection are covered by `taggedTreeConstruction.test.ts` and `taggedTreeSerializer.test.ts`. |
| `detectMoves` / `moveDetection.detectMoves` | Public / low-level | Retained | Routes to tagged move classification; move and ordinary insertion/deletion serialization are covered by `taggedTreeConstruction.test.ts`. |
| `moveDetection.moveSimilarityThreshold` | Low-level | Retained | Gates residual fuzzy candidate edges before global assignment; covered by `taggedTreeConstruction.test.ts`. |
| `moveDetection.moveMinimumWordCount` | Low-level | Retained | Excludes short residual candidates; covered by `taggedTreeConstruction.test.ts`. |
| `moveDetection.caseInsensitiveMove` | Low-level | Retained | Controls case folding in both portable similarity measures; covered by `taggedTreeConstruction.test.ts`. |
| `numbering.enabled` | Low-level | Retained | Controls virtual rendered list identities used by tagged alignment; identities are not serialized. Covered by `taggedTreeConstruction.test.ts`. |
| `revisionAttributionRanges` | Private low-level | Retained | Carries exact Markdoc operation provenance through tagged serialization and is stripped before publication; covered by `tagged-rationale-attribution.test.ts` and `docx-markdoc/src/compile.test.ts`. |
| `taggedTreePublicationSafetyEvaluator` | Private test seam | Retained | Replaces only the final tagged safety evaluation and makes fallback diagnostics observable; covered by `pipeline-safety-guards.test.ts`. |
| `comparisonStrategy` | Public | Scheduled removal | Selects the temporary legacy rollback path; it does not alter tagged behavior. Phase 9 removes it after the authority soak. |
| `engine` | Public | Scheduled removal | Selects the atomizer entry point or rejected WmlComparer adapter; it is not a tagged construction setting. Phase 9 removes it. |
| `reconstructionMode` | Public | Scheduled removal | Controls the legacy base assembler that tagged publication currently shadows. Standalone revised-base assembly makes it meaningless, so Phase 9 removes it. |
| `premergeRuns` | Public / low-level | Scheduled removal | Mutates only the legacy pass; tagged construction reparses canonical source XML. Phase 9 removes it rather than inventing a second tagged normalization contract. |
| `maxWordRefinementChangeRanges` | Public / low-level | Scheduled removal | Budgets only legacy selective word refinement. Tagged alignment has no refinement retry ladder; Phase 9 removes it. |

## Identity audit

| Concern | Tagged identity rule | Evidence / disposition |
| --- | --- | --- |
| Hyperlink destination | Pipeline canonicalization rewrites relationship references by resolved relationship semantics before tagged construction, so equal targets align across different `r:id` values and retargeted links differ. | `relationshipIdCollision.test.ts` and the selected-story hyperlink cases in `pipeline-text-box-stories.test.ts`. |
| Paragraph style versus direct properties | Tagged property deltas compare the source `pPr`, `rPr`, row, cell, and section property containers. Paragraph-style references and direct properties remain distinct source markup. | `taggedTreeSerializer.test.ts` formatting-fidelity cases. Portable property naming remains Phase 7 work. |
| Complex fields | Field instruction context participates in alignment; field-control runs are not fuzzy-move candidates. | The Stage A field matrix in `taggedTreeConstruction.test.ts`. |
| Opaque passthrough | Unmodeled side-only subtrees retain their complete source node and are certified by the P5 opaque-payload invariant. | `taggedTree.test.ts` opaque-payload cases. |
| Existing tracked revisions | Ordered revision provenance (kind, ID, author, date) participates in range-boundary identity and is reapplied to serialized fragments. Preserved input moves are excluded from new move pairing. | `taggedTree.test.ts` and `taggedTreeSerializer.test.ts` multi-author provenance cases. |
| Effective styles | Tagged story comparison intentionally uses authored property/style references, not a computed styles.xml cascade. Changes solely inside style definitions are package-level differences and are not represented as tracked story markup. | Accepted current boundary; the standalone assembler owns `styles.xml` in Phase 6, while portable property naming is Phase 7. |
