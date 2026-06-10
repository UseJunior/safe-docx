## 1. Implementation

- [x] 1.1 Add `formattingFidelity.ts` to the atomizer: paragraph-unit extraction (char-level rPr keys, pPr, table chain), LCS content alignment, canonical property keys, per-dimension tallies, divergence report, scalar score
- [x] 1.2 Add `compareProjectedFormattingFidelity` projection wrapper over accept-all / reject-all
- [x] 1.3 Export the new API from `@usejunior/docx-core`
- [x] 1.4 Add traceability tests covering every scenario in the delta spec
- [x] 1.5 Run the full pre-submit gate suite
