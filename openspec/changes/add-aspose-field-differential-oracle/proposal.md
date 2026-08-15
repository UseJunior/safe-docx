# Change: Add a local Aspose field-comparison differential oracle

## Why

Field comparison behavior has historically been inferred from safe-docx's own output. Direct measurements on
2026-08-14 showed that Microsoft Word and Aspose.Words 25.10 agree on the important boundary: an instruction
change replaces the whole complex field, while a cached-result-only change preserves the field scaffolding and
redlines only the result. Those measurements should become reproducible evidence without putting a proprietary
runtime or license into CI.

## What Changes

- Add a local-only developer command that runs pinned field pairs through Aspose.Words and emits a deterministic
  JSON verdict snapshot.
- Resolve the Aspose Python environment and license only from explicit local configuration, skip cleanly when
  either is absent, and never copy license material into the repository or CI artifacts.
- Check in the version-stamped verdict snapshot and make CI validate its schema and pinned expectations without
  executing Aspose.
- Add a trust-boundary test recording the measured Word/Aspose agreements for instruction changes and cached
  result changes, plus any characterized divergence discovered during implementation.
- Document the refresh command and the oracle version (`Aspose.Words 25.10`).

## Impact

- Affected specs: `docx-comparison` (new differential-evidence requirement).
- Affected code: developer scripts, comparison integration tests, and one checked-in JSON snapshot.
- No production runtime behavior or dependency changes.
- Aspose execution remains local-only; CI consumes only the deterministic snapshot.

