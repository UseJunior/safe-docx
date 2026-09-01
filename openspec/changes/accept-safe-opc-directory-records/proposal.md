# Change: Accept safe OPC ZIP directory records

## Why

Some otherwise valid Word-authored DOCX packages contain explicit ZIP directory
records. The independent Lean verifier currently rejects every directory record
before it can certify the document, even though OPC part lookup needs only the
regular-file entries.

## What Changes

- Classify ZIP central-directory records as regular files or directories from
  the trailing slash plus DOS and Unix type attributes, and reject ambiguous or
  contradictory classification.
- Accept only directory records whose central and local headers agree, use the
  stored method, and declare zero CRC-32, compressed size, expanded size, and
  payload.
- Validate and charge accepted directory records against package, central
  directory, entry-count, name-length, and complete-local-span limits before
  omitting them from the trusted OPC part inventory.
- Preserve exact decoded-name duplicate detection across all records and add a
  collision identity that removes exactly one directory trailing slash, so a
  regular file and directory cannot claim the same identity.
- Keep malformed, ambiguous, payload-bearing, overlapping, duplicate, or
  file/directory-colliding records at the existing process-level `not_run`
  certificate boundary.
- Add compiled public-certificate regression evidence for the affected
  Word-authored package and focused adversarial directory cases.
- Document this as a bounded SafeDocX verifier policy, without widening OPC or
  ECMA-376 conformance claims.

## Impact

- Affected specs: `docx-comparison`, `spec-compliance`
- Affected code after approval: Lean classic-ZIP indexing and inventory
  projection, compiled verifier fixtures, public certificate regression tests,
  checker coverage policy, verifier documentation, and generated conformance
  documentation
- Compatibility: no request, response, or public certificate schema change;
  qualifying packages move from `not_run` to their ordinary verification
  result, while unsafe directory records remain `not_run`
- Scope: classic single-disk stored/deflated ZIP packages only; accepted
  directory records themselves must be stored and empty
- Conformance: SafeDocX verifier policy only; no new ECMA-376 or full OPC claim
- Ref: #745
