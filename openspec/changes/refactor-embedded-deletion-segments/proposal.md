# Change: Encapsulate embedded-content deletion segments

## Why
Issue #1312 (Q in #1295) requires the replacement primitive to validate forward
sibling reachability before its first DOM write, and to keep deletion-segment
state local. Current main checks container identity after splitting boundaries
but does not check whether the end can be reached from the start.

## What Changes
- Validate attached, forward-reachable sibling endpoints before boundary splitting.
- Encapsulate in-place deletion emission in a private local builder; preserved
  objects and sibling markers terminate segments without moving.
- Preserve public signatures, error categories, text-only revision grouping,
  field-boundary refusal, and existing object/marker preservation policies.
- Add failure injection and complete text/object-order projection tests with DOCX
  save/reopen evidence.

## Approval
Implementation follows the detailed remediation plan explicitly approved by the
user with “Implement the plan.” This proposal records that approved architecture;
it introduces no additional public capability or decision requiring approval.

## Contribution reconciliation
Reviewed cocvn157's PR [#1334](https://github.com/UseJunior/safe-docx/pull/1334).
Its segment extraction and forward scan identify the same concern. This change
retains the existing in-place algorithm but uses a private factory rather than
exporting a class/validator. Its validation runs before splitting (the contributor
places it afterward), and the focused tests exercise failed calls with unchanged
whole DOM plus edge objects, consecutive objects, hyperlinks, nested wrappers,
text-only and zero-length ranges, and serialized accept/reject projections.
The contribution's branch and PR remain untouched; its reported test claims are
not used as evidence for this implementation.

## Impact
- Affected specs: `docx-primitives`
- Affected code: `packages/docx-core/src/primitives/text.ts` and dedicated tests
- No formatting change intended for valid ranges; no corpus baseline changes.
