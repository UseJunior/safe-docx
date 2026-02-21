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

## Skills

A skill is a set of local instructions stored in a `SKILL.md` file.

### Available skills

- `unit-test-philosophy`: Risk-based unit testing and Allure-readable behavior-spec conventions for this monorepo. Use when adding/updating tests, expanding coverage, or reviewing test quality. (file: `/Users/stevenobiajulu/Projects/safe-docx/skills/unit-test-philosophy/SKILL.md`)
