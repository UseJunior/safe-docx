# Change: Add a conformance explorer export manifest

## Why

Safe DOCX's conformance registry, schema bindings, evidence references, and
capability-axis projection are authoritative but are spread across Markdown and
several machine-readable artifacts. The public explorer in
`UseJunior/tests-renderer` needs one deterministic, versioned contract so it
does not scrape prose, import repository internals, or create a second source
of product truth.

## What Changes

- Add a versioned JSON Schema for the external Safe DOCX conformance explorer
  manifest.
- Generate a deterministic manifest from the existing ECMA-376 registry,
  vendored schema declarations, and Safe DOCX capability projection.
- Preserve stable joins to neutral `open-agreements/docx-platform-tests`
  identities without copying neutral scenario definitions or results.
- Validate registry inventory, schema declarations, capability/axis identities,
  evidence references, and generated-output drift in CI.
- Document the ownership boundary and the downstream pinned-snapshot refresh
  workflow.

## Impact

- Affected specs: `spec-compliance`
- Affected code: `spec-compliance/`, `scripts/`, root package scripts and CI
  preflight
- External consumer: `UseJunior/tests-renderer#37`
- Runtime API compatibility: no runtime or published-package changes
- Tracking issue: `UseJunior/safe-docx#689`
