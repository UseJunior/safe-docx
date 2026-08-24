# Verification evidence

## Automated coverage

The canonical annotation round-trip suite uses `buildSyntheticDocx` and the
public DOCX primitives. It covers ranged and point comments, exact point
footnotes, structured-body edits, reply topology, audience profiles,
per-annotation safeguards, style-only recompilation, profile switching,
successful anchor remapping, ambiguous-anchor rejection, and atomic rejection
of unsupported body and topology shapes.

The implementation cites ECMA-376 5th edition Part 1 §§17.13.4.4,
17.13.4.3, 17.13.4.5, and 17.11.14 in both the source JSDoc and the corresponding
Allure tests.

## Manual compatibility observations

Observed on 2026-08-24 using a synthetic one-paragraph document. A ranged Word
comment over `beta` was imported into canonical Markdoc and explicitly projected
to an end-anchored footnote. No private or customer document was used.

- LibreOffice: local headless conversion completed successfully and produced a
  one-page PDF. Visual inspection showed `Alpha beta¹ gamma.` and footnote
  `1 Synthetic public note`; the reference remained superscript and occurred at
  the original range end.
- Aspose.Words for Python: local licensed conversion completed successfully and
  produced the same one-page rendering. The license was fetched from Azure Key
  Vault into a permission-restricted temporary file, used only for this local
  check, and deleted immediately. Aspose is not added to CI or any package.
- Word for Mac: the repository fidelity probe returned `INDETERMINATE` because
  Word already had a blocking modal associated with a user document. The probe
  intentionally did not dismiss, close, or inspect that document. This is not a
  compatibility failure or a pass; the structural and cross-reader evidence
  above remains the recorded result until Word can be rerun without the modal.

Generated smoke artifacts were kept outside the repository change and are not
committed.
