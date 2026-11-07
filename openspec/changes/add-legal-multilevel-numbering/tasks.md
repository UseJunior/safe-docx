## 1. Spec

- [x] 1.1 Add the `Legal multilevel numbering` requirement with scenarios
      `SDX-GEN-112`–`SDX-GEN-117` to the `docx-generation` delta.

## 2. Types, emitter, and validation

- [x] 2.1 Add `NUMBERING_LEVEL_FORMATS` (with `decimalZero`),
      `NumberingLevelSpec`, `NumberingInstanceSpec`,
      `NumberingLevelOverrideSpec`, and `TabStopSpec`; export the new types.
- [x] 2.2 Emit `lvlRestart`, `pStyle`, `isLgl`, `firstLine`, and level `tabs`
      through `LVL_ORDER` in `buildLevel`.
- [x] 2.3 Emit additional instances with `w:lvlOverride`/`w:startOverride`
      after every default instance.
- [x] 2.4 Write the reverse style link (`w:numPr`) into each linked style.
- [x] 2.5 Validate the new fields: `lvlRestart` range, `isLgl` type, `pStyle`
      target, `firstLine`/`hanging` exclusivity, tab stops, and instance
      handles and overrides.

## 3. Read side

- [x] 3.1 Honor `isLgl`, `decimalZero`, and `lvlRestart` in
      `computeListLabelForParagraph`.

## 4. Conformance registry

- [x] 4.1 Renumber the level `w:pStyle` entry to § 17.9.23 and retarget its
      citations; add § 17.9.4, 17.9.8, 17.9.10, 17.9.22, and 17.9.26 entries;
      regenerate `CONFORMANCE.md` and the conformance explorer.

## 5. Tests

- [x] 5.1 Add `generation-legal-multilevel-numbering.test.ts` with
      `TEST_FEATURE = 'add-legal-multilevel-numbering'` covering
      `SDX-GEN-112`–`SDX-GEN-117`.

## 6. Verify

- [x] 6.1 `openspec validate add-legal-multilevel-numbering --strict` passes.
- [x] 6.2 Generated two-article agreement renders ARTICLE I / Section 1.01 /
      (a) / (i) / (A) / ARTICLE II / Section 2.01 in Word for Mac and
      LibreOffice, and opens in Word without a repair prompt.
- [x] 6.3 Workspace build, lint, tests, spec coverage, and conformance checks
      pass.
