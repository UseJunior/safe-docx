# Change: Stage save publication with bounded recovery

## Why
The second destination can currently fail after the first output has already replaced user data. Both policies, destination identities and filesystem shapes must be checked before writes.

## What Changes
- Preflight all requested outputs, including canonical targets and inode aliases.
- Stage beside each destination, back up existing files, and recover ordinary failures.
- Preserve symlink write-through and file modes; reject multiply linked files rather than silently splitting hardlinks.
- Report exact paths when recovery or post-success cleanup needs attention.
- No crash-atomic cross-filesystem transaction or race-free protection against external filesystem changes is claimed.

Implementation follows Steven's approved remediation plan for #1305 in #1295; no new public parameters or format/cache policies.

## Impact
- Affected specs: mcp-server
- Affected code: docx-mcp save.ts and a local filesystem publication helper/tests
