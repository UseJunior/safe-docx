# Change: Stage save publication with bounded recovery

## Why
The second destination can currently fail after the first output has already replaced user data. Both policies, destination identities and filesystem shapes must be checked before writes.

## What Changes
- Preflight all requested outputs, including canonical targets and inode aliases.
- Use destination-filesystem private probes for absent case/normalization aliases, including missing parents; preserve distinct names on case-sensitive filesystems.
- Stage beside each destination, verify complete backup bytes, and recover ordinary failures including partial rejected writes.
- Preserve existing inode/security metadata and symlink write-through by in-place publication and restoration. Exclusively create new targets; conservatively reject multiply linked files.
- Report exact paths when recovery or post-success cleanup needs attention.
- No crash-atomic cross-filesystem transaction or race-free protection against external filesystem changes is claimed.

Implementation follows Steven's approved remediation plan for #1305 in #1295; no new public parameters or format/cache policies.

## Impact
- Affected specs: mcp-server
- Affected code: docx-mcp save.ts and a local filesystem publication helper/tests
