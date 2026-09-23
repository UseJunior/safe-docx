# Change: Refactor tracked paragraph move ownership

## Why

Whole-paragraph moves that cross the body-story terminus cannot move a terminal paragraph mark because that endpoint has no following break. Emitting `moveFrom`/`moveTo` paragraph-mark revisions at both endpoints validates against the schema but produces extra paragraphs, residual revisions, duplicated text, or silent whitespace in Word and LibreOffice.

## What Changes

- Match Microsoft Word's native comparison topology for complete-paragraph moves.
- Keep moved run content in paired `moveFrom`/`moveTo` ranges.
- For a terminal-crossing move, represent the removed and created paragraph breaks with ordinary `del` and `ins` paragraph-mark revisions, placing the terminal endpoint's break revision on its stable predecessor.
- Place whole-paragraph move range boundaries at the same paragraph ownership level Word emits.
- Preserve or deterministically supply paragraph revision-session metadata needed for stable Word Accept/Reject projection.
- Teach the internal Accept/Reject projector to project bookmark boundaries enclosed by named move ranges.
- Keep note-bearing terminal predecessors and field-refresh behavior outside the supported proof envelope until separately characterized.

## Impact

- Affected spec: `docx-comparison`
- Affected code: tagged serializer, tagged Accept/Reject projector, move verification and regression tests
- Public API: unchanged
- Hosted API/build/deploy: out of scope

## Approval

Owner approved implementation in this thread with: `I approve - proceed` and later approved Word Accept/Reject verification on disposable public fixtures.
