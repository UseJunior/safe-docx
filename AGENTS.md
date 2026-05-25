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

## ECMA-376 conformance

safe-docx targets a defined subset of [ECMA-376 5th edition](spec-compliance/CONFORMANCE.md).
Spec conformance is a foundational property of this repo, not a side concern, so the
machinery lives at the repo root rather than under `openspec/`.

- **Targeted sections + Non-Goals:** [`spec-compliance/registry/ecma-376.md`](spec-compliance/registry/ecma-376.md)
- **Vendored normative schemas:** [`spec-compliance/ecma-376/schemas/`](spec-compliance/ecma-376/schemas/)
- **Citation-hygiene rules + `@conformance` tag grammar:** [`spec-compliance/AGENTS.md`](spec-compliance/AGENTS.md)

When editing OOXML behavior, lead conformance claims with a `@conformance ECMA-376 edition <N>, Part <N> § <SECTION>`
JSDoc tag and demote internal `#NNN` issue references to `@see`. Tests use
`testAllure.conformance({ spec, edition, part, section })`. The lint
`npm run check:conformance-citations` enforces both.

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
- All CI checks must pass locally before pushing: `npm run build && npm run lint:workspaces && npm run test:run && npm run check:spec-coverage && npm run check:conformance-citations && npm run check:conformance-doc`

## Skills

A skill is a set of local instructions stored in a `SKILL.md` file.

### Available skills

- `docx-editing`: Surgically edit existing (brownfield) .docx files with formatting preservation and tracked changes via the Safe-DOCX MCP server. Use when reading, searching, editing, commenting on, or comparing Word documents — not for from-scratch generation. (file: `skills/docx-editing/SKILL.md`)
