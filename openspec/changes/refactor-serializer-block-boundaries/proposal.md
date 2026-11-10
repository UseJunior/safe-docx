# Change: Share semantic serializer block boundaries

## Why

Current main independently walks table runs and list interruptions in HTML,
Markdown, and DOCX-to-ODF conversion. These duplicate transitions can drift when
downstream pagination consumes the same document view (epic #1295, O/#1310 and V/#1317).

## What Changes

- Export a small typed document-order block iterator and collector from docx-core.
- Share contiguous table/list boundaries while retaining renderer-specific heading,
  spacing, nesting, and table-cell rules. No framework or MCP contract changes.
- Reuse and credit the sound iterator/renderer work in contributor PR #1329; fix
  its invalid test enum references, add public-export and integration coverage, and
  express ODF spacing/manual-label list interruptions through iterator options.
- Keep plaintext outside this focused three-renderer change.

## Approval

Implementation follows the detailed remediation plan explicitly approved by the
user with “Implement the plan”; no further architectural decision is pending.

## Impact

- Affected specs: docx-primitives (semantic serialization)
- Affected packages: docx-core, odf-core
- Public addition: iterator, collector, options, and block union; existing APIs unchanged

## Contributor reconciliation

PR https://github.com/UseJunior/safe-docx/pull/1329 at
`28d2b6c067dabcff8798f610bddfe1f15c47249b` supplies the initial iterator,
HTML/Markdown integration and iterator cases. Its tests reference nonexistent
`LabelType.BULLET` and `LabelType.LEGAL`; the enum on current main contains neither.
Those references prevent a green workspace typecheck and are corrected here.
The reused heading factory also used the unsupported source `heuristic` instead
of `run_in_header` and imported an unused symbol; workspace lint exposed and
verified the need for those test-only corrections.
Allure assertion steps are awaited so asynchronous failures cannot outlive a test.
Its reported test counts are not adopted as evidence. ODF originally retained
manual/spacing list transitions inside its list loop; this implementation delegates
those boundaries to `isListItem` and `shouldBreakList`, with conversion regressions.
The contribution branch and PR remain unchanged and open.
