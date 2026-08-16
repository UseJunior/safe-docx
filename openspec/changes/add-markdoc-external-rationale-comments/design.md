## Context

`Rationale.category` is currently an optional free-form string and rationales are passive IR metadata. `compileMarkdoc` accepts only tracked-revision author/date options. The existing comment primitive accepts author, optional initials, and a revision context carrying the date, while the independent release verifier already requires at least one native comment and compares comment-ID multiplicities when `requireNativeComments` is true.

The compiler must not infer whether omitted or arbitrary rationale metadata is safe to disclose. Comment materialization must also preserve the clean and original document projections that Markdoc certification protects.

## Goals / Non-Goals

### Goals

- Materialize explicitly external-facing rationales as native root Word comments.
- Make selection, identity, timestamping, anchoring, and output deterministic.
- Fail closed when selected rationale cannot be attributed to one exact operation range.
- Preserve text and formatting projections.

### Non-Goals

- Inferring shareability from rationale text or an absent category.
- Publishing internal, correction, or unknown-category rationales.
- Supporting threaded rationale replies or resolving comment conversations.
- Changing rationale text into operative document text.
- Implementing product code in this proposal change.

## Decisions

### Selection uses one exact reserved category

Only a rationale whose category is exactly `external-facing` is selected. Category matching is case-sensitive and does not trim, normalize, alias, classify, or infer. Missing and all other category values remain valid passive metadata but are excluded.

This adds a reserved semantic value without narrowing the existing free-form TypeScript field and therefore avoids breaking existing IR. A boolean was rejected because it would create two competing classification surfaces. A caller predicate or arbitrary allowlist was rejected because serialized CLI/API behavior would be harder to reproduce and could accidentally authorize an internal category.

At most one selected rationale may target an operation. Duplicate selected rationales for the same operation fail before mutation rather than merging text or choosing by order.

### Materialization is opt-in and comment identity is separate

The existing compile options object gains a nested rationale-comment option. Enabling it requires non-empty `author` and `initials` strings plus a valid caller-supplied `date`. These values are used verbatim for every materialized rationale comment.

The nested identity does not fall back to the existing top-level tracked-revision `author` or `date`. Revision authorship and external-comment authorship are different assertions; requiring both explicitly prevents accidental attribution and keeps deterministic dates independent of the process clock. Omitting the nested option preserves current output with zero rationale comments.

The implementation must always pass all three values to the native-comment primitive so its initials and process-clock fallbacks are unreachable on this path.

### Anchors are derived after tracked changes exist

Each selected rationale produces exactly one root comment record and one contiguous comment range. The compiler retains enough operation attribution through comparison to identify the tracked nodes created for that operation; it does not rediscover ownership by searching for rationale text or by guessing from neighboring edits.

- Insertion: anchor exactly the inserted text emitted for the operation.
- Deletion: anchor exactly the deleted text retained in the tracked document.
- Replacement or inline edit with inserted text: anchor the inserted replacement text, excluding unchanged context and deleted predecessor text.
- Replacement or inline edit with no inserted text: use the deletion rule.
- Multi-paragraph edit: use one range beginning at the first attributable changed character and ending at the last attributable changed character, spanning only paragraphs participating in that operation. Unchanged text between those endpoints is included only when a single contiguous Word comment range cannot exclude it; unrelated leading/trailing clause text and adjacent operations are never included.

If attribution is absent, overlaps another operation ambiguously, or yields no anchorable tracked content, compilation fails before returning output. A single rationale is not duplicated into paragraph-by-paragraph comments.

### Comments are projection-neutral annotations

Comment range markers, references, and comment parts are annotations only. Certification continues to compare accept-all with the generated clean document and reject-all with the pinned source, including semantic formatting checks. Adding comments must not change any of those projections. Comment text is never included in operative-text projection calculations.

Accept-all and reject-all processing must preserve comment records, range starts, range ends, and references as a balanced set. When tracked anchor text does not survive a projection, the range collapses to one deterministic zero-width boundary at the edit location; the rationale remains available instead of being deleted with the revision it explains. Zero-width root-comment ranges are already an admitted native-comment shape in this repository.

The independent release verifier's multiplicity, uniqueness, and minimum-count checks remain authoritative for structural integrity of the tracked release artifact. They do not prove that a projected zero-width range collapsed at the correct edit boundary. Package-level accept/reject tests must verify that location semantic separately for insertions, deletions, replacements, and multi-paragraph ranges; this change does not describe the existing verifier as covering that stronger property.

### Independent verification remains the release gate

When the caller requests `requireNativeComments: true`, the existing release verifier must observe a positive valid comment count. If compilation was enabled but no rationale was selected or materialized, the verifier's minimum-one rule fails closed. Its existing multiplicity and uniqueness checks remain authoritative for tracked-artifact structure; projection-collapse location is verified by the compiler package's accept/reject tests.

### Public tests use synthetic content only

All tests use synthetic DOCX fixtures and invented rationale text. Private matter artifacts, private rationale text, and private corpus extracts are prohibited from repository fixtures, snapshots, logs, and failure messages.

## Risks / Trade-offs

- Deleted-text and cross-paragraph comment ranges require extending or supplementing the existing paragraph-scoped primitive: its current visible-text offsets cannot address text inside tracked deletions or span paragraphs. The implementation must reuse comment-part bootstrapping and ID allocation rather than creating a second comment subsystem.
- Exact operation attribution may require compiler-internal metadata through comparison. Failing closed is preferable to anchoring a rationale to nearby but unrelated text.
- The exact category token is intentionally strict. Typos remain unselected and become visible when native comments are required because the release verifier reports zero comments.

## Migration Plan

No migration is required. Existing Markdoc remains valid and existing compile calls retain current output. Callers opt in by categorizing a rationale exactly `external-facing`, supplying deterministic comment identity, and enabling rationale-comment materialization.

## Open Questions

None. Implementation begins only after this proposal is approved.
