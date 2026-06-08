## 1. Oracle helper (committed)

- [x] 1.1 Add `packages/docx-core/src/integration/libreoffice-oracle.ts`: `resolveSoffice()`,
      `packMinimalDocx` / `extractDocumentXml` (reuse `primitives/zip.ts`), `runLibreOfficeOracle`
      (macro-injection driver, one launch per batch), `paragraphShape` (structural projection).
- [x] 1.2 Follow the `reference_libreoffice_macos_oracle` recipe: write `registrymodifications.xcu`
      (MacroSecurityLevel 0), init the profile via a throwaway `--convert-to`, THEN overwrite
      `Module1.xba`, THEN invoke `macro:///Standard.Module1.RunOracle`; verify via a marker file.

## 2. Oracle voter (gated)

- [x] 2.1 Add a `describeOracle = resolveSoffice() ? describe : describe.skip` block to
      `lean-differential-helpers.test.ts`; one `beforeAll` drives the whole batch through LibreOffice.
- [x] 2.2 `[LEAN-HELP-09]` kept-not-dropped (G3/G4/G5 paragraph count matches TS); pin the G3 nested-revision
      content divergence (LibreOffice keeps the text) rather than hide it.
- [x] 2.3 `[LEAN-HELP-10]` full structural agreement on the clean single-level fixtures (G4 reject, G5 accept).
- [x] 2.4 `[LEAN-HELP-11]` PPR-marked drop control (PPR-INS reject, PPR-DEL accept) — LibreOffice drops, matching TS.

## 3. Verification

- [x] 3.1 `npm test -w @usejunior/docx-core -- lean-differential-helpers` green with the oracle voter running
      against a real LibreOffice (11 tests); `tsc --noEmit` clean.
- [x] 3.2 Full `@usejunior/docx-core` suite green (1350 passed / 3 skipped); voter skips cleanly when soffice is absent.

## 4. Specs / docs

- [x] 4.1 Add the `docx-comparison` ADDED requirement + scenarios `[LEAN-HELP-09..11]`.
- [x] 4.2 `verification/ROADMAP.md`: record the oracle voter landed (accept/reject is now oracle-backed for the
      pinned cases); note it is a local-only check.
- [ ] 4.3 Ship: peer-review (codex + agy), open PR, `/automerge-smoke`. Update memory (committed oracle helper).
