## Context

Brownfield legal drafting begins with a DOCX whose invisible structure matters.
The original package is the lossless formatting substrate; a readable text file
should record the deliberate divergence without pretending to replace every
OOXML part. Safe DOCX already owns stable paragraph identity, transactional
editing, tracked changes, comparison, and accept/reject projections. Markdoc
already provides an extensible Markdown AST and schema validation.

The canonical archive is therefore a pair:

```text
source.docx + document.mdoc
```

Generated clean/redline DOCX files, inspection views, verification reports, and
training records are reproducible outputs.

## Goals / Non-Goals

### Goals

- Make a complete source document and its edits readable in one compact file.
- Represent changed language as familiar clean before and after legal states.
- Preserve the source DOCX as the authority for inherited formatting.
- Produce exact clean and tracked-change outputs from one validated AST.
- Retain rationale next to the language it explains.
- Preserve enough provenance to reconstruct source, revised, and contrastive
  training projections.
- Keep syntax general to document editing rather than legal-document concepts.

### Non-Goals for v1

- Replace DOCX as the lossless archive.
- Store raw OOXML inside canonical Markdoc.
- Encode a complete negotiation event store inside the final document.
- Implement tables, headers, footnotes, fields, hyperlinks, moves, numbering
  changes, section changes, or existing tracked-change sources in v1.
- De-identify client records or decide whether they may enter an SFT corpus.
- Add domain tags such as party, approval, voting member, signature, or clause
  type.

## Decisions

### 1. Ownership: a new Safe DOCX package

`@usejunior/docx-markdoc` owns schema, import, IR, replay, and verification.
`legal-explainer` is a downstream consumer. This keeps brownfield invariants
beside the DOCX engine and prevents a website package from becoming the trust
boundary for client documents.

### 2. TypeScript implementation

The package uses the official Markdoc parser directly and Safe DOCX's native
TypeScript APIs. There is one AST and one schema; no regex or second parser may
interpret executable tags. The validated AST compiles to a serializable edit IR
so another runtime may consume it later without parsing Markdoc.

### 3. Compact canonical scaffold

Every body paragraph appears in order with stable bookmark ID, source text
fingerprint, and inherited paragraph style. Unchanged paragraphs remain useful
context and are build-verified against the pinned source. Canonical Markdoc does
not expose Word run fragmentation.

Illustrative unchanged paragraph:

```markdoc
{% para id="_bk_..." fingerprint="..." style="Normal" %}
ARTICLE III - Membership
{% /para %}
```

### 4. Clean before and after states are canonical

Changed paragraphs use the same clean-state convention lawyers use when
negotiating documents:

```markdoc
{% change id="_bk_..." fingerprint="..." style="Normal" operation="charter-term" format="inherit-source-paragraph" %}
{% before %}In accordance with its Certificate of Incorporation, the Corporation...{% /before %}
{% after %}In accordance with its Charter, the Corporation...{% /after %}
{% /change %}
```

The before state is checked exactly against the hash-verified source; the after
state produces the clean document. Safe DOCX comparison deterministically
derives the redline, and mandatory accept/reject verification prevents an
unfaithful alignment from being published. Inline `ins`/`del` remains a
generated review projection, not editable canonical state. This deliberately
accepts local duplication for changed text in exchange for familiar language,
better model comprehension, and a negotiation record whose two legal states are
obvious without mentally interpreting revision markup.

### 5. Explicit formatting policy

Each block operation declares one of a closed set of formatting policies. v1
admits `inherit-source-paragraph` for replacements/deletions and
`inherit-anchor-paragraph` or an existing paragraph style ID for insertions.
Inline edits inherit surrounding/source run properties under a deterministic
boundary rule. If mixed formatting makes that rule ambiguous, compilation
fails and requests a selective detail view; it never guesses.

### 6. Detail is a generated view

`inspect` may expand one anchor, an edit set, or the full document into
normalized paragraph/run properties. Adjacent runs with identical semantic
formatting are coalesced. Hashes retain a link to underlying `pPr`/`rPr` XML.
The detail view is disposable and cannot be compiled as a second source of
truth unless explicitly round-tripped back into canonical operations.

### 7. Negotiation history belongs to version control plus a revision manifest

The current `.mdoc` is refined in place. Git history retains superseded text.
An optional JSONL revision manifest links a document commit/state to an input
reference, actor class, and review status. The final Markdoc does not accumulate
all abandoned variants as permanent markup.

The package exports edit pairs between supplied Markdoc revisions or between a
source and one revision. It does not infer causation: instruction fulfillment,
human correction, or omission labels must come from caller-supplied provenance.

### 8. Verification is mandatory, not advisory

Compilation produces a verification certificate. Success requires:

- source package hash match;
- complete and ordered scaffold match;
- every fingerprint and original text projection match;
- every operation applies exactly once;
- reject-all redline projection equals source under the declared comparison;
- accept-all redline projection equals clean output;
- unchanged admitted package parts remain unchanged;
- no unsupported formatting fallback occurs.

## Risks / Trade-offs

- **Tag noise:** Inline Markdoc may become hard to read for dense rewrites.
  Whole-source-unit operations are the escape hatch.
- **False losslessness:** A readable projection can conceal unsupported OOXML.
  Source hashing, explicit scope reporting, and fail-closed compilation prevent
  the projection from claiming completeness it does not have.
- **Anchor churn:** Bookmark IDs may be absent on first import. Import writes a
  separate anchored source copy and pins that copy; it never silently mutates
  the caller's original.
- **Run ambiguity:** Word fragmentation is not semantic. v1 coalesces equivalent
  formatting for inspection but uses source nodes for replay.
- **Training misuse:** Delivered language is not automatically reusable or
  authorized. The exporter carries provenance/status fields but downstream
  policy decides eligibility and de-identification.

## Migration Plan

1. Land the package and synthetic fixtures without changing existing tools.
2. Recreate the completed amendment and bylaws experiments as de-identified
   conformance fixtures.
3. Dogfood against completed matters while the existing Python builds remain
   the independent oracle.
4. Add downstream `legal-explainer` integration only after v1 round-trip gates
   pass across a varied corpus.
5. Consider MCP/CLI promotion after authoring ergonomics are demonstrated on at
   least three replay matters.

## Open Questions

- Whether the canonical full scaffold should store source text literally or a
  generated include/reference that editors materialize on open. v1 chooses
  literal text because review context and Git search are primary goals.
- Whether rationale binds to the following block, an explicit operation ID, or
  both. v1 should require an explicit stable operation ID in IR even if the
  surface syntax permits adjacency.
- Whether revision manifests belong in this package or a separate knowledge-
  management package after the first SFT adapter is designed.

## Implementation findings

- **2026-08-12 — mixed formatting was refused at paragraph granularity:** The
  first replay rejected every change to a paragraph as soon as it saw two
  direct run-property signatures, even when each changed phrase was wholly
  inside one formatting class. That safety rule prevented ordinary founding-
  member and witness-line cleanup. Replay now aligns the clean before/after
  states into bounded minimal source ranges, leaves unchanged runs in place,
  and gives new text the unique formatting class of its deleted span. A true
  boundary ambiguity still fails closed; `format-source` can name one unique,
  single-format source substring. Synthetic mixed-emphasis replacement and
  mixed-format whole-paragraph deletion regressions prove clean formatting and
  accept/reject round trips.

- **2026-08-12 — full-workspace preflight is independently blocked:** The new
  package build, lint, 10 focused tests, spec coverage, conformance checks, and
  strict OpenSpec validation pass. The full workspace build on current
  `origin/main` fails earlier in `docx-compare`: it imports the existing
  `projectSymbolRun` implementation from `@usejunior/docx-core`, but core's
  public index does not export it. This slice does not alter that API and does
  not treat the unrelated failure as evidence against Markdoc; task 6.5 stays
  open until the repository baseline is repaired and the complete preflight can
  run honestly.

- **2026-08-12 — paragraph insert/delete bookmark corruption:** The clean replay
  path was correct, but reject-all appeared to omit source paragraphs. Serialized
  OOXML proved that the paragraphs were present: rejection had relocated every
  adjacent sibling bookmark around the inserted paragraph, including unrelated
  source anchors, so the document view could no longer index them. Core rejection
  now relocates only a start/end pair with the same `w:id` that actually encloses
  the inserted paragraph. A core regression and the Markdoc end-to-end test now
  prove combined paragraph insertion/deletion under both accept-all and reject-all.

- **2026-08-12 — CommonMark boundary whitespace:** Markdoc's CommonMark parser
  correctly treats ordinary spaces at the beginning or end of a block as
  syntax, so a literal source paragraph ending in spaces initially failed exact
  projection. The importer now emits boundary spaces as `&#32;` and escapes a
  literal ampersand first. Markdoc decodes those references back into the exact
  operative text while the canonical file remains readable. Tests cover this
  because visually invisible whitespace can otherwise make a hash-pinned
  scaffold non-replayable.

- **2026-08-12 — source-anchored IR hydration:** The first implementation
  resolved `replace-source` original text only inside the DOCX mutation path.
  Replay and redline verification passed, but edit-pair export returned an empty
  `before` operand. The compiler now hydrates both the scaffold and operation IR
  from the verified source paragraph before replay or export. A correct document
  artifact is not sufficient evidence that the knowledge projection is correct.
