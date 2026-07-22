# Change: Always emit a baseline settings part with compatibilityMode=15

## Why

`generateDocx` emits `word/settings.xml` only conditionally — today, when a
section needs `w:evenAndOddHeaders` or theme-relative authoring needs
`w:clrSchemeMapping`. That minimal settings part carries no `w:compat` block.
Without a `compatibilityMode` compatSetting, Microsoft Word opens the generated
`.docx` in legacy "Compatibility Mode": the generated `generation-phase*.docx`
artifacts open clean (no repair dialog, issue #482) but every one shows the
Compatibility-Mode banner in the title bar. Issue #487 tracks this as the
documented follow-up to the ancillary-parts work.

## What Changes

- Emit `word/settings.xml` on every generated package, always including a
  `w:compat` block with a `compatibilityMode=15` compatSetting. ECMA-376 5th
  edition Part 1 §§11.3.3 and 17.15.3.4 govern the settings part and custom
  compatibility-setting structure; MS-DOCX §2.3.5 separately defines the
  Microsoft mode-15 semantics. The compat block is static, preserving the
  compiler's determinism guarantee.
- Generalize `emitSettingsPartIfNeeded` → `emitSettingsPart`: the
  `evenAndOddHeaders` and `clrSchemeMapping` logic is folded in (still
  conditional) and the compat block is always present. The part is registered
  through the existing idempotent part registry, so always-emitting does not
  double-register the content-type Override or relationship.
- Add a `Baseline settings part` requirement to `docx-generation` with scenario
  `SDX-GEN-094`.
- Implement the neutral DPT `composeDocumentWithCompatibilityMode` operation
  through `generateDocx`, validating its descriptor, supporting mode 15, and
  declining other requested modes. Pin the suite and vendored capability
  registry to merged DPT commit `19f051ed645cbc8613a5967e02d7f87ef7824454`.
- Require every scenario within the adapter's supported operation and document
  shape set to pass while retaining `unsupported` as honest data for operations
  or revision shapes outside the adapter's public implementation. The new
  `composeCompatibilityMode15WritesCompatSetting` scenario is explicitly
  required to pass.
- Add the neutral `word.settings.compatibility-mode` denominator rows to the
  SafeDocX capability projection as `untested`. The pinned neutral summary
  marks the new scenario unmeasured, so the local passing adapter test does not
  create positive projection evidence.
- Record the new emitter revision in the manual cross-reader compatibility
  matrix (`generation-manual-compat-checklist.md`); the manual Word-for-Mac
  cells reset to `—` pending a fresh human observation that the
  Compatibility-Mode banner is gone.

## Impact

- Affected specs: `docx-generation` and `cross-implementation-conformance`.
- Affected code: `emit/settings-part.ts` (generalized + compat block),
  `compile.ts` (call-site rename), `primitives/namespaces.ts` (compat /
  compatSetting local names), the DPT adapter/self-check, conformance registry,
  and capability projection; a new test file; regenerated output fixtures
  (`word/settings.xml` now present on every `generation-phase*.docx`).
- Out of scope: any compatSetting beyond `compatibilityMode`; carrying the
  baseline settings part through `compareDocuments` rebuild reconstruction.
