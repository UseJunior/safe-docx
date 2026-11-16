# `@usejunior/docx-compare`

`@usejunior/docx-compare` compares two DOCX buffers and returns a DOCX carrying tracked changes.

```ts
import { compareDocuments } from '@usejunior/docx-compare';

const result = await compareDocuments(original, revised, {
  author: 'Contract review',
  date: new Date('2026-08-17T00:00:00.000Z'),
  ignoreFormatting: false,
  detectMoves: true,
  revisionGrouping: 'readable-semantic', // the default
});
```

## Revision grouping

`revisionGrouping` defaults to `'readable-semantic'` (exported as
`DEFAULT_COMPARE_REVISION_GROUPING`): each rewritten passage reads as one
deletion followed by one insertion. `'token-minimal'` emits the smallest
word-level deletion/insertion set, which alternates word by word in a heavily
rewritten paragraph. Accept All and Reject All give the same documents under
both. The library, the `docx-comparison` CLI, the `safe-docx compare` CLI and
the MCP `compare_documents` tool share this default. Before #1494 the library
and the `docx-comparison` CLI defaulted to `'token-minimal'`; pass
`revisionGrouping: 'token-minimal'` to keep that output.

## Command line

```sh
docx-comparison original.docx revised.docx [output.docx] \
  [--author "Name"] [--grouping readable-semantic|token-minimal] [--no-moves] [--no-date]
```

`--grouping` defaults to `readable-semantic`; an unknown value fails with the
list of accepted values. `--no-moves` turns move detection off (on by default).
`--no-date` omits `w:date` from the revisions the comparison creates (by
default they carry the current time). `safe-docx compare` accepts the same flags.

## Revision dates

`date` sets the `w:date` on every revision the comparison creates. Omitted, it
is the current time; `date: null` writes no `w:date` at all, which ECMA-376
Part 1 §17.13.5.14 / §17.13.5.18 allow ("no date information shall be
associated"). Revisions already present in either input keep their own dates.
The MCP `compare_documents` tool takes `revision_date: 'now' | 'none' | <ISO 8601>`.

## Package provenance

The output package always starts from the revised DOCX archive. Safe DOCX adds tagged revision markup to that package while preserving revised-side package metadata and parts, including relationship and content-type topology, section properties, headers and footers, and revision-session identifiers.

Publication fails closed with `TaggedPublicationSafetyError` when the tagged result cannot satisfy its safety gates. The public API does not silently switch to a legacy reconstruction result.

Auxiliary ID collision repair keeps each part's parsed DOM private and exposes
attribute values for allocation scans. Only an attribute change marks a part
dirty. A flush clears that flag after the synchronous archive update succeeds;
serialization or write errors propagate and leave the pending edits retryable.
Clean flushes do not rewrite the part, and later attribute changes make it dirty
again.

## Breaking migration

The public `CompareOptions` surface no longer accepts `engine`, `comparisonStrategy`, `reconstructionMode`, `premergeRuns`, or `maxWordRefinementChangeRanges`. JavaScript callers that pass one of those retired keys receive a `TypeError`; TypeScript callers receive a type error.

Callers that previously selected `reconstructionMode: 'rebuild'` received an original-based package. After upgrading, expect revised-side package provenance instead: revised rsids, `sectPr`, headers and footers, content types, relationships, and other package parts are authoritative. If downstream code compared package metadata or assumed original-side identities, update those assertions to the revised document. Accepting all revisions should reproduce the revised text projection; rejecting all revisions should reproduce the original text projection.

`CompareResult` now reports `engine: 'tagged-tree'`. Remove caller branches and
telemetry for `comparisonStrategyRequested`, `comparisonStrategyUsed`,
`comparisonStrategyFallbackReason`, `taggedTreeFallbackDiagnostics`,
`reconstructionModeRequested`, `reconstructionModeUsed`, `fallbackReason`,
`fallbackDiagnostics`, `ancillaryFallbackDiagnostics`, `rebuildSafetyDiagnostics`,
and `inplaceSuccessDiagnostics`; those fields described implementations and
fallbacks that no longer exist. Publication failures are thrown as typed errors,
including `TaggedPublicationSafetyError`, rather than returned as fallback metadata.
JavaScript reads of a retired result field now return `undefined`.
When `unrepresentedChanges` has no value, the public result now omits that
optional own property instead of returning it with the value `undefined`.

`AncillaryStorySafetyError` exposes its current `issues` only. Remove callers of
the deleted `attempts` property and `AncillaryStorySafetyAttempt` type; the sole
tagged publisher does not make reconstruction-mode attempts.
