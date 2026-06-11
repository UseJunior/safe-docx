# Change: Cross-implementation OOXML conformance suite (wpt-analog) and safe-docx adapter

## Why

Our traceability tests verify safe-docx's own behavior; they cannot show whether another OOXML library (python-docx, docx4j, LibreOffice) implements the same ECMA-376-anchored behavior the same way (issue #283). For the subset of scenarios whose assertions derive from the spec — not from our algorithm — a neutral, forkable, wpt.fyi-style comparison suite makes safe-docx defensible-by-spec rather than defensible-by-tests, and gives the wider ecosystem a shared conformance artifact.

## What Changes

- **New external repository `open-agreements/docx-platform-tests`** (public, Apache-2.0 — created BSD-3-Clause to mirror wpt, relicensed before accepting external contributions; docx-platform-tests#13): the neutral suite. Holds the scenario DSL (`scenario.json` + `input/document.xml` + packed `input.docx`), the language-neutral adapter protocol (file-based CLI, exit code 2 = unsupported, the wpt-NOTRUN analog), a Node/TS runner (`@xmldom/xmldom` + `xpath`, no `@usejunior` dependency — the oracle stays neutral), and CI that publishes a wpt.fyi-shaped `results/latest.json`. Neutrality is the point: researchers fork the suite, not safe-docx.
- **New docx-core bin `safe-docx-conformance-adapter`** (`packages/docx-core/src/cli/conformance-adapter.ts` + `package.json` bin entry): implements adapter protocol v1 over existing primitives (`acceptChanges`, `rejectChanges`, `getParagraphText`/`replaceParagraphTextRange`, `DocxDocument.load`/`toBuffer`). No engine-behavior changes; the adapter only wires existing exports.
- **New skip-gated self-check test** `packages/docx-core/src/integration/cross-implementation-suite.test.ts`: runs the adapter against the suite's scenarios when `DOCX_PLATFORM_TESTS_DIR` is set (Lean-differential-harness gating pattern), pinned to a recorded suite SHA. safe-docx disagreeing with the suite's expected output fails CI.
- **Cross-repo (informational, lands outside this repo):** a comparison-matrix page in `UseJunior/tests-renderer` consuming the suite's published results JSON (UseJunior/tests-renderer#62), and a `python-docx` adapter inside the suite repo demonstrating the asymmetric matrix row (find-replace pass; accept/reject honestly `unsupported`).

## Scope guardrails

- Only spec-anchored scenarios enter the suite (assertion derivable from ECMA-376, with MS-OE376/Word behavior canonical where they diverge). Algorithm-anchored behavior (`_bk_*` identifier stability, determinism guarantees, safe-docx-specific primitives) stays out, per #283.
- `schemaValidAgainstWml` is a defined-but-deferred assertion kind: there is no viable pure-JS XSD validator for the full transitional schema and our own #214 is unimplemented; M1 ships two tracked-changes scenarios + one find-replace scenario instead.
- One adapter per follow-up milestone; LibreOffice headless is a named stretch adapter, explicitly not in scope here.

## Impact

- Affected specs: new capability `cross-implementation-conformance` (ADDED requirements only — deliberately not a `docx-primitives`/`mcp-server` delta, whose coverage validators strict-fail unmapped scenarios in in-flight change deltas).
- Affected code: `packages/docx-core/src/cli/conformance-adapter.ts` (new), `packages/docx-core/package.json` (bin entry), `packages/docx-core/src/integration/cross-implementation-suite.test.ts` (new), `packages/docx-core/src/integration/docx-platform-tests.pin.json` (new).
- External: `open-agreements/docx-platform-tests` (new repo), `UseJunior/tests-renderer` (matrix page).
- Sequencing note: the suite's safe-docx adapter installs from a pinned-SHA `npm pack` tarball until the first release after the bin lands publishes it to npm.
- Milestone issues: #388 (M0, this change), #389 (M2 adapter + self-check), #390 (archive), #391 (optional corpus join field), UseJunior/tests-renderer#62 (M4). Tracking: #283.
