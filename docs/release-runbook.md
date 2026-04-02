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

```bash
node scripts/bump_version.mjs <version>
```

This script is the source of truth for which files are managed (package manifests, MCPB manifest, cross-workspace dependency ranges, and `package-lock.json`). Do not bump versions manually.

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

- [ ] `node scripts/bump_version.mjs --check` confirms all managed files are in sync
- [ ] npm packages are published with provenance
- [ ] GitHub Release exists with categorized notes
- [ ] MCPB asset is attached to the release
- [ ] Changelog data PR is opened (merge it to update the trust site)

### 5. MCP Registry Submissions

After npm publish, submit the package to each registry target:

1. **Official MCP Registry** (`registry.modelcontextprotocol.io`) — Requires `packages/safe-docx/server.json` (already managed by the bump script). Submit via the [registry quickstart](https://modelcontextprotocol.io/registry/quickstart).
2. **Anthropic Connectors Directory** — Separate from the official registry. Submit local MCP servers via the [Google Form](https://support.claude.com/en/articles/12922832-local-mcp-server-submission-guide).
3. **mcpservers.org** — Manual web form at https://mcpservers.org/submit.
4. **Smithery.ai** — Publish via https://smithery.ai/docs/build/publish or https://smithery.ai/new.
5. **Glama.ai** — Auto-discovers from GitHub/registry. Verify listing after registry publish + sync window (not tied to npm timing).
6. **PulseMCP** (`pulsemcp.com`) — Submit via web form.
7. **mcp.so** — Submit via directory form.
8. **mcpmarket.com** — Submit via listing form.

> **Note:** These URLs were verified as of 2026-04-02. Confirm they are still current at submission time.

## Monorepo Version Coupling

All publishable packages share the same version. The preflight job verifies that the tag version matches all files managed by `bump_version.mjs`. If any mismatch exists, the release fails before publishing.

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
