# Safe DOCX Suite

[![CI](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml)
[![codecov](https://img.shields.io/codecov/c/github/usejunior/safe-docx/main)](https://app.codecov.io/gh/usejunior/safe-docx)

Safe DOCX helps coding agents work with Microsoft Word files. Pure TypeScript, zero native dependencies — runs locally, in containers, or in cloud workers (Cloudflare, Vercel, Lambda).

If you are a developer who needs to edit contracts or other paperwork, this repo gives you an MCP server with deterministic `.docx` operations instead of manual Word UI steps.

## Start Here

For actual usage and setup, go to:

- `packages/docx-mcp/README.md`

Quick run:

```bash
npx -y @usejunior/safe-docx
```

## Gemini Extension Manifest

Gemini CLI reads the extension manifest from the repo-root file:

- `gemini-extension.json`

The manifests under `packages/safe-docx-mcpb/` are for the MCPB distribution workflow and are not used as the Gemini extension manifest.

## Key Workflows

- Apply edits to one document with formatting preservation
- Compare two documents and produce a tracked-changes output document
- Extract revisions as structured JSON for downstream automation

Golden prompts:

- `packages/docx-mcp/docs/golden-prompts.md`

Generated tool reference (from Zod schemas):

- `packages/docx-mcp/docs/tool-reference.generated.md`

## Packages

- `@usejunior/docx-core` — OOXML comparison + primitives
- `@usejunior/docx-mcp` — MCP server implementation package
- `@usejunior/safe-docx` — canonical end-user package name (`npx -y @usejunior/safe-docx`)
- `@usejunior/safedocx-mcpb` (private MCP bundle wrapper)

## Development

```bash
npm ci
npm run build
npm run lint --workspaces --if-present
npm run test:run
npm run check:spec-coverage
npm run test:coverage:packages
npm run coverage:packages:check
npm run coverage:matrix
```

## Quality Gates

- Coverage is uploaded to Codecov from CI using package `lcov.info` reports.
- Per-package coverage ratchet is enforced via `npm run coverage:packages:check`.
- Coverage matrix (without stale checked-in docs): `npm run coverage:matrix`.

## Governance

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

### npm Trusted Publisher

1. In npm package settings, add a trusted publisher.
2. Provider: GitHub Actions.
3. Owner: `UseJunior`
4. Repository: `safe-docx`
5. Workflow file: `.github/workflows/release.yml`
6. Environment: leave empty (unless you later add an Actions environment constraint).

Packages to configure:

- `@usejunior/docx-core`
- `@usejunior/docx-mcp`
- `@usejunior/safe-docx`
