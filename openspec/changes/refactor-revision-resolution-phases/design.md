## Decisions
Keep the passes local to accept_changes.ts and reject_changes.ts. Their small
return values carry counters or the paragraph identities discovered before DOM
mutation; later consumers take read-only collections. The public entry points
show the order directly. No generic state-machine runner or shared policy layer
is needed.

Preconditions remain enforced where they already live: row markers are
distinguished by their direct trPr parent, promoted wrappers are sorted deepest
first, paragraph marks are captured before wrapper removal, selective deleted
text restoration excludes surviving foreign wrappers, and paragraph merges run
after property restoration. Regression tests protect row/mark/bookmark/property
ordering, exact selected property containers and observable selector call order
without introducing new validation errors or selector calls.

The unchanged deleted-text-before-move-source order has a pre-existing selective
reject gap: selected move-source text can remain `delText` outside its wrapper.
Dynamic review reproduced this on both main and the refactor. This behavior is
not claimed as resolved or test-protected here. It is separate from #1020's
authorless move-range ends; neither defect is absorbed into this refactor.

The low-level passes mutate their DOM and propagate exceptions. They do not
roll back. A DocxDocument fork, used by the atomic session mutation mechanism,
is the isolation boundary. Tests exercise a late side-story failure on that
unpublished fork and verify that the live source remains unchanged.

## Contributor reconciliation
[PR #1335](https://github.com/UseJunior/safe-docx/pull/1335), by cocvn157
(Trung Hehe), commit c5624fefbda7303ad322ed34e8049da94d4b418f, contributed the
named extraction and six initial synthetic tests reused here with credit.
Comparison is against main 44c9a8ec, after foundations #1301 and #1318 and the
separate embedded-content fix #1312. Our starting worktree had no uncommitted
candidate edits.

This PR moves the public conformance documentation back onto the public entry
points, clarifies that cell topology is deferred, makes later phase inputs
read-only, adds structured conformance metadata to the contributed tests, and
adds phase-interaction, side-story, deferred-revision and failure tests. The
contributor's reported 97-test result is not reused as our evidence; our own
executions are recorded separately. Their branch and PR remain untouched.

Move-range pairing remains [#1020](https://github.com/UseJunior/safe-docx/issues/1020).
The selective range-end regression is characterization of the existing gap,
not a new supported behavior. No comparison baseline is regenerated.

## Verification
The initial 35 new tests pass against the original accept/reject source as well
as the refactor. Review then strengthened all twelve property-history cases and
added four guards for empty mark properties and selector observations. Initial
nine-suite verification passed 130 tests; final review/gate evidence is recorded
on PR #1374. The mandatory default workspace
suite on the integrated pagination base (649a40c7) passes 4,912 tests, with the
58 existing conditional skips. Build, workspace lint, spec coverage, conformance
citations/document and cycle checks pass. The frozen real-corpus gate passes all
37 cases without changing either manifest.

Local public-document smoke verifies all seven SHA-256-pinned NVCA inputs:
tracked replacement, accept and reject, save/reopen, full paragraph text and
unchanged other package parts. Existing orphan-footnote pruning is verified as
an exact projection, rather than incorrectly demanding byte identity for a part
that the existing policy intentionally updates. No formatting behavior changes;
this extraction does not require new visual evidence. Execution logs and local
artifacts are retained under `.tmp/issue-1313/` in the implementing worktree.
