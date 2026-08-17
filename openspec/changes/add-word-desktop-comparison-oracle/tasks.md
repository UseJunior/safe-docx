## 1. Local bridge and job protocol

- [x] 1.1 Add typed job/provenance schemas and a CLI accepting explicit original, revised, output, timeout,
      and normalized Word comparison options.
- [x] 1.2 Stage a disposable copy of the original, hash both immutable inputs, bind an authenticated one-job
      server to loopback, and implement bounded payload/slice handling plus atomic output publication.
- [x] 1.3 Record success/failure manifests with input/output hashes, Word host/API metadata, options,
      timestamps, status, and stable diagnostic codes; never persist the capability token.
- [x] 1.4 Add simulated-client tests for authentication, state transitions, timeouts, malformed/out-of-order
      uploads, size limits, source immutability, DOCX validation, and manifest generation.

## 2. Microsoft Word task-pane add-in

- [x] 2.1 Add a sideloadable Word add-in manifest and minimal task pane under `scripts/oracle/word/`, isolated
      from published package runtime dependencies.
- [x] 2.2 Claim the bridge job only after `Office.onReady`, report host/platform/version data, and explicitly
      require `WordApiDesktop 1.1` before accepting document bytes.
- [x] 2.3 Invoke `compareFromBase64` against the disposable current original with explicit comparison options,
      synchronize, export compressed OOXML in ordered slices, and report terminal success/failure.
- [x] 2.4 Add focused unit tests for add-in job handling and error mapping without requiring Word.

## 3. Developer workflow and safety

- [x] 3.1 Add development scripts for serving HTTPS assets, validating/sideloading the manifest on macOS,
      starting one comparison job, and cleaning only harness-owned temporary state.
- [x] 3.2 Document prerequisites, one-time certificate/sideload/task-pane setup, normal reuse, readiness
      timeouts, Word/API diagnostics, source immutability, and removal/cleanup.
- [x] 3.3 Ensure the workflow never sends keyboard/mouse input, activates an assumed window, or falls back to
      Save As UI automation.

## 4. Issue #891 Word/LibreOffice experiment

- [x] 4.1 Add or reuse repository-approved table and section original/revised fixtures that isolate residual
      terminal deletion behavior.
- [x] 4.2 Generate Word-native redlines for both fixture pairs with the new harness and record Word version,
      hashes, comparison options, and compact revision-topology projections.
- [x] 4.3 Resolve each Word output through the existing LibreOffice accept/reject oracle and record the
      expected-vs-actual paragraph structures, distinguishing safe-docx topology evidence from a
      LibreOffice-specific resolution defect.
- [x] 4.4 Add a gated real-Word smoke/characterization test that skips clearly when Word, the required API, or
      a ready add-in is unavailable.

## 5. Verification and delivery

- [x] 5.1 Run targeted unit/integration tests and a real Word comparison on macOS.
- [x] 5.2 Run `npm run build && npm run lint:workspaces && npm run test:run && npm run check:spec-coverage && npm run check:conformance-citations && npm run check:conformance-doc`.
- [x] 5.3 Document the observed oracle result and any remaining #891 implementation decision; commit with
      `Ref: #891` (never `Fixes`, because the oracle does not itself close the product defect).
