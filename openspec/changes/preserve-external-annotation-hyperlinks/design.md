## Context

Comments and footnotes are independent OOXML source parts, so an annotation
hyperlink's `r:id` resolves in `word/_rels/comments.xml.rels` or
`word/_rels/footnotes.xml.rels`, not in the main document relationships. Raw
relationship IDs are part-local and cannot survive comment/footnote projection.

The canonical annotation body currently stores run text plus a closed set of
run formatting. The importer derives those runs from visible tagged text and
source run spans; the projectors then pass structured bodies to docx-core.

## Goals / Non-Goals

- Goals:
  - Preserve external hyperlink destination, visible text, and every admitted
    run-formatting field through import, Markdoc, and all four comment/footnote
    source/destination combinations.
  - Allocate valid deterministic destination-part relationships without
    assuming source relationship IDs are reusable.
  - Produce stable actionable failures for malformed or unsupported inputs.
- Non-Goals:
  - Internal `w:anchor` hyperlinks, bookmark markers, and general
    cross-reference preservation.
  - Hyperlink metadata beyond destination, such as tooltip, target frame, or
    document location. Word's `w:history` display hint is admitted but is not
    canonical link identity.
  - Revision wrappers or other complex content nested inside annotation
    hyperlinks.

## Decisions

### Canonical runs own resolved destinations

`AnnotationRun` gains an optional structured hyperlink value containing the
resolved external destination. Markdoc uses an `href` attribute on
`annotation-run`; linked unformatted text is therefore still wrapped in an
explicit tag. Link identity never depends on named style or visual formatting.

Alternatives considered:

- Preserve raw `r:id`: rejected because IDs are local to a relationship part
  and collide or dangle after presentation conversion.
- Infer links from the Hyperlink character style: rejected because style is
  visual formatting, not destination identity.
- Add a separate nested Markdoc link tag: deferred because a run-level
  destination composes directly with the existing run-style representation and
  keeps the admitted annotation grammar closed.

### Source relationships are resolved before visible-run reconstruction

Import validates each `w:hyperlink` wrapper, resolves its `r:id` in the owning
part's relationships, and associates the destination with every descendant
source run span. A wrapper must have no `w:anchor`, must have a non-empty
`r:id`, and must resolve to a non-empty hyperlink relationship whose
`TargetMode` is exactly `External`. Direct wrapper children are limited to
admitted `w:r` nodes.

### Destination parts allocate their own relationships

docx-core scans structured annotation bodies for destinations before emitting
XML. A shared relationship helper reuses an existing external hyperlink
relationship for the same destination when available; otherwise it allocates
the first free `rIdN` across every relationship type. Repeated destinations
share one relationship deterministically. Adjacent runs with the same
destination share one `w:hyperlink` wrapper, while formatting stays on each
child run.

### Fail-closed boundaries stay explicit

The importer reports reason codes and relevant IDs/types/modes for missing
`r:id`, dangling IDs, wrong relationship types, non-external targets, internal
anchors, empty targets, and unsupported wrapper attributes or children.
Existing bookmark rejection remains unchanged, so the real ILPA fixtures
advance to the next boundary when it is present rather than silently dropping
navigation markup. On fresh `origin/main`, the WOF fixture reaches
`w:bookmarkStart` in `footnote:19`; the Deal-By-Deal fixture contains no marker
there and imports completely.

## Risks / Trade-offs

- Relationship mutation spans comments and footnotes emitters. A shared helper
  limits drift, while projection tests inspect both XML and `.rels` parts.
- Deduplicating repeated destinations may change relationship multiplicity but
  is semantically lossless and deterministic; tests cover pre-existing ID
  collisions and repeated targets.
- Markdoc gains an additive `href` attribute without changing the IR version.
  Older content remains valid; consumers that ignore unknown runtime fields are
  outside the canonical parser contract.

## Migration Plan

No stored-document migration is required. Existing canonical Markdoc parses as
before. Newly imported external annotation hyperlinks serialize with explicit
destinations and compile only through versions that admit the new attribute.

## Open Questions

None. Issue #956 and the execution handoff explicitly approve this bounded
external-hyperlink capability while deferring internal navigation structures.
