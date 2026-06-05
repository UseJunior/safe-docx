# Design: Isolate ODF package releases from the DOCX suite

## Context

`release.yml` is suite-versioned. The preflight job's
"Verify tag matches package suite versions" step iterates a hardcoded list:

```
packages/docx-core packages/docx-mcp packages/google-docs-core \
packages/safe-docx packages/safe-docx-mcpb
```

and additionally pins `safe-docx-mcpb/manifest.json`, `safe-docx/server.json`,
`safe-docx/.smithery/shttp/manifest.json`, and `gemini-extension.json` to the
tag version (all currently `0.9.1`). The `publish-suite` job publishes a
hardcoded four-package list (`docx-core`, `docx-mcp`, `google-docs-core`,
`safe-docx`). The workflow triggers on `push: tags: ["v*.*.*"]` and a
`workflow_dispatch` taking an existing `v*.*.*` tag.

Two facts, both verified against the current workflow, shape this design:

1. **`odf-v*.*.*` tags do not match the `v*.*.*` push trigger.** GitHub Actions
   tag globs are evaluated against the ref name and anchor at its start;
   `odf-v1.0.0` does not begin with `v`, so a future ODF release workflow can own
   the `odf-v*` namespace with zero overlap on the **push** trigger.
   `workflow_dispatch` is a separate matter — see "The dispatch input" below.
2. **The suite check and publish job are allowlist-driven, not
   discover-all.** A new `packages/odf-core` is not seen by either until it is
   explicitly added. So nothing is broken today — the exposure is a *latent*
   coupling a future contributor could introduce by "finishing the list."

`check:spec-coverage` (the traceability gate that `release.yml` runs) is scoped
only to the `docx-comparison` and `docx-primitives` specs, so introducing a new
`release-publishing` capability spec does not require test-traceability wiring.

## Goals / Non-Goals

**Goals**
- Guarantee ODF packages version and publish independently of the DOCX suite
  tag, decided and enforced *before* any ODF package is published.
- Make the rejected "add ODF to the suite lockstep" option fail CI rather than
  rely on reviewer vigilance.
- Choose a non-colliding `odf-v*` git-tag prefix for the future independent
  track (our own repo's tags — not an external name reservation) without
  building that track now. No placeholder publish to claim any npm name.

**Non-Goals**
- Building `release-odf.yml` (the independent publish pipeline). Deferred until
  ODF has a real published shape — see "Decisions / Staging".
- Creating `packages/odf-core` or any ODF code (Phase 1).
- Changing any DOCX package version or the DOCX release pipeline.

## Decision

### The three options, weighed

| Option | Clears the blocker? | Cost now | Risk |
| --- | --- | --- | --- |
| **A. Independent release track now** (`odf-v*` + full `release-odf.yml`) | Yes | High — a full parallel preflight/publish/provenance/MCP-registry pipeline | Pipeline is built against a *guessed* package shape (no odf-core exists), bitrots until Phase 2 actually publishes |
| **B. ODF-private + workflow-snapshot guard now; build the track at publish-time** (recommended) | Yes | Low — one guard script + a spec | None to the DOCX suite; the independent track is built later when the shape is known |
| **C. Suite-wide lockstep** (add ODF to the hardcoded lists) | No | Low | Rejected — forces churn/re-publish of the stable DOCX suite on every ODF `0.x` bump |

**Recommendation: Option B.** The plan's stated preference was Option A
("independent release track"), and B reaches the *same end state* — an
`odf-v*`-tagged independent pipeline — but sequences it correctly. Building a
publish pipeline before the package it publishes exists means guessing the
`server.json` / smithery / provenance / MCP-registry surface for odf-core and
maintaining dead YAML across all of Phase 1. Option B clears the blocker today
with a guard that is a few dozen lines, and defers the pipeline to the moment we
actually know odf-core's published shape. The `odf-v*` namespace reservation in
this spec means the deferred track slots in without ever editing `release.yml`.

This is a sequencing disagreement with the plan, not a destination
disagreement — surfaced deliberately rather than averaged away.

### Staging

- **Now (this change):** spec + `private: true` convention + allowlist guard.
- **Phase 1:** `packages/odf-core` is created with `"private": true`; the guard
  keeps it off the DOCX release automatically.
- **Pre-publish (post Phase 1, separate change):** build `release-odf.yml` on
  the `odf-v*` trigger with its own preflight/publish, flip odf packages to
  publishable, and add them to an **ODF** allowlist (never the DOCX one).

### The dispatch input

`release.yml`'s `workflow_dispatch` takes a **free-string** `release_tag` input
(with `v0.1.1` only as an example), not a `v*.*.*`-constrained value. So a
maintainer *could* manually dispatch with `odf-v1.0.0`. That is safe by failure,
not by trigger: preflight computes `TAG_VERSION="${TAG_REF#v}"`, which leaves
`odf-v1.0.0` unchanged (it has no leading `v`), and the suite-version check then
fails because `odf-v1.0.0` matches no DOCX package version. The non-overlap
guarantee is therefore: **push** never fires DOCX release on an `odf-v*` tag, and
a **manual dispatch** of one fails preflight before publishing anything. An
optional belt-and-suspenders hardening — an explicit
`^v[0-9]+\.[0-9]+\.[0-9]+` assertion in preflight — is listed in Open Questions;
it edits `release.yml`, so it is not part of this change's required scope.

### The guard

`scripts/check-release-isolation.mjs`. Two assertions, both pure JSON/text
inspection (no network, no build), wired into the existing workspace-lint
required check:

**A. Workflow-snapshot check (the real anti-coupling enforcement).** The guard
holds the four expected DOCX package lists as the single source of truth and
asserts each matches the corresponding hardcoded list in `release.yml`:
- version-pin list (`release.yml` preflight),
- duplicate-publish guard list,
- dry-run pack list,
- publish list.
Adding *any* package — ODF or otherwise — to one of these lists changes the
snapshot and fails the guard, with the offending list + package named. This
guards the coupling mechanism directly (membership in a release list), so it is
robust to packages like `allure-test-factory` that are non-private but on no
release list. To keep the comparison robust rather than parsing shell `for`
loops with a regex, the guard reads the workflow text and asserts each expected
package name is present in the relevant step *and* that no unexpected
`@usejunior/*` / `packages/*` token appears in those steps; the exact extraction
is an implementation detail to be covered by the guard's own unit test.

**B. ODF-private check.** Enumerate workspace packages by reading the root
`package.json` `workspaces` globs and expanding them (e.g. `packages/*` →
`packages/*/package.json`). **Do not** use `npm query .workspace` — verified
against npm 11.12.1 it returns `[]` and `npm query ':workspace'` errors
`EQUERYNOPSEUDO`. For each package whose name matches `/odf/`, assert
`private: true`; otherwise fail with the package name and the remedy. This is
narrow (touches only ODF packages) and forward-looking (no ODF package exists
yet, so it is a no-op on the current tree).

Lifting condition (from review): no ODF package may set `private: false` until
the independent `release-odf.yml` track exists and passes its own preflight. The
ODF-private check enforces the "stays private" half; the spec records the
lifting condition so the future ODF-release change is the only place that
flips it.

## Risks / Trade-offs

- **Guard/workflow drift.** If `release.yml`'s hardcoded list changes and the
  guard's constant does not, the cross-check assertion fails — by design, that
  is the signal, not a bug. Accepted.
- **`private: true` blocks nothing developers need.** Workspaces build, test,
  typecheck, and cross-import private packages normally; only `npm publish`
  refuses. No DX cost.
- **Deferring the track means a second change later.** Accepted — that change is
  cheap *because* it is written against a real package, and it never touches the
  DOCX pipeline.
- **Residual monorepo CI coupling (named, not eliminated).** `release.yml`
  preflight runs `npm run build`, `npm run test`, and `npm run lint:workspaces`
  across *all* workspaces, so once `packages/odf-core` exists its build and tests
  must stay green for a DOCX release to proceed (same as `ci.yml`). This is
  *build/test* coupling, not *version/publish* coupling — odf-core never gets a
  version bump or a publish from the DOCX tag. It is the normal cost of a
  monorepo and is acceptable: odf-core must keep CI green regardless. The guard
  and `private: true` close the version/publish coupling, which is the one that
  forces churn; this build coupling does not force any DOCX version change.

## Migration Plan

Additive. New spec + new guard script + one wire-up line. No version bumps, no
`release.yml` edits, no ODF code. Rollback = delete the guard + spec; the repo
returns to its current allowlist-only (latent-coupling) state.

## Open Questions

- Optional preflight hardening: add `^v[0-9]+\.[0-9]+\.[0-9]+` validation on the
  `workflow_dispatch` `release_tag` input so a manual `odf-v*` dispatch fails
  with a clear message instead of incidentally via the version-mismatch check.
  Deferred — it edits `release.yml` and the safe-by-failure behavior already
  protects against publishing; fold it into the future `release-odf.yml` change.
- Whether the future `release-odf.yml` should be a sibling workflow or a
  parameterized reuse of `release.yml` via a matrix — decide when building it,
  against the real odf-core shape. Not in scope here.
- Whether the unscoped `odf-mcp` thin entrypoint publishes on the same
  `odf-v*` track or its own — revisit at publish-time (it depends on whether its
  version tracks odf-core).
