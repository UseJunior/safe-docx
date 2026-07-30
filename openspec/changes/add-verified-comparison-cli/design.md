## Context

The comparison library already supports `leanXmlVerifier.enabled`, but the
installed CLI never supplies it and discards `CompareResult.documentIntegrity`.
The compiled verifier owns package parsing so its certificate does not trust a
TypeScript-selected XML subset. That parser currently treats every ZIP
directory entry as archive ambiguity, including conventional zero-byte
placeholders such as `word/`.

## Goals / Non-Goals

- Goals:
  - make verified comparison a deliberate CLI choice;
  - preserve a machine-readable certificate;
  - fail closed when a requested certificate does not pass;
  - accept only inert and unambiguous directory placeholders;
  - keep ordinary verified comparisons within the user-accepted 10-second
    latency budget.
- Non-Goals:
  - enable verification by default;
  - claim that rebuild output is verified;
  - accept symlinks, special files, non-empty directory payloads, ambiguous
    directory identities, or directory entries selected as XML stories;
  - publish or test against confidential documents.

## Decisions

### CLI contract

`safe-docx compare ... --verify` enables the compiled verifier. The normal JSON
result gains a `verification` field containing the complete public certificate.
`--certificate <path>` both implies verification and atomically writes the same
JSON value to that path. A requested verification status other than `passed`
throws before either the redline or certificate is published.

The checker path remains configurable through
`SAFE_DOCX_LEAN_XML_CHECKER`. This avoids exposing an installation-specific
path flag as a stable CLI contract while retaining the library option for
programmatic callers.

### Timeout

The default is 10,000 ms in both documentation and implementation. The CLI does
not expose a longer timeout in this slice. Library callers may continue to
override `timeoutMs`.

### ZIP directory placeholders

The trusted binary index may retain a directory entry only when all of the
following are true:

- the safe normalized name ends in `/`;
- central attributes identify a directory consistently;
- method is stored (`0`);
- CRC-32, compressed size, and expanded size are all zero;
- the matching local header has identical metadata and no payload;
- all existing filename, extra-field, bounds, overlap, and flag checks pass.

Directories count toward entry and central-directory limits. Exact part
selection remains regular-file-only, so a relationship cannot select a
directory as XML evidence. Symlinks, special files, non-empty directories, and
ambiguous central/local identities remain `not_run`.

### Performance evidence

A focused real-document test uses the committed public NVCA-derived fixture,
requires a passing protocol-v7 certificate, and asserts total comparison plus
verification time is no more than 10 seconds. The gate does not compile Lean
inside the timed region and skips only when the checker is not present outside
the Lean-enabled job.

## Risks / Trade-offs

- Wall-clock gates can be noisy. The 10-second ceiling is materially above the
  observed healthy path and the test records elapsed time in its failure.
- Fail-closed publication means a verifier timeout produces no redline. This is
  intentional because `--verify` is an assurance request, not best effort.
- Accepting directory placeholders expands the parser subset. The exact inert
  profile and typed-semantics bridge prevent this from becoming arbitrary
  special-entry support.

## Migration Plan

The default CLI remains unchanged. Users opt in with `--verify`; automation that
needs a durable artifact adds `--certificate <path>`.

