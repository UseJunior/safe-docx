## Context

TypeScript produces original, revised, and compared DOCX packages. The verifier must independently select and inspect `word/document.xml`, `word/footnotes.xml`, and `word/endnotes.xml`; passing pre-extracted XML would leave package projection in the producer.

## Goals / Non-Goals

- Goals: fixed-part extraction in the verifier process, fail-closed presence matching, independent story state, generic collection theorem, plain per-story certificates.
- Non-Goals: comments, headers/footers, relationships, note-reference integrity, rendering, arbitrary package parts, rebuild mode, full XML schema validation.

## Decisions

- Protocol v2 passes filesystem paths to immutable temporary snapshots of the three package buffers. Lean invokes `unzip` directly with a fixed part name; TypeScript does not inspect parts or implement verifier predicates.
- `word/document.xml` is required in all packages. Each optional note part must be present in all three packages or absent from all three; any other pattern is a verifier failure.
- Lean models `NamedStoryTriple` and checks a list of stories. Every story starts with fresh wrapper and field state.
- The token parser marks reserved footnote/endnote entries (`w:id=-1` and `w:id=0`), and a Lean projection removes their content before checking. The projection is proved idempotent and proved to remove reserved tokens.
- Protocol output reports each story separately and includes package hashes computed by TypeScript for certificate reproducibility. Package extraction failures remain `not_run`; logical/presence failures are `failed`.

## Risks / Trade-offs

- `unzip` is an operational dependency of protocol v2. The launcher fails closed and reports the extraction error; packaged distributions must ship or provide it.
- The XML scanner remains a deliberately narrow token projection. Coverage is stated exactly and does not imply schema or reference validation.

## Migration Plan

Protocol v1 is replaced internally by v2. The verifier option remains opt-in, and rebuild behavior remains `not_applicable`, so default comparison behavior is unchanged.

