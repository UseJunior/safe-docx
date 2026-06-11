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

**Valid types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`, `style`, `revert`, `build`

**Scopes** should match the package or area you're changing:
- `fix(docx-core):` — bug fix in the core OOXML library
- `feat(docx-mcp):` — new feature in the MCP server
- `docs(contributing):` — documentation updates
- `chore(ci):` — CI/CD changes

Scope your commits to one package when possible. Cross-package changes should use the primary package as scope.

**Subject casing:** The subject (the part after the colon) must not start with a Title Case word like "Add" or "Update". Lowercase starts and all-caps acronyms (SHA, API, URL) are fine.

**Reference issues** in the commit body: `Fixes: #N` (closes the issue) or `Ref: #N` (related but doesn't close).

## Pull Request Guidelines

Pull request titles follow the same Conventional Commits format as commit messages. A CI check (`Validate conventional title`) enforces this on every PR.

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

## LLM-Based Quality Gate

`safe-docx` runs an LLM-based pull-request reviewer in addition to the mechanical CI suite. The gate uses Gemini to read your PR diff and answer a fixed checklist of safe-docx-specific questions (OOXML invariants, tracked-changes correctness, side-part sweeps, paired-artifact updates). It is **advisory** during Phase 1 — it posts a comment with a verdict table but never blocks merge.

### What you'll see

When you open a PR (or mark a draft ready for review), the `LLM-Based Quality Gate` workflow fires and adds a comment within a few minutes. The comment summarizes each checklist item as PASS or WARN, with one-to-two-sentence justifications and file citations.

Most checklist questions begin with `If this PR touches X...`. If your diff doesn't touch the area, the model returns PASS with a one-line note. Items whose preconditions match your diff get a real review.

### Manual re-run

If you fix something raised by a WARN and want to re-run the gate without pushing a new commit, dispatch the workflow manually:

- **Actions → LLM-Based Quality Gate → Run workflow → enter the PR number**

This updates the existing comment rather than appending a new one.

### Override label (Phase 2+)

Once the gate moves to blocking mode, applying the `llm-gate/override` label to a PR causes WARN findings to be non-blocking on that PR. Add a comment explaining why you're overriding. The label is for cases where the reviewer mis-applied a checklist item or the maintainer has decided the WARN is acceptable.

### Adding or editing checklist items

Checklist items live in `.github/llm-based-quality-gate/checklist.md`. Each `- [ ] <question>` line becomes one independent Gemini call. The workflow parses this file from the PR's base ref at runtime, so:

- You **cannot** weaken the checklist by editing it in a PR — the gate uses the base-ref version of the file.
- To add or refine an item, open a separate PR against `main`. The new item takes effect on subsequent PRs.

The system prompt (`.github/llm-based-quality-gate/system-prompt.md`) and composite action (`.github/actions/llm-gate-check/action.yml`) are read from the same trusted base-ref checkout, for the same reason.

If you change a fundamental OOXML invariant or repo orientation listed in `system-prompt.md` (the "OOXML invariants" or "Repo orientation" sections), update the prompt in the same PR — otherwise the model will reason against a stale picture of the codebase.

## License

By contributing, you agree your contributions are licensed under the Apache License 2.0 (inbound = outbound, per its §5).
