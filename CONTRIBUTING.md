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

## Repository Layout

- `packages/docx-core`: OOXML comparison + primitives.
- `packages/docx-mcp`: MCP server and editing tools.
- `packages/safe-docx-mcpb`: private MCP bundle wrapper.
- `openspec/`: specs and change deltas.

## Branch Naming

Create a branch for every change — never commit directly to `main`.

- **Issue branches**: `{issue}-{description}-{YYYYMMDD}`
  - Example: `42-add-redline-support-20260221`
  - The date suffix is recommended (helps sort stale branches) but not required
- **Tweak branches**: `tweak-{description}` for changes too small to warrant an issue
  - Example: `tweak-fix-typo-in-readme`

## Conventional Commits

We use [Conventional Commits](https://www.conventionalcommits.org/) for clear, machine-readable history.

**Format:**
```
type(scope): imperative subject

Body explaining WHY this change was made, not just what changed.
Context, trade-offs, and alternatives considered are all welcome here.
Longer is better — think essay, not tweet.

Fixes: #42
```

**Valid types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`, `style`

**Scopes** should match the package or area you're changing:
- `fix(docx-core):` — bug fix in the core OOXML library
- `feat(docx-mcp):` — new feature in the MCP server
- `docs(contributing):` — documentation updates
- `chore(ci):` — CI/CD changes

Scope your commits to one package when possible. Cross-package changes should use the primary package as scope.

**Reference issues** in the commit body: `Fixes: #N` (closes the issue) or `Ref: #N` (related but doesn't close).

## Pull Request Guidelines

- **Keep PRs small and focused.** 10 small PRs are better than 1 monolithic one.
- **A PR doesn't have to be done** — or even work — but it should represent clean progress in one direction.
- **Decompose where possible.** For example, submit regexes + tests in one PR, then the feature that uses them in another.
- **Include screenshots or gifs** for any PR that touches something visual (diff output, formatting changes, etc.).
- Include test evidence for behavior changes.
- For new capabilities or behavior shifts, include an OpenSpec change.

**Maintainer exception:** During early development, maintainers may use larger PRs that bundle related changes. The small-PR guidance is most important for external contributions and for mature codebases where review load matters.

## Code Review Etiquette

- **Before your first review:** interactive rebase to clean up history is fine and encouraged.
- **After review begins:** do NOT force push. Reviewers need to see incremental changes on top of what they already reviewed.
- **After review completes:** squash merge or rebase to produce a clean history on `main`.

## Before Opening a PR

1. **Build**: `npm run build` passes
2. **Lint**: `npm run lint:workspaces` passes
3. **Test**: `npm run test:run` passes
4. **Spec coverage**: `npm run check:spec-coverage` passes
5. Keep OpenSpec traceability checks green
6. Update docs/specs when behavior changes

All checks must pass locally before pushing.

## License

By contributing, you agree your contributions are licensed under the MIT License.
