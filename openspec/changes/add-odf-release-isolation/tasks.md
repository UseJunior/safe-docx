## 1. Release-isolation guard
- [x] 1.1 Add `scripts/check-release-isolation.mjs`
- [x] 1.2 Assertion A (workflow-snapshot): encode the four expected DOCX lists (version-pin, duplicate-publish, dry-run pack, publish) as named constants and assert each matches the corresponding hardcoded list in `release.yml`; fail if any new/unexpected package appears in those steps
- [x] 1.3 Assertion B (ODF-private): enumerate workspace packages by reading root `package.json` `workspaces` globs and expanding them (NOT `npm query .workspace` — returns `[]` on npm 11.12); assert every package whose name matches `/odf/` is `private: true`
- [x] 1.4 Emit actionable failure output (offending list/package + remedy) and exit non-zero

## 2. CI wire-up
- [x] 2.1 Add a `check:release-isolation` script to the root `package.json`
- [x] 2.2 Run it from the existing workspace-lint required check so it gates every PR
- [x] 2.3 Confirm it passes on the current tree (workflow lists match snapshot; no `odf`-named package exists yet; `allure-test-factory` is intentionally not in scope)

## 3. Convention documentation
- [x] 3.1 Document the ODF `private: true` rule and its lifting condition (stays private until `release-odf.yml` exists and passes preflight) in the guard's header and/or `openspec/project.md` conventions
- [x] 3.2 Note the non-colliding `odf-v*` git-tag prefix for the future independent ODF release track (spec note; no workflow built, no placeholder publish to claim any npm name)

## 4. Verification
- [x] 4.1 Negative test: a temporary `odf`-named non-private fixture package makes Assertion B fail (then remove the fixture)
- [x] 4.2 Negative test: adding a fake package to a `release.yml` DOCX list makes Assertion A fail (then restore)
- [x] 4.3 `release.yml` is unchanged and no DOCX package version is touched (diff review)

## 5. OpenSpec
- [x] 5.1 Create change proposal
- [x] 5.2 Create design with the three options and recommendation
- [x] 5.3 Create `release-publishing` capability spec with scenarios
- [x] 5.4 `openspec validate add-odf-release-isolation --strict` passes
