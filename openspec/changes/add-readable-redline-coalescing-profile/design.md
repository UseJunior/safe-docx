## Context

The current Markdoc compiler derives token-minimal replacement hunks from an
exact token LCS. That fixed the dense-rewrite common-token losses tracked by
#846. It also means an edited phrase can serialize as several small alternating
deletion/insertion ranges separated by ordinary spaces. Historical issue #42
and PR #43 established that reviewers often understand the same change better
as one deleted phrase followed by one inserted phrase, even though doing so
places the unchanged bridge spaces inside both revision sides.

The independent release verifier currently exposes one
`authored-zero-loss` policy. Calling a readability-grouped artifact
"minimal" or silently weakening that policy would make the certificate
misleading.

## Goals / Non-Goals

- Goals:
  - restore bounded whitespace-bridged replacement grouping as a supported,
    deterministic Markdoc compile option;
  - preserve exact accept/reject semantics and common lexical/punctuation
    content;
  - distinguish token minimality from readability-aware coalescing in evidence;
  - keep the independent verifier capable of rejecting over-broad grouping.
- Non-goals:
  - arbitrary fuzzy diffing or a claim to reproduce Microsoft Word's choices;
  - swallowing common words or punctuation for visual convenience;
  - bridging tabs, line breaks, fields, bookmarks, comments, hyperlinks,
    property changes, paragraph boundaries, table boundaries, or incompatible
    revision provenance;
  - changing the dense-rewrite LCS or weakening issue #846's lexical and
    punctuation guarantees.

## Decisions

### One resolved policy on every compile path

The policy values are `token-minimal` and `readable-whitespace`. Canonical
Markdoc may declare `revision-grouping="readable-whitespace"` on its singleton
`compilation` tag. The TypeScript compile options and CLI
`--revision-grouping` flag expose the same closed value set. A complete runtime
override wins over the Markdoc value; absent either, `token-minimal` applies.
Unknown or duplicate values fail before mutation. The certificate records the
resolved value and whether it came from API, CLI, Markdoc, or the default.

An explicit opt-in avoids silently changing byte shape for existing callers and
makes a non-minimality allowance reviewable in source control.

### Readable grouping is a bounded post-alignment transform

The compiler first computes the same exact-token LCS and minimal text hunks it
does today. In `readable-whitespace` mode only, a later transform may combine a
chain of at least two replacement fragments when every separating common token
is a nonempty run of ordinary U+0020 spaces and the fragments can be emitted as
one deletion range followed by one insertion range with compatible revision
identity and formatting treatment.

Each bridged space is copied to both revision sides. Reject therefore restores
the source phrase and Accept yields the revised phrase. This is intentionally
non-minimal in token accounting, but it is projection-neutral and makes the
phrase read as a unit. The transform must not bridge lexical tokens,
punctuation, non-space whitespace, or any protected OOXML boundary. It must not
turn a lone replacement into a larger range merely to consume adjacent spaces.

### Verification names the trade-off instead of hiding it

The verifier accepts an explicit policy:

- `authored-zero-loss`: every checker-owned common token must remain ordinary;
- `authored-readable-whitespace-v1`: lexical, punctuation, and structural loss
  remains zero, while a plain-space token may be classified as an allowed
  readability bridge only when finished tracked markup proves it occurs on
  both sides of one eligible paired replacement group and both semantic
  projections are exact.

Evidence reports mandatory losses separately from allowed coalesced whitespace,
including per-paragraph diagnostics and totals. An unexplained lost space, a
space absorbed under the wrong policy, or any lost lexical/punctuation/
structural token fails the gate. A certificate for the readable policy must not
claim 100-percent token minimality; it reports readability coalescing explicitly.

### Tests judge both usefulness and bounds

Positive tests use synthetic multi-word replacements that are fragmented in
`token-minimal` mode and become one readable deletion/insertion pair in
`readable-whitespace` mode. Negative controls cover punctuation, tabs/newlines,
single fragments, mismatched formatting/provenance, repeated tokens, and
structural boundaries. Every positive fixture checks exact accept/reject text,
the physical revision shape, and policy-aware independent-verifier evidence.
The existing #846 dense-rewrite fixtures continue to require zero lexical and
punctuation loss in both modes.

## Risks / Trade-offs

- Readability is partly subjective. The narrow space-only chain rule makes the
  behavior deterministic and independently falsifiable.
- Cloning spaces increases revised-token counts and can alter wrapper/run
  topology. Exact projection tests and OOXML schema/conformance checks guard the
  result.
- Two verifier policies could be confused by callers. Closed names,
  fail-closed mismatches, and certificate provenance prevent silent fallback.

## Migration Plan

No migration is required. Existing Markdoc and API calls resolve to
`token-minimal`. Callers that prefer phrase-level review opt into
`readable-whitespace` declaratively or through a complete runtime override.

## Open Questions

- None. Punctuation remains mandatory common content; this proposal authorizes
  only preservable plain-space bridging.

