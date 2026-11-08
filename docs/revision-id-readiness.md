# Managed revision allocation

`RevisionIdAllocator` owns asynchronous readiness for managed editors. Its
`ensureReady()` shares an in-flight seed and retries after failure. `allocate()`
refuses calls while unseeded or seeding. A successful seed yields plain
`RevisionIdState` for existing synchronous emitters. `createRevisionIdState()`
and caller-supplied allocation callbacks keep their existing behavior.

The MCP session stores controllers outside cloneable session data. Mutation
candidates use `fork()` to copy ready allocation data or share the initial scan
before copying it. Failed, retired and no-op candidates discard tentative IDs;
an unpublished ID may be reused by the next edit. A changed live candidate
publishes its counter only if its checkpoint still matches the active state.
If a direct caller allocated in the meantime, the edit returns
`REVISION_ID_CONFLICT` and can be retried. Publication updates the active plain
object in place so previously issued contexts remain current.

The scan covers the current main story, footnotes, endnotes, comments, glossary,
and relationship-selected headers and footers, including nonstandard filenames.
Only revision-bearing IDs reserve counter values. Malformed optional stories
retain the existing best-effort parse policy; they are not newly claimed as
validated or editable. Readiness never rewrites source IDs or changes the
[logical revision grouping policy](revision-id-policy.md).

This implements [#1299](https://github.com/UseJunior/safe-docx/issues/1299) in
the [state-machine remediation series](https://github.com/UseJunior/safe-docx/issues/1295).
[Contributor PR #1340](https://github.com/UseJunior/safe-docx/pull/1340) by
@cocvn157 informed the allocator and current-story scan. The separate managed
boundary and explicit publication operation accommodate the atomic mutation
forks subsequently merged for #1301 without cloning promises or class instances.
