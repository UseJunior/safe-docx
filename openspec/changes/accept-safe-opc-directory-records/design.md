## Context

The protocol-v4/v6 independent verifier builds its trusted package inventory
from classic ZIP bytes before delegating exact-name decompression to `unzip`.
The current parser recognizes DOS and Unix directory indicators but rejects
every directory. That fail-closed rule excludes Word-authored packages whose
regular OPC parts are safe but whose ZIP producer emitted explicit directory
metadata.

Directory records cannot simply be ignored during central-directory parsing.
Doing so before local-header, duplicate, collision, span, and resource checks
would create a second, less constrained archive namespace outside the trusted
index.

## Goals / Non-Goals

- Goals:
  - accept a narrow, unambiguous, empty directory-record subset;
  - validate directories under the same bounded central/local index as files;
  - prevent aliasing between `name` and `name/`;
  - keep directory metadata out of the trusted OPC part inventory;
  - preserve the existing public certificate schema and fail-closed boundary.
- Non-Goals:
  - treat directories as OPC parts or selected XML resources;
  - accept directory payloads, compressed directories, symlinks, or special
    files;
  - normalize case, Unicode, separators, or multiple trailing slashes;
  - widen classic ZIP, OPC, or ECMA-376 conformance claims.

## Decisions

### Classify from all available central signals

Classification uses three central-record signals: the decoded name's trailing
slash, DOS external-attribute directory bit `0x10`, and the Unix file type in
the high mode bits when present.

A safe directory name ends in `/` but not `//` and has at least one directory
attribute. If a Unix file type is present, it is directory type; a simultaneous
Unix regular-file type and DOS directory indication is contradictory and
rejected. A safe regular file has no trailing slash or DOS directory bit and
has either no Unix type or Unix regular-file type. Unix symlink and other
special types remain unsupported. Any other combination is ambiguous and
causes process-level `not_run`.

All other exact-name safety rules remain unchanged. In particular, the parser
still rejects leading slash, backslash, controls, pattern characters, and
`.`/`..` or empty path segments; the one final empty segment represented by a
safe directory's terminal slash is the only new exception.

This accepts DOS-only, Unix-only, and consistently dual-marked directory
records without letting a trailing slash alone or contradictory attributes
decide trusted identity.

### Require empty stored directory records

An accepted directory record uses compression method `0` and has zero CRC-32,
compressed size, and expanded size. Its local header must match the central
raw filename, flags, method, CRC, and sizes under the existing exact checks.
The computed data offset therefore equals the complete local-record span end,
proving zero payload. Extra fields remain subject to the existing bounded
parser, ZIP64 and Unicode Path exclusions, and central/local policies.

Alternative considered: accept deflate method `8` for empty directories.
There is no OPC payload to decompress, and accepting a compressed empty stream
would add extractor and representation ambiguity without improving part
coverage.

### Validate before projecting the trusted part inventory

Directory records count toward package bytes, central-directory bytes, ZIP
entry count, filename length, and complete local-record span validation. Their
zero declared sizes contribute zero to compressed/expanded byte totals.
Directories participate in exact decoded-name duplicate detection and pairwise
local-span overlap checks. Only after every record passes are directories
removed from the inventory exposed to exact OPC part lookup, selected-part
admission, and decompression.

This ordering prevents an omitted record from bypassing archive amplification,
namespace, or overlap controls. Directory entries never increment selected-part
counts and never become relationship targets or fixed stories.

### Add an explicit file/directory collision identity

Exact decoded names remain the primary identity and are not case-folded or
Unicode-normalized. For collision checking only, a validated directory removes
exactly its one final `/`; a regular file retains its full name. Any equal
collision identities with different record kinds invalidate the entire index.
Thus `word` and `word/` cannot coexist, while `word/` and
`word/document.xml` remain distinct.

### Preserve the certificate boundary

Valid directory metadata is invisible in v4/v6 evidence and the public v1
certificate. The certificate is determined only by the same fixed and selected
regular-file stories as before. Invalid directory metadata prevents a trusted
index, so the executable produces no valid protocol response and the public
certificate remains `not_run`; it is not downgraded to a structured selection
failure. No certificate schema or protocol version changes.

## Risks / Trade-offs

- Some ZIP tools emit slash-only directories without attributes. They remain
  unsupported because their record kind is not independently corroborated.
- Rejecting Unix-regular plus DOS-directory attributes may exclude permissive
  readers' output, but avoids allowing contradictory type metadata into a
  security-sensitive index.
- Filtering after full validation retains bounded work proportional to the
  declared entry count. Existing entry and central-directory ceilings cap that
  cost.
- A collision check stricter than ordinary ZIP lookup can reject archives other
  tools open. This is intentional because the trusted inventory must expose one
  unambiguous file namespace.

## Migration Plan

1. Extend the existing central-entry classification without changing public
   request, response, or certificate types.
2. Validate and collision-check all records, then project only regular files
   into the trusted inventory.
3. Add compiled accepted/adversarial fixtures and the Word-authored public
   certificate regression.
4. Update policy coverage and generated conformance documentation.

Rollback restores unconditional directory rejection. Certificates created
before or after the change remain protocol-v1 compatible.

## Open Questions

None. The accepted directory subset and certificate boundary are intentionally
narrow.
