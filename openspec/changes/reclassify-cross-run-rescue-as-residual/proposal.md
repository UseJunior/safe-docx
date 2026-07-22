# Reclassify the cross-run inplace rescue scenario as a documented residual

## Why

The root `check:spec-coverage` gate runs the docx-core matrix validator WARN-only
because `--strict` never reached `validate_openspec_coverage.mjs` (issue #469).
#513 closed the tooling and coverage gaps for every docx-comparison scenario
except one — "Cross-run pass rescues inplace output" — leaving the gate stuck at
68/69 and therefore unable to flip to `--strict`.

That last scenario cannot be honestly mapped to a test, and the blocker is not
the one #513 assumed. #513 assumed the problem was *observability* (the engine
surfaced cross-run pass diagnostics only on rebuild fallback). The real blocker
is *reachability*: the scenario's precondition — "no-cross-run inplace passes
fail round-trip safety" — is not satisfiable by any known input.

The inplace pipeline evaluates passes in order: `inplace_word_split`,
`inplace_run_level`, `inplace_word_split_cross_run`, `inplace_run_level_cross_run`.
`inplace_run_level` deletes and re-inserts whole runs, which preserves normalized
text by construction, so it satisfies the round-trip text checks on every case
that `inplace_word_split` fails. The cross-run passes (3–4) are therefore never
the selected rescuer. Verified empirically: ~3,900 synthetic fragmentation cases
and all 508 integration/atomizer tests (fields, tables, hyperlinks, NVCA, ILPA,
and the OpenAgreements fixtures added precisely because they historically
triggered this path) produced **zero** cross-run pass selections. Later
`inplace_word_split`/premerge improvements appear to have subsumed the cross-run
safety net.

Tag-stuffing a clean inplace test as a "cross-run rescue" was already rejected in
peer review of #513, so the honest close is to stop asserting the unreachable
branch as a mappable scenario.

## What Changes

- **Expose which inplace pass produced the output.** Add
  `inplaceSuccessDiagnostics` (`passUsed` + `precedingFailedAttempts`) to
  `CompareResult`, populated on the inplace success path. This mirrors, on the
  success path, the per-pass detail that `fallbackDiagnostics.attempts` already
  surfaces on the rebuild-fallback path. (This is #469 step 1, kept because it is
  genuinely useful independent of the reachability finding.)
- **Reclassify the "Cross-run pass rescues inplace output" scenario.** Fold its
  intent into the requirement prose as a documented residual (the cross-run
  passes are a currently-unreachable safety net), and replace it with a genuine,
  reachable scenario that asserts the pipeline reports the selected pass and its
  superseded attempts — exercising the real fail-then-rescue machinery
  (`inplace_word_split` fails a safety check → `inplace_run_level` rescues,
  staying inplace) via the new diagnostics.
- **Flip the gate to `--strict`.** Change the root `check:spec-coverage` script
  so `check:spec-coverage:openspec` runs with `--strict`, making a docx-comparison
  or cross-implementation-conformance coverage regression fail CI instead of
  merely warning.

## Impact

- Affected specs: `docx-comparison` (one requirement's scenario set reframed).
- Affected code: `packages/docx-core/src/compare-types.ts`,
  `packages/docx-core/src/baselines/atomizer/pipeline.ts` (additive metadata),
  root `package.json` (`check:spec-coverage`), one docx-core integration test,
  the auto-generated traceability matrix.
- Gate: docx-core matrix coverage becomes enforcing (`--strict`), closing the
  WARN-only rot described in #469.
- Follow-up: the apparent unreachability of the cross-run passes (candidate dead
  code) is tracked separately for engine cleanup; this change does not remove
  them.
