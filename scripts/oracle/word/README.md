# Microsoft Word comparison oracle

This developer-only harness asks Microsoft Word for Mac to compare two DOCX files through the supported
Office.js `Document.compareFromBase64` API (`WordApiDesktop 1.2`). It does not send keystrokes, activate an
assumed window, use a file picker, or automate Save As.

Word is behavioral reference evidence, not the ECMA-376 conformance authority. Normal builds, tests, and
published packages do not require this harness.

## Prerequisites

- A current Microsoft Word for Mac build with `WordApiDesktop 1.2`.
- Node.js 20 or newer.
- A localhost HTTPS certificate trusted by macOS and Word.
- The add-in manifest sideloaded into Word.

The standard Office add-in development certificate helper can create and trust the certificate:

```sh
npx office-addin-dev-certs install
npx office-addin-dev-certs verify
```

The helper normally writes `localhost.crt` and `localhost.key` under
`~/.office-addin-dev-certs/`. Inspect the paths printed by the helper rather than assuming them.

## One-time Word setup on macOS

1. Start the static add-in asset server:

   ```sh
   npm run oracle:word:serve -- --cert /absolute/path/to/localhost.crt --key /absolute/path/to/localhost.key
   ```

2. Verify `https://localhost:38491/taskpane.html` loads without a certificate warning.
3. Sideload `scripts/oracle/word/manifest.xml` using Microsoft's current “Sideload an Office Add-in on Mac”
   instructions. For the file-system method, Word reads manifests from its `wef` sideload directory; quit and
   reopen Word after adding or changing the manifest.
4. In Word, open **Insert → My Add-ins**, select **Safe DOCX Word Oracle**, and pin its task pane if desired.

The task pane downloads `office.js` from Microsoft's Office CDN, as required by Office add-ins. The job bridge
itself binds only to loopback and makes no outbound requests.

## Run one comparison

Keep the asset server running. In another terminal:

```sh
npm run oracle:word:compare -- \
  --original /absolute/path/original.docx \
  --revised /absolute/path/revised.docx \
  --output /absolute/path/word-compared.docx \
  --cert /absolute/path/to/localhost.crt \
  --key /absolute/path/to/localhost.key
```

The CLI automatically:

1. embeds Microsoft's documented auto-open web-extension/task-pane parts in a disposable original;
2. gives that copy a unique filename carrying the ephemeral loopback coordinates and capability;
3. opens only that staged file with Word via macOS `open -g`; and
4. lets the auto-opened pane verify and claim the job from the staged filename.

No URL paste or window selection is required after the one-time add-in installation. The CLI still prints a
fallback URL for diagnosis, and `--no-open` leaves opening the staged file to the developer. Before comparing,
the pane verifies that Word's current document has the job's unique staged filename;
it fails with `WRONG_CURRENT_DOCUMENT` instead of comparing whichever document happens to own the pane. The
revised document is sent to Word as base64, so Word does not need a second file-access grant.

On success, the CLI atomically writes the compared DOCX and an adjacent
`word-compared.docx.word-oracle.json` provenance manifest. The manifest records hashes, sizes, normalized
options, Word host/version/API metadata, timestamps, and terminal status. It never records the capability
token or document contents. Both source hashes are checked again before the CLI exits.

Useful options:

- `--timeout 300` sets the readiness/completion timeout in seconds.
- `--author "Safe DOCX Oracle"` attributes the comparison when supported by Word.
- `--no-compare-formatting` disables formatting comparison through Node's boolean-option syntax.

## Failure modes

- `WORD_API_UNSUPPORTED`: update Word or use a build exposing `WordApiDesktop 1.2`.
- `WORD_EXPORT_UNAVAILABLE`: the host compared the documents but cannot export the current compressed DOCX
  through Office.js. This harness deliberately stops; it never falls back to Save As automation.
- `WRONG_CURRENT_DOCUMENT`: open the exact uniquely named staged original printed by the current CLI job,
  then reconnect using a new job (a claimed job is intentionally single-use).
- `expired`: the task pane did not claim or finish the job before the timeout.
- Browser/network errors: confirm both the fixed asset server and ephemeral bridge certificate are trusted,
  and paste the exact URL printed for the current job.

A failed job publishes no compared DOCX. Once a job and bridge have been created, the CLI closes the bridge in
a `finally` path and writes a diagnostic provenance manifest for staging, launch, timeout, bridge-close, and
output-publication failures. Failures before input validation/job creation cannot produce a job manifest.

## Tests and cleanup

Protocol, authentication, payload-boundary, and task-pane parsing tests need no Word:

```sh
npm run oracle:word:test
```

Generate the deterministic #891 table and section source pairs anywhere outside the repository:

```sh
npm run oracle:word:fixtures -- --output-dir /private/tmp/issue891-word-inputs
```

The gated real-Word test runs only when all five `SAFE_DOCX_WORD_ORACLE_{ORIGINAL,REVISED,OUTPUT,CERT,KEY}`
environment variables are set. Otherwise it reports a clear skip. The observed Word 16.112 table/section
topologies and downstream LibreOffice resolution results are recorded in
`evidence/issue-891-word-16.112.json`; this compact record is behavioral evidence, not a normative
conformance claim.

The CLI stages originals only under the system temporary directory with the prefix
`safe-docx-word-oracle-`. It never deletes caller-owned paths. macOS eventually cleans system temporary
files; a developer may remove a specific, verified staging directory printed by the CLI after Word closes it.
To remove the add-in, delete only this manifest from Word's sideload location and restart Word.

Ref: #891

# Microsoft Word Accept All / Reject All oracle

`npm run oracle:word:accept-reject` checks safe-docx's accept and reject against Microsoft Word for Mac. It
needs no add-in or certificate: it drives Word's own `accept all revisions` / `reject all revisions`
through AppleScript and saves the result with Save As. It is macOS-only, opt-in, and never part of
`npm test` or CI.

For every case and for both Accept All and Reject All, it compares Word's saved document with:

- docx-core `acceptChanges` / `rejectChanges` (`DocxDocument`, body and side stories), and
- docx-compare `acceptAllChanges` / `rejectAllChanges` (applied to the body and to every revised header,
  footer and note part).

The comparison is a projection, not a byte diff, because Word rewrites everything it saves. It covers the
number of live sections, each section's page size, margins and `w:titlePg`, each section's default/first/even
header and footer bindings resolved to the bound part's text (with linked-to-previous inheritance), every
body paragraph's text, and the number of tracked revisions left, which must be zero on both sides (a Word
output that still has revisions is an `UNRESOLVED` error and is never cached). Page setup missing on one side
is only a note when the other side holds what Word writes by default (Letter or A4, portrait, default
margins); otherwise it is a mismatch. The logic lives in
`packages/docx-core/src/integration/word-accept-reject-oracle.ts` and is unit-tested without Word.

Built-in suites:

- `matrix`: the 30 section-boundary fixtures behind #1188 (S1e and S3b, ten survivor variants). 60 units.
- `round-trip`: the nine #1144 part A pairs. Each pair is compared with `compareDocuments`; Word's Accept
  All must also reproduce the revised side and its Reject All the original. 18 units.

## Setup

1. Install Microsoft Word for Mac and open it once, so its container
   `~/Library/Containers/com.microsoft.Word/Data/` exists.
2. Build the packages: `npm run build`. The runner imports from `packages/*/dist`.
3. Allow the terminal (or IDE) you run from to control Word: System Settings → Privacy & Security →
   Automation → your terminal → Microsoft Word. The first run asks; a denied permission shows up as
   AppleEvent error `-1743`, and the command skips with that message.

## Run

```sh
npm run build
npm run oracle:word:accept-reject                       # both suites, about 2 minutes on a fresh cache
npm run oracle:word:accept-reject -- --suite matrix     # just the #1188 matrix
npm run oracle:word:accept-reject -- --only s1e-v9      # cases whose id contains the text
npm run oracle:word:accept-reject -- --suite none --fixture /path/redline.docx
npm run oracle:word:accept-reject -- --suite none --pair /path/original.docx,/path/revised.docx
```

Options: `--refresh` ignores cached Word outputs; `--timeout <s>` bounds each Word call (default 120);
`--keep` keeps the staged inputs and Word outputs; `--json <file>` writes the full result; `--strict` exits 3
instead of 0 when it skips.

Exit status: 0 when every unit matches (or fails as listed in `known-divergences.mjs`), 1 for a mismatch or
for a listed divergence that now matches (remove its entry), 2 for a Word or harness error, 3 for a skip with
`--strict`. It skips with exit 0 when `CI` is set, off macOS, or when Word or the Automation permission is
missing.

## How it drives Word

- Every input and output is staged under `~/Library/Containers/com.microsoft.Word/Data/safe-docx-oracle/`.
  Word is sandboxed; files inside its container open and save without the "Grant File Access" prompt, which
  would otherwise stall the run invisibly.
- Each call is bounded by an AppleScript `with timeout` and a child-process timeout. A call that times out is
  retried once and then reported as `STALL`, which usually means Word is showing a dialog. Only the osascript
  process the runner started is killed.
- The runner closes only documents under its own run directory, never quits Word, and leaves other open
  documents alone, so it can run while you (or another tool) have documents open.
- Concurrent runs are serialized on `~/Library/Containers/com.microsoft.Word/Data/safe-docx-word-oracle.lock`
  (the LibreOffice oracle's lock protocol). A running holder's lock is never reclaimed, however long the run
  takes, and the run fails rather than proceeding unlocked if the lockfile cannot be created.
- Word outputs are cached in `safe-docx-oracle/cache/`, keyed by the input's content hash, the mode, the Word
  version and the AppleScript version. A rerun after a change to our appliers reuses Word's results and
  finishes in seconds; a change to the compare output produces a new redline and therefore a new Word run.
  Delete the cache directory, or pass `--refresh`, to start over.
