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
