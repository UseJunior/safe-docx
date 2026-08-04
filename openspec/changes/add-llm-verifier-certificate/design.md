## Context

`DocumentIntegrityCertificate` is the canonical public v1 evidence object. Its
repetition is useful for direct inspection and backwards compatibility, but it
is not a token-efficient reasoning protocol. The CLI is the correct projection
boundary because the Lean checker and comparison library must continue to
produce the canonical certificate unchanged.

## Goals / Non-Goals

- Goals:
  - provide an explicit LLM-oriented JSON contract;
  - preserve every failure, anomaly, exclusion, identity, and hash needed to
    understand the verification result;
  - deduplicate repeated claims and uniform invariant outcomes;
  - make schema, public certificate, and checker protocol versions unambiguous;
  - keep output deterministic and fail closed.
- Non-Goals:
  - alter Lean proofs, checker protocols, or the public v1 certificate;
  - make `llm` the default in this change;
  - generate HTML or other human-facing presentation;
  - interpret exclusions as failures or verified claims.

## Decisions

### Projection boundary and compatibility

The comparison library continues to return `DocumentIntegrityCertificate`.
The CLI projects it only after verification has passed. `--certificate-format`
accepts `full` or `llm`; omission means `full`. Supplying the flag implies
verification, just like `--certificate`.

For `full`, the CLI JSON `verification` field and certificate file retain the
existing canonical object. For `llm`, both contain the same normalized
projection. The result also names `certificate_format` when verification is
present so a caller can select the correct schema without inference.

### Versioned normalized schema

The LLM projection starts with:

- `schemaId: "safe-docx.llm-verification-certificate"`;
- `schemaVersion: 1`;
- `verdict`;
- explicit verifier metadata containing public certificate protocol v1 and the
  internal checker protocol separately.

The canonical certificate remains the source of truth. The projection carries
its package/XML hashes, reconstruction mode, reason, exclusions, story
identities, token counts, and every structured anomaly.

### Stable invariants and grouped results

Six stable invariant IDs replace repeated prose claims. Their definitions occur
once in deterministic order. Each evaluated fixed or relationship story is
represented once in a story registry. Stories sharing the same passed, failed,
and not-evaluated invariant vectors are grouped into one result set that lists
their story IDs. This preserves the complete evaluation relation without
repeating claims or identical status maps.

Note and comment evidence has its own compact story-status collection because
those checks are inventory/topology protocols rather than the six generic
story invariants.

### Failures and exclusions

No compaction rule may discard non-passing evidence. Presence mismatches,
fixed-story failures, relationship-selection failures, note failures, and
comment failures are copied into separately named anomaly arrays. Exclusions
remain a top-level scope property. An LLM can therefore distinguish failure,
unavailability, non-evaluation, and out-of-scope behavior without parsing prose.

## Risks / Trade-offs

- The projection duplicates a public contract. Versioning plus fixture-level
  exact tests prevent silent drift.
- Hard-coded invariant IDs require deliberate schema evolution if the canonical
  certificate adds a new generic check. Exhaustiveness helpers and tests make
  omission fail during development.
- Keeping `full` as default limits immediate token savings but avoids breaking
  existing automation.

## Migration Plan

Existing callers require no change. LLM agents add
`--certificate-format llm`, with or without `--certificate <path>`. A future
default change, if desired, requires a separate compatibility decision.
