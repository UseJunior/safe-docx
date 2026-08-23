# Tagged comparison option-to-observable matrix

This matrix inventories every setting accepted by the stable `compareDocuments`
facade and the exported low-level `compareDocumentsAtomizer` entry point. Both
entry points use the tagged-tree comparison and revised-base publication path.
The migration decisions that retired the former selectors are recorded in the
[archived tagged-tree change](../../openspec/changes/archive/2026-08-19-refactor-tagged-tree-spine/specs/docx-comparison/spec.md).
The facade rejects any key in `REMOVED_COMPARISON_OPTIONS` with a `TypeError`
instead of silently accepting an obsolete selector.

“Public” means the setting is part of `CompareOptions`. “Low-level” means it is
accepted by `compareDocumentsAtomizer`; settings marked “internal” are exported
only because that low-level function is an attribution or test seam, rather than
a supported selector on the stable facade.

Nested move and formatting settings are declared in
[`docx-core/src/core-types.ts`](../docx-core/src/core-types.ts); numbering settings
are declared in [`numberingIntegration.ts`](src/tagged/numberingIntegration.ts).

| Setting | Surface | Tagged observable and evidence |
| --- | --- | --- |
| `author` | Public / low-level | Supplies `w:author` on generated revision and property-change markup; covered by `src/tagged/taggedTreeSerializer.test.ts`. |
| `date` | Public / low-level | Supplies normalized `w:date` on generated revision and property-change markup; covered by `src/tagged/taggedTreeSerializer.test.ts`. |
| `ignoreFormatting` | Public | Disables representation of authored property differences while still requiring fidelity to the revised/Accept formatting projection; covered by `src/compare-options.test.ts` and `src/tagged/taggedTreeShadow.test.ts`. |
| `detectMoves` | Public | Controls tagged move classification; move and ordinary insertion/deletion serialization are covered by `src/tagged/taggedTreeConstruction.test.ts`. |
| `formatDetection.detectFormatChanges` | Low-level | Controls whether authored property differences are represented as tracked property changes. Disabling detection still requires fidelity to the revised/Accept formatting projection; covered by `src/tagged/taggedTreeConstruction.test.ts`, `src/tagged/taggedTreeSerializer.test.ts`, and `src/tagged/taggedTreeShadow.test.ts`. |
| `moveDetection.detectMoves` | Low-level | Controls tagged move classification at the low-level entry point; covered by `src/tagged/taggedTreeConstruction.test.ts`. |
| `moveDetection.moveSimilarityThreshold` | Low-level | Gates residual fuzzy candidate edges before global assignment; covered by `src/tagged/taggedTreeConstruction.test.ts`. |
| `moveDetection.moveMinimumWordCount` | Low-level | Excludes short residual candidates; covered by `src/tagged/taggedTreeConstruction.test.ts`. |
| `moveDetection.caseInsensitiveMove` | Low-level | Controls case folding in both portable similarity measures; covered by `src/tagged/taggedTreeConstruction.test.ts`. |
| `numbering.enabled` | Low-level | Controls virtual rendered list identities used by tagged alignment; identities are not serialized. Covered by `src/tagged/taggedTreeConstruction.test.ts`. |
| `revisionAttributionRanges` | Internal low-level | Carries exact Markdoc operation provenance through tagged serialization and is stripped before publication; covered by `src/integration/tagged-rationale-attribution.test.ts` and `../docx-markdoc/src/rationale-comments.test.ts`. |
| `taggedTreePublicationSafetyEvaluator` | Internal low-level test seam | Replaces only the final structural publication-safety evaluation so fail-closed diagnostics can be exercised; covered by `src/tagged/taggedTreeShadow.test.ts`. |
| `taggedTreeFormattingFidelityEvaluator` | Internal low-level test seam | Replaces only the final source-projected formatting evaluation so fail-closed fidelity behavior can be exercised; covered by `src/tagged/taggedTreeShadow.test.ts`. |

Successful stable results report `engine: 'tagged-tree'` and do not carry
requested-strategy, reconstruction-mode, or fallback metadata. Unsafe
publication throws a typed error instead of returning an alternate
implementation's output. `src/public-result-metadata.test.ts` keeps the runtime
shape, the exact `CompareResult` type, and `api-removal-policy.json` in sync.

## Identity audit

| Concern | Tagged identity rule | Evidence / disposition |
| --- | --- | --- |
| Hyperlink destination | Pipeline canonicalization rewrites relationship references by resolved relationship semantics before tagged construction, so equal targets align across different `r:id` values and retargeted links differ. | `src/tagged/relationshipIdCollision.test.ts` and the selected-story hyperlink cases in `src/tagged/pipeline-text-box-stories.test.ts`. |
| Paragraph style versus direct properties | Tagged property deltas compare the source `pPr`, `rPr`, row, cell, and section property containers. Paragraph-style references and direct properties remain distinct source markup. | `src/tagged/taggedTreeSerializer.test.ts` formatting-fidelity cases. |
| Complex fields | Field instruction context participates in alignment; field-control runs are not fuzzy-move candidates. | The field matrix in `src/tagged/taggedTreeConstruction.test.ts`. |
| Opaque passthrough | Unmodeled side-only subtrees retain their complete source node. | `src/tagged/taggedTree.test.ts` opaque-payload cases. |
| Existing tracked revisions | Ordered revision provenance (kind, ID, author, date) participates in range-boundary identity and is reapplied to serialized fragments. Preserved input moves are excluded from new move pairing. | `src/tagged/taggedTree.test.ts` and `src/tagged/taggedTreeSerializer.test.ts` multi-author provenance cases. |
| Effective styles | Tagged story comparison intentionally uses authored property/style references, not a computed `styles.xml` cascade. Changes solely inside style definitions are package-level differences and are not represented as tracked story markup. | Accepted current boundary; no computed-style comparison option is exposed. |
