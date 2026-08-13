## Context

Brownfield Markdoc deliberately treats the pinned DOCX as the formatting
substrate. Existing `format-source` selects one unique, single-format source
substring whose run properties become the base template for new text. That
contract preserves formatting but cannot express a deliberate format absent
from the source.

Safe DOCX core already supports additive run-property overlays through
`ReplacementPart.addRunProps`. The missing layer is explicit canonical intent,
unambiguous scope, and verification that comparison preserves the resulting
format through accept/reject projections.

## Goals / Non-Goals

### Goals

- Express intentional new direct character formatting without raw OOXML.
- Preserve the readability and domain neutrality of canonical Markdoc.
- Keep inherited formatting and additive formatting as separate concepts.
- Fail before mutation when formatting scope is ambiguous or unsupported.
- Certify formatting fidelity across both redline projections.

### Non-Goals

- Encode every Word run property in the first release.
- Infer formatting from the semantic role or appearance of text.
- Make raw OOXML or generated inspection detail canonical.
- Author paragraph, table, numbering, header, or image formatting.
- Compare source formatting directly with clean formatting across intentional
  text edits.

## Decisions

### 1. Closed, additive run-format vocabulary

Canonical operations may declare a structured run-format overlay drawn from a
closed allowlist that maps to `ReplacementPart.addRunProps`. The initial
allowlist includes at least `underline` and `highlight`; implementation may add
other already-supported primitive properties only when their syntax and
validation are equally deterministic.

Values are explicit (`underline="single"`, `highlight="yellow"`), not booleans
whose OOXML meaning depends on defaults. Unknown properties and values fail
validation. The compiler clones the selected inherited template first and then
applies only the declared overlay, preserving undeclared font, size, color,
bold, italic, and other admitted properties.

### 2. Scope is generated replacement text, not the paragraph

An operation-level run-format declaration applies only to the replacement text
created by that operation. It does not restyle unchanged text or the source
paragraph. In the first release, the declaration is admitted only when the
before/after alignment yields exactly one non-empty generated replacement hunk.
Zero-width insertion is one generated hunk and is admitted. Multiple generated
hunks fail closed with a diagnostic requiring separate source-anchored
operations or future selectively scoped syntax.

This constraint avoids an ad hoc inline DSL while ensuring that a visually
simple attribute cannot silently format several unrelated phrases.

### 3. `format-source` remains inheritance-only

`format-source` continues to select a unique source substring occupying one
coalesced formatting class. It supplies the base run template. A run-format
overlay is independent and applied afterward. Omitting the overlay never causes
the compiler to infer highlighting, underlining, or any other new formatting.

### 4. Formatting projection verification uses semantic fidelity

The certificate compares:

1. pinned source `word/document.xml` with reject-all output; and
2. generated clean `word/document.xml` with accept-all output.

It uses the existing formatting-fidelity comparison that tolerates harmless run
fragmentation and canonical XML differences while detecting semantic paragraph
and run-property divergence. Both comparisons must pass for projection
verification and delivery readiness to pass. Reports include actionable first
divergences without embedding the entire source document.

Source is not compared with clean output because intentional text and format
changes make that the wrong invariant. The clean document is the expected
accepted state, including any explicit run-format overlay.

## Risks / Trade-offs

- **Syntax growth:** A broad property bag could become raw OOXML in disguise.
  Mitigation: a closed semantic allowlist backed by existing core primitives.
- **Overbroad styling:** One declaration could affect unrelated replacements.
  Mitigation: admit exactly one generated hunk and fail closed otherwise.
- **False certificate failures:** XML serialization and run splitting vary.
  Mitigation: reuse semantic formatting-fidelity comparison rather than byte
  equality.
- **False expectations:** A consumer may assume visual formatting from text.
  Mitigation: only declared formatting is authored; no heuristic recognizes
  blanks, dates, signatures, or document domains.

## Migration Plan

1. Add schema/IR types and validation without changing existing documents.
2. Compile admitted overlays through `ReplacementPart.addRunProps`.
3. Add semantic formatting checks to projection certification.
4. Update downstream adapters to declare intentional new formatting explicitly.
5. Re-run the completed brownfield experiment and require zero unexplained
   semantic formatting divergences before Word review.
