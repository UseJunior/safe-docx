# Release Runbook

This document describes how releases work in the safe-docx monorepo.

## Commit Message Conventions

All commits to `main` must follow [Conventional Commits](https://www.conventionalcommits.org/). The PR title is the commit message (squash merge).

| Type       | When to use                                    |
|------------|------------------------------------------------|
| `feat`     | New feature or capability                      |
| `fix`      | Bug fix                                        |
| `refactor` | Code restructuring with no behavior change     |
| `test`     | Adding or updating tests                       |
| `docs`     | Documentation-only changes                     |
| `chore`    | Dependency bumps, config changes, maintenance  |
| `ci`       | CI/CD workflow changes                         |
| `perf`     | Performance improvements                       |
| `style`    | Code style / formatting                        |
| `revert`   | Reverting a previous commit                    |
| `build`    | Build system changes                           |

Scope is optional but recommended for package-specific changes:

```
feat(docx-core): add paragraph diffing
fix(docx-mcp): correct session cleanup on timeout
chore(release): bump workspace versions to 0.2.0
```

## Release Process

### 1. Bump versions

Update the version in all four package manifests and the MCPB `manifest.json`:

- `packages/docx-core/package.json`
- `packages/docx-mcp/package.json`
- `packages/safe-docx/package.json`
- `packages/safe-docx-mcpb/package.json`
- `packages/safe-docx-mcpb/manifest.json`

Commit: `chore(release): bump workspace versions to X.Y.Z`

### 2. Tag and push

```bash
git tag vX.Y.Z
git push origin main --tags
```

### 3. Monitor the release workflow

The workflow runs these jobs in order:

```
preflight → publish-suite → ensure-release → publish-mcpb-asset → update-changelog-data
```

- **preflight**: Full CI gate (build, lint, test, coverage, spec checks)
- **publish-suite**: Publishes `@usejunior/docx-core`, `@usejunior/docx-mcp`, `@usejunior/safe-docx` to npm
- **ensure-release**: Creates the GitHub Release with auto-generated notes
- **publish-mcpb-asset**: Attaches `safe-docx.mcpb` + checksum to the release
- **update-changelog-data**: Regenerates `changelog.json` and opens a PR

### 4. Verify

- [ ] npm packages are published with provenance
- [ ] GitHub Release exists with categorized notes
- [ ] MCPB asset is attached to the release
- [ ] Changelog data PR is opened (merge it to update the trust site)

## Monorepo Version Coupling

All publishable packages share the same version. The preflight job verifies that the tag version matches every `package.json` and the MCPB `manifest.json`. If any mismatch exists, the release fails before publishing.

## Fixing Bad Release Notes

1. Edit the release notes directly on the [GitHub Releases page](https://github.com/UseJunior/safe-docx/releases)
2. Re-run the changelog generator to pick up the edits:
   ```bash
   node scripts/generate_changelog_data.mjs
   ```
3. Commit and push the updated `changelog.json`

## Backfilling Missing Releases

If a release was never created on GitHub (e.g., early versions):

```bash
gh release create v0.1.0 --target <commit-sha> --generate-notes --title "v0.1.0"
```

Then regenerate changelog data.

## Troubleshooting

### MCPB asset job fails

The GitHub Release is still created by `ensure-release` (it no longer depends on MCPB success). Re-run just the `publish-mcpb-asset` job via workflow dispatch.

### Stale changelog data

The `update-changelog-data` job runs automatically on release. If it fails or you need a manual refresh:

```bash
node scripts/generate_changelog_data.mjs
node scripts/check_changelog_data.mjs
```

### Local `gh` auth

The generator requires the GitHub CLI to be authenticated:

```bash
gh auth login
gh auth status  # verify
```

In CI, the workflow sets `GH_TOKEN: ${{ github.token }}` — no manual auth needed.
