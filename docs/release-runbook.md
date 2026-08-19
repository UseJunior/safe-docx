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

### 2. Tag (automated)

Merging the bump PR is the release trigger. The `Auto-tag release` workflow
(`.github/workflows/auto-tag-release.yml`) runs on every push to `main`; when the
push changed the root `package.json` version and no `v<version>` tag exists yet,
it pushes the tag with the release-bot App token, and the tag push triggers the
release workflow below.

Manual fallback (auto-tag failed, or releasing a commit other than the current
`main` tip):

```bash
git tag vX.Y.Z <commit-sha>
git push origin vX.Y.Z
```

When post-merge verification must finish before the tag is created, commit a
`.release-manual-tag` file containing exactly the release version. The auto-tag
workflow will deliberately skip that version regardless of merge strategy;
after verifying the exact `main` commit, create and push the tag with the manual
fallback commands above. Remove the sentinel in a later maintenance PR.

Two constraints to preserve when touching this machinery:

- The tag must be pushed with a GitHub App or PAT credential. Tags created with
  the workflow-scoped `GITHUB_TOKEN` do not trigger `release.yml`.
- npm trusted publishing (OIDC) is pinned to the `release.yml` workflow filename.
  Never move `npm publish` or `mcp-publisher publish` into another workflow file —
  the trusted-publisher claim match would fail and the publish would be rejected.

### 3. Monitor the release workflow

The workflow runs these jobs in order:

```
preflight → publish-suite → ensure-release → publish-mcpb-asset → update-changelog-data
                         ↘ publish-mcp-registry (parallel, soft-fail)
```

- **preflight**: Full CI gate (build, lint, test, coverage, spec checks)
- **publish-suite**: Publishes the version-locked npm suite in dependency order. `@usejunior/docx-markdoc` follows `docx-core` and `docx-compare`.
- **ensure-release**: Creates the GitHub Release with auto-generated notes
- **publish-mcp-registry**: Publishes `server.json` to the official MCP Registry via OIDC (soft-fail; does not block other jobs)
- **publish-mcpb-asset**: Attaches `safe-docx.mcpb` + checksum to the release
- **update-changelog-data**: Regenerates `changelog.json` and opens a PR

### 4. Verify

- [ ] `node scripts/bump_version.mjs --check` confirms all managed files are in sync
- [ ] npm packages are published with provenance
- [ ] GitHub Release exists with categorized notes
- [ ] MCPB asset is attached to the release
- [ ] Changelog data PR is opened (merge it to update the trust site)
- [ ] MCP Registry version is current (`publish-mcp-registry` job; soft-fail during preview)

### 5. MCP Registry Submissions

After npm publish, submit the package to each registry target:

1. **Official MCP Registry** (`registry.modelcontextprotocol.io`) — **Automated.** Published by the `publish-mcp-registry` CI job via GitHub OIDC. Verify at `https://registry.modelcontextprotocol.io/server/io.github.UseJunior/safe-docx`. Falls back to manual via the [registry quickstart](https://modelcontextprotocol.io/registry/quickstart) if the job fails.
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

### Bootstrapping a new npm package

The publish loop is resumable: it skips package versions that already exist and
fails only when every suite package is already present. This matters when a new
package has no npm trusted-publisher configuration yet. Earlier dependencies
may publish before npm rejects the new package; after the one-time manual
bootstrap and trusted-publisher setup, dispatch `release.yml` again with the
same tag. The rerun skips published versions and continues in dependency order.

For v0.20.0 specifically, do not publish `@usejunior/docx-markdoc@0.19.1` and do
not manually publish `@usejunior/docx-markdoc@0.20.0` until
`@usejunior/docx-core@0.20.0` is visible on npm. If the first trusted-publishing
run stops at `docx-markdoc`, run the locally prepared bootstrap script:

```bash
/private/tmp/publish-docx-markdoc-release.sh 0.20.0
```

It performs npm web login and publishes only `docx-markdoc` from a clean,
detached checkout of `v0.20.0`. Then configure npm trusted publishing for
`UseJunior/safe-docx` and workflow `release.yml` before rerunning that tag.

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

### MCP Registry publish fails

The `publish-mcp-registry` job uses `continue-on-error: true` — failures appear yellow in the Actions UI but don't block the release. To retry:

1. Re-run the failed job via the Actions UI
2. Or publish manually:
   ```bash
   # Download mcp-publisher
   curl -fsSL "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_amd64.tar.gz" | tar xz mcp-publisher
   ./mcp-publisher login github
   ./mcp-publisher publish packages/safe-docx/server.json
   ```

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
