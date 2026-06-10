## ADDED Requirements

### Requirement: ODF core publishes with the DOCX suite release

The system SHALL version and publish `@usejunior/odf-core` as part of the suite release:
its version SHALL match the suite lockstep version (and therefore the `v*.*.*` release
tag), and `release.yml` SHALL include it in the version-pin, duplicate-publish, dry-run
pack, and publish lists, publishing in dependency order (after `@usejunior/docx-core`,
before `@usejunior/docx-mcp`).

`@usejunior/docx-mcp` SHALL declare `@usejunior/odf-core` as a regular dependency so a
production install resolves it and `.odt` tools work out of the box; the dynamic
`loadOdfCore()` loader remains as defense in depth and degrades to a clear
`MISSING_DEPENDENCY` error if the package is somehow absent.

*(Revision note: this replaces the original independent-track design — `odf-v*` tags and
`release-odf.yml` are retired unused. See the proposal's 2026-06-10 revision for why.)*

#### Scenario: [ORP-01] Suite tag publishes odf-core with the suite
- **WHEN** a `v*.*.*` release tag is pushed
- **THEN** the preflight requires `packages/odf-core` to match the tag version and the publish step publishes `@usejunior/odf-core` after `docx-core` and before `docx-mcp`

#### Scenario: [ORP-02] Production installs get ODF support out of the box
- **WHEN** the published `@usejunior/docx-mcp` (or the `@usejunior/safe-docx` wrapper) is installed from npm
- **THEN** `@usejunior/odf-core` is installed as a dependency and `.odt` tool calls do not fail with `MISSING_DEPENDENCY`

### Requirement: Release lists are snapshot-guarded against surface drift

The system SHALL enforce, in CI, that the hardcoded suite package lists in
`release.yml` (the version-pin list, the duplicate-publish guard list, the dry-run pack
list, and the publish list) each equal a fixed expected set that includes
`odf-core`. If any list gains or loses a package, the guard SHALL fail until the
expected snapshot is deliberately updated alongside `release.yml`. This protects the
actual release mechanism (membership in a release list) so the publish surface can only
change on purpose.

#### Scenario: [ORP-03] Changing a release list fails the guard until the snapshot is updated
- **WHEN** a package name is added to or removed from any of the hardcoded suite lists in `release.yml` without updating the guard's expected snapshot
- **THEN** the guard exits non-zero, naming the list and the unexpected or missing package

### Requirement: Publish-list packages must be publishable

The system SHALL require every package on the npm publish list to NOT be marked
`private: true`. A private package on the publish surface would fail the release at tag
time; the guard SHALL catch it at PR time with the offending package path and remedy.

#### Scenario: [ORP-04] A private package on the publish list fails CI
- **WHEN** a package on the publish list sets `"private": true`
- **THEN** the release-surface guard exits non-zero, naming the package and the remedy

### Requirement: First publish of a new suite package is a manual bootstrap

The system SHALL bootstrap a newly added suite package by a one-time manual publish at
the current suite version (npm trusted publishing can only be configured for an
already-existing package), followed by configuring the package's trusted publisher to
match the existing suite packages; subsequent suite tags publish it via OIDC like the
rest. The duplicate-publish guard SHALL treat the manually published version as already
released and skip it without failing.

#### Scenario: [ORP-05] Manual bootstrap version is skipped, next tag publishes via OIDC
- **WHEN** a new suite package was manually published at version X and a suite tag for version Y > X is later pushed
- **THEN** the duplicate-publish guard passes (Y is unpublished) and the workflow publishes version Y via trusted publishing
