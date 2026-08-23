# `@usejunior/docx-compare`

`@usejunior/docx-compare` compares two DOCX buffers and returns a DOCX carrying tracked changes.

```ts
import { compareDocuments } from '@usejunior/docx-compare';

const result = await compareDocuments(original, revised, {
  author: 'Contract review',
  date: new Date('2026-08-17T00:00:00.000Z'),
  ignoreFormatting: false,
  detectMoves: true,
});
```

## Package provenance

The output package always starts from the revised DOCX archive. Safe DOCX adds tagged revision markup to that package while preserving revised-side package metadata and parts, including relationship and content-type topology, section properties, headers and footers, and revision-session identifiers.

Publication fails closed with `TaggedPublicationSafetyError` when the tagged result cannot satisfy its safety gates. The public API does not silently switch to a legacy reconstruction result.

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

`AncillaryStorySafetyError` exposes its current `issues` only. Remove callers of
the deleted `attempts` property and `AncillaryStorySafetyAttempt` type; the sole
tagged publisher does not make reconstruction-mode attempts.
