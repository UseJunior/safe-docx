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

## 6. Revision (2026-06-10, issue #372): fold odf-core into the suite train
- [x] 6.1 Drop `private: true` from `packages/odf-core` and add `publishConfig.access: public` (other publish metadata already present)
- [x] 6.2 Add `@usejunior/odf-core` to `docx-mcp` `dependencies` (ODF works out of the box; gdocs stays optional-peer)
- [x] 6.3 Add odf-core to all four `release.yml` loops, publish ordered after docx-core / before docx-mcp
- [x] 6.4 Guard: include odf-core in `EXPECTED_LOOPS`; replace the ODF-private assertion with the publish-list-publishable assertion; update tests
- [x] 6.5 Rewrite the `release-publishing` delta to the revised policy (ORP-01..05); proposal addendum records the reversal rationale
- [x] 6.6 Sync human-facing format claims: npm descriptions/keywords (`odt`, `opendocument`, `libreoffice`), `server.json`, MCPB manifest, `gemini-extension.json`, root + docx-mcp READMEs
