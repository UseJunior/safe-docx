# Change: Add deterministic heading provenance

## Why

SafeDocX already gives agents a compact document outline, but its deterministic
path recognizes only literal `Heading1` through `Heading6` paragraph style IDs.
Real legal documents frequently encode outline intent through `w:outlineLvl`,
numbering levels linked to paragraph styles, or localized Word style names.
Those headings are currently invisible to the default low-noise outline, forcing
agents to scan more prose or rely on lower-confidence formatting heuristics.

The document view already exposes a `heading.source` taxonomy and several
heuristic sources. This change extends that existing contract instead of adding
parallel heading fields or another UI.

## What Changes

- Resolve effective paragraph `w:outlineLvl` through direct formatting and the
  paragraph style chain and expose it on `ParagraphFormatting`.
- Parse the optional `w:pStyle` association on numbering levels and expose a
  read-only level lookup so document-view classification can use it.
- Extend `HeadingSource` with deterministic `list_metadata` and
  `outline_level` values while retaining `word_style` and all current heuristic
  source values.
- Recognize Word built-in Heading 1 through Heading 9 style IDs and a maintained,
  versioned alias table for localized built-in heading names, including English,
  French, German, Spanish, and Japanese.
- Apply one documented precedence order:
  `word_style` → `list_metadata` → `outline_level` → existing heuristics.
- Treat deterministic sources as default outline entries; retain the existing
  opt-in boundary for heuristic headings.
- Document the complete heading shape and source taxonomy in generated MCP
  reference material.

## Impact

- Affected specs: `docx-primitives`, `mcp-server`
- Affected code:
  - paragraph style/property parsing
  - numbering-level parsing and lookup
  - document-view heading classification and types
  - `get_document_outline` deterministic-source filtering
  - shared fixtures, tests, generated MCP reference, and conformance registry
- Ref: #206

## Out of scope

- Adding another formatting-inference flag: the existing document view already
  implements heuristic heading sources and `get_document_outline` already gates
  them behind `include_heuristic_headings`.
- Renaming `word_style` to `builtin_style`, which would break existing consumers.
- Inferring hierarchy for Word `Title` or `Subtitle`, whose outline level is not
  intrinsic to the style name; those paragraphs remain eligible through an
  explicit effective `w:outlineLvl`.
- Promoting detected headings into Word styles, generating a table of contents,
  or detecting headings in text boxes, ancillary stories, or Google Docs.
- The signature-cluster suppression inconsistency described in the issue
  discussion; that is an independent existing-behavior bug and should remain a
  focused fix.
