## Context

safe-docx already has a committed LibreOffice oracle for accepting and rejecting tracked changes. That oracle
shows a table-row deletion mismatch for #891, but it cannot independently produce the redline that Word would
create from clean original and revised documents. Manual Word comparison established that Word produces the
same relevant table topology as the current safe-docx candidate, yet manual files are not a reproducible
developer workflow.

Word for Mac exposes native comparison through Office.js `Word.Document.compareFromBase64`, in the
desktop-only `WordApiDesktop 1.1` requirement set. It does not expose a supported headless command-line
interface. The design therefore separates orchestration from execution: a local CLI owns files and job
provenance, while code running inside Word calls the supported API.

## Goals / Non-Goals

### Goals

- Produce a Word-native compared DOCX from explicit original and revised DOCX paths.
- Avoid foreground focus, keystroke injection, and file-picker automation.
- Preserve the source files byte-for-byte by operating on a disposable original copy.
- Make every output attributable to input hashes, Word/API version information, options, and job status.
- Support repeatable #891 table and section experiments and downstream LibreOffice resolution checks.
- Keep Word completely optional for normal builds, tests, and published packages.

### Non-Goals

- Run Microsoft Word headlessly or in CI.
- Treat Word behavior as the normative definition of ECMA-376 conformance.
- General-purpose remote control of Word or arbitrary filesystem access from an add-in.
- Replace the production safe-docx comparison engine with Office.js.
- Automate installation, Microsoft sign-in, or all one-time macOS permission prompts.

## Decisions

### Decision: use a task-pane Office add-in and `compareFromBase64`

The add-in SHALL use Word's supported Office.js desktop comparison API instead of AppleScript, VBA, or UI
scripting. The revised document is delivered as base64, avoiding a Word file-access prompt for that input.
The original is opened only as a disposable staged copy, and `CompareTarget.current` is used so the add-in
remains attached to the document that receives the comparison result.

Alternatives considered:

- **AppleScript/VBA:** rejected on Word for Mac because the comparison command fails with `-1708` in the
  tested environment.
- **Accessibility/UI automation:** rejected because it is focus-dependent and can send input to an unrelated
  window.
- **Aspose as the sole oracle:** useful as an independent implementation, but insufficient to establish what
  Word itself emits.
- **Microsoft Graph:** it offers file access but no native Word document-comparison endpoint.

### Decision: export the compared document through Office.js

After comparison and synchronization, the add-in SHALL obtain the current document as compressed OOXML via
the Office document file API, stream its slices to the bridge, and close the file handle. The bridge assembles
the slices into a temporary output, validates that it is a readable DOCX package, and atomically renames it to
the requested output path.

If Word cannot export a comparison result through this route on a supported build, the job SHALL fail with a
specific capability error and retain diagnostics; it SHALL NOT fall back to Save As UI automation.

### Decision: use a narrow, authenticated loopback job protocol

The bridge SHALL bind only to `127.0.0.1` on an ephemeral port and require a cryptographically random bearer
token supplied in the add-in launch/configuration URL. One bridge process handles one active job. Its protocol
is limited to:

1. claim the pending job;
2. report Word/API capability and progress;
3. fetch the revised DOCX payload;
4. upload ordered result slices; and
5. complete or fail the job.

Requests with a missing/incorrect token, unknown job identifier, out-of-order slice, oversized payload, or
completed/expired job SHALL be rejected. The bridge SHALL not accept arbitrary paths from the browser
context; paths are resolved and validated by the CLI before the server starts.

### Decision: require explicit readiness rather than controlling application focus

The CLI may open the staged original with the platform's normal application launcher and may print the local
task-pane URL/instructions. It SHALL wait for the add-in to claim the job and report readiness. It SHALL NOT
use keyboard/mouse events, AppleScript `activate`, or assumptions about the active window.

Before comparison, the add-in SHALL verify that Word's current document URL names the job's unique staged
original. A mismatch or unavailable URL is a terminal capability failure, preventing a pinned task pane from
silently comparing the revised payload against a different open document.

The first release may require the developer to sideload and open/pin the add-in task pane once. Subsequent
jobs can be accepted by the running task pane. Timeouts produce actionable diagnostics rather than attempting
blind recovery.

### Decision: store outputs with a machine-readable provenance manifest

Each successful or failed experiment SHALL record a JSON manifest adjacent to the requested output,
including:

- SHA-256 hashes and byte sizes for original, revised, and (on success) output;
- normalized comparison options;
- Word host/platform/version information reported by Office.js;
- whether `WordApiDesktop 1.1` was supported;
- job identifier, timestamps, terminal status, and diagnostic code; and
- the local harness version/schema version.

The manifest SHALL avoid embedding document contents, the bearer token, or unrelated environment data.

### Decision: separate protocol tests from the real-Word characterization

Automated tests SHALL cover staging, source immutability, authentication, state transitions, slice assembly,
payload limits, timeouts, and manifest creation using a simulated add-in client. A separately gated command
SHALL run only when a developer has Word and the add-in available. Absence of Word is a clear skip for the
gated test, not a failure of the normal suite.

The #891 experiment SHALL retain input fixtures and compact topology/resolution summaries. Generated Word
binaries may be committed only if repository fixture policy and size permit; otherwise the reproducible
command and hash-addressed local result manifest are the durable evidence.

## Risks / Trade-offs

- **`WordApiDesktop 1.1` availability varies by Word build.** The add-in performs an explicit requirement-set
  check and fails with build/version diagnostics.
- **Office add-ins need HTTPS and sideloading setup.** Provide a documented development-certificate workflow
  and a deterministic manifest; do not weaken browser or Office security settings.
- **The task pane lifecycle is not headless.** The bridge has a bounded readiness timeout and tells the user
  exactly which one-time/manual action remains.
- **Word output may vary by build.** Input/output hashes, Word version, API support, and comparison options
  make results attributable instead of assuming byte-for-byte determinism across versions.
- **A loopback server expands local attack surface.** Bind narrowly, authenticate every request, expose only
  a single bounded job, redact secrets, and terminate promptly.
- **Comparing into the current document mutates it.** The CLI opens a disposable staged copy and verifies both
  caller-provided inputs remain unchanged.

## Migration Plan

1. Add protocol types, bridge, simulated-client tests, and documentation.
2. Add the sideloadable Word task-pane add-in and capability diagnostics.
3. Add the opt-in CLI/smoke command and perform one real Word round trip.
4. Run table and section #891 comparisons and pass Word results through the LibreOffice oracle.
5. Keep the harness local-only; removal consists of deleting the add-in/bridge and development scripts, with
   no production data or API migration.

## Open Questions

- During implementation, verify whether the current Word for Mac build exports the post-comparison current
  document through `getFileAsync(Office.FileType.Compressed)` without an additional save. If not, stop with a
  capability finding and amend this design; do not introduce UI automation.
- Decide after measuring fixture sizes whether Word-generated binaries belong in git or only their compact
  XML/topology projections and provenance manifests do.
