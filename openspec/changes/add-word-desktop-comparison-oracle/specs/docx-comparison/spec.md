## ADDED Requirements

### Requirement: A local Microsoft Word comparison oracle produces attributable native redlines without focus-dependent automation

The repository SHALL provide an opt-in developer harness that compares an explicit original DOCX and revised
DOCX with Microsoft Word's native comparison engine through the Office.js
`Word.Document.compareFromBase64` API. The add-in SHALL require `WordApiDesktop 1.1` and SHALL report a clear,
version-attributed capability failure when the installed Word host does not support it.

The harness SHALL operate on a disposable copy of the original and SHALL leave both caller-provided inputs
byte-for-byte unchanged. It SHALL export the resulting compared document through supported Office.js file
APIs and SHALL NOT use focus-dependent keyboard/mouse injection, blind window activation, file-picker
automation, or Save As UI automation.

Before invoking comparison, the add-in SHALL verify that Word's current document URL identifies the job's
unique staged original filename. If the URL is unavailable or identifies another document, the job SHALL fail
without comparing, preventing a pinned task pane from silently targeting an unrelated open document.

The CLI/add-in protocol SHALL be local-only: it SHALL bind to loopback, authenticate every request with an
ephemeral capability token, restrict each process to one bounded job, reject invalid state transitions and
oversized payloads, and terminate after completion or timeout. The browser/add-in context SHALL not choose
arbitrary filesystem paths.

Every terminal job SHALL emit a machine-readable provenance manifest containing input hashes, normalized
comparison options, Word host/version and API-support information, timestamps, status, and stable diagnostic
codes; successful jobs SHALL also include the output hash. The manifest SHALL not persist the authentication
token or document contents.

The Word oracle SHALL remain a development and verification dependency only. Normal CI and package runtime
SHALL not require Microsoft Word, a GUI session, Office.js desktop APIs, or the add-in. A gated real-Word
check SHALL skip clearly when the host, API, or ready add-in is unavailable. Word output is behavioral
reference evidence and SHALL NOT be represented as the normative definition of ECMA-376 conformance.

#### Scenario: [WORD-ORACLE-01] A supported Word host returns a native compared DOCX with provenance

- **GIVEN** explicit readable original and revised DOCX inputs, a writable output location, a ready sideloaded add-in, and a Word host supporting `WordApiDesktop 1.1`
- **WHEN** the developer runs one Word comparison job
- **THEN** Word compares the staged original against the revised bytes, the bridge atomically publishes a valid compared DOCX, and the adjacent manifest records matching input/output hashes, Word/API metadata, normalized options, and a successful terminal status

#### Scenario: [WORD-ORACLE-02] Source documents remain immutable

- **GIVEN** original and revised inputs with hashes recorded before a comparison job
- **WHEN** the job succeeds, fails, or times out
- **THEN** the hashes of both caller-provided inputs are unchanged, and any Word mutation was confined to harness-owned disposable staging

#### Scenario: [WORD-ORACLE-03] Unsupported or unavailable Word fails explicitly without fabricated output

- **GIVEN** Word is missing, the task pane does not become ready, `WordApiDesktop 1.1` is unsupported, comparison throws, or compressed OOXML export is unavailable
- **WHEN** the gated oracle command runs
- **THEN** it skips or fails with a specific diagnostic and attributable manifest, publishes no partial output as successful, and does not fall back to UI scripting

#### Scenario: [WORD-ORACLE-04] The loopback bridge rejects unauthorized and invalid job traffic

- **GIVEN** a pending one-job bridge session
- **WHEN** a request has a missing or incorrect token, an unknown job ID, an invalid state transition, an out-of-order result slice, an expired/completed job, or an oversized payload
- **THEN** the bridge rejects the request, does not expose source paths or contents, does not publish an output, and records only redacted diagnostics

#### Scenario: [WORD-ORACLE-05] Issue #891 Word outputs distinguish revision topology from LibreOffice resolution behavior

- **GIVEN** the table and section original/revised fixture pairs for residual terminal deletion behavior
- **WHEN** each pair is compared by Word and the resulting native redline is accepted and rejected through the existing LibreOffice oracle
- **THEN** the experiment records Word's relevant revision topology and LibreOffice's resulting paragraph structure with hashes and version metadata, so a disagreement is preserved as interoperability evidence rather than silently attributed to safe-docx or treated as an ECMA-376 conformance verdict
