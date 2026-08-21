# Change: Make the tagged tree the sole comparison spine

Issues: #838, #839, #895. Related: #836, #837, #846, #542, #469.

## Why

Tagged-tree comparison is the default, but it still post-processes a complete
legacy WmlComparer-style run. The legacy atom/LCS/reconstruction pipeline chooses
the base package, assembles all non-document parts, reconciles notes, and supplies
most public statistics. That coupling retains two comparison engines, makes the
tagged rollback appear more independent than it is, and leaves tagged output
without several compatibility passes already learned by the legacy path.

## What Changes

- Add a mandatory legacy-versus-tagged characterization manifest before changing
  behavior, covering projections, package invariants, normalized package parts,
  statistics, diagnostics, and explicitly adjudicated divergences.
- Port consumer compatibility, volatile PAGEREF suppression, Markdoc rationale
  attribution, fuzzy move detection, numbering and every retained option onto the
  tagged tree.
- Build one standalone tagged package that deterministically reconciles both
  input archives, then derive public statistics and footnote publication from
  tagged output.
- Make the standalone tagged assembler authoritative while retaining a private,
  measured emergency rollback for at least one release/corpus soak cycle.
- **BREAKING** Remove public `reconstructionMode`, `comparisonStrategy`, `engine`,
  `premergeRuns`, and `maxWordRefinementChangeRanges` in a dedicated release.
- **BREAKING** Remove exported atom, atom-LCS, legacy move/format detection, and
  reconstruction APIs according to a generated and reviewed removal inventory.
- **BREAKING** Version `insertedAtoms`, `deletedAtoms`, and `formatChangeAtoms`
  as `tagged-token-v1` because the deleted flattened atom/LCS engine's weighting
  cannot be retained without preserving that engine as a shadow statistics path.
- Delete the legacy WmlComparer implementation only after the release-evidence
  gate passes, while extracting portable revision-markup helpers first.
- Rename the surviving tagged implementation out of `baselines/` only after the
  rollback window, preserving useful history throughout the migration.

## Impact

- Affected specs: `docx-comparison`.
- Affected packages: `docx-compare`, `docx-markdoc`, `docx-mcp`, `docx-core`, and
  generated conformance/tool documentation.
- Compatibility: package provenance is not caller-selectable. Every result
  preserves both source projections by construction: accepting all comparison
  revisions yields revised semantics, while rejecting all revisions yields
  original semantics, including referenced ancillary resources.
- Dependencies: none added; leaf alignment continues to use `textAlignment.ts`.
- Delivery: one OpenSpec change, one independently reviewed PR per phase, and
  separate releases for the authority flip, public removals, and legacy deletion.
