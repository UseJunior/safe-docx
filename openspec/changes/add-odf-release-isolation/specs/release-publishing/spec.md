## ADDED Requirements

### Requirement: ODF packages release independently of the DOCX suite

The system SHALL version and publish ODF packages (`@usejunior/odf-core` and any
future ODF package) on a release track that is decoupled from the DOCX suite
release tag. ODF versions SHALL NOT be required to match the DOCX suite version,
and an ODF version change SHALL NOT force a version bump or re-publish of any
DOCX suite package (`docx-core`, `docx-mcp`, `google-docs-core`, `safe-docx`,
`safe-docx-mcpb`).

This isolation guarantee covers the **version-pin and publish** behavior of the
DOCX release. It does NOT cover ordinary monorepo CI: the DOCX release preflight
runs all-workspace build/test/lint, so an ODF package must keep CI green like any
other workspace member. That is build health, not version/publish coupling.

The DOCX suite release SHALL continue to trigger on `v*.*.*` push tags. The
future independent ODF release track SHALL own the `odf-v*` tag namespace, which
does not match the DOCX `v*.*.*` push trigger.

#### Scenario: [ORP-01] ODF version bump does not bump or republish the DOCX suite
- **WHEN** an ODF package version is changed
- **THEN** no DOCX suite package version changes and the DOCX version-pin/publish preflight does not require any ODF package to match the tag

#### Scenario: [ORP-02] DOCX release tag ignores ODF packages
- **WHEN** a `v*.*.*` DOCX release tag is pushed
- **THEN** the suite-version preflight checks only the DOCX list and does not require any ODF package to match the tag

#### Scenario: [ORP-03] ODF push tag does not trigger the DOCX release
- **WHEN** a future `odf-v*` tag is pushed for an ODF release
- **THEN** it does not match the `v*.*.*` push trigger and does not start the DOCX `release.yml` workflow

#### Scenario: [ORP-04] Manual dispatch of an ODF tag fails safely
- **WHEN** the DOCX `release.yml` is manually dispatched with an `odf-v*` tag
- **THEN** preflight fails the suite-version check (the tag matches no DOCX package version) before anything is published

### Requirement: ODF packages must be private until their release track exists

The system SHALL require every workspace package whose name matches `odf` to be
marked `private: true`. ODF packages SHALL remain `private: true` until the
independent ODF release track (`release-odf.yml`) exists and passes its own
preflight; only that future change may set an ODF package `private: false`. A
`private: true` package builds, tests, and is consumed across the workspace
normally; npm refuses to publish it.

#### Scenario: [ORP-05] ODF core is private until its own publish gate
- **WHEN** `packages/odf-core` exists before the ODF release track is built
- **THEN** its `package.json` has `"private": true` and it is not published by the DOCX release

#### Scenario: [ORP-06] A non-private ODF package fails CI
- **WHEN** a workspace package whose name matches `odf` is not marked `private: true`
- **THEN** the release-isolation guard exits non-zero and the PR check fails with the offending package name

### Requirement: Release lists are snapshot-guarded against new packages

The system SHALL enforce, in CI, that the hardcoded DOCX package lists in
`release.yml` (the version-pin list, the duplicate-publish guard list, the
dry-run pack list, and the publish list) each equal a fixed expected DOCX set.
If any list gains an unexpected package — ODF or otherwise — the guard SHALL
fail. This protects the actual coupling mechanism (membership in a release list)
directly, rather than inferring it from a package's `private` flag, and so does
not depend on the private-ness of packages that are on no release list.

#### Scenario: [ORP-07] Adding a package to a DOCX release list fails the guard
- **WHEN** a package name is added to any of the four hardcoded DOCX lists in `release.yml`
- **THEN** the guard exits non-zero, naming the list and the unexpected package
