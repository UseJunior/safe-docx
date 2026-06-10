# Change: Isolate ODF package releases from the DOCX suite

## Why

The repo will gain `@usejunior/odf-core` and an `odf` MCP backend (see the ODF
support roadmap). Those packages will start at `0.x` and churn rapidly while the
DOCX suite (`docx-core`, `docx-mcp`, `google-docs-core`, `safe-docx`,
`safe-docx-mcpb`) is stable at `0.9.1`.

`release.yml` enforces **suite-wide version lockstep**: the preflight
"Verify tag matches package suite versions" step fails the release unless the
`v*.*.*` tag equals every suite package's `version` *and* the
`safe-docx-mcpb/manifest.json`, `safe-docx/server.json`,
`safe-docx/.smithery/shttp/manifest.json`, and `gemini-extension.json` versions.

If ODF packages were added to that lockstep, every ODF `0.x` bump would force a
version bump (and a full re-publish + provenance + MCP-registry round) of the
stable DOCX suite. That is the rejected option. We need ODF to version
independently **before any ODF package is published**, so this is a blocker for
the ODF workstream.

The good news, established by reading the current pipeline: the suite-version
check and the publish job both iterate **hardcoded allowlists** of the five
DOCX packages, and the release workflow triggers only on `v*.*.*` tags. A new
`packages/odf-core` is therefore invisible to the DOCX release today — the
coupling only appears if someone *adds* ODF to those hardcoded lists. The risk
is silent regression (a future contributor "completes the set"), not a current
break.

## What Changes

- Add a **release-isolation capability spec** stating that ODF packages version
  and publish on their own track, decoupled from the DOCX suite tag.
- Establish the **`private: true` convention for ODF packages**: every ODF
  package is born `private` and stays private until the independent ODF release
  track exists and passes its own preflight. `private` packages build, test, and
  develop normally in the workspace; npm simply refuses to publish them.
- Add a **CI guard** (`scripts/check-release-isolation.mjs`, wired into an
  existing required check) with two assertions:
  1. **Workflow-snapshot check** — the DOCX package lists hardcoded in
     `release.yml` (version-pin, duplicate-publish, dry-run pack, and publish)
     each equal a fixed expected DOCX set. Adding *any* new package (ODF or
     otherwise) to those lists fails the guard. This directly protects the
     coupling mechanism — being on a release list — rather than inferring it
     from a package's `private` flag.
  2. **ODF-private check** — any workspace package whose name matches `odf` must
     be `private: true`.
  Together these make the lockstep coupling impossible to reintroduce by
  accident without touching `release.yml`'s lists or un-privating an ODF
  package, both of which now fail CI.
- **Defer** building the independent ODF release pipeline (`release-odf.yml`)
  until ODF is a real, functioning package at a genuine publish-readiness gate
  (post Phase 1). This proposal does **not** build that pipeline and does **not**
  publish anything; it records the decision and notes that the future track will
  use a non-colliding `odf-v*` git-tag prefix so it slots in without touching
  `release.yml`.
- **No name-squatting.** We do **not** publish a thin/placeholder `odf-mcp`
  (unscoped) entrypoint to reserve the npm name. ODF packages publish only when
  they are real, functioning artifacts. This drops the earlier "claim the
  `odf-mcp` name early" goal — reserve-only publishing is against npm policy and
  not how we want to claim the brand.

## Impact

- Affected specs: new `release-publishing` capability (additive).
- Affected code: `scripts/check-release-allowlist.mjs` (new), one wire-up line
  in the package-level `package.json`/CI lint step that runs it; no change to
  `release.yml` and no change to any DOCX package version.
- No ODF package exists yet, so the ODF-private rule is forward-looking policy
  enforced by the guard rather than an edit to an existing manifest.
- Out of scope (named, not fixed): `@usejunior/allure-test-factory` is
  `private: false` yet unpublished (npm 404) and absent from every release list
  — a pre-existing inconsistency. The guard's workflow-snapshot design tolerates
  it deliberately (it is not on any release list, so it is not coupling risk);
  this change does not mark it private or otherwise touch it.
- Unblocks the ODF workstream: odf-core can be built and merged without any risk
  of coupling to — or churn on — the stable DOCX release.

## Revision (2026-06-10, issue #372)

The deferred independent ODF release track is **not being built**; `@usejunior/odf-core`
joins the main suite release train instead. The original isolation premise — a rapidly
churning experimental lane that must not force suite republishes — no longer holds:

- The ODF lane shipped end-to-end (#328, #335, #336, #341, #348, #366): the published
  `docx-mcp` server loads `odf-core` at runtime for every `.odt` tool call, so the two
  packages are version-coupled de facto. An independent track would add a cross-track
  compatibility range to manage while delivering nothing (suite republishes are fully
  automated and effectively free).
- Keeping odf-core private makes the shipped ODF features unreachable for npm users:
  `loadOdfCore()` returns null in a production install and every `.odt` call fails with
  `MISSING_DEPENDENCY`.

What changes relative to the original proposal:

- `odf-core` drops `private: true`, gains publish metadata, and is added to all four
  `release.yml` loops (publish ordered after `docx-core`, before `docx-mcp`).
- `docx-mcp` declares `@usejunior/odf-core` as a regular dependency — ODF works out of
  the box. (Google Docs stays an optional peer because it needs external OAuth setup;
  ODF needs nothing.)
- The guard (`scripts/check-release-isolation.mjs`) keeps assertion A (workflow
  snapshot, now including odf-core) and replaces the ODF-must-be-private assertion with
  its inverse for the publish surface: any `private: true` package on the publish list
  fails CI (it would otherwise fail the release at tag time).
- The `odf-v*` tag namespace is retired unused; no `release-odf.yml` will be built.
- Bootstrap: npm trusted publishing can only be configured for an existing package, so
  the first `@usejunior/odf-core` publish is manual (interactive, at the current suite
  version), then the package's trusted publisher is configured to mirror the other four
  and the next suite tag publishes it via OIDC.

The spec delta below reflects the revised policy.
