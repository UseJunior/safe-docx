# Contributing

Thanks for helping improve Safe Docx. This guide covers the common contribution paths: document primitives, MCP tools, format providers, conformance evidence, and documentation.

All contributors must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways To Contribute

1. **Add or repair a document primitive** — change general OOXML or ODF behavior in the format package that owns it.
2. **Add or improve an MCP tool** — extend the central catalog, dispatch layer, provider behavior, and generated reference together.
3. **Improve comparison** — add a narrowly specified comparison or tracked-change behavior with round-trip evidence.
4. **Strengthen conformance** — connect implementation, tests, citations, schemas, and explicit non-goals.
5. **Improve documentation** — keep tutorials, architecture, generated references, and package boundaries aligned with the code.

## Ground Rules

- Create a branch before committing. Never commit directly to `main`.
- Keep pull requests focused on one concern.
- Preserve unrelated changes in a dirty worktree.
- Add test evidence for behavior changes.
- Use OpenSpec for new capabilities, breaking changes, and architectural shifts.
- Follow the ECMA-376 citation rules when changing claimed OOXML behavior.
- Do not force-push after review begins.

## Repository Layout

```text
safe-docx/
├── packages/              Published libraries and MCP runtime
├── skills/                Agent instructions for document editing
├── docs/                  User and maintainer guides
├── spec-compliance/       ECMA-376 registry, schemas, and reports
├── verification/          Invariants and optional formal verification
├── openspec/              Requirements and change proposals
├── tests/                 Cross-package fixtures and integration tests
└── site/                  Public documentation site
```

Package ownership:

| Package | Responsibility |
|---|---|
| `docx-mcp` | Agent-facing tools, sessions, policy, and provider dispatch |
| `docx-core` | General OOXML primitives and document generation |
| `docx-compare` | DOCX comparison and redline construction |
| `odf-core` | ODF editing and tracked changes |
| `google-docs-core` | Google Docs reads, writes, and anchors |
| `safe-docx` | Stable end-user executable name |
| `test-narrative` | Shared human-readable test metadata |

## Domain Boundaries

Safe Docx is a general document library. Public vocabulary should come from Word, OOXML, ODF, or a small set of explicit agent affordances: paragraph, run, table, row, cell, border, numbering, section, comment, revision, outline, and similar concepts.

Do not add concepts tied to one downstream document type or product. A signature block is a table assembled by the consumer; it is not a core `SignatureBlock` primitive. Agreement fields, parties, cover terms, and domain-specific recipes belong outside `packages/*/src/**`.

Agent affordances are appropriate when they solve a general model constraint, such as a token-efficient outline. Name them for that general function.

## Before You Start

Read the instructions closest to the code you will change:

- [`openspec/AGENTS.md`](openspec/AGENTS.md) for proposals and specifications;
- [`spec-compliance/AGENTS.md`](spec-compliance/AGENTS.md) for OOXML citations and conformance metadata;
- [`packages/docx-core/src/testing/ooxml-fixtures.ts`](packages/docx-core/src/testing/ooxml-fixtures.ts) before adding field XML or minimal DOCX fixtures;
- [`docs/architecture.md`](docs/architecture.md) for package boundaries.

Check active work before editing:

```bash
git status --short --branch
openspec list
openspec list --specs
```

## Branches

Issue work uses:

```text
{issue}-{short-description}-{YYYYMMDD}
```

Example:

```text
42-add-redline-support-20260221
```

Small changes use:

```text
tweak-{description}
```

## Commits

Use Conventional Commits:

```text
type(scope): imperative description

Explain why the change is needed, the relevant trade-offs, and why this
implementation was chosen.

Fixes: #42
```

Valid types are `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`, `style`, `revert`, and `build`.

Use the owning package or area as the scope:

```text
fix(docx-core): preserve field wrappers during replacement
feat(docx-mcp): expose structured revision extraction
docs(architecture): clarify provider boundaries
```

Subjects begin with lowercase text unless the first word is an acronym. Commit bodies explain why, not only what. Reference the issue with `Fixes: #N` or `Ref: #N`.

## Add Or Change OOXML Behavior

1. Identify the owning package and relevant OpenSpec capability.
2. Check `packages/docx-core/src/testing/` for an existing fixture or builder.
3. Add the implementation with an ECMA-376 citation where the repository makes a conformance claim.
4. Add tests using shared OOXML or synthetic-DOCX fixtures.
5. Attach conformance metadata to the tests.
6. Run the package tests and conformance checks.

Implementation citations use:

```ts
/**
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @see #42
 */
```

Tests use:

```ts
testAllure.conformance({
  spec: 'ECMA-376',
  edition: 5,
  part: 1,
  section: '17.13.5.20',
});
```

Use `ooxml-fixtures.ts` for reusable field XML and `buildDocxFromBodyXml`. Use `buildSyntheticDocx` for paragraph-array packages with comment, footnote, or bookmark scaffolding. Inline XML is reserved for scenario-specific malformed or regression inputs.

## Add Or Change An MCP Tool

1. Update `packages/docx-mcp/src/tool_catalog.ts`.
2. Implement dispatch and provider behavior at the appropriate layer.
3. Add OpenSpec scenarios and tests.
4. Regenerate the tool reference.
5. Check that tool documentation has no drift.

```bash
npm run docs:generate:tools -w @usejunior/docx-mcp
npm run check:tool-docs
```

## Development Setup

```bash
npm ci
npm run build
npm run test:run
```

Run one package while iterating:

```bash
npm run build -w @usejunior/docx-core
npm run test:run -w @usejunior/docx-core
```

## Pre-Submit

All repository checks must pass before pushing:

```bash
npm run build && \
npm run lint:workspaces && \
npm run test:run && \
npm run check:spec-coverage && \
npm run check:conformance-citations && \
npm run check:conformance-doc
```

Also run checks specific to the changed surface, including generated tool docs, site links, package manifests, or formal verification where applicable.

## Pull Requests

- Use a Conventional Commit title.
- Explain the problem, decision, and evidence.
- Keep one concern per PR when practical.
- Include screenshots or GIFs for visual changes.
- Do not force-push after review starts.
- Use incremental commits during review; maintainers can squash or rebase after review.

An advisory LLM quality gate reviews OOXML invariants, tracked-change behavior, side-part updates, and paired artifacts. If it reports a warning, either address it or explain why it does not apply. The checklist lives in `.github/llm-based-quality-gate/checklist.md` and is read from the PR base branch.

## Documentation Changes

Keep each document at one abstraction level:

- `README.md` is the project front door;
- `docs/tutorial.md` is the canonical user journey;
- `docs/architecture.md` explains system structure;
- `docs/trust-and-conformance.md` explains assurance boundaries;
- package READMEs explain package ownership and entry points;
- generated references remain generated.

Verify commands, package names, tool names, and paths against the repository before committing.

## License

Contributions are licensed under [Apache License 2.0](LICENSE), including the inbound-license terms in section 5.
