## 1. Engine diagnostics (issue #469 step 1)

- [x] 1.1 Add `ReconstructionInplaceSuccessDiagnostics` and the
      `inplaceSuccessDiagnostics` field to `CompareResult` in `compare-types.ts`
- [x] 1.2 Populate `inplaceSuccessDiagnostics` (selected pass + preceding failed
      attempts) on the inplace success path in `pipeline.ts`

## 2. Spec reclassification

- [x] 2.1 Reframe the "Inplace Reconstruction Cross-Run Recovery" requirement in
      `openspec/specs/docx-comparison/spec.md`: document the cross-run passes as a
      currently-unreachable residual and replace the phantom "Cross-run pass
      rescues inplace output" scenario with a genuine pass-reporting scenario
- [x] 2.2 Add the genuine fail-then-rescue test mapping the new scenario and
      asserting `inplaceSuccessDiagnostics`

## 3. Gate enforcement (issue #469 step 3)

- [x] 3.1 Flip `check:spec-coverage:openspec` to `--strict` in the root
      `check:spec-coverage` script
- [x] 3.2 Regenerate the traceability matrix and confirm
      `npm run check:spec-coverage` passes with all scenarios mapped

## 4. Verification

- [x] 4.1 `openspec validate reclassify-cross-run-rescue-as-residual --strict`
- [x] 4.2 Build docx-core and run the affected integration tests
- [x] 4.3 Run `node scripts/validate_openspec_coverage.mjs --strict` → exit 0
