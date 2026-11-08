# Contribution reconciliation: #1324

Reviewed the actual patch of [cocvn157's #1324](https://github.com/UseJunior/safe-docx/pull/1324), not just its PR description. Credit: that contribution implements the useful direction of preflighting policies, destination-local staging, backups and synthetic failure injection. Its branch, PR and permissions are unchanged. Its reported checks are not counted as our validation.

The owned issue branch follows the approved plan with a separate local helper rather than applying #1324 unchanged:

- In #1324, `publishedEntries` is updated only after stage-to-destination rename. An original moved to backup immediately before a failed publish is absent from that recovery list; later backup cleanup can delete that original. Track backup state as soon as backup rename succeeds, and restore every backup regardless of whether its stage was published.
- Register a stage before writing so partial failed writes are cleaned. Report cleanup failures instead of swallowing them.
- Resolve symlink targets before publication, preserving write-through rather than replacing the symlink itself. Check nonexistent paths through symlinked parents and reject device/inode aliases.
- Preserve existing mode bits and reject multiply linked outputs explicitly, rather than silently splitting hardlinks.
- Back up both originals before publishing either. Restore directly over an already published file; do not unlink user files first in an attempt to make restoration succeed.
- Keep failure injection private to tests via filesystem spies, with no `_testHooks` addition to save parameters.
- Preserve #1304's artifact union, captured generation/metadata, validation and cache publication guard. Compute fallible revision metadata before filesystem publication.
- Treat cleanup after both publications as committed success with exact cleanup diagnostics; do not assert rollback after originals may already have been discarded.

Execution evidence for the owned implementation is recorded in the PR with commands and actual outputs. A separate local extraction probe executed #1324's actual helper additions (TypeScript stripped with Node) and injected a real second stage-to-target rename failure after backup. `node .tmp/issue-1305/contributor-probe.mjs` exited 0: the first destination retained `old-clean`, but the second destination and its backup were both missing; the only surviving file was `clean.docx`. Evidence: `.tmp/issue-1305/contributor-probe.log` (local). No contributor test claims are reused.
