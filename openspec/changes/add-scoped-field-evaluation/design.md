## Context

The repository currently has three field-related mechanisms:

1. strict begin/separate/end structural validation;
2. opaque preservation of unchanged PAGE, NUMPAGES, REF, and PAGEREF ranges;
3. TOC-specific PAGEREF cache suppression during comparison.

Those mechanisms parse field instructions independently and intentionally do
not evaluate them. Word fields divide into two important classes. REF can be
deterministic when it requests the bookmarked text projection and the bookmark
range is present in the same admitted story. PAGE, NUMPAGES, PAGEREF, and TOC
page numbers depend on pagination and rendering that Safe Docx does not
implement.

## Goals / Non-Goals

- Goals: centralize instruction tokenization and classification.
- Goals: evaluate simple bookmark-text REF fields in the main document.
- Goals: preserve result-run formatting while replacing cached text.
- Goals: mark layout-dependent fields dirty rather than inventing values.
- Goals: produce stable, structured diagnostics for every encountered outer
  field.
- Goals: fail before mutation on malformed field topology or ambiguous
  bookmark identity.
- Non-goals: PAGE, NUMPAGES, PAGEREF, or TOC pagination.
- Non-goals: REF switches whose output is not the bookmarked text projection,
  including numbering/position projections.
- Non-goals: nested, cross-paragraph, locked, pre-tracked, or simple
  `w:fldSimple` evaluation in the first version.
- Non-goals: ancillary-story mutation in the first version.
- Non-goals: mandatory Word or LibreOffice runtime dependencies.

## Decisions

### One shared instruction classifier

A new docx-core module tokenizes instruction text with quoted arguments and
backslash switches retained. It returns a discriminated record with:

- normalized instruction kind;
- ordered tokens;
- bookmark target when applicable;
- known switches and their arguments;
- evaluation class: `deterministic`, `layout_dependent`, or `unsupported`;
- a stable unsupported reason when the admitted subset is exceeded.

REF is deterministic only when it has exactly one bookmark argument and only
the `\h` or `\* MERGEFORMAT` presentation switches. `\d`, `\n`, `\p`, `\r`,
`\t`, and unknown switches remain unsupported because they change the output
projection or require numbering/position semantics. Quoted bookmark targets
are admitted. PAGE, NUMPAGES, PAGEREF, and TOC are layout-dependent regardless
of switches. SEQ is classified but not evaluated until ordering, restart, and
switch semantics receive their own requirement.

### Refresh is transactional and main-story-only

`refreshDocumentFieldsXml(documentXml, options)` parses and validates the
complete main story before mutation, and `refreshDocxFields(buffer, options)`
applies it to `word/document.xml`. A malformed complex-field stack throws a
typed error with no returned XML. The first implementation evaluates only
outer REF fields whose begin and end occur in one paragraph and which are not
owned by revision markup. Cross-paragraph layout fields such as TOC remain
eligible for dirty marking.

Every field receives a structural locator consisting of paragraph ordinal and
field ordinal. Results are returned in document order.

### Bookmark resolution is paired by ID and bounded by markers

REF targets resolve through exactly one `w:bookmarkStart` with the requested
name, exactly one start with its `w:id`, and exactly one matching
`w:bookmarkEnd`. Duplicate names or IDs, missing ends, reversed ranges, and
self-reference are unsupported and do not mutate that field.

Visible bookmarked text is collected strictly between the paired markers in
document order. Field instructions are excluded and cached field results are
included. Tabs become `\t`; line breaks become `\n`; paragraph boundaries
become `\n`. The first version rejects a target range containing tracked
revisions or the REF field being evaluated.

### Cached-result replacement preserves the first result run

Evaluation requires at least one direct result `w:t` payload between the
field's separator and end. The first result text node receives the refreshed
text and retains its run and run properties. Subsequent result text nodes are
emptied without deleting their runs or unrelated child elements. `xml:space`
is set to `preserve` only when the refreshed value has leading or trailing
whitespace and removed otherwise.

An identical result is reported as `unchanged` and produces byte-identical
input XML by returning the original string without serialization.

### Layout-dependent fields are dirtied, not evaluated

When `markLayoutDependentDirty` is true, the begin `w:fldChar` of PAGE,
NUMPAGES, PAGEREF, and TOC receives `w:dirty="true"`. Cached results remain
unchanged. Already-dirty fields are reported as `unchanged`. This is an
explicit request for a capable host to refresh the result; it is not a claim
that Safe Docx computed or verified the cache.

### Comparison reuses classification without broadening suppression

The existing TOC PAGEREF suppression rule remains intentionally narrow.
`pagerefComparisonIdentity` delegates instruction recognition and normalization
to the shared classifier. This removes parser drift but does not suppress
ordinary PAGEREF or REF cached changes outside the existing TOC rule.

## Risks / Trade-offs

- Serializing a mutated XML document can normalize lexical details outside the
  changed field. The implementation returns the original XML when no mutation
  occurs and tests semantic preservation of unaffected structure.
- Bookmark ranges can contain complex content. Rejecting revisions,
  self-reference, and unsupported renderable objects understates what Word can
  evaluate but avoids silently producing incomplete cached text.
- Marking fields dirty can cause a host update prompt. It is opt-in and reported
  per field.

## Migration Plan

Additive only. Existing comparison and generation behavior is unchanged unless
a caller invokes the refresh primitive. Comparison adopts the shared PAGEREF
classifier with pinned behavior tests.
