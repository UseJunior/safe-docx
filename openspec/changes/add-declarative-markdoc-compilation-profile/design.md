## Context

Canonical Markdoc describes the revision but not all deterministic compile input.
The TypeScript API accepts revision and comment identities, while the CLI exposes
neither. Internal rationale is never materialized, which is safe but prevents a
useful internal-review artifact.

## Goals / Non-Goals

- Goals: reproducible CLI-only external-comment builds; explicit visibility;
  auditable override precedence; a high-friction internal-comment artifact.
- Non-goals: evidence-source schemas (#884), network/file resolvers, embedding
  output paths in Markdoc, or exposing private model chain-of-thought.

## Decisions

### A singleton declarative profile

Canonical syntax gains one optional singleton tag:

```markdoc
{% compilation
   revision-author="AI Drafter"
   build-date="2026-08-16T14:30:00.000Z"
   external-rationale-comments="include"
   comment-author="External Reviewer"
   comment-initials="ER"
/%}
```

`build-date` is one optional ISO-8601 instant shared by revision and comment
metadata. When omitted, compilation captures the current system UTC instant once
and reuses it everywhere. Pinning exists for fixtures and reproducible builds,
not as authenticated evidence of when a human made an edit. Including external
comments requires complete comment identity.

### Explicit rationale visibility

`visibility="internal|external-facing"` becomes the required authorization
field. The legacy `category` attribute is rejected. This is an intentional clean
break while the package has no known external production consumers.

### Override precedence

The CLI exposes a complete rendering override, not field-by-field identity
inheritance. Without an override, external-facing rationales render by default
when present (or follow the explicit Markdoc include/omit policy). A CLI
`--no-external-comments` override wins over Markdoc and suppresses all external
comments. If external rationales exist but are suppressed, CLI output emits a
warning. Excluded internal rationales never produce a warning.

Identity comes from the Markdoc profile for CLI-only replay or from one complete
API option object for programmatic use. The certificate records the resolved
configuration and source. Partial CLI identity overrides are not supported.

Output paths remain runtime concerns and cannot be embedded in a revision file.

### Internal export is a runtime capability

Internal-comment inclusion cannot appear in Markdoc. It requires the exact
`--dangerously-include-internal-comments` flag and a distinct explicit internal
output path. The path's basename is rewritten to end in
`INTERNAL COMMENTS INCLUDED.docx`; if necessary, the preceding basename is
truncated by Unicode code points to fit the platform-safe component limit. The
warning suffix and extension are never truncated.

External-comment output is reported conspicuously by the CLI and uses a filename
containing `EXTERNAL COMMENTS INCLUDED`. The CLI refuses an internal path equal
to the source, clean, or external redline
path and refuses silent overwrite. CLI output and the certificate declare the
internal mode. A visible in-document warning is deferred because adding document
content would change operative projections; it can be proposed separately.

### Validation remains one implementation path

`compile` calls the same parser and semantic validator used by `validate` before
mutation. The standalone command remains useful for editors and CI because it
writes no DOCX and avoids the more expensive replay/comparison steps.

## Risks / Trade-offs

- Profile metadata may be mistaken for authorship proof. Documentation will say
  it is caller-supplied attribution, not authenticated identity.
- A dangerous flag cannot prevent deliberate disclosure. The distinct path,
  forced filename, collision checks, and certificate disclosure reduce accidental
  disclosure.
- Keeping legacy `category` parseable avoids abrupt breakage but intentionally
  requires migration before it can authorize external comments.

## Migration Plan

Replace every rationale `category` with required `visibility`. Add a compilation
profile to make author identity replayable. Omit `build-date` for normal builds or
pin it when deterministic fixture bytes are required.

## Open Questions

- None. The approved design uses complete rendering overrides and one shared
  build timestamp.
