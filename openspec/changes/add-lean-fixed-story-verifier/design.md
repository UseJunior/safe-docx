## Context

TypeScript produces original, revised, and compared DOCX packages. The verifier must independently select and inspect `word/document.xml`, `word/footnotes.xml`, and `word/endnotes.xml`; passing pre-extracted XML would leave package projection in the producer.

## Goals / Non-Goals

- Goals: bounded fixed-part extraction in the verifier process, namespace-aware XML projection, missing-as-empty optional stories, independent story state, generic collection theorem, plain per-story certificates.
- Non-Goals: comments, headers/footers, relationships, note-reference integrity, rendering, arbitrary package parts, rebuild mode, full XML schema validation.

## Decisions

- Protocol v2 passes filesystem paths to immutable temporary snapshots of the three package buffers. Lean invokes `unzip` directly with a fixed part name; TypeScript does not inspect parts or implement verifier predicates.
- `word/document.xml` is required in all packages. If any package supplies an optional note part, absent sides are modeled as empty stories so tracked part addition/removal can be verified; all-absent optional parts are omitted.
- Lean models `NamedStoryTriple` and checks a list of stories. Every story starts with fresh wrapper and field state.
- The token parser resolves qualified names to namespace URIs, requires the expected WordprocessingML expanded-name root, and rejects malformed/unbound XML instead of treating it as empty.
- Reserved notes are selected by namespace-qualified `w:type="separator"` or `w:type="continuationSeparator"`, independent of numeric ID. The Lean projection is proved idempotent and proved to remove a typed reserved payload.
- Protocol output reports each story separately and includes package hashes computed from immutable TypeScript snapshots. Extraction is preflighted against compressed, expanded, ratio, and package limits and streamed with a hard output bound.
- The executable protocol is v2. The public certificate retains its v1 fields and adds `checkerProtocolVersion`, fixed-story scope, package hashes, story reports, presence, and exclusions.

## Risks / Trade-offs

- `unzip` is an operational dependency of executable protocol v2. The launcher fails closed and reports missing, corrupt, oversized, or extraction errors; packaged distributions must ship or provide it.
- The XML scanner remains a deliberately narrow token projection. Coverage is stated exactly and does not imply schema or reference validation.

## Migration Plan

The internal executable protocol moves to v2. The public certificate remains protocol v1 and gains additive fields, so existing consumers retain their discriminator, verifier name, scope, hashes, main checks, and token counts. The verifier option remains opt-in, and rebuild behavior remains `not_applicable`.
