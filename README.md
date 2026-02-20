# Safe DOCX Suite

Monorepo for the Safe DOCX package family.

## Packages

- `@usejunior/docx-primitives`
- `@usejunior/docx-comparison`
- `@usejunior/safe-docx`
- `safe-docx` (unscoped alias package)
- `@usejunior/safedocx-mcpb` (private MCP bundle wrapper)

## Development

```bash
npm ci
npm run build
npm run test:run
npm run check:spec-coverage
```

## npm Trusted Publishing (GitHub OIDC)

Releases are configured to publish from GitHub Actions using npm Trusted Publishing (OIDC), not long-lived `NPM_TOKEN` secrets.

One-time npm setup per package:

1. In npm package settings, add a trusted publisher.
2. Provider: GitHub Actions.
3. Owner: `UseJunior`
4. Repository: `safe-docx`
5. Workflow file: `.github/workflows/release.yml`
6. Environment: leave empty (unless you later add an Actions environment constraint).

Packages to configure:

- `@usejunior/docx-primitives`
- `@usejunior/docx-comparison`
- `@usejunior/safe-docx`
- `safe-docx`
