# spec-compliance

This tree advertises what external specifications safe-docx claims correctness
against, and binds each claim to a stable identifier, a vendored normative
artifact, and (where available) tests and formal proofs.

The contents are auditable in-repo:

| Path                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `CONFORMANCE.md`              | Human-readable summary. **Auto-generated** — do not edit by hand.  |
| `registry/ecma-376.md`        | Source of truth: targeted sections, Non-Goals, schema bindings.    |
| `manifests/`                  | Machine-readable bounded conformance classifications.              |
| `evidence/`                   | Generated, mutation-sensitive executable evidence results.         |
| `capabilities/`               | Pinned neutral denominator and SafeDocX per-axis evidence claims.   |
| `generated/safe-docx-capability-projection.*` | Generated per-axis report; do not edit by hand.      |
| `ecma-376/coverage-ledger/`   | Planning ledgers for expanding coverage without overclaiming.      |
| `ecma-376/schemas/`           | Vendored normative ECMA-376 XSDs (3.3 MB total, in-tree).          |
| `ecma-376/COPYRIGHT.txt`      | Ecma International copyright notice preserved with the schemas.    |
| `AGENTS.md`                   | Citation-hygiene rules for AI assistants and contributors.         |

The registry directory is multi-spec by design — additional specs (for
instance, the Google Docs API surface that `google-docs-core` will bind to)
land as siblings of `registry/ecma-376.md` without restructuring this tree.

## Workflow

- **Reading a conformance claim in source.** A JSDoc `@conformance ECMA-376
  edition 5, Part 1 § 17.16.13` tag points at a registry entry whose
  `[ECMA-PART1-17-16-13]` ID is stable across reorganizations of either
  ECMA-376 or this codebase.
- **Adding a new conformance claim.** Add a `## [ECMA-PART<N>-<section>] …`
  entry to `registry/ecma-376.md`, regenerate `CONFORMANCE.md` and the
  generated conformance report via `npm run check:conformance-doc`, then annotate
  the source/test sites with `@conformance` / `.conformance(…)`. The
  citation-hygiene lint will verify everything resolves.
- **Marking a deliberate non-conformance.** Use `@conformance-gap` in place
  of `@conformance`. The coverage report classifies it as an intentional
  divergence, not a missing claim.
- **Planning the next ECMA tranche.** Use the coverage ledgers under
  `ecma-376/coverage-ledger/` to group registry work into reviewable issue
  slices before adding claims.
- **Refreshing advanced-revision evidence.** Run
  `npm run generate:advanced-revision-evidence`. CI reruns the focused tests
  and rejects the committed artifact if any element/operation/story result or
  target-removal, operation-mutation, or story-mutation sentinel drifts.
- **Refreshing the capability projection.** Neutral definitions remain owned
  by `open-agreements/docx-platform-tests`. Copy the reviewed registry files
  from the exact upstream commit into `capabilities/upstream/`, update
  `capabilities/upstream-pin.json` with the full commit and SHA-256 values,
  reconcile every profile capability/axis pair in
  `capabilities/safe-docx-projection.json`, then run
  `npm run generate:capability-projection`. CI is offline and rejects pin,
  denominator, evidence-path, or generated-report drift. A positive row means
  only that its listed executable evidence passed within the stated scope; it
  is not a general DOCX or ECMA-376 conformance claim.

Local evidence is read from the exact claimed Git commit, including the owning
workspace package version, and selectors must be exact string-literal titles on
recognized `test` or `it` calls. The Lean XML checker coverage registry is
reported separately as scope metadata: it covers in-place main, footnote, and
endnote text and field-marker projections with the registry's exact exclusions,
but it does not establish any capability row without a pinned executable result.

The generated report names two different inventories. The profile denominator
is the intersection of every profile axis with every capability's applicable
axes, including explicit gaps and untested rows. The evidence inventory starts
with authored scenario mappings and adds derived cross-platform rows when a
complete result run can support them. The pinned result snapshot may measure
fewer rows still. These counts answer different questions and must not be used
as interchangeable coverage percentages.

See [`AGENTS.md`](./AGENTS.md) for the full citation rules and the
[issue #227 problem statement](https://github.com/UseJunior/safe-docx/issues/227)
for the WHATWG-style auditability goal this directory serves.
