# Change: Add an opt-in Microsoft Word Accept All / Reject All oracle

## Why

Accept/reject fixes for section boundaries (#1144, #1171, #1188) were checked against Microsoft Word 16 for
Mac with a throwaway AppleScript and scratch fixture generators. That evidence decided the behavior (Word's
all-or-nothing header/footer carry, for example), but it was not reproducible: the generators and runner
lived in a temporary directory and are gone. A later change to the appliers could drift from Word without
anyone noticing, because CI cannot run Word.

## What Changes

- Add a Word-free comparison module, `packages/docx-core/src/integration/word-accept-reject-oracle.ts`
  (internal, not exported from the package index). It projects a package to what a reader sees and diffs
  two projections: live section count, each section's page size, margins and `w:titlePg`, each section's
  header/footer bindings for default/first/even resolved to the bound part's text with linked-to-previous
  inheritance, body paragraph text, and the count of tracked revisions left (which must be zero on both
  sides). Missing page setup is tolerated only where the other side holds Word's defaults. It also classifies `osascript`
  failures, hashes packages for the cache, runs the case-by-mode orchestration against an injected Word
  driver, and formats the report. Its Word lock reuses the `soffice-lock.ts` acquisition protocol on its
  own lockfile, never reclaims a live holder's lock, and fails closed when the lockfile cannot be created.
- Add a runner under `scripts/oracle/word/accept-reject/` and the root script
  `npm run oracle:word:accept-reject`:
  - an AppleScript driver that stages inputs and outputs inside Word's sandbox container
    (`~/Library/Containers/com.microsoft.Word/Data/`), so Word never shows the file-access prompt; it
    closes only its own documents and never quits Word;
  - committed fixture generators for the 30-fixture #1188 section-boundary matrix (byte-identical in
    `word/document.xml` to the fixtures the #1188 Word runs used) and the nine #1144 part A round-trip
    pairs;
  - external inputs (`--fixture`, `--pair`), a content-addressed cache of Word outputs, and a known-divergence
    list (XFAIL/XPASS).
- Every unit (case x Accept All / Reject All) compares Word's saved output with docx-core
  `acceptChanges`/`rejectChanges` and with docx-compare `acceptAllChanges`/`rejectAllChanges`. Round-trip
  pairs are first compared with `compareDocuments`; Word's Accept All must then reproduce the revised side
  and its Reject All the original.

## Impact

- Affected specs: `docx-comparison` (ADDED: one requirement).
- Affected code: new `word-accept-reject-oracle.ts` and its unit tests in docx-core; new
  `scripts/oracle/word/accept-reject/`; root `package.json` scripts; `scripts/oracle/word/README.md`.
- No production-engine change and no published API change.
- macOS-only and opt-in. It is not part of `npm test` or CI; it skips with exit 0 and a message when CI is
  set, on other platforms, or when Word or the Automation permission is missing.
- Word is behavioral reference evidence, not the definition of ECMA-376 conformance.

## References

- Ref: #1144, #1171, #1188
