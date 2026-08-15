# Change: Align composite anchors by semantic context

## Why

Atom-level LCS can match the punctuation and text fragments of a repeated list
marker across unrelated rewritten items. The resulting redline preserves part of
the marker as unchanged even though the semantic item it introduces was replaced.
A Roman-numeral exception fixes one corpus example but embeds document-specific
syntax and similarity heuristics in the generic LCS.

## What Changes

- Recognize parenthetical numeric, alphabetic, and Roman list markers as composite
  contextual anchors.
- Associate each anchor with the same-paragraph item span that it introduces.
- Permit an anchor's atoms to match only when the corresponding item spans are
  structurally compatible; otherwise emit the complete anchor on each side.
- Keep ordinary token LCS inside compatible items and for prose parentheticals.

## Impact

- Affected spec: docx-comparison
- Affected code: atomizer alignment and comparison integration tests
- Replaces the Roman-only implementation proposed by PR #856

