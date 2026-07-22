# Change: Emit standard ancillary parts (theme, fontTable, webSettings)

## Why

`generateDocx` produces a slim DOCX package that omits three parts every
Word-authored `.docx` carries: `word/theme/theme1.xml`, `word/fontTable.xml`, and
`word/webSettings.xml`. Issue #482 tracks the suspicion that their absence
contributes to Microsoft Word for Mac showing a repair/recovery dialog on open.
The structural checks and LibreOffice probes verify "opens cleanly" only as far as
they can reach; they cannot observe the absence of a Word-for-Mac repair prompt.
Emitting the three parts makes authored output part-for-part comparable to genuine
Word output, removing that whole class of doubt as a defensive baseline, and
completes the cross-reader compatibility matrix bookkeeping for the new emitter
revision.

## What Changes

- Emit three new parts on every generated package, wired through the existing
  part-registry (content-type Override + `word/_rels/document.xml.rels`
  relationship): `word/theme/theme1.xml` (canonical Office theme), a
  `word/fontTable.xml` enumerating the fonts the spec actually references, and a
  minimal `word/webSettings.xml`.
- Add a `Standard ancillary parts` requirement to `docx-generation` with scenario
  `SDX-GEN-093`.
- Record the new emitter revision in the manual cross-reader compatibility matrix
  (`generation-manual-compat-checklist.md`); manual Word-for-Mac / Pages / Google
  Docs cells stay open for human observation.

## Impact

- Affected specs: `docx-generation` (one ADDED requirement).
- Affected code: three new emitters under
  `packages/docx-core/src/generation/emit/`, wired in `compile.ts`; a new test
  file; regenerated output fixtures (the three parts now appear in every
  `generation-phase*.docx`).
- Out of scope: carrying ancillary parts through `compareDocuments` rebuild
  reconstruction — a part-less original compared against a part-carrying revision
  drops `theme1.xml` because rebuild clones the original archive. #483/#484 locked
  the author→compare round-trip at the text level (SDX-GEN-100..104); ancillary-part
  survival through compare is a separate follow-up, not addressed here.
