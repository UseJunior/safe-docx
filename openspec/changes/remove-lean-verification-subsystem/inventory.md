# Retirement inventory and coverage map

The complete implementation was already present on `main` in commit `55df2b94`
(`refactor: replace Lean verification with artifact checks`). This audit records
the resulting state and the maintained TypeScript evidence that replaced the
removed subsystem.

## Removed surfaces

| Surface | Post-retirement state |
| --- | --- |
| Source and build | `verification/lean`, its toolchain files, build artifacts, and audit scripts are absent. |
| CI | `.github/workflows/lean-build.yml` is absent. |
| Runtime | The comparison pipeline has no checker subprocess branch or executable discovery. |
| Public API | `leanXmlVerifier`, `LeanXmlVerifierOptions`, `runLeanXmlTripleVerifier`, and certificate fields are absent. |
| Integration tests | Differential, specification-bridge, and checker-supervisor suites are absent. |
| Current specification | Canonical comparison and conformance specifications contain no formal-verifier requirement. |
| Current claims | Generated capability and conformance surfaces contain no formal-assurance claim. |

## Preserved user-visible invariants

| Invariant | Maintained TypeScript evidence |
| --- | --- |
| Emitted-redline LCS minimality | `packages/docx-release-verifier/src/minimality.ts` and `minimality.test.ts` |
| Accept/reject text projection | `packages/docx-release-verifier/src/verifier.ts` and `verifier.test.ts`; `packages/docx-core/src/integration/accept_reject_invariant_corpus.test.ts` |
| Field structure under comparison and resolution | `packages/docx-compare/src/baselines/atomizer/pipeline.field-validation.test.ts`; complex-field reconstruction tests; docx-core field regressions |
| Package and relationship integrity | release-verifier package gates; docx-compare relationship collision and ancillary-story tests |
| Comment and note topology | docx-compare comment/ancillary-note tests and docx-core acceptance/rejection integration tests |
| Move-range pairing and paragraph-mark resolution | docx-compare move-range and in-place modifier regressions |
| Real implementation cross-check | `packages/docx-core/src/integration/libreoffice-oracle-trust-boundary.test.ts` when LibreOffice is available |

Proof-internal propositions with no observable product behavior were retired;
they were not relabeled as runtime guarantees.

## Residual-reference classification

Current product code, public APIs, workflows, canonical specs, and generated
claims contain no retired-subsystem references. Historical OpenSpec material is
retained only as change history. The retirement proposal itself necessarily
names the removed surface, and negative claim tests continue to reject generic
formal-assurance language.
