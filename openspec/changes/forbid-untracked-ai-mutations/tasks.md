# Tasks

## 1. Surface classification
- [x] 1.1 Add a `surface` (`revisionable` | `package-mutation` | `internal`) field to every tool-catalog entry.
- [x] 1.2 Flag dual-surface tools with `emitsNonRevisionChanges`.
- [x] 1.3 Reflect the classification in each write tool's description and in the exported tool metadata + `TOOL_SURFACE_INDEX`.

## 2. Non-revision change manifest
- [x] 2.1 Add `nonRevisionManifest` to `DocxSession` and a `recordNonRevisionChange` manager method.
- [x] 2.2 Record manifest entries in `add_comment`, `delete_comment`, and `add_footnote`.
- [x] 2.3 Surface the manifest as `non_revision_changes` in the `save` report.

## 3. Tests
- [x] 3.1 Property test: every fresh-emission revisionable editor produces a valid AI tracked change.
- [x] 3.2 Assert AI-inserted body text is never untracked.
- [x] 3.3 Manifest scenarios for comment and footnote side parts, and the tracked-only empty-manifest case.

## 4. Docs
- [x] 4.1 Update `packages/docx-core/SUPPORT.md` to describe the implemented manifest shape.
