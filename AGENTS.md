<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

## Workflow Conventions

Follow all conventions in [CONTRIBUTING.md](CONTRIBUTING.md). The rules below are **mandatory** for AI agents:

### Branch Naming
- ALWAYS create a branch before committing. Never commit directly to `main`.
- Issue work: `{issue}-{short-description}-{YYYYMMDD}` (e.g., `42-add-redline-support-20260221`)
- Minor fixes: `tweak-{description}` (e.g., `tweak-fix-typo-in-readme`)

### Commits
- Use conventional commit format: `type(scope): imperative description`
- Valid types: feat, fix, refactor, test, docs, chore, ci, perf, style
- Scope to the package: `feat(docx-primitives):`, `fix(safe-docx):`, `refactor(docx-comparison):`
- Body MUST explain WHY, not just what. Longer is better.
- Reference the issue: `Fixes: #N` or `Ref: #N`

### Pull Requests
- Keep PRs small and focused — one concern per PR.
- NEVER force push after a review has started.
- Include screenshots for any visual changes.

### Pre-submit
- All CI checks must pass locally before pushing: `npm run build && npm run lint:workspaces && npm run test:run && npm run check:spec-coverage`

## Skills

A skill is a set of local instructions stored in a `SKILL.md` file.

### Available skills

- `unit-test-philosophy`: Risk-based unit testing and Allure-readable behavior-spec conventions for this monorepo. Use when adding/updating tests, expanding coverage, or reviewing test quality. (file: `/Users/stevenobiajulu/Projects/safe-docx/skills/unit-test-philosophy/SKILL.md`)
