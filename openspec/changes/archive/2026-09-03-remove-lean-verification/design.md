## Context

Safe DOCX currently contains both production TypeScript verification and a
compiled Lean DOCX checker. The latter is not shipped in the npm package and
has shown multi-minute execution under realistic contention.

## Goals / Non-Goals

- Goals: eliminate Lean code, binaries, invocation paths, claims, and required
  gates; leave no runtime or CI dependency on Lean.
- Non-goals: weaken TypeScript package integrity, accept/reject replay,
  formatting projection, renderer, or authorization checks; rewrite the DOCX
  comparison engine.

## Decisions

- Delete the formal-verification subsystem rather than retain it as an optional
  package or dormant CI job.
- Remove public API fields instead of retaining deprecated no-op settings.
- Port release-certificate emitted-redline minimality to a small independent
  TypeScript implementation over finished OOXML. Exact replay remains a
  distinct claim and must not be relabeled as minimality.
- Remove Lean-only historical active-change directories where they describe
  capabilities that no longer exist; archived history may remain only where it
  is clearly historical and does not feed generated current claims.

## Risks / Trade-offs

- Formal assurance is lost. Mitigation: retain independently implemented
  artifact-level TypeScript LCS minimality, structural, conformance, renderer,
  and mutation-control tests.
- Removing cross-cutting references can expose stale generated artifacts.
  Mitigation: regenerate all derived conformance/trust documents and require a
  repository-wide case-insensitive Lean-reference scan.

## Migration Plan

1. Port emitted-redline minimality into the independent release verifier.
2. Remove public/runtime Lean invocation surfaces and their tests.
3. Remove Lean sources, scripts, workflows, and registries.
4. Update specifications, conformance evidence, release verification, and docs.
5. Regenerate derived artifacts and run the full non-Lean pre-submit suite.
