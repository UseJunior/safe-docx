# spec-compliance

This tree advertises what external specifications safe-docx claims correctness
against, and binds each claim to a stable identifier, a vendored normative
artifact, and (where available) tests and formal proofs.

The contents are auditable in-repo:

| Path                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `CONFORMANCE.md`              | Human-readable summary. **Auto-generated** — do not edit by hand.  |
| `registry/ecma-376.md`        | Source of truth: targeted sections, Non-Goals, schema bindings.    |
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
  README marker block via `npm run check:conformance-doc`, then annotate
  the source/test sites with `@conformance` / `.conformance(…)`. The
  citation-hygiene lint will verify everything resolves.
- **Marking a deliberate non-conformance.** Use `@conformance-gap` in place
  of `@conformance`. The coverage report classifies it as an intentional
  divergence, not a missing claim.
- **Planning the next ECMA tranche.** Use the coverage ledgers under
  `ecma-376/coverage-ledger/` to group registry work into reviewable issue
  slices before adding claims.

See [`AGENTS.md`](./AGENTS.md) for the full citation rules and the
[issue #227 problem statement](https://github.com/UseJunior/safe-docx/issues/227)
for the WHATWG-style auditability goal this directory serves.
