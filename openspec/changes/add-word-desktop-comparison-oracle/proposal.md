# Change: Add a Microsoft Word desktop comparison oracle

## Why

Issue #891 needs reference-implementation evidence for table and section-boundary deletions. LibreOffice's
accept/reject result disagrees with the expected paragraph structure, but that result alone cannot tell us
whether safe-docx emitted the wrong revision topology or LibreOffice resolved a valid Word redline
incorrectly. Microsoft Word's native comparison engine is the most relevant behavioral reference for this
question.

The existing macOS automation route is not suitable: Word's AppleScript/VBA comparison command returns
`-1708`, and focus-dependent UI scripting can type into the wrong window. Word's Office.js desktop API
provides a supported `compareFromBase64` operation, so a sideloaded task-pane add-in plus a local bridge can
make the native comparison reproducible without blind keystrokes.

## What Changes

- Add an opt-in, developer-only Microsoft Word task-pane add-in that checks for `WordApiDesktop 1.2`, receives
  a comparison job from a loopback bridge, invokes Word's native `compareFromBase64` API against a disposable
  copy of the original document, and exports the compared DOCX.
- Add a local CLI/bridge that stages original and revised DOCX files, authenticates a single Word add-in
  session with an ephemeral token, records job provenance, and writes the resulting redline without mutating
  either source document.
- Add explicit setup and troubleshooting documentation for macOS sideloading, HTTPS development
  certificates, task-pane activation, API availability, and cleanup. The workflow may require one-time user
  setup, but comparison jobs do not depend on Word being the foreground application.
- Add gated integration coverage for the bridge protocol and an opt-in real-Word smoke/characterization
  command. CI continues to run without Microsoft Word.
- Use the oracle to generate and inspect Word-native comparison outputs for the table and section fixtures
  relevant to #891, then feed those outputs into the existing LibreOffice accept/reject oracle. A Word/LO
  disagreement is recorded as interoperability evidence rather than treated as proof that Word or
  LibreOffice defines ECMA-376 conformance.

## Impact

- Affected specs: `docx-comparison` (ADDED: local Microsoft Word comparison-oracle requirement).
- Affected code: new local Word add-in and loopback bridge under `scripts/oracle/word/`; root development
  scripts/dependencies; gated integration tests and issue-#891 oracle fixtures or result manifests.
- No published-package runtime dependency and no production comparison-engine behavior change.
- No CI dependency on Word, Office.js desktop APIs, or a GUI session.
- Security-sensitive local surface: the bridge is loopback-only, uses an ephemeral capability token, bounds
  accepted paths and payload sizes, and shuts down after its job/session completes.

## References

- Ref: #891
- Microsoft Word JavaScript API: `Document.compareFromBase64` (`WordApiDesktop 1.2`)
- Microsoft Office add-in sideloading on Mac
