# Tagged comparison option-to-observable matrix

This matrix inventories every setting accepted by the stable `compareDocuments`
facade and the exported low-level `compareDocumentsAtomizer` entry point. Both
entry points use the tagged-tree comparison and revised-base publication path.
The migration decisions that retired the former selectors are recorded in the
[archived tagged-tree change](../../openspec/changes/archive/2026-08-19-refactor-tagged-tree-spine/specs/docx-comparison/spec.md).

“Public” means the setting is part of `CompareOptions`. “Low-level” means it is
accepted by `compareDocumentsAtomizer`; settings marked “internal” are exported
only because that low-level function is an attribution or test seam, rather than
a supported selector on the stable facade.

| Setting | Surface | Tagged observable and evidence |
| --- | --- | --- |
| `author` | Public / low-level | Supplies `w:author` on generated revision and property-change markup; covered by `taggedTreeSerializer.test.ts`. |
| `date` | Public / low-level | Supplies normalized `w:date` on generated revision and property-change markup; covered by `taggedTreeSerializer.test.ts`. |
| `ignoreFormatting` | Public | Disables representation of authored property differences while retaining publication validation; covered by `compare-options.test.ts` and `taggedTreeShadow.test.ts`. |
| `detectMoves` | Public | Controls tagged move classification; move and ordinary insertion/deletion serialization are covered by `taggedTreeConstruction.test.ts`. |
| `formatDetection.detectFormatChanges` | Low-level | Controls whether authored property differences are represented as tracked property changes. Publication still validates the resulting package in either mode; covered by `taggedTreeConstruction.test.ts`, `taggedTreeSerializer.test.ts`, and `taggedTreeShadow.test.ts`. |
| `moveDetection.detectMoves` | Low-level | Controls tagged move classification at the low-level entry point; covered by `taggedTreeConstruction.test.ts`. |
| `moveDetection.moveSimilarityThreshold` | Low-level | Gates residual fuzzy candidate edges before global assignment; covered by `taggedTreeConstruction.test.ts`. |
| `moveDetection.moveMinimumWordCount` | Low-level | Excludes short residual candidates; covered by `taggedTreeConstruction.test.ts`. |
| `moveDetection.caseInsensitiveMove` | Low-level | Controls case folding in both portable similarity measures; covered by `taggedTreeConstruction.test.ts`. |
| `numbering.enabled` | Low-level | Controls virtual rendered list identities used by tagged alignment; identities are not serialized. Covered by `taggedTreeConstruction.test.ts`. |
| `revisionAttributionRanges` | Internal low-level | Carries exact Markdoc operation provenance through tagged serialization and is stripped before publication; covered by `tagged-rationale-attribution.test.ts` and `docx-markdoc/src/compile.test.ts`. |
| `taggedTreePublicationSafetyEvaluator` | Internal low-level test seam | Replaces only the final structural publication-safety evaluation so fail-closed diagnostics can be exercised; covered by `pipeline-safety-guards.test.ts`. |
| `taggedTreeFormattingFidelityEvaluator` | Internal low-level test seam | Replaces only the final source-projected formatting evaluation so fail-closed fidelity behavior can be exercised; covered by `taggedTreeShadow.test.ts`. |

Successful results report `engine: 'tagged-tree'`. The stable result surface does
not report a requested strategy, reconstruction mode, or fallback metadata:
unsafe publication throws a typed error instead of returning an alternate
implementation's output.

## Identity audit

| Concern | Tagged identity rule | Evidence / disposition |
| --- | --- | --- |
| Hyperlink destination | Pipeline canonicalization rewrites relationship references by resolved relationship semantics before tagged construction, so equal targets align across different `r:id` values and retargeted links differ. | `relationshipIdCollision.test.ts` and the selected-story hyperlink cases in `pipeline-text-box-stories.test.ts`. |
| Paragraph style versus direct properties | Tagged property deltas compare the source `pPr`, `rPr`, row, cell, and section property containers. Paragraph-style references and direct properties remain distinct source markup. | `taggedTreeSerializer.test.ts` formatting-fidelity cases. |
| Complex fields | Field instruction context participates in alignment; field-control runs are not fuzzy-move candidates. | The field matrix in `taggedTreeConstruction.test.ts`. |
| Opaque passthrough | Unmodeled side-only subtrees retain their complete source node. | `taggedTree.test.ts` opaque-payload cases. |
| Existing tracked revisions | Ordered revision provenance (kind, ID, author, date) participates in range-boundary identity and is reapplied to serialized fragments. Preserved input moves are excluded from new move pairing. | `taggedTree.test.ts` and `taggedTreeSerializer.test.ts` multi-author provenance cases. |
| Effective styles | Tagged story comparison intentionally uses authored property/style references, not a computed `styles.xml` cascade. Changes solely inside style definitions are package-level differences and are not represented as tracked story markup. | Accepted current boundary; no computed-style comparison option is exposed. |
