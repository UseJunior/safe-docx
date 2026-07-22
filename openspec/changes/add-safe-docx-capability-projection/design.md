## Context

`open-agreements/docx-platform-tests` owns neutral capability definitions,
applicable axes, profiles, and scenario mappings. SafeDocX owns product support
claims and local evidence. CI must remain reproducible without network access,
and existing conformance and Lean registries remain authoritative rather than
being copied into a new truth source.

## Goals / Non-Goals

- Goals: pin the neutral denominator, require explicit status for every
  profile-defined capability/axis pair, require executable evidence for every
  positive status, and expose honest generated summaries.
- Non-goals: create a new legal-priority denominator, claim full ECMA-376
  conformance, infer support from citations, or expand Lean checker scope.

## Decisions

- Vendor upstream registry files unchanged and record their SHA-256 digests in
  a separate pin manifest. This preserves upstream ownership while making CI
  offline and reproducible.
- Project only the axes named by the pinned upstream profile, intersected with
  each capability's applicable axes. The projection does not invent axes or a
  product-specific denominator.
- Use statuses `supported`, `partial`, `preservation-only`, `gap`, `non-goal`,
  and `untested`. The first three are positive and require exact executable
  evidence. `preservation-only` is valid only for the `preserve` axis.
- Resolve local evidence commits through Git, read test and package metadata
  from those commit objects, and recognize only exact string-literal test
  titles. A local normative evidence class additionally requires structured
  conformance metadata on that test call.
- Treat claim package parts as a nonempty subset of the neutral capability
  parts, with stories derived from the claimed subset. This keeps each row no
  broader than the executable evidence it cites.
- Expose the existing Lean checker coverage registry as a formal-assurance
  boundary, not executable capability evidence. Until a pinned checker result
  is added, the registry establishes no positive capability row.

## Risks / Trade-offs

- A pinned snapshot can become stale. Hash and profile-denominator checks make
  drift explicit, while the documented update command keeps refresh deliberate.
- Conservative statuses may understate broad behavior. This is preferable to a
  positive claim that lacks executable evidence or mode/story scope.
- The neutral profile currently measures only its declared axes. Other useful
  SafeDocX evidence remains outside this report until upstream expands the
  profile.

## Migration Plan

Additive only. Existing ECMA registries, manifests, tests, and Lean coverage
remain unchanged and continue to be independently validated.
