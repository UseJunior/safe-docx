# Contributing to Safe DOCX Suite

Thanks for contributing to `safe-docx`.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) in issues, pull requests, and discussions.

## Development Setup

```bash
npm ci
npm run build
npm run lint --workspaces --if-present
npm run test:run
npm run check:spec-coverage
```

## Before Opening a PR

1. Run build, lint, and tests locally.
2. Keep OpenSpec traceability checks green.
3. Keep package coverage from regressing.
4. Update docs/specs when behavior changes.

## Repository Layout

- `packages/docx-primitives`: OOXML primitives and invariants.
- `packages/docx-comparison`: comparison/diff engine.
- `packages/safe-docx`: MCP server and editing tools.
- `packages/safedocx`: unscoped alias package.
- `packages/safe-docx-mcpb`: private MCP bundle wrapper.
- `openspec/`: specs and change deltas.

## Commit and PR Guidance

- Prefer focused PRs with one concern per change.
- Include test evidence for behavior changes.
- For new capabilities or behavior shifts, include an OpenSpec change.

## License

By contributing, you agree your contributions are licensed under the MIT License.
