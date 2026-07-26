# Change: Surface unrepresented section and header/footer changes

## Why

The comparison engine can preserve revised section properties and header/footer
parts without emitting tracked-change markup for them. A result with zero text
revisions therefore looks like an empty comparison even when pagination or
running content changed.

## What Changes

- Add structured `CompareResult.unrepresentedChanges` diagnostics.
- Detect section-property and relationship-selected header/footer differences
  that are present in the inputs but not represented by emitted revisions.
- Keep existing revision statistics unchanged; the new field makes their scope
  explicit instead of counting non-text changes as insertions or deletions.

## Impact

- Affected specs: `docx-comparison`
- Affected code: atomizer package inspection, public comparison result types,
  and comparison integration tests

