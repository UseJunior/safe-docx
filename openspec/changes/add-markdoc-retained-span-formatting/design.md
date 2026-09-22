## Context

`run-format` currently styles only generated replacement hunks. That boundary
is intentional: it prevents a formatting declaration from silently reaching
unchanged source text. It also leaves no canonical way to clear a source
property from text the aligner classifies as common.

The lower-level text replacement path can already express additive and
subtractive run properties and the comparison engine already emits native
`w:rPrChange` for direct-format differences. The missing pieces are a
text-preserving run-range mutation, canonical retained-span intent, exact scope
validation, and end-to-end certification.

## Goals / Non-Goals

### Goals

- Author an exact format-only change over retained visible text.
- Preserve visible text and every undeclared property byte-semantically.
- Emit reviewable native property-change markup with exact accept/reject
  projections.
- Keep generated-text formatting and retained-text formatting visibly distinct.
- Work wherever the existing Markdoc paragraph operation is admitted,
  including an existing physical table cell.

### Non-Goals

- Infer that a placeholder, blank, date, or completed field should lose or gain
  formatting.
- Expose arbitrary OOXML property bags.
- Format generated text through `retain-format`; `run-format` remains the
  generated-span mechanism.
- Span several source formatting classes in one declaration.
- Change paragraph, table, numbering, section, or drawing properties.
- Define redline token alignment or whitespace grouping policy; that remains a
  separate readability-profile change.

## Decisions

### 1. Canonical syntax wraps the exact retained occurrence

An `after` block may wrap retained text in an inline declaration:

```markdoc
{% after %}Status: {% retain-format highlight="none" %}Complete{% /retain-format %}{% /after %}
```

The parser removes the wrapper from visible revised text and records its exact
half-open revised-text interval. Repeated strings require no occurrence
selector because the authored wrapper identifies one occurrence structurally.
Empty, nested, or overlapping declarations are invalid.

The initial closed vocabulary is symmetric with the existing generated-text
surface:

- `highlight="yellow" | "none"`
- `underline="single" | "none"`

An omitted property preserves its source value. A declaration must change at
least one effective admitted direct property; deterministic no-ops fail closed
instead of creating misleading canonical intent.

### 2. Retained scope is proven against alignment

Each interval must map wholly to one common source/revised alignment interval.
It may not overlap generated or deleted text or cross an alignment boundary.
The mapped source interval must occupy one coalesced direct-run formatting
class after harmless physical fragmentation is normalized. Authors split a
mixed-format target into multiple declarations.

This is stricter than substring search and avoids selecting the wrong repeated
token. Validation occurs before any package mutation and reports stable codes
for invalid structure, non-common scope, mixed formatting, overlap, and no-op
intent.

### 3. A text-preserving primitive owns run surgery

`docx-core` gains a bounded run-range formatter that splits admitted text-run
boundaries, clones all existing direct properties and non-text structure, then
changes only the declared properties. It does not delete/reinsert visible text,
cross embedded objects or unsupported wrappers, or normalize unrelated runs.

The primitive supports clean mutation without revision markup. Markdoc first
uses it to construct the intended clean state; the established comparison path
then compares source with clean and emits `w:rPrChange` containing the prior
`w:rPr` snapshot. This keeps revision identity, author/date attribution,
accept/reject handling, and comparison safety gates on the canonical path.

If comparison emits text insertion/deletion markup for a property-only span,
compilation fails certification. One physical `w:rPrChange` per affected run is
permitted when a semantically single span crosses harmless run fragmentation;
the certificate reports both declared spans and emitted property-change ranges.

### 4. Projection and minimal-mutation checks are explicit

For every retained-format declaration, certification requires:

1. source and clean visible text are identical over the declared interval;
2. clean has exactly the declared property state and preserves undeclared
   properties;
3. tracked output has no `w:ins`/`w:del` attributable solely to that span;
4. accept-all is semantically equal to clean;
5. reject-all is semantically equal to the pinned source; and
6. clean contains no revision markup.

The existing document-wide text, formatting, story, table, and package checks
remain authoritative. The new certificate fields disclose scope and
property-change counts without embedding source text.

### 5. Retained and generated declarations cannot claim the same interval

`run-format` remains valid only on generated hunks. `retain-format` remains
valid only on common aligned text. Their disjoint scope rules make overlap
impossible by construction and keep author intent readable.

## Risks / Trade-offs

- **Run fragmentation can multiply physical changes.** Certification counts
  physical property revisions but reasons about the one declared semantic span.
- **Strict single-class admission rejects some useful spans.** Authors can use
  adjacent declarations; this is safer than flattening mixed source formats.
- **Comparison could regress to text replacement.** A dedicated negative gate
  rejects `w:ins`/`w:del` for property-only intervals.
- **Syntax could grow into OOXML.** The initial vocabulary stays closed and
  semantic; additions require their own proposal and projection tests.

## Migration Plan

1. Add the core range-format primitive and ECMA-tagged accept/reject evidence.
2. Add parser/IR representation and pre-mutation alignment validation.
3. Apply clean retained-span mutations before comparison.
4. Extend certificate diagnostics and failure gates.
5. Add synthetic highlighted-placeholder and repeated-token controls, then run
   a de-identified real-document smoke out of band.
