## Context

The current Markdoc compiler derives token-minimal replacement hunks from an
exact token LCS. That fixed the dense-rewrite common-token losses tracked by
#846. It also means an edited phrase can serialize as several small alternating
deletion/insertion ranges separated by ordinary spaces. Historical issue #42
and PR #43 established that reviewers often understand the same change better
as one deleted phrase followed by one inserted phrase, even though doing so
places the unchanged bridge spaces inside both revision sides.

The independent release verifier exposes one `authored-zero-loss` policy. Its
obligation model deliberately does not charge an inter-word space whose
adjacent words are both replaced. Correct bridge-space grouping therefore
already passes the gate; the missing verifier feature is disclosure of the
chosen emitted shape, not a second pass/fail policy.

## Goals / Non-Goals

- Goals:
  - add bounded whitespace-bridged replacement grouping as a supported,
    deterministic Markdoc compile option;
  - preserve exact accept/reject semantics and common lexical/punctuation
    content;
  - disclose readability-aware coalescing separately from required token loss;
  - keep the independent verifier capable of rejecting over-broad grouping.
- Non-goals:
  - arbitrary fuzzy diffing or a claim to reproduce Microsoft Word's choices;
  - swallowing common words or punctuation for visual convenience;
  - bridging tabs, line breaks, fields, bookmarks, comments, hyperlinks,
    property changes, paragraph boundaries, table boundaries, or incompatible
    formatting;
  - changing the dense-rewrite LCS or weakening issue #846's lexical and
    punctuation guarantees;
  - token-specific punctuation allowances, which remain a separate proposal.

## Decisions

### One resolved compile policy on every path

The compile policy values are `token-minimal` and `readable-whitespace`.
Canonical Markdoc may declare `revision-grouping="readable-whitespace"` on its
singleton `compilation` tag. The TypeScript compile options and CLI
`--revision-grouping` flag expose the same closed value set. An explicit runtime
value wins over the Markdoc value; absent either, `token-minimal` applies.
Unknown or duplicate values fail before mutation. The CLI passes explicit
`cli` provenance through the compile API; direct callers use `api`. The
compilation certificate records
`revisionGrouping: { policy, source, coalescedSpaceTokens, groupedChains }`.

An explicit opt-in avoids silently changing byte shape for existing callers and
makes a non-minimal emitted-revision choice reviewable in source control.

### Readable grouping is a bounded post-validation transform

The compiler first computes and validates the same exact-token LCS and minimal
`TextHunk[]` it does today. A replacement fragment is a hunk with
`start < end` and a nonempty `replacement`; pure insertions and pure deletions
terminate a chain. In `readable-whitespace` mode only, a post-validation
transform may combine a chain of at least two replacement fragments when every
intervening source and revised slice is the same nonempty run of ordinary
U+0020 spaces. Grouping cannot turn an otherwise invalid operation valid: run
format, retained-format, and inline-format scopes are always validated against
the token-minimal hunk set.

A chain is eligible only when the merged source range and each constituent
fragment resolve through `templateForHunk` to the same single run-property
signature (or to the same explicit `format-source`). If not, the compiler emits
the original hunks rather than throwing a new readability-mode error. Grouping
is intra-operation and intra-paragraph, including selected header/footer story
paragraphs; it never combines operations. Existing-revision admission remains
the defensive provenance guard.

Each bridged space is copied to both revision sides. Reject therefore restores
the source phrase and Accept yields the revised phrase. This is intentionally
non-minimal in emitted revision text, but it is projection-neutral and makes
the phrase read as a unit. The transform must not bridge lexical tokens,
punctuation, non-space whitespace, or any protected OOXML boundary. It must not
turn a lone replacement into a larger range merely to consume adjacent spaces.

### Verification discloses the trade-off without inventing a second gate

The existing `authored-zero-loss` gate remains authoritative. Its anchored
common-token model already excludes a bridge space when neither adjacent word
is matched, while still charging anchored edge spaces and common lexical,
punctuation, and structural tokens. The verifier independently inspects finished
tracked markup and reports U+0020-only tokens present inside both sides of one
adjacent content-bearing deletion/insertion group. This
`coalescedWhitespace` evidence is disclosure only: it does not alter
`lostTokensByClass` or the gate verdict.

Token-minimal output reports zero grouped chains and zero coalesced spaces.
Correct readable output still reports zero required loss but a nonzero
disclosure count. Grouping that swallows an anchored edge space, lexical token,
punctuation, or structural whitespace continues to fail the existing gate.
Evidence remains derived solely from finished markup and the independent
operands, never compiler IR.

### Tests judge both usefulness and bounds

Positive tests use synthetic multi-word replacements that are fragmented in
`token-minimal` mode and become one readable deletion/insertion pair in
`readable-whitespace` mode. Negative controls cover punctuation, tabs/newlines,
pure insertions/deletions, single fragments, mismatched formatting, repeated
tokens, existing revisions, and structural boundaries. Every positive fixture
checks exact accept/reject text and semantic formatting, physical revision
shape, attribution-range consistency, and independent-verifier disclosure
evidence. The existing #846 dense-rewrite fixtures continue to require zero
lexical and punctuation loss in both modes.

## Risks / Trade-offs

- Readability is partly subjective. The narrow space-only chain rule makes the
  behavior deterministic and independently falsifiable.
- Cloning spaces increases revised-token counts and can alter wrapper/run
  topology. Exact text and formatting projection tests plus OOXML schema checks
  guard the result.
- Disclosure could be mistaken for a weakened gate. Separate fields and stable
  `authored-zero-loss` naming make clear that required token loss is unchanged.

## Migration Plan

No migration is required. Existing Markdoc and API calls resolve to
`token-minimal`. Callers that prefer phrase-level review opt into
`readable-whitespace` declaratively or through an explicit runtime value.

## Open Questions

- Deferred: the token-specific punctuation exception mentioned under #998. It
  is rejected from this change because #846 makes common punctuation mandatory
  and the verifier correctly reports it as punctuation loss. Revisit only
  through a separate, explicit, independently disclosed allowance.

## Alternatives Considered

- Honor authored inline `{% del %}`/`{% ins %}` spans directly. That would give
  precise control when spans exist, but ordinary `{% before %}`/`{% after %}`
  rewrites carry no such grouping, and compile currently re-minimizes their
  projections. Automatic bounded space bridging covers both authoring forms
  with one deterministic rule; explicit-span authority can be proposed later.

